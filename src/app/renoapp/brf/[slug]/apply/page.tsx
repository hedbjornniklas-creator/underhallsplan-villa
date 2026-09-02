'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

type Requirement = {
  id: string
  documentTypeId: string
  documentKey: string
  documentLabel: string
  documentDescription: string | null
  isRequired: boolean
  phase?: 'before_required' | 'before_conditional' | 'during_execution' | 'after_completion'
  note: string | null
  sortOrder: number
}

type ActionCategory = {
  id: string
  slug: string
  label: string
  description: string | null
  sortOrder: number
}

type ParticipantRole = {
  id: string
  key: string
  label: string
  description: string | null
  roleKind: 'contractor' | 'consultant'
  verificationInstructions: string | null
  verificationUrl: string | null
  insuranceRequired: boolean
  requiresCompanyName: boolean
  requiresOrgNumber: boolean
  requiresContactName: boolean
  requiresEmail: boolean
  requiresPhone: boolean
  requiresCertification: boolean
  isRequired: boolean
  sortOrder: number
}

type ParticipantEntry = {
  participantRoleId: string
  companyName: string
  orgNumber: string
  contactName: string
  email: string
  phone: string
  certificationReference: string
  hasVerifiedAuthorization: boolean
  acceptsResponsibility: boolean
}

type ActionType = {
  id: string
  category?: ActionCategory
  key: string
  label: string
  description: string | null
  riskLevel?: 'low' | 'medium' | 'high'
  contractorRequirement?:
    | 'none'
    | 'qualified_contractor'
    | 'authorized_electrician'
    | 'safe_water'
    | 'bkr_or_gvk'
    | 'structural_engineer'
  sortOrder: number
  requirements: Requirement[]
  participantRoles: ParticipantRole[]
  questions: ApplyQuestion[]
}

type ApplyQuestionOption = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  triggers: ApplyQuestionOptionTrigger[]
}

type ApplyQuestionOptionTrigger = {
  id: string
  triggerType: 'question' | 'document' | 'participant_role' | 'review_flag'
  questionId: string | null
  documentTypeId: string | null
  documentKey: string | null
  documentLabel: string | null
  documentDescription: string | null
  documentPhase: 'before_required' | 'during_execution' | 'after_completion' | null
  participantRoleId: string | null
  participantRole: ParticipantRole | null
  reviewFlagId: string | null
  reviewFlag: {
    id: string
    key: string
    label: string
    description: string | null
    severity: 'info' | 'warning' | 'high'
    category: string
  } | null
  sortOrder: number
}

type ApplyQuestion = {
  id: string
  key: string
  label: string
  helpText: string | null
  responseType: 'single_select' | 'multi_select' | 'boolean'
  sortOrder: number
  isRequired: boolean
  options: ApplyQuestionOption[]
}

type PublicConfigResponse = {
  brf: {
    id: string
    name: string
    slug: string
    applyIntroText: string | null
  }
  actionTypes: ActionType[]
  questionBank: ApplyQuestion[]
}

type DraftResponse = {
  state: 'open' | 'expired' | 'revoked'
  access: {
    email: string
    expiresAt: string
    lastUsedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
  }
  form: {
    applicantName: string
    applicantEmail: string
    applicantPhone: string
    unitNumberInternal: string
    unitNumberSkatteverket: string
    description: string
    contractorName: string
    contractorOrgNumber: string
    contractorEmail: string
    contractorPhone: string
    contractorHasRequiredCertification: boolean
    participantEntries: ParticipantEntry[]
    actionTypeKeys: string[]
    questionAnswers: Record<string, string[]>
    checks?: {
      affectsStructure: boolean
      affectsPlumbing: boolean
      affectsVentilation: boolean
      affectsElectrical: boolean
      affectsWetRoom: boolean
      affectsSurfaceOnly: boolean
    }
  }
  case: {
    id: string
    caseNumber: string
    status: string
    submittedAt: string
    updatedAt: string
  }
  documents: Array<{
    id: string
    documentTypeId: string | null
    participantRoleId: string | null
    documentScope: 'general' | 'participant_insurance'
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
  completionRequest: {
    requestedDocuments: Array<{
      documentTypeId: string
      label: string
      description: string | null
      note: string | null
    }>
    requestedParticipants: Array<{
      participantRoleId: string
      key: string
      label: string
      description: string | null
      reviewGuidance: string | null
      roleKind: 'contractor' | 'consultant'
      verificationInstructions: string | null
      verificationUrl: string | null
      insuranceRequired: boolean
      requiresCompanyName: boolean
      requiresOrgNumber: boolean
      requiresContactName: boolean
      requiresEmail: boolean
      requiresPhone: boolean
      requiresCertification: boolean
      note: string | null
    }>
  }
  messages: Array<{
    id: string
    type: 'request_for_info' | 'applicant_reply' | 'document_uploaded' | 'decision' | 'status_change'
    authorRole: 'board' | 'applicant' | 'system'
    message: string | null
    createdAt: string
  }>
}

type SubmitResult = {
  caseId: string
  caseNumber: string
  accessUrl: string
  resumeUrl: string
  status: 'draft' | 'submitted'
  emailSent: boolean
  emailError: string | null
}

type UploadedDocument = {
  id: string
  documentTypeId: string | null
  participantRoleId: string | null
  documentScope: 'general' | 'participant_insurance'
  fileName: string | null
  status: string
  uploadedAt: string
  note: string | null
}

type FormState = {
  applicantName: string
  applicantEmail: string
  applicantPhone: string
  unitNumberInternal: string
  unitNumberSkatteverket: string
  actionTypeKeys: string[]
  description: string
  contractorName: string
  contractorOrgNumber: string
  contractorEmail: string
  contractorPhone: string
  contractorHasRequiredCertification: boolean
  participantEntries: ParticipantEntry[]
  questionAnswers: Record<string, string[]>
}

const INITIAL_FORM: FormState = {
  applicantName: '',
  applicantEmail: '',
  applicantPhone: '',
  unitNumberInternal: '',
  unitNumberSkatteverket: '',
  actionTypeKeys: [],
  description: '',
  contractorName: '',
  contractorOrgNumber: '',
  contractorEmail: '',
  contractorPhone: '',
  contractorHasRequiredCertification: false,
  participantEntries: [],
  questionAnswers: {},
}

const STEP_ITEMS = [
  { id: 1, label: 'Lägenhet och kontakt' },
  { id: 2, label: 'Vad vill du renovera?' },
  { id: 3, label: 'Underlag' },
  { id: 4, label: 'Entreprenörer & konsulter' },
  { id: 5, label: 'Granska och skicka' },
]

const VISIBLE_STEP_ITEMS = STEP_ITEMS.filter((item) => item.id !== 3 && item.id !== 4)

function getNextVisibleStepId(currentStep: number | null, items = VISIBLE_STEP_ITEMS) {
  if (currentStep == null) return items[0]?.id ?? 1

  const currentIndex = items.findIndex((item) => item.id === currentStep)
  const nextStep = items[currentIndex + 1]
  return nextStep?.id ?? currentStep
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function formatCaseStatus(status: string) {
  if (status === 'draft') return 'Utkast'
  if (status === 'new_application') return 'Ny ansökan'
  if (status === 'submitted') return 'Inskickad'
  if (status === 'need_info') return 'Komplettering krävs'
  if (status === 'review') return 'Under granskning'
  if (status === 'approved') return 'Godkänd'
  if (status === 'conditional') return 'Villkorad'
  if (status === 'rejected') return 'Avslagen'
  return status
}

function getMessageTitle(type: DraftResponse['messages'][number]['type']) {
  if (type === 'request_for_info') return 'Styrelsen begär komplettering'
  if (type === 'applicant_reply') return 'Du skickade komplettering'
  if (type === 'document_uploaded') return 'Dokument uppladdat'
  if (type === 'decision') return 'Beslut registrerat'
  return 'Status uppdaterad'
}

function pickHigherPriorityPhase(
  left?: Requirement['phase'],
  right?: Requirement['phase']
): Requirement['phase'] | undefined {
  const priority: Array<NonNullable<Requirement['phase']>> = [
    'before_required',
    'before_conditional',
    'during_execution',
    'after_completion',
  ]

  const leftIndex = left ? priority.indexOf(left) : -1
  const rightIndex = right ? priority.indexOf(right) : -1

  if (leftIndex === -1) return right
  if (rightIndex === -1) return left
  return leftIndex <= rightIndex ? left : right
}

function mergeRequirements(actions: ActionType[]) {
  const merged = new Map<string, Requirement>()

  for (const action of actions) {
    for (const requirement of action.requirements) {
      const current = merged.get(requirement.documentTypeId)
      if (!current) {
        merged.set(requirement.documentTypeId, requirement)
        continue
      }

      merged.set(requirement.documentTypeId, {
        ...current,
        isRequired: current.isRequired || requirement.isRequired,
        phase: pickHigherPriorityPhase(current.phase, requirement.phase),
        note: current.note || requirement.note,
        sortOrder: Math.min(current.sortOrder, requirement.sortOrder),
      })
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.sortOrder - right.sortOrder)
}

function mergeQuestions(actions: ActionType[]) {
  const merged = new Map<string, ApplyQuestion>()

  for (const action of actions) {
    for (const question of action.questions ?? []) {
      const current = merged.get(question.id)
      if (!current) {
        merged.set(question.id, question)
        continue
      }

      merged.set(question.id, {
        ...current,
        isRequired: current.isRequired || question.isRequired,
        sortOrder: Math.min(current.sortOrder, question.sortOrder),
      })
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.sortOrder - right.sortOrder)
}

function buildQuestionMap(questionBank: ApplyQuestion[]) {
  return new Map(questionBank.map((question) => [question.id, question]))
}

function resolveVisibleQuestions(
  baseQuestions: ApplyQuestion[],
  questionBank: ApplyQuestion[],
  questionAnswers: Record<string, string[]>
) {
  const questionBankById = buildQuestionMap(questionBank)
  const resolved = new Map<string, ApplyQuestion>()

  const mergeQuestion = (question: ApplyQuestion) => {
    const current = resolved.get(question.id)
    if (!current) {
      resolved.set(question.id, question)
      return true
    }

    const next = {
      ...current,
      isRequired: current.isRequired || question.isRequired,
      sortOrder: Math.min(current.sortOrder, question.sortOrder),
      options: current.options.length > 0 ? current.options : question.options,
    }
    const changed =
      next.isRequired !== current.isRequired ||
      next.sortOrder !== current.sortOrder ||
      next.options !== current.options

    if (changed) {
      resolved.set(question.id, next)
    }

    return changed
  }

  for (const question of baseQuestions) {
    mergeQuestion(question)
  }

  let changed = true
  while (changed) {
    changed = false

    for (const question of Array.from(resolved.values())) {
      const selectedOptionKeys = questionAnswers[question.key] ?? []
      if (selectedOptionKeys.length === 0) continue

      for (const option of question.options) {
        if (!selectedOptionKeys.includes(option.key)) continue

        for (const trigger of option.triggers) {
          if (trigger.triggerType !== 'question' || !trigger.questionId) continue
          const triggeredQuestion = questionBankById.get(trigger.questionId)
          if (!triggeredQuestion) continue

          changed =
            mergeQuestion({
              ...triggeredQuestion,
              isRequired: true,
            }) || changed
        }
      }
    }
  }

  return Array.from(resolved.values()).sort(
    (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
  )
}

function resolveTriggeredRequirements(
  baseRequirements: Requirement[],
  visibleQuestions: ApplyQuestion[],
  questionAnswers: Record<string, string[]>
) {
  const merged = new Map<string, Requirement>()

  for (const requirement of baseRequirements) {
    merged.set(requirement.documentTypeId, requirement)
  }

  for (const question of visibleQuestions) {
    const selectedOptionKeys = questionAnswers[question.key] ?? []
    if (selectedOptionKeys.length === 0) continue

    for (const option of question.options) {
      if (!selectedOptionKeys.includes(option.key)) continue

      for (const trigger of option.triggers) {
        if (trigger.triggerType !== 'document' || !trigger.documentTypeId) continue

        const current = merged.get(trigger.documentTypeId)
        const candidate: Requirement = {
          id: trigger.id,
          documentTypeId: trigger.documentTypeId,
          documentKey: trigger.documentKey ?? trigger.documentTypeId,
          documentLabel: trigger.documentLabel ?? 'Dokument',
          documentDescription: trigger.documentDescription,
          isRequired: true,
          phase: trigger.documentPhase ?? 'before_required',
          note: current?.note ?? null,
          sortOrder: current?.sortOrder ?? 1000 + trigger.sortOrder,
        }

        if (!current) {
          merged.set(trigger.documentTypeId, candidate)
          continue
        }

        merged.set(trigger.documentTypeId, {
          ...current,
          isRequired: current.isRequired || candidate.isRequired,
          phase: pickHigherPriorityPhase(current.phase, candidate.phase),
          note: current.note || candidate.note,
          sortOrder: Math.min(current.sortOrder, candidate.sortOrder),
        })
      }
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.sortOrder - right.sortOrder)
}

function mergeParticipantRoles(actions: ActionType[]) {
  const merged = new Map<string, ParticipantRole>()

  for (const action of actions) {
    for (const participantRole of action.participantRoles ?? []) {
      const current = merged.get(participantRole.id)
      if (!current) {
        merged.set(participantRole.id, participantRole)
        continue
      }

      merged.set(participantRole.id, {
        ...current,
        isRequired: current.isRequired || participantRole.isRequired,
        sortOrder: Math.min(current.sortOrder, participantRole.sortOrder),
      })
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.sortOrder - right.sortOrder)
}

function resolveTriggeredParticipantRoles(
  baseParticipantRoles: ParticipantRole[],
  visibleQuestions: ApplyQuestion[],
  questionAnswers: Record<string, string[]>
) {
  const merged = new Map(baseParticipantRoles.map((participantRole) => [participantRole.id, participantRole]))

  for (const question of visibleQuestions) {
    const selectedOptionKeys = questionAnswers[question.key] ?? []
    if (selectedOptionKeys.length === 0) continue

    for (const option of question.options) {
      if (!selectedOptionKeys.includes(option.key)) continue

      for (const trigger of option.triggers) {
        if (trigger.triggerType !== 'participant_role' || !trigger.participantRole) continue

        const current = merged.get(trigger.participantRole.id)
        const candidate = {
          ...trigger.participantRole,
          isRequired: trigger.participantRole.isRequired !== false,
        }

        if (!current) {
          merged.set(candidate.id, candidate)
          continue
        }

        merged.set(candidate.id, {
          ...current,
          isRequired: current.isRequired || candidate.isRequired,
          sortOrder: Math.min(current.sortOrder, candidate.sortOrder),
        })
      }
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.sortOrder - right.sortOrder)
}

function groupActionsByCategory(actions: ActionType[]) {
  const grouped = new Map<string, { category: ActionCategory; actions: ActionType[] }>()

  for (const action of actions) {
    const category = action.category ?? {
      id: 'ovrigt',
      slug: 'ovrigt',
      label: 'Övrigt',
      description: null,
      sortOrder: 999,
    }

    if (!grouped.has(category.id)) {
      grouped.set(category.id, { category, actions: [] })
    }

    grouped.get(category.id)?.actions.push(action)
  }

  return Array.from(grouped.values()).sort((left, right) => left.category.sortOrder - right.category.sortOrder)
}

function groupRequirementsByPhase(requirements: Requirement[]) {
  return {
    beforeRequired: requirements.filter((item) => item.phase === 'before_required'),
    beforeConditional: requirements.filter((item) => item.phase === 'before_conditional'),
    duringExecution: requirements.filter((item) => item.phase === 'during_execution'),
    afterCompletion: requirements.filter((item) => item.phase === 'after_completion'),
    uncategorized: requirements.filter((item) => !item.phase),
  }
}

function isBeforePhaseRequirement(requirement: Requirement) {
  return requirement.phase === 'before_required' || requirement.phase === 'before_conditional'
}

function toggleMultiSelectValue(values: string[], optionKey: string) {
  return values.includes(optionKey)
    ? values.filter((value) => value !== optionKey)
    : [...values, optionKey]
}

const compactDescriptionStyle = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
}

function emptyParticipantEntry(participantRoleId: string): ParticipantEntry {
  return {
    participantRoleId,
    companyName: '',
    orgNumber: '',
    contactName: '',
    email: '',
    phone: '',
    certificationReference: '',
    hasVerifiedAuthorization: false,
    acceptsResponsibility: false,
  }
}

function normalizeParticipantEntries(entries: ParticipantEntry[]) {
  return Array.from(
    new Map(
      entries.map((entry) => [
        entry.participantRoleId,
        {
          participantRoleId: entry.participantRoleId,
          companyName: entry.companyName.trim(),
          orgNumber: entry.orgNumber.trim(),
          contactName: entry.contactName.trim(),
          email: entry.email.trim().toLowerCase(),
          phone: entry.phone.trim(),
          certificationReference: entry.certificationReference.trim(),
          hasVerifiedAuthorization: entry.hasVerifiedAuthorization,
          acceptsResponsibility: entry.acceptsResponsibility,
        },
      ])
    ).values()
  ).sort((left, right) => left.participantRoleId.localeCompare(right.participantRoleId, 'sv'))
}

function buildDraftFingerprint(form: FormState) {
  const sortedQuestionAnswers = Object.fromEntries(
    Object.entries(form.questionAnswers)
      .sort(([left], [right]) => left.localeCompare(right, 'sv'))
      .map(([questionKey, values]) => [
        questionKey,
        [...values].sort((left, right) => left.localeCompare(right, 'sv')),
      ])
  )

  return JSON.stringify({
    applicantName: form.applicantName.trim(),
    applicantEmail: form.applicantEmail.trim().toLowerCase(),
    applicantPhone: form.applicantPhone.trim(),
    unitNumberInternal: form.unitNumberInternal.trim(),
    unitNumberSkatteverket: form.unitNumberSkatteverket.trim(),
    actionTypeKeys: [...form.actionTypeKeys].sort((left, right) => left.localeCompare(right, 'sv')),
    description: form.description.trim(),
    contractorName: form.contractorName.trim(),
    contractorOrgNumber: form.contractorOrgNumber.trim(),
    contractorEmail: form.contractorEmail.trim().toLowerCase(),
    contractorPhone: form.contractorPhone.trim(),
    contractorHasRequiredCertification: form.contractorHasRequiredCertification,
    participantEntries: normalizeParticipantEntries(form.participantEntries),
    questionAnswers: sortedQuestionAnswers,
  })
}

export default function RenoAppApplyPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const slug = typeof params?.slug === 'string' ? params.slug : 'okand-brf'
  const initialDraftToken = searchParams.get('draft') ?? ''

  const [config, setConfig] = useState<PublicConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [step, setStep] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)
  const [activeDraftToken, setActiveDraftToken] = useState(initialDraftToken)
  const [draftInfo, setDraftInfo] = useState<DraftResponse | null>(null)
  const [replyMessage, setReplyMessage] = useState('')
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([])
  const [savingDraft, setSavingDraft] = useState(false)
  const [autosaving, setAutosaving] = useState(false)
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null)
  const [uploadingTargetId, setUploadingTargetId] = useState<string | null>(null)
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)
  const [showCaseMessages, setShowCaseMessages] = useState(false)
  const [openVerificationInstructionIds, setOpenVerificationInstructionIds] = useState<string[]>([])
  const [actionDescriptionModal, setActionDescriptionModal] = useState<{
    label: string
    description: string
  } | null>(null)
  const lastSavedDraftFingerprintRef = useRef('')
  const autosaveDraftRef = useRef<(fingerprint: string) => void>(() => {})

  useEffect(() => {
    let active = true

    const loadConfig = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/renoapp/brf/${slug}/public`, { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as PublicConfigResponse & { error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa BRF-konfiguration.')
        }

        if (!active) return
        setConfig(payload)
      } catch (fetchError) {
        if (!active) return
        setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa BRF-konfiguration.')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadConfig()

    return () => {
      active = false
    }
  }, [slug])

  useEffect(() => {
    let active = true

    const loadDraft = async () => {
      if (!activeDraftToken) {
        setDraftInfo(null)
        setUploadedDocuments([])
        setReplyMessage('')
        return
      }

      try {
        const response = await fetch(`/api/renoapp/public/applications/draft/${activeDraftToken}`, {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => ({}))) as DraftResponse & { error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa utkastet.')
        }

        if (!active) return

        setDraftInfo(payload)
        setUploadedDocuments(payload.documents ?? [])
        setReplyMessage('')
        if (payload.case.status === 'need_info') {
          setStep(
            payload.completionRequest?.requestedDocuments.length > 0
              ? 3
              : payload.completionRequest?.requestedParticipants.length > 0
                ? 4
                : 5
          )
        }
        const nextForm = {
          applicantName: payload.form.applicantName,
          applicantEmail: payload.form.applicantEmail,
          applicantPhone: payload.form.applicantPhone,
          unitNumberInternal: payload.form.unitNumberInternal,
          unitNumberSkatteverket: payload.form.unitNumberSkatteverket,
          actionTypeKeys: payload.form.actionTypeKeys,
          description: payload.form.description,
          contractorName: payload.form.contractorName,
          contractorOrgNumber: payload.form.contractorOrgNumber,
          contractorEmail: payload.form.contractorEmail,
          contractorPhone: payload.form.contractorPhone,
          contractorHasRequiredCertification: payload.form.contractorHasRequiredCertification,
          participantEntries: payload.form.participantEntries ?? [],
          questionAnswers: payload.form.questionAnswers ?? {},
        }
        setForm(nextForm)
        lastSavedDraftFingerprintRef.current = buildDraftFingerprint(nextForm)
        setLastAutosavedAt(payload.case.updatedAt ?? null)
      } catch (fetchError) {
        if (!active) return
        setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa utkastet.')
      }
    }

    void loadDraft()

    return () => {
      active = false
    }
  }, [activeDraftToken])

  const selectedActions = useMemo(
    () => config?.actionTypes.filter((action) => form.actionTypeKeys.includes(action.key)) ?? [],
    [config, form.actionTypeKeys]
  )
  const isNeedInfoCase = draftInfo?.case.status === 'need_info'
  const isReadOnlyCase = Boolean(
    draftInfo && draftInfo.case.status !== 'draft' && draftInfo.case.status !== 'need_info'
  )
  const caseMessages = useMemo(
    () => (draftInfo?.messages ?? []).filter((message) => message.type !== 'document_uploaded'),
    [draftInfo?.messages]
  )
  const latestCompletionRequestMessage = useMemo(
    () => (draftInfo?.messages ?? []).find((message) => message.type === 'request_for_info')?.message ?? null,
    [draftInfo?.messages]
  )

  const baseRequirements = useMemo(() => mergeRequirements(selectedActions), [selectedActions])
  const baseQuestions = useMemo(() => mergeQuestions(selectedActions), [selectedActions])
  const baseParticipantRoles = useMemo(() => mergeParticipantRoles(selectedActions), [selectedActions])
  const visibleQuestions = useMemo(
    () => resolveVisibleQuestions(baseQuestions, config?.questionBank ?? [], form.questionAnswers),
    [baseQuestions, config?.questionBank, form.questionAnswers]
  )
  const mergedRequirements = useMemo(
    () => resolveTriggeredRequirements(baseRequirements, visibleQuestions, form.questionAnswers),
    [baseRequirements, form.questionAnswers, visibleQuestions]
  )
  const mergedParticipantRoles = useMemo(
    () => resolveTriggeredParticipantRoles(baseParticipantRoles, visibleQuestions, form.questionAnswers),
    [baseParticipantRoles, form.questionAnswers, visibleQuestions]
  )
  const actionGroups = useMemo(() => groupActionsByCategory(config?.actionTypes ?? []), [config?.actionTypes])
  const requirementGroups = useMemo(() => groupRequirementsByPhase(mergedRequirements), [mergedRequirements])
  const beforePhaseRequirements = useMemo(
    () => mergedRequirements.filter(isBeforePhaseRequirement),
    [mergedRequirements]
  )
  const completionRequirements = useMemo<Requirement[]>(
    () =>
      (draftInfo?.completionRequest?.requestedDocuments ?? []).map((item, index) => ({
        id: `requested-document:${item.documentTypeId}`,
        documentTypeId: item.documentTypeId,
        documentKey: item.documentTypeId,
        documentLabel: item.label,
        documentDescription: item.description,
        isRequired: true,
        phase: 'before_required',
        note: item.note,
        sortOrder: index,
      })),
    [draftInfo?.completionRequest?.requestedDocuments]
  )
  const completionParticipantRoles = useMemo<ParticipantRole[]>(
    () =>
      (draftInfo?.completionRequest?.requestedParticipants ?? []).map((item, index) => ({
        id: item.participantRoleId,
        key: item.key,
        label: item.label,
        description: item.description,
        roleKind: item.roleKind,
        verificationInstructions: item.verificationInstructions,
        verificationUrl: item.verificationUrl,
        insuranceRequired: item.insuranceRequired,
        requiresCompanyName: item.requiresCompanyName,
        requiresOrgNumber: item.requiresOrgNumber,
        requiresContactName: item.requiresContactName,
        requiresEmail: item.requiresEmail,
        requiresPhone: item.requiresPhone,
        requiresCertification: item.requiresCertification,
        isRequired: true,
        sortOrder: index,
      })),
    [draftInfo?.completionRequest?.requestedParticipants]
  )
  const requirementsForCurrentFlow = isNeedInfoCase ? completionRequirements : beforePhaseRequirements
  const participantRolesForCurrentFlow = isNeedInfoCase ? completionParticipantRoles : mergedParticipantRoles
  const flowStepItems = useMemo(() => {
    if (!isNeedInfoCase) return VISIBLE_STEP_ITEMS

    return STEP_ITEMS.filter(
      (item) =>
        (item.id === 3 && completionRequirements.length > 0) ||
        (item.id === 4 && completionParticipantRoles.length > 0) ||
        item.id === 5
    )
  }, [completionParticipantRoles.length, completionRequirements.length, isNeedInfoCase])
  const filledParticipantEntryCount = useMemo(
    () =>
      normalizeParticipantEntries(form.participantEntries).filter((entry) =>
        Boolean(
          entry.companyName ||
            entry.orgNumber ||
            entry.contactName ||
            entry.email ||
            entry.phone ||
            entry.certificationReference ||
            entry.hasVerifiedAuthorization ||
            entry.acceptsResponsibility
        )
      ).length,
    [form.participantEntries]
  )
  const draftFingerprint = useMemo(() => buildDraftFingerprint(form), [form])
  const autosaveEligible = useMemo(
    () => draftFingerprint !== buildDraftFingerprint(INITIAL_FORM) || Boolean(activeDraftToken),
    [activeDraftToken, draftFingerprint]
  )
  const stepSummaries = useMemo<Record<number, string>>(
    () => ({
      1:
        form.applicantName || form.applicantEmail
          ? `${form.applicantName || 'Ingen sökande angiven'}${form.applicantEmail ? `, ${form.applicantEmail}` : ''}`
          : 'Kontaktuppgifter saknas ännu.',
      2:
        selectedActions.length > 0
          ? selectedActions
              .map((action) => action.label)
              .slice(0, 3)
              .join(', ')
          : 'Inga renoveringar valda ännu.',
      3:
        isNeedInfoCase
          ? `${requirementsForCurrentFlow.length} begärda handlingar.`
          : selectedActions.length === 0
          ? 'Välj först vad du vill renovera.'
          : beforePhaseRequirements.length > 0
          ? `${requirementGroups.beforeRequired.length} obligatoriska underlag, ${
              beforePhaseRequirements.length - requirementGroups.beforeRequired.length
            } övriga underlag.`
          : 'Inga underlag behöver bifogas utifrån dina nuvarande val.',
      4:
        participantRolesForCurrentFlow.length > 0
          ? `${filledParticipantEntryCount} av ${participantRolesForCurrentFlow.length} roller ifyllda.`
          : 'Inga entreprenörer eller konsulter behövs ännu.',
      5:
        submitResult?.caseNumber
          ? `Ärendenummer ${submitResult.caseNumber}.`
          : `${selectedActions.length} valda renoveringar sammanställda.`,
    }),
    [
      beforePhaseRequirements.length,
      form.applicantEmail,
      form.applicantName,
      filledParticipantEntryCount,
      isNeedInfoCase,
      participantRolesForCurrentFlow.length,
      requirementGroups.beforeRequired.length,
      requirementsForCurrentFlow.length,
      selectedActions,
      submitResult?.caseNumber,
    ]
  )

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const getParticipantEntry = (participantRoleId: string) =>
    form.participantEntries.find((entry) => entry.participantRoleId === participantRoleId) ??
    emptyParticipantEntry(participantRoleId)

  const updateParticipantEntry = (
    participantRoleId: string,
    patch: Partial<Omit<ParticipantEntry, 'participantRoleId'>>
  ) => {
    setForm((current) => {
      const existing =
        current.participantEntries.find((entry) => entry.participantRoleId === participantRoleId) ??
        emptyParticipantEntry(participantRoleId)
      const nextEntry = {
        ...existing,
        ...patch,
        participantRoleId,
      }

      return {
        ...current,
        participantEntries: [
          ...current.participantEntries.filter((entry) => entry.participantRoleId !== participantRoleId),
          nextEntry,
        ],
      }
    })
  }

  const updateQuestionAnswer = (questionKey: string, value: string[]) => {
    setForm((current) => ({
      ...current,
      questionAnswers: {
        ...current.questionAnswers,
        [questionKey]: value,
      },
    }))
  }

  const clearForm = () => {
    if (!window.confirm('Rensa hela formuläret och börja om?')) return

    setForm((current) => ({
      ...INITIAL_FORM,
      applicantName: current.applicantName,
      applicantEmail: current.applicantEmail,
      applicantPhone: current.applicantPhone,
      unitNumberInternal: current.unitNumberInternal,
      unitNumberSkatteverket: current.unitNumberSkatteverket,
    }))
    setStep(null)
    setError(null)
    setSubmitResult(null)
    setDraftInfo(null)
    setReplyMessage('')
    setUploadedDocuments([])
    setActiveDraftToken('')
    setLastAutosavedAt(null)
    lastSavedDraftFingerprintRef.current = ''
    router.replace(`/renoapp/brf/${slug}/apply`)
  }

  const toggleActionType = (key: string) => {
    setForm((current) => ({
      ...current,
      actionTypeKeys: current.actionTypeKeys.includes(key)
        ? current.actionTypeKeys.filter((value) => value !== key)
        : [...current.actionTypeKeys, key],
    }))
  }

  const uploadDocuments = async (
    input: {
      documentTypeId?: string | null
      participantRoleId?: string | null
      documentScope?: 'general' | 'participant_insurance'
    },
    files: FileList | File[] | null
  ) => {
    const selectedFiles = files ? Array.from(files).filter((file): file is File => file instanceof File) : []
    if (selectedFiles.length === 0) return
    if (!activeDraftToken) {
      setError('Spara först ansökan som utkast innan du laddar upp dokument.')
      return
    }

    const uploadKey = input.participantRoleId ?? input.documentTypeId ?? 'upload'
    setUploadingTargetId(uploadKey)
    setError(null)

    try {
      for (const file of selectedFiles) {
        const formData = new FormData()
        formData.append('file', file)
        if (input.documentTypeId) formData.append('document_type_id', input.documentTypeId)
        if (input.participantRoleId) formData.append('participant_role_id', input.participantRoleId)
        formData.append('document_scope', input.documentScope ?? 'general')

        const response = await fetch(`/api/renoapp/case-access/${activeDraftToken}/documents`, {
          method: 'POST',
          body: formData,
        })

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
          document?: UploadedDocument
        }

        if (!response.ok || !payload.document) {
          throw new Error(payload.error ?? 'Kunde inte ladda upp dokument.')
        }

        const uploadedDocument = payload.document as UploadedDocument
        setUploadedDocuments((current) => [uploadedDocument, ...current])
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp dokument.')
    } finally {
      setUploadingTargetId(null)
    }
  }

  const deleteDocument = async (documentId: string) => {
    if (!activeDraftToken) return
    if (!window.confirm('Radera detta dokument?')) return

    setDeletingDocumentId(documentId)
    setError(null)

    try {
      const response = await fetch(
        `/api/renoapp/case-access/${activeDraftToken}/documents?documentId=${encodeURIComponent(documentId)}`,
        { method: 'DELETE' }
      )

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera dokument.')
      }

      setUploadedDocuments((current) => current.filter((item) => item.id !== documentId))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera dokument.')
    } finally {
      setDeletingDocumentId(null)
    }
  }

  const submitApplication = async (
    mode: 'draft' | 'submit',
    options?: { silent?: boolean; fingerprint?: string }
  ) => {
    const isSilentDraft = mode === 'draft' && options?.silent === true

    if (mode === 'draft' && !isSilentDraft) {
      setSavingDraft(true)
    } else if (isSilentDraft) {
      setAutosaving(true)
    } else {
      setSubmitting(true)
    }

    if (!isSilentDraft) {
      setError(null)
      setSubmitResult(null)
    }

    try {
      const response = await fetch('/api/renoapp/public/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brfSlug: slug,
          draftToken: activeDraftToken || null,
          mode,
          applicantName: form.applicantName,
          applicantEmail: form.applicantEmail,
          applicantPhone: form.applicantPhone,
          unitNumberInternal: form.unitNumberInternal,
          unitNumberSkatteverket: form.unitNumberSkatteverket,
          description: form.description,
          replyMessage: mode === 'submit' ? replyMessage : null,
          contractorName: form.contractorName,
          contractorOrgNumber: form.contractorOrgNumber,
          contractorEmail: form.contractorEmail,
          contractorPhone: form.contractorPhone,
          contractorHasRequiredCertification: form.contractorHasRequiredCertification,
          participantEntries: normalizeParticipantEntries(form.participantEntries),
          actionTypeKeys: form.actionTypeKeys,
          questionAnswers: form.questionAnswers,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as SubmitResult & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara ansökan.')
      }

      if (!isSilentDraft) {
        setSubmitResult(payload)
      }

      if (mode === 'draft') {
        lastSavedDraftFingerprintRef.current = options?.fingerprint ?? draftFingerprint
        setLastAutosavedAt(new Date().toISOString())
      }

      const nextDraftToken =
        payload.resumeUrl.match(/[?&]draft=([^&]+)/)?.[1] ?? activeDraftToken

      if (nextDraftToken) {
        setActiveDraftToken(nextDraftToken)
        if (nextDraftToken !== activeDraftToken) {
          router.replace(`/renoapp/brf/${slug}/apply?draft=${nextDraftToken}`)
        }
      }

      if (mode === 'submit') {
        const now = new Date().toISOString()
        setReplyMessage('')
        setDraftInfo((current) =>
          current
            ? {
                ...current,
                case: {
                  ...current.case,
                  status: current.case.status === 'need_info' ? 'review' : 'submitted',
                  updatedAt: now,
                },
                messages:
                  current.case.status === 'need_info'
                    ? [
                        {
                          id: `reply-${now}`,
                          type: 'applicant_reply',
                          authorRole: 'applicant',
                          message: replyMessage.trim() || 'Komplettering inskickad.',
                          createdAt: now,
                        },
                        ...current.messages,
                      ]
                    : current.messages,
              }
            : current
        )
        setStep(5)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte spara ansökan.')
    } finally {
      setSavingDraft(false)
      setAutosaving(false)
      setSubmitting(false)
    }
  }

  autosaveDraftRef.current = (fingerprint: string) => {
    void submitApplication('draft', { silent: true, fingerprint })
  }

  useEffect(() => {
    if (
      !config ||
      !activeDraftToken ||
      !autosaveEligible ||
      isNeedInfoCase ||
      submitting ||
      savingDraft ||
      autosaving
    ) return
    if (draftFingerprint === lastSavedDraftFingerprintRef.current) return

    const timeoutId = window.setTimeout(() => {
      autosaveDraftRef.current(draftFingerprint)
    }, 1200)

    return () => window.clearTimeout(timeoutId)
  }, [activeDraftToken, autosaveEligible, autosaving, config, draftFingerprint, isNeedInfoCase, savingDraft, submitting])

  const renderStepContent = (stepId: number) => {
    if (stepId === 1) {
      return (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <input
              value={form.applicantName}
              onChange={(event) => updateField('applicantName', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Namn *"
              required
            />
            <input
              value={form.applicantEmail}
              onChange={(event) => updateField('applicantEmail', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="E-post *"
              type="email"
              required
            />
            <input
              value={form.applicantPhone}
              onChange={(event) => updateField('applicantPhone', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
              placeholder="Telefon *"
              required
            />
            <input
              value={form.unitNumberInternal}
              onChange={(event) => updateField('unitNumberInternal', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Internt lägenhetsnummer *"
              required
            />
            <input
              value={form.unitNumberSkatteverket}
              onChange={(event) => updateField('unitNumberSkatteverket', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Skatteverkets lägenhetsnummer *"
              required
            />
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm leading-7 text-stone-700">
            <p className="font-semibold text-stone-900">Spara och fortsätt senare</p>
            <p className="mt-2">
              Du kan skapa ett utkast direkt och fortsätta från samma länk senare. När ett utkast finns autosparas dina ändringar löpande.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!activeDraftToken ? (
                <button
                  type="button"
                  onClick={() => void submitApplication('draft')}
                  disabled={savingDraft}
                  className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingDraft ? 'Skapar utkast...' : 'Skapa utkast'}
                </button>
              ) : (
                <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                  Utkast skapat
                </span>
              )}
              {!activeDraftToken ? <span className="text-xs text-stone-500">Du kan fylla i resten senare.</span> : null}
            </div>
          </div>
        </div>
      )
    }

    if (stepId === 2) {
      return (
        <div className="space-y-4 md:space-y-6">
          {actionGroups.map((group) => (
            <div key={group.category.id}>
              <div className="mb-2 md:mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">{group.category.label}</p>
                {group.category.description ? (
                  <p className="mt-1 hidden text-sm text-stone-700 sm:block">{group.category.description}</p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.actions.map((action) => {
                  const selected = form.actionTypeKeys.includes(action.key)
                  const hasLongDescription = (action.description?.trim().length ?? 0) > 90

                  return (
                    <div
                      key={action.id}
                      className={`min-h-[64px] rounded-[18px] border px-3 py-2.5 text-left transition md:min-h-[74px] md:rounded-[22px] md:px-4 md:py-3 ${
                        selected
                          ? 'border-emerald-600 bg-emerald-50 shadow-[0_10px_30px_-20px_rgba(5,150,105,0.7)]'
                          : 'border-stone-200 bg-white hover:border-stone-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleActionType(action.key)}
                        className="flex w-full items-start justify-between gap-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold leading-5 text-stone-900 md:text-base md:leading-6">
                            {action.label}
                          </p>
                          {action.description ? (
                            <p
                              className="mt-1 text-xs leading-5 text-stone-700 md:text-sm md:leading-6"
                              style={compactDescriptionStyle}
                            >
                              {action.description}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                            selected
                              ? 'border-emerald-700 bg-emerald-700 text-white'
                              : 'border-stone-300 bg-white text-stone-500'
                          }`}
                        >
                          {selected ? 'x' : '+'}
                        </span>
                      </button>
                      {action.description && hasLongDescription ? (
                        <button
                          type="button"
                          onClick={() =>
                            setActionDescriptionModal({
                              label: action.label,
                              description: action.description ?? '',
                            })
                          }
                          className="mt-1 text-xs font-semibold text-stone-600 underline underline-offset-2 hover:text-stone-900"
                        >
                          Visa mer
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {selectedActions.length > 0 ? (
            <div className="rounded-2xl border-0 bg-transparent p-0 md:rounded-3xl md:border md:border-stone-200 md:bg-white md:p-5">
              <p className="text-sm font-semibold text-stone-900">Följdfrågor</p>

              {visibleQuestions.length === 0 ? (
                <p className="mt-4 text-sm text-stone-600">
                  Inga följdfrågor är kopplade till de valda renoveringstyperna ännu.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {visibleQuestions.map((question) => {
                    const selectedValues = form.questionAnswers[question.key] ?? []

                    return (
                      <div key={question.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 md:rounded-2xl md:px-4 md:py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-stone-900">
                              {question.label}
                              {question.isRequired ? ' *' : ''}
                            </p>
                            {question.helpText ? (
                              <p className="mt-1 text-sm leading-6 text-stone-700 md:leading-7">{question.helpText}</p>
                            ) : null}
                          </div>
                          <span className="shrink-0 rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-semibold text-stone-600">
                            {question.responseType === 'multi_select' ? 'Flera val' : 'Ett val'}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {question.options.map((option) => {
                            const selected = selectedValues.includes(option.key)
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() =>
                                  updateQuestionAnswer(
                                    question.key,
                                    question.responseType === 'multi_select'
                                      ? toggleMultiSelectValue(selectedValues, option.key)
                                      : [option.key]
                                  )
                                }
                                className={`rounded-xl border px-3 py-2.5 text-left transition md:rounded-2xl md:px-4 md:py-3 ${
                                  selected
                                    ? 'border-emerald-600 bg-emerald-50'
                                    : 'border-stone-200 bg-white hover:border-stone-300'
                                }`}
                              >
                                <p className="font-medium text-stone-900">{option.label}</p>
                                {option.description ? (
                                  <p className="mt-1 text-sm leading-6 text-stone-700">{option.description}</p>
                                ) : null}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : null}

          <div className="rounded-3xl border border-stone-200 bg-white p-5">
            <label className="block text-sm font-semibold text-stone-900" htmlFor="description">
              Beskriv projektet
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
              rows={7}
              className="mt-3 min-h-44 w-full rounded-3xl border border-stone-300 bg-white px-5 py-4 text-sm text-stone-900"
              placeholder="Beskriv så noggrant som möjligt vad du vill göra, hur omfattande arbetet är, vilka rum eller installationer som berörs och om du redan har ritningar eller annan dokumentation klar."
            />
          </div>
        </div>
      )
    }

    if (stepId === 3) {
      return (
        <div className="grid gap-4">
          <p className="max-w-4xl text-sm leading-7 text-stone-700">
            {isNeedInfoCase
              ? 'Ladda upp de handlingar som styrelsen har begärt. Befintliga handlingar ligger kvar i ärendet.'
              : 'Här ser du vad som normalt behöver bifogas utifrån de renoveringstyper du valt. Om något saknas nu kan du ändå spara utkastet och komplettera senare.'}
          </p>
          {!activeDraftToken && requirementsForCurrentFlow.length > 0 ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Fyll först i lägenhet och kontakt så att utkastet kan skapas innan du laddar upp dokument.
            </div>
          ) : null}
          {!isNeedInfoCase && selectedActions.length === 0 ? (
            <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
              Välj först minst en renoveringstyp i steg 2.
            </div>
          ) : requirementsForCurrentFlow.length === 0 ? (
            <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
              Inga underlag behöver bifogas utifrån dina nuvarande val.
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white">
              {requirementsForCurrentFlow.map((requirement, index) => {
                const requirementDocuments = uploadedDocuments.filter(
                  (item) => item.documentTypeId === requirement.documentTypeId
                )

                return (
                  <div
                    key={requirement.documentTypeId}
                    className={`${index > 0 ? 'border-t border-stone-200' : ''} px-5 py-5`}
                  >
                    <p className="font-semibold text-stone-900">
                      {requirement.documentLabel} {requirement.isRequired ? '(obligatorisk)' : '(bra att ha)'}
                    </p>
                    {requirement.documentDescription ? (
                      <p className="mt-2 text-sm leading-7 text-stone-700">{requirement.documentDescription}</p>
                    ) : null}
                    {requirement.note ? <p className="mt-2 text-sm text-stone-500">{requirement.note}</p> : null}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <label
                        className={`inline-flex cursor-pointer items-center rounded-full px-4 py-2 text-sm font-semibold transition ${
                          activeDraftToken
                            ? 'bg-stone-900 text-white hover:bg-stone-700'
                            : 'cursor-not-allowed border border-stone-300 bg-stone-100 text-stone-500'
                        }`}
                      >
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                          disabled={!activeDraftToken || uploadingTargetId === requirement.documentTypeId}
                          className="hidden"
                          onChange={(event) => {
                            void uploadDocuments(
                              { documentTypeId: requirement.documentTypeId, documentScope: 'general' },
                              event.target.files
                            )
                            event.currentTarget.value = ''
                          }}
                        />
                        {uploadingTargetId === requirement.documentTypeId
                          ? 'Laddar upp...'
                          : 'Ladda upp ett eller flera dokument'}
                      </label>
                    </div>
                    <p className="mt-2 text-sm text-stone-500">Du kan lägga till fler dokument senare om det behövs.</p>
                    {requirementDocuments.length > 0 ? (
                      <ul className="mt-4 divide-y divide-stone-200 border-t border-stone-200">
                        {requirementDocuments.map((item) => (
                          <li key={item.id} className="flex items-start justify-between gap-3 py-3 text-sm text-stone-700">
                            <div>
                              <p className="font-medium text-sky-700">{item.fileName ?? 'Dokument'}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-stone-500">
                                {item.status} · uppladdad {formatDateTime(item.uploadedAt)}
                              </p>
                              {item.note ? <p className="mt-1 text-stone-500">{item.note}</p> : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => void deleteDocument(item.id)}
                              disabled={deletingDocumentId === item.id}
                              className="rounded-full border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {deletingDocumentId === item.id ? 'Raderar...' : 'Radera'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    if (stepId === 4) {
      return (
        <div className="grid gap-4">
          {participantRolesForCurrentFlow.length === 0 ? (
            <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
              Inga entreprenörer eller konsulter behöver anges utifrån dina nuvarande val.
            </div>
          ) : null}

          {participantRolesForCurrentFlow.map((participantRole) => {
            const entry = getParticipantEntry(participantRole.id)
            const insuranceDocuments = uploadedDocuments.filter(
              (item) =>
                item.participantRoleId === participantRole.id && item.documentScope === 'participant_insurance'
            )
            const hasVerificationContent = Boolean(
              participantRole.verificationInstructions || participantRole.verificationUrl
            )
            const verificationInstructionsOpen = openVerificationInstructionIds.includes(
              participantRole.id
            )

            return (
              <div key={participantRole.id} className="rounded-3xl border border-stone-200 bg-white p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-stone-900">
                      {participantRole.label}
                      {participantRole.isRequired ? ' (krävs)' : ''}
                    </p>
                    {participantRole.description ? (
                      <p className="mt-2 text-sm leading-7 text-stone-700">{participantRole.description}</p>
                    ) : null}
                    {hasVerificationContent ? (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenVerificationInstructionIds((current) =>
                              current.includes(participantRole.id)
                                ? current.filter((id) => id !== participantRole.id)
                                : [...current, participantRole.id]
                            )
                          }
                          className="inline-flex items-center rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-stone-700 transition hover:bg-stone-100"
                        >
                          Verifieringsinstruktion
                        </button>
                        {verificationInstructionsOpen ? (
                          <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                            {participantRole.verificationInstructions ? (
                              <p className="text-sm leading-7 text-stone-700">
                                {participantRole.verificationInstructions}
                              </p>
                            ) : null}
                            {participantRole.verificationUrl ? (
                              <a
                                href={participantRole.verificationUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex text-sm font-semibold text-emerald-700 underline"
                              >
                                Kontrollera behörighet
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">
                    {participantRole.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'}
                  </span>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {participantRole.requiresCompanyName ? (
                    <input
                      value={entry.companyName}
                      onChange={(event) =>
                        updateParticipantEntry(participantRole.id, { companyName: event.target.value })
                      }
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                      placeholder="Företagsnamn"
                    />
                  ) : null}

                  {participantRole.requiresOrgNumber ? (
                    <input
                      value={entry.orgNumber}
                      onChange={(event) =>
                        updateParticipantEntry(participantRole.id, { orgNumber: event.target.value })
                      }
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                      placeholder="Organisationsnummer"
                    />
                  ) : null}

                  {participantRole.requiresContactName ? (
                    <input
                      value={entry.contactName}
                      onChange={(event) =>
                        updateParticipantEntry(participantRole.id, { contactName: event.target.value })
                      }
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                      placeholder="Kontaktperson"
                    />
                  ) : null}

                  {participantRole.requiresEmail ? (
                    <input
                      value={entry.email}
                      onChange={(event) => updateParticipantEntry(participantRole.id, { email: event.target.value })}
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                      placeholder="E-post"
                      type="email"
                    />
                  ) : null}

                  {participantRole.requiresPhone ? (
                    <input
                      value={entry.phone}
                      onChange={(event) => updateParticipantEntry(participantRole.id, { phone: event.target.value })}
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                      placeholder="Telefon"
                    />
                  ) : null}

                  {participantRole.requiresCertification ? (
                    <input
                      value={entry.certificationReference}
                      onChange={(event) =>
                        updateParticipantEntry(participantRole.id, {
                          certificationReference: event.target.value,
                        })
                      }
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                      placeholder="Behörighetsnummer eller certifieringsreferens"
                    />
                  ) : null}
                </div>

                {participantRole.insuranceRequired ? (
                  <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                    <p className="text-sm font-semibold text-stone-900">Försäkringsbevis</p>
                    <p className="mt-2 text-sm leading-7 text-stone-700">
                      Ladda upp försäkringsbevis för {participantRole.label.toLowerCase()}.
                    </p>
                    {!activeDraftToken ? (
                      <p className="mt-2 text-sm text-amber-800">
                        Skapa först utkastet i steg 1 innan du laddar upp försäkringsbevis.
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <label
                        className={`inline-flex cursor-pointer items-center rounded-full px-4 py-2 text-sm font-semibold transition ${
                          activeDraftToken
                            ? 'bg-stone-900 text-white hover:bg-stone-700'
                            : 'cursor-not-allowed border border-stone-300 bg-stone-100 text-stone-500'
                        }`}
                      >
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                          disabled={!activeDraftToken || uploadingTargetId === participantRole.id}
                          className="hidden"
                          onChange={(event) => {
                            void uploadDocuments(
                              {
                                participantRoleId: participantRole.id,
                                documentScope: 'participant_insurance',
                              },
                              event.target.files
                            )
                            event.currentTarget.value = ''
                          }}
                        />
                        {uploadingTargetId === participantRole.id
                          ? 'Laddar upp...'
                          : 'Ladda upp ett eller flera försäkringsbevis'}
                      </label>
                      <p className="text-sm text-stone-500">Du kan lägga till fler filer om det behövs.</p>
                    </div>

                    {insuranceDocuments.length > 0 ? (
                      <ul className="mt-4 space-y-2">
                        {insuranceDocuments.map((item) => (
                          <li
                            key={item.id}
                            className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-sky-700">{item.fileName ?? 'Försäkringsbevis'}</p>
                                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-stone-500">
                                  {item.status} · uppladdad {formatDateTime(item.uploadedAt)}
                                </p>
                                {item.note ? <p className="mt-1 text-stone-500">{item.note}</p> : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => void deleteDocument(item.id)}
                                disabled={deletingDocumentId === item.id}
                                className="rounded-full border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deletingDocumentId === item.id ? 'Raderar...' : 'Radera'}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3">
                  <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                    <input
                      checked={entry.hasVerifiedAuthorization}
                      onChange={(event) =>
                        updateParticipantEntry(participantRole.id, {
                          hasVerifiedAuthorization: event.target.checked,
                        })
                      }
                      type="checkbox"
                      className="mt-1"
                    />
                    <span>Jag har kontrollerat att företaget har rätt behörighet.</span>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                    <input
                      checked={entry.acceptsResponsibility}
                      onChange={(event) =>
                        updateParticipantEntry(participantRole.id, {
                          acceptsResponsibility: event.target.checked,
                        })
                      }
                      type="checkbox"
                      className="mt-1"
                    />
                    <span>Jag förstår att jag ansvarar för att uppgifterna är korrekta.</span>
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )
    }

    return (
      <div className="grid gap-4">
        <div className="rounded-3xl border border-stone-200 bg-white p-5">
          <p className="text-sm font-semibold text-stone-900">Sammanfattning</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <p className="font-medium text-stone-900">Sökande</p>
              <p className="mt-1">{form.applicantName || '-'}</p>
              <p>{form.applicantEmail || '-'}</p>
              <p>{form.applicantPhone || '-'}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <p className="font-medium text-stone-900">Lägenhet</p>
              <p className="mt-1">Internt nr: {form.unitNumberInternal || '-'}</p>
              <p>Skatteverket: {form.unitNumberSkatteverket || '-'}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <p className="font-medium text-stone-900">Valda renoveringstyper</p>
              {selectedActions.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {selectedActions.map((action) => (
                    <li key={action.id}>{action.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1">Inga valda renoveringstyper.</p>
              )}
            </div>
          </div>
        </div>

        {isNeedInfoCase ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-sm font-semibold text-amber-950">Svar till styrelsen</p>
            <p className="mt-2 text-sm leading-7 text-amber-900">
              Beskriv vad du har kompletterat eller förtydligat. Du kan också bara ladda upp dokument och skicka in igen.
            </p>
            <textarea
              value={replyMessage}
              onChange={(event) => setReplyMessage(event.target.value)}
              rows={5}
              className="mt-4 w-full rounded-3xl border border-amber-200 bg-white px-5 py-4 text-sm text-stone-900"
              placeholder="Skriv ditt svar till styrelsen här."
            />
          </div>
        ) : null}

        {submitResult ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
            <p className="font-semibold">{submitResult.status === 'draft' ? 'Utkast sparat' : 'Ansökan registrerad'}</p>
            <p className="mt-2">Ärendenummer: {submitResult.caseNumber}</p>
            <p className="mt-2 break-all">
              {submitResult.status === 'draft' ? 'Fortsätt senare via:' : 'Öppna samma ansökningssida via:'}{' '}
              {submitResult.resumeUrl}
            </p>
            {submitResult.emailError ? <p className="mt-2 text-amber-900">{submitResult.emailError}</p> : null}
          </div>
        ) : null}
      </div>
    )
  }

  if (loading) {
    return <main className="mx-auto min-h-screen max-w-6xl px-6 py-14 md:px-10">Laddar ansökningsguide...</main>
  }

  if (error && !config) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl px-6 py-14 md:px-10">
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
          {error}
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-3 py-4 md:px-6 md:py-10">
      <section className="rounded-[24px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.98))] p-4 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)] md:rounded-[32px] md:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Ansökningsguide</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">{config?.brf.name ?? slug}</h1>
          <p className="mt-4 max-w-4xl text-base leading-8 text-stone-700">
            {config?.brf.applyIntroText ??
              'Guiden hjälper dig att välja rätt renoveringstyper, förstå vilka dokument som behövs och skicka in ett komplett underlag till din BRF.'}
          </p>
        </div>

        {draftInfo ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">
              {isNeedInfoCase
                ? 'Styrelsen har begärt komplettering i ditt ärende.'
                : isReadOnlyCase
                  ? 'Ansökan är inskickad och låst för ändringar.'
                  : 'Du arbetar i ett sparat ärende.'}
            </p>
            <p className="mt-2">
              Ärendenummer {draftInfo.case.caseNumber} har status {formatCaseStatus(draftInfo.case.status)} och uppdaterades senast{' '}
              {formatDateTime(draftInfo.case.updatedAt)}.
            </p>
            {isNeedInfoCase && latestCompletionRequestMessage ? (
              <div className="mt-4 border-t border-amber-200 pt-4">
                <p className="font-semibold text-amber-950">Styrelsens begäran</p>
                <p className="mt-2 whitespace-pre-wrap leading-7">{latestCompletionRequestMessage}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {caseMessages.length ? (
          <div className="mt-6 rounded-3xl border border-stone-200 bg-white/90 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-stone-900">Kommunikation i ärendet</p>
              <button
                type="button"
                onClick={() => setShowCaseMessages((current) => !current)}
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                {showCaseMessages ? 'Dölj kommunikation' : 'Visa kommunikation'}
              </button>
            </div>
            {showCaseMessages ? (
              <div className="mt-4 space-y-2">
                {caseMessages.map((message) => (
                  <div key={message.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-stone-900">{getMessageTitle(message.type)}</p>
                      <p className="text-xs text-stone-500">{formatDateTime(message.createdAt)}</p>
                    </div>
                    {message.message ? <p className="mt-2 whitespace-pre-wrap">{message.message}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {isReadOnlyCase ? (
          <div className="mt-4 rounded-2xl border border-stone-200 bg-white/80 p-4 md:mt-6 md:rounded-3xl md:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Inskickad ansökan</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-900">Styrelsen handlägger ärendet</h2>
            <p className="mt-2 text-sm leading-7 text-stone-600">
              Grundansökan kan inte ändras efter inskickning. Om styrelsen behöver mer information skickas en ny
              kompletteringsbegäran till den här adressen.
            </p>
            <div className="mt-6">{renderStepContent(5)}</div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-stone-200 bg-white/80 p-4 md:mt-6 md:rounded-3xl md:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Ansökan steg för steg</p>
              <h2 className="mt-2 text-2xl font-semibold text-stone-900">
                {isNeedInfoCase ? 'Komplettera det styrelsen har begärt' : 'Fyll ett steg i taget'}
              </h2>
              <p className="mt-2 text-sm text-stone-600">
                {isNeedInfoCase
                  ? 'Grundansökan är låst. Lägg till efterfrågade handlingar eller uppgifter och skicka sedan kompletteringen.'
                  : 'Varje steg öppnas direkt under sin egen rad. Du kan alltid öppna ett tidigare steg igen och ändra något.'}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2 md:mt-6 md:space-y-3">
            {flowStepItems.map((item, visibleIndex) => {
              const isOpen = step === item.id

              return (
                <section
                  key={item.id}
                  className={`overflow-hidden rounded-[22px] border transition md:rounded-[28px] ${
                    isOpen
                      ? 'border-stone-300 bg-white shadow-[0_18px_50px_-35px_rgba(41,37,36,0.45)]'
                      : 'border-stone-200 bg-stone-50/80'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setStep((current) => (current === item.id ? null : item.id))}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left md:gap-4 md:px-5 md:py-4"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                          isOpen
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-300 bg-white text-stone-700'
                        }`}
                      >
                        {visibleIndex + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-stone-900 md:text-base">{item.label}</p>
                        {!isOpen ? <p className="mt-1 hidden text-sm text-stone-600 sm:block">{stepSummaries[item.id]}</p> : null}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                      {isOpen ? 'Öppet' : 'Öppna'}
                    </span>
                  </button>

                  {isOpen ? <div className="border-t border-stone-200 px-4 py-4 md:px-5 md:py-5">{renderStepContent(item.id)}</div> : null}
                </section>
              )
            })}
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          {autosaveEligible && !isNeedInfoCase && !submitResult ? (
            <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              {autosaving
                ? 'Autosparar utkast...'
                : lastAutosavedAt
                  ? `Utkast autosparat ${formatDateTime(lastAutosavedAt)}.`
                  : 'Välj Spara utkast när du vill skapa ansökan. Därefter autosparas ändringarna.'}
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {step !== 5 ? (
              <button
                type="button"
                onClick={() => setStep((current) => getNextVisibleStepId(current, flowStepItems))}
                className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
              >
                Nästa steg
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submitApplication('submit')}
                disabled={submitting}
                className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Skickar...' : isNeedInfoCase ? 'Skicka komplettering' : 'Skicka ansökan'}
              </button>
            )}
            {!activeDraftToken ? (
              <button
                type="button"
                onClick={() => void submitApplication('draft')}
                disabled={savingDraft}
                className="rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingDraft ? 'Sparar...' : 'Spara och fortsätt senare'}
              </button>
            ) : null}
            {!isNeedInfoCase ? (
              <button
                type="button"
                onClick={clearForm}
                className="rounded-full border border-rose-300 px-5 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                Rensa formulär
              </button>
            ) : null}
          </div>
          </div>
        )}
      </section>
      {actionDescriptionModal ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center"
          onClick={() => setActionDescriptionModal(null)}
        >
          <div
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-[28px] bg-white p-5 shadow-[0_30px_80px_-40px_rgba(41,37,36,0.6)] md:max-h-[calc(100vh-4rem)] md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-h-0 items-start justify-between gap-4">
              <div className="min-h-0 min-w-0 flex-1">
                <p className="text-lg font-semibold text-stone-900">{actionDescriptionModal.label}</p>
                <p className="mt-2 max-h-[calc(100vh-12rem)] overflow-y-auto whitespace-pre-line pr-2 text-sm leading-7 text-stone-700 md:max-h-[calc(100vh-14rem)]">
                  {actionDescriptionModal.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionDescriptionModal(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-300 text-sm font-semibold text-stone-600 hover:bg-stone-100"
                aria-label="Stäng beskrivning"
              >
                ×
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setActionDescriptionModal(null)}
                className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700"
              >
                Stäng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

