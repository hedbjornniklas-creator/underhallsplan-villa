import 'server-only'

import {
  FLOW_AI_MAX_PROPOSED_CHANGES,
  fingerprintFlowAiSnapshot,
  type FlowAiChange,
  type FlowAiEntityType,
  type FlowAiSnapshot,
} from '@/lib/renoapp/flowAi'
import {
  FlowAiServerError,
  buildRenoAppFlowAiSnapshot,
  verifyFlowAiApplyToken,
} from '@/lib/renoapp/flowAiServer'
import {
  requireRenoAppViewerContext,
  saveRenoAppAdminActionType,
  saveRenoAppAdminActionTypeParticipantRole,
  saveRenoAppAdminActionTypeQuestion,
  saveRenoAppAdminDocumentType,
  saveRenoAppAdminParticipantRole,
  saveRenoAppAdminQuestion,
  saveRenoAppAdminRequirement,
  saveRenoAppAdminReviewFlag,
  saveRenoAppAdminReviewFlagLink,
} from '@/lib/renoapp/server'

type JsonRecord = Record<string, unknown>

const BASE_ENTITY_TYPES = [
  'action_type',
  'document_type',
  'participant_role',
  'review_flag',
] as const satisfies readonly FlowAiEntityType[]

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown) {
  return text(value) || null
}

function positiveNumber(value: unknown, fallback = 100) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function parseAfter(change: FlowAiChange) {
  let value: unknown
  try {
    value = JSON.parse(change.afterJson)
  } catch {
    throw new FlowAiServerError('FLOW_AI_APPLY_CHANGE_INVALID', 400)
  }
  if (!isRecord(value)) throw new FlowAiServerError('FLOW_AI_APPLY_CHANGE_INVALID', 400)
  return value
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function entityMap(items: unknown[]) {
  return new Map(
    records(items)
      .map((item) => [text(item.key), item] as const)
      .filter(([key]) => Boolean(key))
  )
}

function mapId(map: Map<string, JsonRecord>, key: string, code: string) {
  const id = text(map.get(key)?.id)
  if (!id) throw new FlowAiServerError(code, 409)
  return id
}

function normalizeVerifiedChange(value: FlowAiChange) {
  const entityTypes = new Set<FlowAiEntityType>([
    'action_type',
    'question',
    'question_option',
    'document_type',
    'participant_role',
    'review_flag',
    'action_question_link',
    'action_document_link',
    'action_participant_link',
    'option_trigger',
    'review_flag_link',
  ])
  if (
    !text(value.changeId)
    || !entityTypes.has(value.entityType)
    || !['add', 'update', 'deactivate'].includes(value.operation)
    || !text(value.semanticKey)
    || value.validationStatus === 'blocked'
    || typeof value.afterJson !== 'string'
    || value.afterJson.length > 20_000
  ) {
    throw new FlowAiServerError('FLOW_AI_APPLY_CHANGE_INVALID', 400)
  }
  parseAfter(value)
  return value
}

function futureKeys(current: Map<string, JsonRecord>, changes: FlowAiChange[], entityType: FlowAiEntityType) {
  const keys = new Set(current.keys())
  for (const change of changes.filter((item) => item.entityType === entityType)) {
    if (change.operation === 'deactivate') keys.delete(change.semanticKey)
    else keys.add(change.semanticKey)
  }
  return keys
}

function preflightDependencies(input: {
  changes: FlowAiChange[]
  actionByKey: Map<string, JsonRecord>
  questionByKey: Map<string, JsonRecord>
  documentByKey: Map<string, JsonRecord>
  participantByKey: Map<string, JsonRecord>
  reviewFlagByKey: Map<string, JsonRecord>
}) {
  const actions = futureKeys(input.actionByKey, input.changes, 'action_type')
  const questions = futureKeys(input.questionByKey, input.changes, 'question')
  const documents = futureKeys(input.documentByKey, input.changes, 'document_type')
  const participants = futureKeys(input.participantByKey, input.changes, 'participant_role')
  const reviewFlags = futureKeys(input.reviewFlagByKey, input.changes, 'review_flag')
  const options = new Set<string>()
  for (const [questionKey, question] of input.questionByKey) {
    for (const option of records(question.options)) options.add(`${questionKey}.${text(option.key)}`)
  }
  for (const change of input.changes.filter((item) => item.entityType === 'question_option')) {
    const identity = `${change.parentSemanticKey ?? ''}.${change.semanticKey}`
    if (change.operation === 'deactivate') options.delete(identity)
    else options.add(identity)
  }

  for (const change of input.changes) {
    const parent = change.parentSemanticKey ?? ''
    if (change.entityType === 'question_option' && !questions.has(parent)) {
      throw new FlowAiServerError('FLOW_AI_APPLY_DEPENDENCY_MISSING', 409)
    }
    if (change.entityType === 'action_question_link' && (!actions.has(parent) || !questions.has(change.semanticKey))) {
      throw new FlowAiServerError('FLOW_AI_APPLY_DEPENDENCY_MISSING', 409)
    }
    if (change.entityType === 'action_document_link' && (!actions.has(parent) || !documents.has(change.semanticKey))) {
      throw new FlowAiServerError('FLOW_AI_APPLY_DEPENDENCY_MISSING', 409)
    }
    if (change.entityType === 'action_participant_link' && (!actions.has(parent) || !participants.has(change.semanticKey))) {
      throw new FlowAiServerError('FLOW_AI_APPLY_DEPENDENCY_MISSING', 409)
    }
    if (change.entityType === 'option_trigger') {
      const [kind, ...targetParts] = change.semanticKey.split(':')
      const targetKey = targetParts.join(':')
      const targetExists = kind === 'question'
        ? questions.has(targetKey)
        : kind === 'document'
          ? documents.has(targetKey)
          : kind === 'participant_role'
            ? participants.has(targetKey)
            : kind === 'review_flag'
              ? reviewFlags.has(targetKey)
              : false
      if (!options.has(parent) || !targetExists) {
        throw new FlowAiServerError('FLOW_AI_APPLY_DEPENDENCY_MISSING', 409)
      }
    }
    if (change.entityType === 'review_flag_link') {
      const [kind, ...targetParts] = change.semanticKey.split(':')
      const targetKey = targetParts.join(':')
      const targetExists = kind === 'action_type'
        ? actions.has(targetKey)
        : kind === 'document_type'
          ? documents.has(targetKey)
          : kind === 'participant_role'
            ? participants.has(targetKey)
            : false
      if (!reviewFlags.has(parent) || !targetExists) {
        throw new FlowAiServerError('FLOW_AI_APPLY_DEPENDENCY_MISSING', 409)
      }
    }
  }
}

async function applyBaseChange(
  change: FlowAiChange,
  maps: {
    actionByKey: Map<string, JsonRecord>
    documentByKey: Map<string, JsonRecord>
    participantByKey: Map<string, JsonRecord>
    reviewFlagByKey: Map<string, JsonRecord>
  }
) {
  const after = parseAfter(change)
  if (change.entityType === 'action_type') {
    const existing = maps.actionByKey.get(change.semanticKey)
    const saved = await saveRenoAppAdminActionType({
      id: text(existing?.id) || null,
      categoryId: typeof after.categoryId === 'string' || after.categoryId === null ? after.categoryId : undefined,
      key: change.semanticKey,
      label: text(after.label),
      description: optionalText(after.description),
      riskLevel: after.riskLevel === 'low' || after.riskLevel === 'high' ? after.riskLevel : 'medium',
      contractorRequirement:
        after.contractorRequirement === 'qualified_contractor'
        || after.contractorRequirement === 'authorized_electrician'
        || after.contractorRequirement === 'safe_water'
        || after.contractorRequirement === 'bkr_or_gvk'
        || after.contractorRequirement === 'structural_engineer'
          ? after.contractorRequirement
          : 'none',
      impliesStructure: bool(after.impliesStructure, false),
      impliesPlumbing: bool(after.impliesPlumbing, false),
      impliesVentilation: bool(after.impliesVentilation, false),
      impliesElectrical: bool(after.impliesElectrical, false),
      impliesWetRoom: bool(after.impliesWetRoom, false),
      impliesSurfaceOnly: bool(after.impliesSurfaceOnly, false),
      sortOrder: positiveNumber(after.sortOrder),
      isActive: bool(after.isActive, change.operation !== 'deactivate'),
    })
    maps.actionByKey.set(change.semanticKey, saved as unknown as JsonRecord)
    return
  }
  if (change.entityType === 'document_type') {
    const existing = maps.documentByKey.get(change.semanticKey)
    const saved = await saveRenoAppAdminDocumentType({
      id: text(existing?.id) || null,
      key: change.semanticKey,
      label: text(after.label),
      description: optionalText(after.description),
      reviewGuidance: optionalText(after.reviewGuidance),
      defaultPhase: after.defaultPhase === 'during_execution' || after.defaultPhase === 'after_completion'
        ? after.defaultPhase
        : 'before_required',
      sortOrder: positiveNumber(after.sortOrder),
      isActive: bool(after.isActive, change.operation !== 'deactivate'),
    })
    maps.documentByKey.set(change.semanticKey, saved as unknown as JsonRecord)
    return
  }
  if (change.entityType === 'participant_role') {
    const existing = maps.participantByKey.get(change.semanticKey)
    const saved = await saveRenoAppAdminParticipantRole({
      id: text(existing?.id) || null,
      key: change.semanticKey,
      label: text(after.label),
      description: optionalText(after.description),
      reviewGuidance: optionalText(after.reviewGuidance),
      roleKind: after.roleKind === 'consultant' ? 'consultant' : 'contractor',
      verificationInstructions: optionalText(after.verificationInstructions),
      verificationUrl: optionalText(after.verificationUrl),
      insuranceRequired: bool(after.insuranceRequired, false),
      requiresCompanyName: bool(after.requiresCompanyName, true),
      requiresOrgNumber: bool(after.requiresOrgNumber, false),
      requiresContactName: bool(after.requiresContactName, false),
      requiresEmail: bool(after.requiresEmail, false),
      requiresPhone: bool(after.requiresPhone, false),
      requiresCertification: bool(after.requiresCertification, false),
      sortOrder: positiveNumber(after.sortOrder),
      isActive: bool(after.isActive, change.operation !== 'deactivate'),
    })
    maps.participantByKey.set(change.semanticKey, saved as unknown as JsonRecord)
    return
  }
  if (change.entityType === 'review_flag') {
    const existing = maps.reviewFlagByKey.get(change.semanticKey)
    const saved = await saveRenoAppAdminReviewFlag({
      id: text(existing?.id) || null,
      key: change.semanticKey,
      label: text(after.label),
      description: optionalText(after.description),
      severity: after.severity === 'info' || after.severity === 'high' ? after.severity : 'warning',
      category: optionalText(after.category),
      sortOrder: positiveNumber(after.sortOrder),
      isActive: bool(after.isActive, change.operation !== 'deactivate'),
    })
    maps.reviewFlagByKey.set(change.semanticKey, saved as unknown as JsonRecord)
  }
}

function currentTriggerIdentity(
  trigger: JsonRecord,
  maps: {
    questionById: Map<string, string>
    documentById: Map<string, string>
    participantById: Map<string, string>
    reviewFlagById: Map<string, string>
  }
) {
  const kind = text(trigger.triggerType)
  const targetKey = kind === 'question'
    ? maps.questionById.get(text(trigger.questionId))
    : kind === 'document'
      ? maps.documentById.get(text(trigger.documentTypeId))
      : kind === 'participant_role'
        ? maps.participantById.get(text(trigger.participantRoleId))
        : kind === 'review_flag'
          ? maps.reviewFlagById.get(text(trigger.reviewFlagId))
          : null
  return targetKey ? `${kind}:${targetKey}` : ''
}

function resolveTriggerTarget(
  semanticKey: string,
  maps: {
    actionByKey: Map<string, JsonRecord>
    questionByKey: Map<string, JsonRecord>
    documentByKey: Map<string, JsonRecord>
    participantByKey: Map<string, JsonRecord>
    reviewFlagByKey: Map<string, JsonRecord>
  }
): {
  triggerType: 'question' | 'document' | 'participant_role' | 'review_flag'
  questionId?: string
  documentTypeId?: string
  participantRoleId?: string
  reviewFlagId?: string
} {
  const [triggerType, ...targetParts] = semanticKey.split(':')
  const targetKey = targetParts.join(':')
  if (triggerType === 'question') {
    return { triggerType, questionId: mapId(maps.questionByKey, targetKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING') }
  }
  if (triggerType === 'document') {
    return { triggerType, documentTypeId: mapId(maps.documentByKey, targetKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING') }
  }
  if (triggerType === 'participant_role') {
    return { triggerType, participantRoleId: mapId(maps.participantByKey, targetKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING') }
  }
  if (triggerType === 'review_flag') {
    return { triggerType, reviewFlagId: mapId(maps.reviewFlagByKey, targetKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING') }
  }
  throw new FlowAiServerError('FLOW_AI_APPLY_DEPENDENCY_MISSING', 409)
}

async function applyQuestions(input: {
  snapshot: FlowAiSnapshot
  changes: FlowAiChange[]
  maps: {
    actionByKey: Map<string, JsonRecord>
    questionByKey: Map<string, JsonRecord>
    documentByKey: Map<string, JsonRecord>
    participantByKey: Map<string, JsonRecord>
    reviewFlagByKey: Map<string, JsonRecord>
  }
}) {
  const questionChanges = input.changes.filter((item) => item.entityType === 'question')
  const optionChanges = input.changes.filter((item) => item.entityType === 'question_option')
  const triggerChanges = input.changes.filter((item) => item.entityType === 'option_trigger')
  const affectedKeys = new Set<string>(questionChanges.map((item) => item.semanticKey))
  for (const change of optionChanges) if (change.parentSemanticKey) affectedKeys.add(change.parentSemanticKey)
  for (const change of triggerChanges) {
    const questionKey = (change.parentSemanticKey ?? '').split('.')[0]
    if (questionKey) affectedKeys.add(questionKey)
  }

  for (const change of questionChanges.filter((item) => item.operation === 'add')) {
    const after = parseAfter(change)
    const staged = await saveRenoAppAdminQuestion({
      question: {
        key: change.semanticKey,
        label: text(after.label),
        helpText: optionalText(after.helpText),
        responseType: after.responseType === 'multi_select' || after.responseType === 'boolean'
          ? after.responseType
          : 'single_select',
        sortOrder: positiveNumber(after.sortOrder),
        isActive: false,
        metadata: after.metadata ?? {},
      },
      options: [],
    })
    input.maps.questionByKey.set(change.semanticKey, staged as unknown as JsonRecord)
  }

  const rebuildReverseMaps = () => ({
    questionById: new Map([...input.maps.questionByKey].map(([key, value]) => [text(value.id), key])),
    documentById: new Map([...input.maps.documentByKey].map(([key, value]) => [text(value.id), key])),
    participantById: new Map([...input.maps.participantByKey].map(([key, value]) => [text(value.id), key])),
    reviewFlagById: new Map([...input.maps.reviewFlagByKey].map(([key, value]) => [text(value.id), key])),
  })

  for (const questionKey of affectedKeys) {
    const current = input.maps.questionByKey.get(questionKey)
    if (!current) throw new FlowAiServerError('FLOW_AI_APPLY_DEPENDENCY_MISSING', 409)
    const rootChange = questionChanges.find((item) => item.semanticKey === questionKey)
    const root = rootChange ? parseAfter(rootChange) : current
    const optionMap = new Map(
      records(current.options)
        .map((option) => [text(option.key), option] as const)
        .filter(([key]) => Boolean(key))
    )
    for (const change of optionChanges.filter((item) => item.parentSemanticKey === questionKey)) {
      optionMap.set(change.semanticKey, parseAfter(change))
    }

    const reverseMaps = rebuildReverseMaps()
    const options = [...optionMap].map(([optionKey, option]) => {
      const triggerMap = new Map<string, JsonRecord>()
      for (const trigger of records(option.triggers)) {
        const identity = currentTriggerIdentity(trigger, reverseMaps)
        if (identity) triggerMap.set(identity, trigger)
      }
      const parentKey = `${questionKey}.${optionKey}`
      for (const change of triggerChanges.filter((item) => item.parentSemanticKey === parentKey)) {
        triggerMap.set(change.semanticKey, parseAfter(change))
      }
      return {
        id: text(option.id) || null,
        key: optionKey,
        label: text(option.label),
        description: optionalText(option.description),
        sortOrder: positiveNumber(option.sortOrder),
        isActive: bool(option.isActive, true),
        metadata: option.metadata ?? {},
        triggers: [...triggerMap].map(([semanticKey, trigger]) => ({
          ...resolveTriggerTarget(semanticKey, input.maps),
          sortOrder: positiveNumber(trigger.sortOrder),
          isActive: bool(trigger.isActive, true),
        })),
      }
    })
    const saved = await saveRenoAppAdminQuestion({
      question: {
        id: text(current.id) || null,
        key: questionKey,
        label: text(root.label),
        helpText: optionalText(root.helpText),
        responseType: root.responseType === 'multi_select' || root.responseType === 'boolean'
          ? root.responseType
          : 'single_select',
        sortOrder: positiveNumber(root.sortOrder),
        isActive: bool(root.isActive, rootChange?.operation !== 'deactivate'),
        metadata: root.metadata ?? {},
      },
      options,
    })
    input.maps.questionByKey.set(questionKey, saved as unknown as JsonRecord)
  }
}

async function applyLinks(input: {
  changes: FlowAiChange[]
  maps: {
    actionByKey: Map<string, JsonRecord>
    questionByKey: Map<string, JsonRecord>
    documentByKey: Map<string, JsonRecord>
    participantByKey: Map<string, JsonRecord>
    reviewFlagByKey: Map<string, JsonRecord>
  }
}) {
  for (const change of input.changes) {
    const after = parseAfter(change)
    const enabled = change.operation !== 'deactivate' && bool(after.isActive, true)
    const parent = change.parentSemanticKey ?? ''
    if (change.entityType === 'action_question_link') {
      await saveRenoAppAdminActionTypeQuestion({
        actionTypeId: mapId(input.maps.actionByKey, parent, 'FLOW_AI_APPLY_DEPENDENCY_MISSING'),
        questionId: mapId(input.maps.questionByKey, change.semanticKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING'),
        isEnabled: enabled,
        isRequired: bool(after.isRequired, true),
        sortOrder: positiveNumber(after.sortOrder),
      })
    } else if (change.entityType === 'action_document_link') {
      await saveRenoAppAdminRequirement({
        actionTypeId: mapId(input.maps.actionByKey, parent, 'FLOW_AI_APPLY_DEPENDENCY_MISSING'),
        documentTypeId: mapId(input.maps.documentByKey, change.semanticKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING'),
        isEnabled: enabled,
        isRequired: bool(after.isRequired, true),
        phase: after.phase === 'before_conditional'
          || after.phase === 'during_execution'
          || after.phase === 'after_completion'
          ? after.phase
          : 'before_required',
        note: optionalText(after.note),
        sortOrder: positiveNumber(after.sortOrder),
      })
    } else if (change.entityType === 'action_participant_link') {
      await saveRenoAppAdminActionTypeParticipantRole({
        actionTypeId: mapId(input.maps.actionByKey, parent, 'FLOW_AI_APPLY_DEPENDENCY_MISSING'),
        participantRoleId: mapId(input.maps.participantByKey, change.semanticKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING'),
        isEnabled: enabled,
        isRequired: bool(after.isRequired, true),
        sortOrder: positiveNumber(after.sortOrder),
      })
    } else if (change.entityType === 'review_flag_link') {
      const [targetType, ...targetParts] = change.semanticKey.split(':')
      const targetKey = targetParts.join(':')
      await saveRenoAppAdminReviewFlagLink({
        reviewFlagId: mapId(input.maps.reviewFlagByKey, parent, 'FLOW_AI_APPLY_DEPENDENCY_MISSING'),
        actionTypeId: targetType === 'action_type'
          ? mapId(input.maps.actionByKey, targetKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING')
          : null,
        documentTypeId: targetType === 'document_type'
          ? mapId(input.maps.documentByKey, targetKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING')
          : null,
        participantRoleId: targetType === 'participant_role'
          ? mapId(input.maps.participantByKey, targetKey, 'FLOW_AI_APPLY_DEPENDENCY_MISSING')
          : null,
        isEnabled: enabled,
        sortOrder: positiveNumber(after.sortOrder),
      })
    }
  }
}

export async function applyRenoAppFlowAiChanges(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.applyTokens)) {
    throw new FlowAiServerError('FLOW_AI_APPLY_REQUEST_INVALID', 400)
  }
  const tokens = value.applyTokens
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
  if (tokens.length < 1 || tokens.length > FLOW_AI_MAX_PROPOSED_CHANGES || new Set(tokens).size !== tokens.length) {
    throw new FlowAiServerError('FLOW_AI_APPLY_SELECTION_INVALID', 400)
  }

  const context = await requireRenoAppViewerContext()
  if (!context.isInternalAdmin) throw new FlowAiServerError('ADMIN_REQUIRED', 403)
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new FlowAiServerError('OPENAI_API_KEY_MISSING', 503)
  const payloads = tokens.map((token) => verifyFlowAiApplyToken({
    token,
    adminUserId: context.userId,
    apiKey,
  }))
  const snapshotFingerprint = payloads[0]?.snapshot_fingerprint ?? ''
  const responseId = payloads[0]?.response_id ?? ''
  if (
    payloads.some((payload) => payload.snapshot_fingerprint !== snapshotFingerprint)
    || payloads.some((payload) => payload.response_id !== responseId)
    || payloads.some((payload) => payload.proposal_can_apply !== true)
  ) {
    throw new FlowAiServerError('FLOW_AI_APPLY_TOKEN_INVALID', 403)
  }
  const changes = payloads.map((payload) => normalizeVerifiedChange(payload.change))
  if (new Set(changes.map((change) => change.changeId)).size !== changes.length) {
    throw new FlowAiServerError('FLOW_AI_APPLY_SELECTION_INVALID', 400)
  }
  const containsRisk = changes.some((change) => (
    change.risk === 'high'
    || change.requiresExpertReview
    || change.operation === 'deactivate'
    || change.validationStatus === 'warning'
  ))
  if (containsRisk && value.acknowledgeRisk !== true) {
    throw new FlowAiServerError('FLOW_AI_APPLY_RISK_ACK_REQUIRED', 400)
  }

  const snapshot = await buildRenoAppFlowAiSnapshot()
  const currentFingerprint = await fingerprintFlowAiSnapshot(snapshot)
  if (currentFingerprint !== snapshotFingerprint) {
    throw new FlowAiServerError('FLOW_AI_SNAPSHOT_STALE', 409, { snapshotFingerprint: currentFingerprint })
  }

  const maps = {
    actionByKey: entityMap(snapshot.actionTypes),
    questionByKey: entityMap(snapshot.questions),
    documentByKey: entityMap(snapshot.documentTypes),
    participantByKey: entityMap(snapshot.participantRoles),
    reviewFlagByKey: entityMap(snapshot.reviewFlags),
  }
  preflightDependencies({ changes, ...maps })

  for (const entityType of BASE_ENTITY_TYPES) {
    for (const change of changes.filter((item) => item.entityType === entityType)) {
      await applyBaseChange(change, maps)
    }
  }
  await applyQuestions({ snapshot, changes, maps })
  await applyLinks({ changes, maps })

  const updatedSnapshot = await buildRenoAppFlowAiSnapshot()
  const updatedFingerprint = await fingerprintFlowAiSnapshot(updatedSnapshot)
  console.info('[renoapp.flow-ai] Applied reviewed proposal', {
    responseId,
    appliedCount: changes.length,
    snapshotFingerprint,
    updatedFingerprint,
  })
  return {
    appliedCount: changes.length,
    appliedChangeIds: changes.map((change) => change.changeId),
    snapshotFingerprint: updatedFingerprint,
  }
}
