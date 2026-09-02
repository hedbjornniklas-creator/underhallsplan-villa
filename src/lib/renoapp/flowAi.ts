export const FLOW_AI_SNAPSHOT_SCHEMA_VERSION = 1 as const

export const FLOW_AI_DEFAULT_ALLOWED_SOURCE_DOMAINS = [
  'riksdagen.se',
  'regeringen.se',
  'boverket.se',
  'elsakerhetsverket.se',
  'av.se',
  'msb.se',
  'mcf.se',
  'swedac.se',
  'naturvardsverket.se',
  'folkhalsomyndigheten.se',
  'skr.se',
  'eur-lex.europa.eu',
  'ec.europa.eu',
  'sakervatten.se',
  'bkr.se',
  'gvk.se',
  'installatorsforetagen.se',
  'svenskventilation.se',
  'ri.se',
  'sis.se',
  'elstandard.se',
] as const

export type FlowAiMode = 'create' | 'review' | 'extend'
export type FlowAiProviderStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'incomplete'
  | 'cancelled'

export const FLOW_AI_JOB_METADATA_APP = 'renoapp_flow_ai' as const
export const FLOW_AI_JOB_METADATA_SCHEMA = '2' as const
export const FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS = 64_000
export const FLOW_AI_MIN_MAX_OUTPUT_TOKENS = 16_000
export const FLOW_AI_MAX_MAX_OUTPUT_TOKENS = 128_000
export const FLOW_AI_DEFAULT_REASONING_EFFORT = 'medium' as const
export const FLOW_AI_DEFAULT_SERVICE_TIER = 'default' as const
export const FLOW_AI_DEFAULT_MAX_BACKGROUND_JOB_AGE_MS = 8 * 60 * 1_000
export const FLOW_AI_MIN_MAX_BACKGROUND_JOB_AGE_MS = 60 * 1_000
export const FLOW_AI_MAX_MAX_BACKGROUND_JOB_AGE_MS = 9 * 60 * 1_000
export const FLOW_AI_MAX_PROPOSED_CHANGES = 64
export const FLOW_AI_MAX_PROPOSED_SOURCES = 16
export const FLOW_AI_MAX_TEST_SCENARIOS = 6

export type FlowAiReasoningEffort = 'low' | 'medium' | 'high'
export type FlowAiServiceTier = 'default' | 'priority'
export type FlowAiIncompleteReason = 'max_output_tokens' | 'content_filter' | 'unknown'

export type FlowAiGenerationConfig = {
  maxOutputTokens: number
  reasoningEffort: FlowAiReasoningEffort
}

export type FlowAiExecutionConfig = {
  serviceTier: FlowAiServiceTier
  maxBackgroundJobAgeMs: number
}

export type FlowAiTokenUsage = {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
}

export type FlowAiTerminalDiagnostics = FlowAiTokenUsage & FlowAiGenerationConfig & {
  reason: FlowAiIncompleteReason
}

export type FlowAiJobMetadataFields = {
  app: string
  schema: string
  snapshot_fingerprint: string
  mode: FlowAiMode
  target_action_id: string
  target_action_key: string
  admin_user_hash: string
  domains_hash: string
  instruction_hash: string
  max_output_tokens: string
  reasoning_effort: FlowAiReasoningEffort
  started_at: string
  nonce: string
  signature: string
}

export type FlowAiEntityType =
  | 'action_type'
  | 'question'
  | 'question_option'
  | 'document_type'
  | 'participant_role'
  | 'review_flag'
  | 'action_question_link'
  | 'action_document_link'
  | 'action_participant_link'
  | 'option_trigger'
  | 'review_flag_link'

export type FlowAiChangeOperation = 'add' | 'update' | 'deactivate'
export type FlowAiRisk = 'low' | 'medium' | 'high'
export type FlowAiValidationSeverity = 'warning' | 'error'
export type FlowAiChangeValidationStatus = 'valid' | 'warning' | 'blocked'

/**
 * The complete data set currently shown by the flow builder. The item shapes are
 * deliberately opaque here: the builder's API responses are the canonical
 * representation, and retaining every field is important for stale-snapshot checks.
 */
export type FlowAiSnapshot = {
  schemaVersion: typeof FLOW_AI_SNAPSHOT_SCHEMA_VERSION
  actionTypes: unknown[]
  questions: unknown[]
  documentTypes: unknown[]
  participantRoles: unknown[]
  reviewFlags: unknown[]
  requirementGroups: unknown[]
  questionGroups: unknown[]
  participantGroups: unknown[]
  reviewFlagLinks: unknown[]
}

export type FlowAiRequest = {
  instruction: string
  mode?: FlowAiMode
  actionTypeId?: string | null
  snapshot?: FlowAiSnapshot
  snapshotFingerprint?: string
}

export type FlowAiSourceType =
  | 'law'
  | 'regulation'
  | 'authority_guidance'
  | 'standard'
  | 'industry_practice'
  | 'municipal'
  | 'organization_policy'

export type FlowAiSource = {
  sourceId: string
  title: string
  publisher: string
  url: string
  sourceType: FlowAiSourceType
  reference: string | null
  effectiveDate: string | null
  claim: string
  retrievedAt: string
  verified: boolean
}

export type FlowAiCandidateChange = {
  changeId: string
  requestedOperation: FlowAiChangeOperation
  entityType: FlowAiEntityType
  semanticKey: string
  parentSemanticKey: string | null
  title: string
  reason: string
  risk: FlowAiRisk
  fieldsJson: string
  sourceIds: string[]
  requiresExpertReview: boolean
}

export type FlowAiChange = {
  changeId: string
  operation: FlowAiChangeOperation
  entityType: FlowAiEntityType
  semanticKey: string
  parentSemanticKey: string | null
  targetId: string | null
  title: string
  reason: string
  risk: FlowAiRisk
  beforeJson: string | null
  afterJson: string
  sourceIds: string[]
  requiresExpertReview: boolean
  validationStatus: FlowAiChangeValidationStatus
  applyToken?: string
}

export type FlowAiTestScenarioAnswer = {
  questionKey: string
  optionKeys: string[]
}

export type FlowAiTestScenario = {
  scenarioId: string
  title: string
  description: string
  answers: FlowAiTestScenarioAnswer[]
  expectedDocumentKeys: string[]
  expectedParticipantKeys: string[]
  expectedReviewFlagKeys: string[]
}

export type FlowAiValidationIssue = {
  code: string
  severity: FlowAiValidationSeverity
  message: string
  changeId: string | null
  sourceId: string | null
}

export type FlowAiCandidateSource = Omit<FlowAiSource, 'retrievedAt' | 'verified'>

export type FlowAiCandidateProposal = {
  mode: FlowAiMode
  summary: string
  warnings: string[]
  candidateChanges: FlowAiCandidateChange[]
  sources: FlowAiCandidateSource[]
  testScenarios: FlowAiTestScenario[]
}

export type FlowAiProposal = {
  mode: FlowAiMode
  summary: string
  warnings: string[]
  changes: FlowAiChange[]
  sources: FlowAiSource[]
  testScenarios: FlowAiTestScenario[]
  validationIssues: FlowAiValidationIssue[]
  canApply: boolean
}

export type FlowAiResponse = {
  proposal: FlowAiProposal
  snapshotFingerprint: string
  generatedAt: string
  model: string
}

export type FlowAiJobSummary = {
  responseId: string
  status: FlowAiProviderStatus
  snapshotFingerprint: string
  createdAt: string
  model: string
}

export type FlowAiStartResponse = FlowAiJobSummary & {
  pollAfterMs: number
}

export type FlowAiPendingResponse = FlowAiJobSummary & {
  status: 'queued' | 'in_progress'
  pollAfterMs: number
  progressMessage: string
}

export type FlowAiCompletedResponse = FlowAiResponse & {
  responseId: string
  status: 'completed'
  createdAt: string
}

export type FlowAiTerminalErrorResponse = FlowAiJobSummary & {
  status: 'failed' | 'incomplete' | 'cancelled'
  error: {
    code: string
    message: string
    diagnostics: FlowAiTerminalDiagnostics
  }
}

export type FlowAiPollResponse =
  | FlowAiPendingResponse
  | FlowAiCompletedResponse
  | FlowAiTerminalErrorResponse

type JsonRecord = Record<string, unknown>

const SNAPSHOT_ARRAY_KEYS = [
  'actionTypes',
  'questions',
  'documentTypes',
  'participantRoles',
  'reviewFlags',
  'requirementGroups',
  'questionGroups',
  'participantGroups',
  'reviewFlagLinks',
] as const

const ENTITY_TYPES = new Set<FlowAiEntityType>([
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

const SOURCE_TYPES = new Set<FlowAiSourceType>([
  'law',
  'regulation',
  'authority_guidance',
  'standard',
  'industry_practice',
  'municipal',
  'organization_policy',
])

const ALLOWED_PATCH_FIELDS: Record<FlowAiEntityType, ReadonlySet<string>> = {
  action_type: new Set([
    'key',
    'label',
    'description',
    'categoryId',
    'categoryKey',
    'riskLevel',
    'contractorRequirement',
    'impliesStructure',
    'impliesPlumbing',
    'impliesVentilation',
    'impliesElectrical',
    'impliesWetRoom',
    'impliesSurfaceOnly',
    'sortOrder',
    'isActive',
  ]),
  question: new Set([
    'key',
    'label',
    'helpText',
    'responseType',
    'sortOrder',
    'isActive',
    'metadata',
  ]),
  question_option: new Set([
    'key',
    'label',
    'description',
    'sortOrder',
    'isActive',
    'metadata',
  ]),
  document_type: new Set([
    'key',
    'label',
    'description',
    'reviewGuidance',
    'defaultPhase',
    'sortOrder',
    'isActive',
  ]),
  participant_role: new Set([
    'key',
    'label',
    'description',
    'reviewGuidance',
    'roleKind',
    'verificationInstructions',
    'verificationUrl',
    'insuranceRequired',
    'requiresCompanyName',
    'requiresOrgNumber',
    'requiresContactName',
    'requiresEmail',
    'requiresPhone',
    'requiresCertification',
    'sortOrder',
    'isActive',
  ]),
  review_flag: new Set([
    'key',
    'label',
    'description',
    'severity',
    'category',
    'sortOrder',
    'isActive',
  ]),
  action_question_link: new Set(['isRequired', 'sortOrder', 'isActive']),
  action_document_link: new Set(['isRequired', 'phase', 'note', 'sortOrder', 'isActive']),
  action_participant_link: new Set(['isRequired', 'sortOrder', 'isActive']),
  option_trigger: new Set(['triggerType', 'targetKey', 'sortOrder', 'isActive']),
  review_flag_link: new Set(['sortOrder', 'isActive']),
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanOptionalText(value: unknown) {
  const text = cleanText(value)
  return text || null
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(cleanText).filter(Boolean))]
}

function stableValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('FLOW_AI_SNAPSHOT_CIRCULAR')
    seen.add(value)
    const result = value.map((item) => stableValue(item, seen) ?? null)
    seen.delete(value)
    return result
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw new Error('FLOW_AI_SNAPSHOT_CIRCULAR')
    seen.add(value)
    const result: JsonRecord = {}
    for (const key of Object.keys(value).sort()) {
      const item = stableValue(value[key], seen)
      if (typeof item !== 'undefined') result[key] = item
    }
    seen.delete(value)
    return result
  }
  return String(value)
}

export function stableStringifyFlowAiSnapshot(value: unknown) {
  return JSON.stringify(stableValue(value, new Set()))
}

export async function fingerprintFlowAiSnapshot(snapshot: FlowAiSnapshot) {
  const serialized = stableStringifyFlowAiSnapshot(snapshot)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

export function normalizeFlowAiSnapshot(value: unknown): FlowAiSnapshot {
  if (!isRecord(value) || value.schemaVersion !== FLOW_AI_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('FLOW_AI_SNAPSHOT_INVALID')
  }
  for (const key of SNAPSHOT_ARRAY_KEYS) {
    if (!Array.isArray(value[key])) throw new Error('FLOW_AI_SNAPSHOT_INVALID')
  }
  return {
    schemaVersion: FLOW_AI_SNAPSHOT_SCHEMA_VERSION,
    actionTypes: value.actionTypes as unknown[],
    questions: value.questions as unknown[],
    documentTypes: value.documentTypes as unknown[],
    participantRoles: value.participantRoles as unknown[],
    reviewFlags: value.reviewFlags as unknown[],
    requirementGroups: value.requirementGroups as unknown[],
    questionGroups: value.questionGroups as unknown[],
    participantGroups: value.participantGroups as unknown[],
    reviewFlagLinks: value.reviewFlagLinks as unknown[],
  }
}

export function normalizeFlowAiMode(value: unknown, instruction = '', actionTypeId?: string | null): FlowAiMode {
  if (value === 'create' || value === 'review' || value === 'extend') return value
  const normalized = instruction.toLocaleLowerCase('sv')
  if (/\b(granska|granskning|revidera|revidering|uppdatera|kontrollera)\b/u.test(normalized)) {
    return 'review'
  }
  if (/\b(lägg till|lagg till|utöka|utoka|komplettera|förläng|forlang)\b/u.test(normalized)) {
    return 'extend'
  }
  if (/\b(skapa|bygg|nytt flöde|nytt flode|ny renoveringstyp)\b/u.test(normalized)) {
    return 'create'
  }
  return actionTypeId ? 'extend' : 'create'
}

export function normalizeFlowAiProviderStatus(value: unknown): FlowAiProviderStatus {
  if (
    value === 'queued'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'failed'
    || value === 'incomplete'
    || value === 'cancelled'
  ) return value
  throw new Error('FLOW_AI_PROVIDER_STATUS_INVALID')
}

export function resolveFlowAiGenerationConfig(input: {
  maxOutputTokens?: unknown
  reasoningEffort?: unknown
} = {}): FlowAiGenerationConfig {
  const budgetText = typeof input.maxOutputTokens === 'string' ? input.maxOutputTokens.trim() : ''
  const parsedBudget = typeof input.maxOutputTokens === 'number'
    ? input.maxOutputTokens
    : /^\d+$/u.test(budgetText)
      ? Number(budgetText)
      : Number.NaN
  const maxOutputTokens = Number.isSafeInteger(parsedBudget)
    && parsedBudget >= FLOW_AI_MIN_MAX_OUTPUT_TOKENS
    && parsedBudget <= FLOW_AI_MAX_MAX_OUTPUT_TOKENS
    ? parsedBudget
    : FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS
  const reasoningEffort = input.reasoningEffort === 'low'
    || input.reasoningEffort === 'medium'
    || input.reasoningEffort === 'high'
    ? input.reasoningEffort
    : FLOW_AI_DEFAULT_REASONING_EFFORT
  return { maxOutputTokens, reasoningEffort }
}

export function resolveFlowAiExecutionConfig(input: {
  serviceTier?: unknown
  maxBackgroundJobAgeMs?: unknown
} = {}): FlowAiExecutionConfig {
  const ageText = typeof input.maxBackgroundJobAgeMs === 'string'
    ? input.maxBackgroundJobAgeMs.trim()
    : ''
  const parsedAge = typeof input.maxBackgroundJobAgeMs === 'number'
    ? input.maxBackgroundJobAgeMs
    : /^\d+$/u.test(ageText)
      ? Number(ageText)
      : Number.NaN
  const maxBackgroundJobAgeMs = Number.isSafeInteger(parsedAge)
    && parsedAge >= FLOW_AI_MIN_MAX_BACKGROUND_JOB_AGE_MS
    && parsedAge <= FLOW_AI_MAX_MAX_BACKGROUND_JOB_AGE_MS
    ? parsedAge
    : FLOW_AI_DEFAULT_MAX_BACKGROUND_JOB_AGE_MS
  const serviceTier = input.serviceTier === 'priority'
    ? 'priority'
    : FLOW_AI_DEFAULT_SERVICE_TIER
  return { serviceTier, maxBackgroundJobAgeMs }
}

export function normalizeFlowAiIncompleteReason(value: unknown): FlowAiIncompleteReason {
  if (value === 'max_output_tokens' || value === 'content_filter') return value
  return 'unknown'
}

function safeTokenCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

export function normalizeFlowAiTokenUsage(value: unknown): FlowAiTokenUsage {
  const usage = isRecord(value) ? value : {}
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {}
  return {
    inputTokens: safeTokenCount(usage.input_tokens),
    outputTokens: safeTokenCount(usage.output_tokens),
    reasoningTokens: safeTokenCount(outputDetails.reasoning_tokens),
    totalTokens: safeTokenCount(usage.total_tokens),
  }
}

export function buildFlowAiTerminalError(input: {
  status: 'failed' | 'incomplete' | 'cancelled'
  incompleteReason?: unknown
  usage?: unknown
  generationConfig: FlowAiGenerationConfig
}): FlowAiTerminalErrorResponse['error'] {
  const reason = input.status === 'incomplete'
    ? normalizeFlowAiIncompleteReason(input.incompleteReason)
    : 'unknown'
  const diagnostics: FlowAiTerminalDiagnostics = {
    ...normalizeFlowAiTokenUsage(input.usage),
    ...input.generationConfig,
    reason,
  }
  if (input.status === 'cancelled') {
    return {
      code: 'OPENAI_RESPONSE_CANCELLED',
      message: 'AI-körningen avbröts.',
      diagnostics,
    }
  }
  if (input.status === 'failed') {
    return {
      code: 'OPENAI_RESPONSE_FAILED',
      message: 'AI-körningen misslyckades hos leverantören.',
      diagnostics,
    }
  }
  if (reason === 'max_output_tokens') {
    return {
      code: 'OPENAI_RESPONSE_INCOMPLETE',
      message: 'AI:n nådde körningens tokenbudget innan det strukturerade förslaget blev klart. Försök med en mer avgränsad instruktion eller kontakta systemadministratören.',
      diagnostics,
    }
  }
  if (reason === 'content_filter') {
    return {
      code: 'OPENAI_RESPONSE_INCOMPLETE',
      message: 'AI-svaret stoppades av innehållskontrollen. Formulera om instruktionen och försök igen.',
      diagnostics,
    }
  }
  return {
    code: 'OPENAI_RESPONSE_INCOMPLETE',
    message: 'AI-svaret blev ofullständigt. Starta en ny, mer avgränsad granskning.',
    diagnostics,
  }
}

export function normalizeFlowAiResponseId(value: unknown) {
  const responseId = cleanText(value)
  if (!/^resp_[A-Za-z0-9_-]{8,200}$/u.test(responseId)) {
    throw new Error('FLOW_AI_RESPONSE_ID_INVALID')
  }
  return responseId
}

/** Parse the provider metadata shape. Authenticity is verified server-side with HMAC. */
export function normalizeFlowAiJobMetadata(value: unknown): FlowAiJobMetadataFields {
  if (!isRecord(value)) throw new Error('FLOW_AI_RESPONSE_METADATA_INVALID')
  const metadata: FlowAiJobMetadataFields = {
    app: cleanText(value.app),
    schema: cleanText(value.schema),
    snapshot_fingerprint: cleanText(value.snapshot_fingerprint),
    mode: cleanText(value.mode) as FlowAiMode,
    target_action_id: cleanText(value.target_action_id),
    target_action_key: cleanText(value.target_action_key),
    admin_user_hash: cleanText(value.admin_user_hash),
    domains_hash: cleanText(value.domains_hash),
    instruction_hash: cleanText(value.instruction_hash),
    max_output_tokens: cleanText(value.max_output_tokens),
    reasoning_effort: cleanText(value.reasoning_effort) as FlowAiReasoningEffort,
    started_at: cleanText(value.started_at),
    nonce: cleanText(value.nonce),
    signature: cleanText(value.signature),
  }
  if (
    metadata.app !== FLOW_AI_JOB_METADATA_APP
    || metadata.schema !== FLOW_AI_JOB_METADATA_SCHEMA
    || !/^sha256:[a-f0-9]{64}$/u.test(metadata.snapshot_fingerprint)
    || !(['create', 'review', 'extend'] as const).includes(metadata.mode)
    || !metadata.target_action_id
    || !metadata.target_action_key
    || !/^[a-f0-9]{64}$/u.test(metadata.admin_user_hash)
    || !/^[a-f0-9]{64}$/u.test(metadata.domains_hash)
    || !/^[a-f0-9]{64}$/u.test(metadata.instruction_hash)
    || !/^\d{5,6}$/u.test(metadata.max_output_tokens)
    || Number(metadata.max_output_tokens) < FLOW_AI_MIN_MAX_OUTPUT_TOKENS
    || Number(metadata.max_output_tokens) > FLOW_AI_MAX_MAX_OUTPUT_TOKENS
    || !(['low', 'medium', 'high'] as const).includes(metadata.reasoning_effort)
    || !Number.isFinite(Date.parse(metadata.started_at))
    || !metadata.nonce
    || !/^[a-f0-9]{64}$/u.test(metadata.signature)
    || (
      metadata.mode === 'create'
      && (metadata.target_action_id !== '-' || metadata.target_action_key !== '-')
    )
    || (
      (metadata.mode === 'review' || metadata.mode === 'extend')
      && (metadata.target_action_id === '-' || metadata.target_action_key === '-')
    )
  ) {
    throw new Error('FLOW_AI_RESPONSE_METADATA_INVALID')
  }
  return metadata
}

function normalizeSemanticKey(value: unknown) {
  return cleanText(value).toLocaleLowerCase('sv')
}

function entityIndexKey(entityType: FlowAiEntityType, parentKey: string | null, semanticKey: string) {
  return `${entityType}\u0000${normalizeSemanticKey(parentKey)}\u0000${normalizeSemanticKey(semanticKey)}`
}

type IndexedEntity = {
  value: JsonRecord
  targetId: string | null
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function addIndexEntity(
  index: Map<string, IndexedEntity>,
  entityType: FlowAiEntityType,
  parentKey: string | null,
  semanticKey: string,
  value: JsonRecord
) {
  if (!semanticKey) return
  index.set(entityIndexKey(entityType, parentKey, semanticKey), {
    value,
    targetId: cleanOptionalText(value.id),
  })
}

function buildEntityIndex(snapshot: FlowAiSnapshot) {
  const index = new Map<string, IndexedEntity>()
  const actionKeyById = new Map<string, string>()
  const questionKeyById = new Map<string, string>()
  const documentKeyById = new Map<string, string>()
  const participantKeyById = new Map<string, string>()
  const reviewFlagKeyById = new Map<string, string>()

  for (const item of records(snapshot.actionTypes)) {
    const key = cleanText(item.key)
    addIndexEntity(index, 'action_type', null, key, item)
    if (cleanText(item.id)) actionKeyById.set(cleanText(item.id), key)
  }
  for (const item of records(snapshot.documentTypes)) {
    const key = cleanText(item.key)
    addIndexEntity(index, 'document_type', null, key, item)
    if (cleanText(item.id)) documentKeyById.set(cleanText(item.id), key)
  }
  for (const item of records(snapshot.participantRoles)) {
    const key = cleanText(item.key)
    addIndexEntity(index, 'participant_role', null, key, item)
    if (cleanText(item.id)) participantKeyById.set(cleanText(item.id), key)
  }
  for (const item of records(snapshot.reviewFlags)) {
    const key = cleanText(item.key)
    addIndexEntity(index, 'review_flag', null, key, item)
    if (cleanText(item.id)) reviewFlagKeyById.set(cleanText(item.id), key)
  }
  for (const question of records(snapshot.questions)) {
    const questionKey = cleanText(question.key)
    addIndexEntity(index, 'question', null, questionKey, question)
    if (cleanText(question.id)) questionKeyById.set(cleanText(question.id), questionKey)
    for (const option of records(question.options)) {
      const optionKey = cleanText(option.key)
      addIndexEntity(index, 'question_option', questionKey, optionKey, option)
    }
  }

  for (const group of records(snapshot.requirementGroups)) {
    const actionKey = cleanText(isRecord(group.actionType) ? group.actionType.key : null)
    for (const requirement of records(group.requirements)) {
      const documentKey = cleanText(requirement.documentKey)
        || documentKeyById.get(cleanText(requirement.documentTypeId))
        || ''
      addIndexEntity(index, 'action_document_link', actionKey, documentKey, requirement)
    }
  }
  for (const group of records(snapshot.questionGroups)) {
    const actionKey = cleanText(isRecord(group.actionType) ? group.actionType.key : null)
    for (const link of records(group.questions)) {
      const questionKey = cleanText(link.questionKey)
        || questionKeyById.get(cleanText(link.questionId))
        || ''
      addIndexEntity(index, 'action_question_link', actionKey, questionKey, link)
    }
  }
  for (const group of records(snapshot.participantGroups)) {
    const actionKey = cleanText(isRecord(group.actionType) ? group.actionType.key : null)
    for (const link of records(group.participantRoles)) {
      const participantKey = cleanText(link.participantRoleKey)
        || participantKeyById.get(cleanText(link.participantRoleId))
        || ''
      addIndexEntity(index, 'action_participant_link', actionKey, participantKey, link)
    }
  }

  for (const question of records(snapshot.questions)) {
    const questionKey = cleanText(question.key)
    for (const option of records(question.options)) {
      const optionKey = cleanText(option.key)
      const parentKey = `${questionKey}.${optionKey}`
      for (const trigger of records(option.triggers)) {
        const triggerType = cleanText(trigger.triggerType)
        const targetKey = triggerType === 'question'
          ? questionKeyById.get(cleanText(trigger.questionId))
          : triggerType === 'document'
            ? documentKeyById.get(cleanText(trigger.documentTypeId))
            : triggerType === 'participant_role'
              ? participantKeyById.get(cleanText(trigger.participantRoleId))
              : triggerType === 'review_flag'
                ? reviewFlagKeyById.get(cleanText(trigger.reviewFlagId))
                : null
        if (targetKey) addIndexEntity(index, 'option_trigger', parentKey, `${triggerType}:${targetKey}`, trigger)
      }
    }
  }

  for (const link of records(snapshot.reviewFlagLinks)) {
    const reviewFlagKey = reviewFlagKeyById.get(cleanText(link.reviewFlagId)) ?? ''
    const semanticKey = cleanText(link.actionTypeId)
      ? `action_type:${actionKeyById.get(cleanText(link.actionTypeId)) ?? ''}`
      : cleanText(link.documentTypeId)
        ? `document_type:${documentKeyById.get(cleanText(link.documentTypeId)) ?? ''}`
        : cleanText(link.participantRoleId)
          ? `participant_role:${participantKeyById.get(cleanText(link.participantRoleId)) ?? ''}`
          : ''
    addIndexEntity(index, 'review_flag_link', reviewFlagKey, semanticKey, link)
  }

  return {
    index,
    actionKeyById,
    questionKeyById,
    documentKeyById,
    participantKeyById,
    reviewFlagKeyById,
  }
}

function makeIssue(input: Partial<FlowAiValidationIssue> & Pick<FlowAiValidationIssue, 'code' | 'message'>): FlowAiValidationIssue {
  return {
    code: input.code,
    severity: input.severity ?? 'warning',
    message: input.message,
    changeId: input.changeId ?? null,
    sourceId: input.sourceId ?? null,
  }
}

function normalizePatch(
  candidate: FlowAiCandidateChange,
  issues: FlowAiValidationIssue[]
): JsonRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate.fieldsJson)
  } catch {
    issues.push(makeIssue({
      code: 'INVALID_FIELDS_JSON',
      severity: 'error',
      message: `Ändringen ”${candidate.title}” innehåller ogiltig JSON.`,
      changeId: candidate.changeId,
    }))
    return null
  }
  if (!isRecord(parsed)) {
    issues.push(makeIssue({
      code: 'INVALID_FIELDS_OBJECT',
      severity: 'error',
      message: `Ändringen ”${candidate.title}” måste beskriva fält som ett JSON-objekt.`,
      changeId: candidate.changeId,
    }))
    return null
  }

  const allowed = ALLOWED_PATCH_FIELDS[candidate.entityType]
  const result: JsonRecord = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!allowed.has(key)) {
      issues.push(makeIssue({
        code: 'UNSUPPORTED_FIELD',
        message: `Fältet ”${key}” stöds inte för ${candidate.entityType} och har ignorerats.`,
        changeId: candidate.changeId,
      }))
      continue
    }
    result[key] = value
  }

  const enumChecks: Array<[string, ReadonlySet<string>]> = [
    ['riskLevel', new Set(['low', 'medium', 'high'])],
    ['responseType', new Set(['single_select', 'multi_select', 'boolean'])],
    ['defaultPhase', new Set(['before_required', 'during_execution', 'after_completion'])],
    ['phase', new Set(['before_required', 'before_conditional', 'during_execution', 'after_completion'])],
    ['roleKind', new Set(['contractor', 'consultant'])],
    ['severity', new Set(['info', 'warning', 'high'])],
    ['triggerType', new Set(['question', 'document', 'participant_role', 'review_flag'])],
    [
      'contractorRequirement',
      new Set([
        'none',
        'qualified_contractor',
        'authorized_electrician',
        'safe_water',
        'bkr_or_gvk',
        'structural_engineer',
      ]),
    ],
  ]
  for (const [field, allowedValues] of enumChecks) {
    if (field in result && !allowedValues.has(cleanText(result[field]))) {
      issues.push(makeIssue({
        code: 'INVALID_ENUM_VALUE',
        severity: 'error',
        message: `Värdet för ”${field}” är inte giltigt.`,
        changeId: candidate.changeId,
      }))
      delete result[field]
    }
  }

  if ('sortOrder' in result) {
    const value = Number(result.sortOrder)
    if (!Number.isFinite(value) || value <= 0) {
      issues.push(makeIssue({
        code: 'INVALID_SORT_ORDER',
        severity: 'error',
        message: 'sortOrder måste vara ett positivt tal.',
        changeId: candidate.changeId,
      }))
      delete result.sortOrder
    } else {
      result.sortOrder = value
    }
  }

  for (const field of [
    'isRequired',
    'isActive',
    'insuranceRequired',
    'requiresCompanyName',
    'requiresOrgNumber',
    'requiresContactName',
    'requiresEmail',
    'requiresPhone',
    'requiresCertification',
    'impliesStructure',
    'impliesPlumbing',
    'impliesVentilation',
    'impliesElectrical',
    'impliesWetRoom',
    'impliesSurfaceOnly',
  ]) {
    if (field in result && typeof result[field] !== 'boolean') {
      issues.push(makeIssue({
        code: 'INVALID_BOOLEAN_VALUE',
        severity: 'error',
        message: `Fältet ”${field}” måste vara true eller false.`,
        changeId: candidate.changeId,
      }))
      delete result[field]
    }
  }

  if ('verificationUrl' in result && result.verificationUrl !== null) {
    try {
      const url = new URL(cleanText(result.verificationUrl))
      if (url.protocol !== 'https:') throw new Error('HTTPS_REQUIRED')
      result.verificationUrl = url.toString()
    } catch {
      issues.push(makeIssue({
        code: 'INVALID_VERIFICATION_URL',
        severity: 'error',
        message: 'Verifieringslänken måste vara en giltig HTTPS-adress.',
        changeId: candidate.changeId,
      }))
      delete result.verificationUrl
    }
  }

  return result
}

function newEntityBase(candidate: FlowAiCandidateChange): JsonRecord {
  switch (candidate.entityType) {
    case 'action_type':
    case 'question':
    case 'document_type':
    case 'participant_role':
    case 'review_flag':
      return { key: candidate.semanticKey }
    case 'question_option':
      return { questionKey: candidate.parentSemanticKey, key: candidate.semanticKey }
    case 'action_question_link':
      return { actionTypeKey: candidate.parentSemanticKey, questionKey: candidate.semanticKey }
    case 'action_document_link':
      return { actionTypeKey: candidate.parentSemanticKey, documentTypeKey: candidate.semanticKey }
    case 'action_participant_link':
      return { actionTypeKey: candidate.parentSemanticKey, participantRoleKey: candidate.semanticKey }
    case 'option_trigger': {
      const [triggerType, ...targetParts] = candidate.semanticKey.split(':')
      return {
        optionKey: candidate.parentSemanticKey,
        triggerType,
        targetKey: targetParts.join(':'),
      }
    }
    case 'review_flag_link': {
      const [targetType, ...targetParts] = candidate.semanticKey.split(':')
      return {
        reviewFlagKey: candidate.parentSemanticKey,
        targetType,
        targetKey: targetParts.join(':'),
      }
    }
  }
}

function issueStatus(changeId: string, issues: FlowAiValidationIssue[]): FlowAiChangeValidationStatus {
  const ownIssues = issues.filter((issue) => issue.changeId === changeId)
  if (ownIssues.some((issue) => issue.severity === 'error')) return 'blocked'
  if (ownIssues.length > 0) return 'warning'
  return 'valid'
}

export function buildFlowAiDeterministicDiff(input: {
  snapshot: FlowAiSnapshot
  candidates: FlowAiCandidateChange[]
}) {
  const { index } = buildEntityIndex(input.snapshot)
  const changes: FlowAiChange[] = []
  const issues: FlowAiValidationIssue[] = []
  const seen = new Set<string>()

  for (const rawCandidate of input.candidates) {
    if (!ENTITY_TYPES.has(rawCandidate.entityType)) {
      issues.push(makeIssue({
        code: 'UNKNOWN_ENTITY_TYPE',
        severity: 'error',
        message: 'AI-förslaget innehåller en okänd objekttyp.',
        changeId: cleanOptionalText(rawCandidate.changeId),
      }))
      continue
    }
    const candidate: FlowAiCandidateChange = {
      ...rawCandidate,
      changeId: cleanText(rawCandidate.changeId),
      semanticKey: cleanText(rawCandidate.semanticKey),
      parentSemanticKey: cleanOptionalText(rawCandidate.parentSemanticKey),
      title: cleanText(rawCandidate.title),
      reason: cleanText(rawCandidate.reason),
      sourceIds: cleanStringArray(rawCandidate.sourceIds),
    }
    if (!candidate.changeId || !candidate.semanticKey || !candidate.title || !candidate.reason) {
      issues.push(makeIssue({
        code: 'INCOMPLETE_CHANGE',
        severity: 'error',
        message: 'Ett ändringsförslag saknar id, nyckel, rubrik eller motivering.',
        changeId: candidate.changeId || null,
      }))
      continue
    }
    const identity = entityIndexKey(candidate.entityType, candidate.parentSemanticKey, candidate.semanticKey)
    if (seen.has(identity)) {
      issues.push(makeIssue({
        code: 'DUPLICATE_CHANGE',
        severity: 'error',
        message: `Flera ändringar avser samma objekt: ${candidate.semanticKey}.`,
        changeId: candidate.changeId,
      }))
      continue
    }
    seen.add(identity)

    const patch = normalizePatch(candidate, issues)
    if (!patch) continue
    const existing = index.get(identity)
    if (candidate.requestedOperation === 'deactivate' && !existing) {
      issues.push(makeIssue({
        code: 'DEACTIVATE_TARGET_MISSING',
        severity: 'error',
        message: `Objektet ”${candidate.semanticKey}” finns inte och kan inte inaktiveras.`,
        changeId: candidate.changeId,
      }))
      continue
    }

    const operation: FlowAiChangeOperation = candidate.requestedOperation === 'deactivate'
      ? 'deactivate'
      : existing
        ? 'update'
        : 'add'
    const before = existing?.value ?? null
    const after: JsonRecord = operation === 'deactivate'
      ? { ...(before ?? {}), ...patch, isActive: false }
      : { ...(before ?? newEntityBase(candidate)), ...patch }
    const beforeJson = before ? stableStringifyFlowAiSnapshot(before) : null
    const afterJson = stableStringifyFlowAiSnapshot(after)

    if (
      candidate.entityType === 'action_type'
      && after.impliesSurfaceOnly === true
      && [
        after.impliesStructure,
        after.impliesPlumbing,
        after.impliesVentilation,
        after.impliesElectrical,
        after.impliesWetRoom,
      ].some((value) => value === true)
    ) {
      issues.push(makeIssue({
        code: 'SURFACE_ONLY_CONFLICT',
        severity: 'error',
        message: 'En ren ytskiktsåtgärd kan inte samtidigt markeras som konstruktion, VVS, ventilation, el eller våtrum.',
        changeId: candidate.changeId,
      }))
    }

    if (beforeJson === afterJson) {
      issues.push(makeIssue({
        code: 'NO_EFFECT',
        message: `Ändringen ”${candidate.title}” skulle inte ändra något och har utelämnats.`,
        changeId: candidate.changeId,
      }))
      continue
    }

    if (operation === 'deactivate') {
      issues.push(makeIssue({
        code: 'DEACTIVATION_REQUIRES_REVIEW',
        message: 'Inaktivering måste alltid granskas särskilt innan publicering.',
        changeId: candidate.changeId,
      }))
    }

    changes.push({
      changeId: candidate.changeId,
      operation,
      entityType: candidate.entityType,
      semanticKey: candidate.semanticKey,
      parentSemanticKey: candidate.parentSemanticKey,
      targetId: existing?.targetId ?? null,
      title: candidate.title,
      reason: candidate.reason,
      risk: candidate.risk,
      beforeJson,
      afterJson,
      sourceIds: candidate.sourceIds,
      requiresExpertReview: candidate.requiresExpertReview || operation === 'deactivate',
      validationStatus: 'valid',
    })
  }

  return { changes, issues }
}

function normalizedUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    url.hash = ''
    url.hostname = url.hostname.toLocaleLowerCase('en-US')
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, '')
    return url.toString()
  } catch {
    return null
  }
}

function hostnameAllowed(urlValue: string, allowedDomains: readonly string[]) {
  try {
    const hostname = new URL(urlValue).hostname.toLocaleLowerCase('en-US')
    return allowedDomains.some((domain) => {
      const normalizedDomain = domain.trim().toLocaleLowerCase('en-US').replace(/^\.+/u, '')
      return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)
    })
  } catch {
    return false
  }
}

function parseCandidateProposal(value: unknown): FlowAiCandidateProposal {
  if (!isRecord(value)) throw new Error('FLOW_AI_INVALID_RESPONSE')
  const mode = normalizeFlowAiMode(value.mode)
  const candidateChanges = records(value.candidateChanges).slice(0, FLOW_AI_MAX_PROPOSED_CHANGES).map((item): FlowAiCandidateChange => ({
    changeId: cleanText(item.changeId),
    requestedOperation:
      item.requestedOperation === 'update' || item.requestedOperation === 'deactivate'
        ? item.requestedOperation
        : 'add',
    entityType: cleanText(item.entityType) as FlowAiEntityType,
    semanticKey: cleanText(item.semanticKey),
    parentSemanticKey: cleanOptionalText(item.parentSemanticKey),
    title: cleanText(item.title),
    reason: cleanText(item.reason),
    risk: item.risk === 'high' || item.risk === 'medium' ? item.risk : 'low',
    fieldsJson: cleanText(item.fieldsJson),
    sourceIds: cleanStringArray(item.sourceIds),
    requiresExpertReview: item.requiresExpertReview === true,
  }))
  const sources = records(value.sources).slice(0, FLOW_AI_MAX_PROPOSED_SOURCES).map((item): FlowAiCandidateSource => ({
    sourceId: cleanText(item.sourceId),
    title: cleanText(item.title),
    publisher: cleanText(item.publisher),
    url: cleanText(item.url),
    sourceType: cleanText(item.sourceType) as FlowAiSourceType,
    reference: cleanOptionalText(item.reference),
    effectiveDate: cleanOptionalText(item.effectiveDate),
    claim: cleanText(item.claim),
  }))
  const testScenarios = records(value.testScenarios).slice(0, FLOW_AI_MAX_TEST_SCENARIOS).map((item): FlowAiTestScenario => ({
    scenarioId: cleanText(item.scenarioId),
    title: cleanText(item.title),
    description: cleanText(item.description),
    answers: records(item.answers).map((answer) => ({
      questionKey: cleanText(answer.questionKey),
      optionKeys: cleanStringArray(answer.optionKeys),
    })),
    expectedDocumentKeys: cleanStringArray(item.expectedDocumentKeys),
    expectedParticipantKeys: cleanStringArray(item.expectedParticipantKeys),
    expectedReviewFlagKeys: cleanStringArray(item.expectedReviewFlagKeys),
  }))
  return {
    mode,
    summary: cleanText(value.summary),
    warnings: cleanStringArray(value.warnings).slice(0, 20),
    candidateChanges,
    sources,
    testScenarios,
  }
}

function mandatoryChange(change: FlowAiChange) {
  try {
    const after = JSON.parse(change.afterJson) as JsonRecord
    if (after.isRequired === true) return true
    return change.entityType === 'action_type'
      && typeof after.contractorRequirement === 'string'
      && after.contractorRequirement !== 'none'
  } catch {
    return true
  }
}

function validateReferences(input: {
  snapshot: FlowAiSnapshot
  changes: FlowAiChange[]
  issues: FlowAiValidationIssue[]
}) {
  const { index } = buildEntityIndex(input.snapshot)
  const future = new Set(index.keys())
  for (const change of input.changes) {
    const identity = entityIndexKey(change.entityType, change.parentSemanticKey, change.semanticKey)
    if (change.operation === 'deactivate') future.delete(identity)
    else future.add(identity)
  }

  const exists = (entity: FlowAiEntityType, parent: string | null, key: string) =>
    future.has(entityIndexKey(entity, parent, key))

  for (const change of input.changes) {
    const parent = change.parentSemanticKey
    if (change.entityType === 'question_option' && (!parent || !exists('question', null, parent))) {
      input.issues.push(makeIssue({
        code: 'DANGLING_OPTION_PARENT',
        severity: 'error',
        message: `Svarsalternativet ”${change.semanticKey}” saknar en giltig fråga.`,
        changeId: change.changeId,
      }))
    }
    const actionLinkTargets: Partial<Record<FlowAiEntityType, FlowAiEntityType>> = {
      action_question_link: 'question',
      action_document_link: 'document_type',
      action_participant_link: 'participant_role',
    }
    const targetEntity = actionLinkTargets[change.entityType]
    if (targetEntity) {
      if (!parent || !exists('action_type', null, parent) || !exists(targetEntity, null, change.semanticKey)) {
        input.issues.push(makeIssue({
          code: 'DANGLING_ACTION_LINK',
          severity: 'error',
          message: `Kopplingen ”${change.semanticKey}” refererar till ett objekt som saknas.`,
          changeId: change.changeId,
        }))
      }
    }
    if (change.entityType === 'option_trigger') {
      const parentParts = (parent ?? '').split('.')
      const questionKey = parentParts.shift() ?? ''
      const optionKey = parentParts.join('.')
      const [triggerType, ...targetParts] = change.semanticKey.split(':')
      const targetKey = targetParts.join(':')
      const triggerEntity = triggerType === 'question'
        ? 'question'
        : triggerType === 'document'
          ? 'document_type'
          : triggerType === 'participant_role'
            ? 'participant_role'
            : triggerType === 'review_flag'
              ? 'review_flag'
              : null
      if (
        !questionKey
        || !optionKey
        || !exists('question_option', questionKey, optionKey)
        || !triggerEntity
        || !targetKey
        || !exists(triggerEntity, null, targetKey)
      ) {
        input.issues.push(makeIssue({
          code: 'DANGLING_OPTION_TRIGGER',
          severity: 'error',
          message: `Villkoret ”${change.semanticKey}” refererar till ett objekt som saknas.`,
          changeId: change.changeId,
        }))
      }
    }
    if (change.entityType === 'review_flag_link') {
      const [targetType, ...targetParts] = change.semanticKey.split(':')
      const targetKey = targetParts.join(':')
      const targetEntity = targetType === 'action_type'
        ? 'action_type'
        : targetType === 'document_type'
          ? 'document_type'
          : targetType === 'participant_role'
            ? 'participant_role'
            : null
      if (!parent || !exists('review_flag', null, parent) || !targetEntity || !exists(targetEntity, null, targetKey)) {
        input.issues.push(makeIssue({
          code: 'DANGLING_REVIEW_FLAG_LINK',
          severity: 'error',
          message: `Flaggkopplingen ”${change.semanticKey}” refererar till ett objekt som saknas.`,
          changeId: change.changeId,
        }))
      }
    }
  }
}

function validateQuestionCycles(input: {
  snapshot: FlowAiSnapshot
  changes: FlowAiChange[]
  issues: FlowAiValidationIssue[]
}) {
  const graph = new Map<string, Set<string>>()
  const questionKeyById = new Map(
    records(input.snapshot.questions)
      .map((question) => [cleanText(question.id), cleanText(question.key)] as const)
      .filter(([id, key]) => id && key)
  )
  const addEdge = (from: string, to: string) => {
    if (!from || !to) return
    const targets = graph.get(from) ?? new Set<string>()
    targets.add(to)
    graph.set(from, targets)
  }
  for (const question of records(input.snapshot.questions)) {
    const from = cleanText(question.key)
    for (const option of records(question.options)) {
      for (const trigger of records(option.triggers)) {
        if (trigger.triggerType !== 'question' || trigger.isActive === false) continue
        addEdge(from, questionKeyById.get(cleanText(trigger.questionId)) ?? '')
      }
    }
  }
  for (const change of input.changes) {
    if (change.entityType !== 'option_trigger' || change.operation === 'deactivate') continue
    const [kind, ...targetParts] = change.semanticKey.split(':')
    if (kind === 'question') addEdge((change.parentSemanticKey ?? '').split('.')[0] ?? '', targetParts.join(':'))
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  let cycle: string[] | null = null
  const walk = (node: string, path: string[]) => {
    if (cycle) return
    if (visiting.has(node)) {
      cycle = [...path, node]
      return
    }
    if (visited.has(node)) return
    visiting.add(node)
    for (const target of graph.get(node) ?? []) walk(target, [...path, node])
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of graph.keys()) walk(node, [])
  if (cycle) {
    input.issues.push(makeIssue({
      code: 'QUESTION_CYCLE',
      severity: 'error',
      message: `Frågeflödet innehåller en cykel: ${(cycle as string[]).join(' → ')}.`,
    }))
  }
}

export function validateFlowAiProposal(input: {
  rawProposal: unknown
  snapshot: FlowAiSnapshot
  retrievedSourceUrls: readonly string[]
  allowedSourceDomains?: readonly string[]
  retrievedAt: string
  requestedMode: FlowAiMode
  targetActionKey?: string | null
}): FlowAiProposal {
  const candidate = parseCandidateProposal(input.rawProposal)
  const allowedDomains = input.allowedSourceDomains ?? FLOW_AI_DEFAULT_ALLOWED_SOURCE_DOMAINS
  const retrievedUrls = new Set(
    input.retrievedSourceUrls.map(normalizedUrl).filter((value): value is string => Boolean(value))
  )
  const issues: FlowAiValidationIssue[] = []
  if (candidate.mode !== input.requestedMode) {
    issues.push(makeIssue({
      code: 'MODE_MISMATCH',
      severity: 'error',
      message: `AI:n svarade med läget ${candidate.mode}, men begärt läge var ${input.requestedMode}.`,
    }))
  }

  const sourceIds = new Set<string>()
  const sources = candidate.sources.map((source): FlowAiSource => {
    const normalized = normalizedUrl(source.url)
    const domainIsAllowed = Boolean(normalized) && hostnameAllowed(normalized ?? '', allowedDomains)
    const verified = Boolean(normalized) && domainIsAllowed && retrievedUrls.has(normalized ?? '')
    if (!source.sourceId || sourceIds.has(source.sourceId)) {
      issues.push(makeIssue({
        code: 'INVALID_SOURCE_ID',
        severity: 'error',
        message: 'En källa saknar ett unikt käll-id.',
        sourceId: source.sourceId || null,
      }))
    } else {
      sourceIds.add(source.sourceId)
    }
    if (!SOURCE_TYPES.has(source.sourceType)) {
      issues.push(makeIssue({
        code: 'INVALID_SOURCE_TYPE',
        severity: 'error',
        message: `Källtypen för ”${source.title || source.sourceId}” är inte giltig.`,
        sourceId: source.sourceId || null,
      }))
    }
    if (!domainIsAllowed) {
      issues.push(makeIssue({
        code: 'SOURCE_DOMAIN_NOT_ALLOWED',
        severity: 'error',
        message: `Källan ”${source.title || source.sourceId}” ligger inte på en godkänd domän.`,
        sourceId: source.sourceId || null,
      }))
    } else if (!verified) {
      issues.push(makeIssue({
        code: 'SOURCE_NOT_RETRIEVED',
        severity: 'error',
        message: `Källan ”${source.title || source.sourceId}” kunde inte verifieras i webbsökningen.`,
        sourceId: source.sourceId || null,
      }))
    }
    return {
      ...source,
      url: normalized ?? source.url,
      retrievedAt: input.retrievedAt,
      verified,
    }
  })

  const diff = buildFlowAiDeterministicDiff({
    snapshot: input.snapshot,
    candidates: candidate.candidateChanges,
  })
  issues.push(...diff.issues)
  validateReferences({ snapshot: input.snapshot, changes: diff.changes, issues })
  validateQuestionCycles({ snapshot: input.snapshot, changes: diff.changes, issues })

  const sourceById = new Map(sources.map((source) => [source.sourceId, source]))
  for (const change of diff.changes) {
    const linkedSources = change.sourceIds.map((sourceId) => sourceById.get(sourceId)).filter(Boolean)
    const verifiedSources = linkedSources.filter((source) => source?.verified)
    const bindingSupportSources = verifiedSources.filter((source) => source?.sourceType !== 'standard')
    if (linkedSources.length !== change.sourceIds.length) {
      issues.push(makeIssue({
        code: 'UNKNOWN_CHANGE_SOURCE',
        severity: 'error',
        message: `Ändringen ”${change.title}” refererar till en okänd källa.`,
        changeId: change.changeId,
      }))
    }
    if (change.sourceIds.length === 0) {
      issues.push(makeIssue({
        code: 'CHANGE_WITHOUT_SOURCE',
        message: `Ändringen ”${change.title}” saknar källstöd.`,
        changeId: change.changeId,
      }))
    }
    if (linkedSources.some((source) => source?.sourceType === 'standard')) {
      issues.push(makeIssue({
        code: 'STANDARD_REQUIRES_EXPERT_REVIEW',
        message: `Ändringen ”${change.title}” hänvisar till standardmetadata och kräver expertgranskning av tillämplighet och fulltext.`,
        changeId: change.changeId,
      }))
    }
    if (mandatoryChange(change) && bindingSupportSources.length === 0) {
      issues.push(makeIssue({
        code: 'MANDATORY_REQUIREMENT_WITHOUT_VERIFIED_SOURCE',
        severity: 'error',
        message: `Det obligatoriska kravet ”${change.title}” saknar verifierat stöd utöver standardmetadata och är blockerat.`,
        changeId: change.changeId,
      }))
    }

    if (input.targetActionKey && (
      (change.entityType === 'action_type' && normalizeSemanticKey(change.semanticKey) !== normalizeSemanticKey(input.targetActionKey))
      || (
        (change.entityType === 'action_question_link'
          || change.entityType === 'action_document_link'
          || change.entityType === 'action_participant_link')
        && normalizeSemanticKey(change.parentSemanticKey) !== normalizeSemanticKey(input.targetActionKey)
      )
    )) {
      issues.push(makeIssue({
        code: 'OUTSIDE_TARGET_FLOW',
        severity: 'error',
        message: `Ändringen ”${change.title}” ligger utanför det valda flödet.`,
        changeId: change.changeId,
      }))
    }
  }

  const changes = diff.changes.map((change) => {
    const validationStatus = issueStatus(change.changeId, issues)
    return {
      ...change,
      requiresExpertReview: change.requiresExpertReview || validationStatus !== 'valid',
      validationStatus,
    }
  })
  const warningTexts = [...new Set([
    ...candidate.warnings,
    ...issues.map((issue) => issue.message),
  ])]

  return {
    mode: input.requestedMode,
    summary: candidate.summary,
    warnings: warningTexts,
    changes,
    sources,
    testScenarios: candidate.testScenarios,
    validationIssues: issues,
    canApply: changes.length > 0 && !issues.some((issue) => issue.severity === 'error'),
  }
}
