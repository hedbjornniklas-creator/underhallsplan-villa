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
  requiresCompanyName: boolean
  requiresOrgNumber: boolean
  requiresContactName: boolean
  requiresEmail: boolean
  requiresPhone: boolean
  requiresCertification: boolean
  isRequired: boolean
  sortOrder: number
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
  triggerType: 'question' | 'document' | 'participant_role'
  questionId: string | null
  documentTypeId: string | null
  documentKey: string | null
  documentLabel: string | null
  documentDescription: string | null
  documentPhase: 'before_required' | 'during_execution' | 'after_completion' | null
  participantRoleId: string | null
  participantRole: ParticipantRole | null
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
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
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
  questionAnswers: {},
}

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const STEP_ITEMS = [
  { id: 1, label: 'Lägenhet och kontakt' },
  { id: 2, label: 'Vad vill du renovera?' },
  { id: 3, label: 'Underlag' },
  { id: 4, label: 'Projekt och entreprenör' },
  { id: 5, label: 'Granska och skicka' },
]

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
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
          note: current?.note ?? 'Detta dokument kravs utifran dina svar i foljdfragorna.',
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

function getContractorRequirementText(requirement?: ActionType['contractorRequirement']) {
  if (requirement === 'authorized_electrician') return 'Kräver behörig elektriker.'
  if (requirement === 'safe_water') return 'Kräver Säker Vatten-auktoriserad VVS-entreprenör.'
  if (requirement === 'bkr_or_gvk') return 'Kräver behörig våtrumsentreprenör enligt BKR eller GVK.'
  if (requirement === 'structural_engineer') return 'Kräver konstruktör eller särskilt sakkunnig.'
  if (requirement === 'qualified_contractor') return 'Kräver kvalificerad entreprenör.'
  return null
}

function describeParticipantInfoRequirements(participantRole: ParticipantRole) {
  return [
    participantRole.requiresCompanyName ? 'företagsnamn' : null,
    participantRole.requiresOrgNumber ? 'organisationsnummer' : null,
    participantRole.requiresContactName ? 'kontaktperson' : null,
    participantRole.requiresEmail ? 'e-post' : null,
    participantRole.requiresPhone ? 'telefon' : null,
    participantRole.requiresCertification ? 'behörighet/intyg' : null,
  ]
    .filter(Boolean)
    .join(', ')
}

function renderParticipantRoleList(items: ParticipantRole[]) {
  return (
    <ul className="space-y-2">
      {items.map((participantRole) => (
        <li key={participantRole.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <p className="font-medium text-stone-900">
            {participantRole.label} {participantRole.isRequired ? '(obligatorisk)' : '(vid behov)'}
          </p>
          {participantRole.description ? <p className="mt-1">{participantRole.description}</p> : null}
          <p className="mt-1 text-stone-500">
            {participantRole.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'}
            {describeParticipantInfoRequirements(participantRole)
              ? ` • Uppgifter: ${describeParticipantInfoRequirements(participantRole)}`
              : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}


const compactDescriptionStyle = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
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
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([])
  const [savingDraft, setSavingDraft] = useState(false)
  const [autosaving, setAutosaving] = useState(false)
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null)
  const [uploadingDocumentTypeId, setUploadingDocumentTypeId] = useState<string | null>(null)
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
  const contractorRequirementTexts = useMemo(
    () =>
      Array.from(
        new Set(selectedActions.map((action) => getContractorRequirementText(action.contractorRequirement)).filter(Boolean))
      ) as string[],
    [selectedActions]
  )
  const autosaveEligible = useMemo(() => {
    const hasName = form.applicantName.trim().length > 0
    const hasValidEmail = SIMPLE_EMAIL_REGEX.test(form.applicantEmail.trim())
    const hasUnit =
      form.unitNumberInternal.trim().length > 0 || form.unitNumberSkatteverket.trim().length > 0

    return hasName && hasValidEmail && hasUnit
  }, [form.applicantEmail, form.applicantName, form.unitNumberInternal, form.unitNumberSkatteverket])
  const draftFingerprint = useMemo(() => buildDraftFingerprint(form), [form])
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
        beforePhaseRequirements.length > 0
          ? `${requirementGroups.beforeRequired.length} obligatoriska underlag, ${
              beforePhaseRequirements.length - requirementGroups.beforeRequired.length
            } övriga underlag.`
          : 'Välj först vad du vill renovera.',
      4:
        form.contractorName || form.description
          ? `${form.contractorName ? `Entreprenör: ${form.contractorName}. ` : ''}${
              form.contractorHasRequiredCertification ? 'Behörighet bekräftad.' : 'Behörighet inte bekräftad ännu.'
            }`
          : mergedParticipantRoles.length > 0
            ? `${mergedParticipantRoles.length} medverkande behöver planeras.`
            : 'Projektbeskrivning och entreprenör saknas ännu.',
      5:
        submitResult?.caseNumber
          ? `Ärendenummer ${submitResult.caseNumber}.`
          : `${selectedActions.length} valda renoveringar och ${beforePhaseRequirements.length} underlagskrav sammanställda.`,
    }),
    [
      beforePhaseRequirements.length,
      form.applicantEmail,
      form.applicantName,
      form.contractorHasRequiredCertification,
      form.contractorName,
      form.description,
      mergedParticipantRoles.length,
      requirementGroups.beforeRequired.length,
      selectedActions,
      submitResult?.caseNumber,
    ]
  )

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
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

    setForm(INITIAL_FORM)
    setStep(null)
    setError(null)
    setSubmitResult(null)
    setDraftInfo(null)
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

  const uploadDocument = async (documentTypeId: string, file: File | null) => {
    if (!file) return
    if (!activeDraftToken) {
      setError('Spara först ansökan som utkast innan du laddar upp dokument.')
      return
    }

    setUploadingDocumentTypeId(documentTypeId)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('document_type_id', documentTypeId)

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

      setUploadedDocuments((current) => [payload.document as UploadedDocument, ...current])
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp dokument.')
    } finally {
      setUploadingDocumentTypeId(null)
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
          contractorName: form.contractorName,
          contractorOrgNumber: form.contractorOrgNumber,
          contractorEmail: form.contractorEmail,
          contractorPhone: form.contractorPhone,
          contractorHasRequiredCertification: form.contractorHasRequiredCertification,
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
    if (!config || !activeDraftToken || !autosaveEligible || submitting || savingDraft || autosaving) return
    if (draftFingerprint === lastSavedDraftFingerprintRef.current) return

    const timeoutId = window.setTimeout(() => {
      autosaveDraftRef.current(draftFingerprint)
    }, 1200)

    return () => window.clearTimeout(timeoutId)
  }, [activeDraftToken, autosaveEligible, autosaving, config, draftFingerprint, savingDraft, submitting])

  const renderStepContent = (stepId: number) => {
    if (stepId === 1) {
      return (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <input
              value={form.applicantName}
              onChange={(event) => updateField('applicantName', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Namn"
            />
            <input
              value={form.applicantEmail}
              onChange={(event) => updateField('applicantEmail', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="E-post"
              type="email"
            />
            <input
              value={form.applicantPhone}
              onChange={(event) => updateField('applicantPhone', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
              placeholder="Telefon"
            />
            <input
              value={form.unitNumberInternal}
              onChange={(event) => updateField('unitNumberInternal', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Internt lägenhetsnummer"
            />
            <input
              value={form.unitNumberSkatteverket}
              onChange={(event) => updateField('unitNumberSkatteverket', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Skatteverkets lägenhetsnummer"
            />
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm leading-7 text-stone-700">
            <p className="font-semibold text-stone-900">Spara och fortsätt senare</p>
            <p className="mt-2">
              Fyll i namn, e-post och lägenhet och välj sedan `Spara utkast` för att skapa ansökan. Därefter autosparas dina ändringar löpande.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!activeDraftToken ? (
                <button
                  type="button"
                  onClick={() => void submitApplication('draft')}
                  disabled={!autosaveEligible || savingDraft}
                  className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingDraft ? 'Skapar utkast...' : 'Skapa utkast'}
                </button>
              ) : (
                <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                  Utkast skapat
                </span>
              )}
              {!autosaveEligible && !activeDraftToken ? (
                <span className="text-xs text-stone-500">Fyll först i namn, e-post och lägenhet.</span>
              ) : null}
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

                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => toggleActionType(action.key)}
                      className={`min-h-[64px] rounded-[18px] border px-3 py-2.5 text-left transition md:min-h-[74px] md:rounded-[22px] md:px-4 md:py-3 ${
                        selected
                          ? 'border-emerald-600 bg-emerald-50 shadow-[0_10px_30px_-20px_rgba(5,150,105,0.7)]'
                          : 'border-stone-200 bg-white hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold leading-5 text-stone-900 md:text-base md:leading-6">
                            {action.label}
                          </p>
                          {action.description ? (
                            <p className="mt-1 text-xs leading-5 text-stone-700 md:text-sm md:leading-6" style={compactDescriptionStyle}>
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
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {selectedActions.length > 0 ? (
            <div className="rounded-2xl border-0 bg-transparent p-0 md:rounded-3xl md:border md:border-stone-200 md:bg-white md:p-5">
              <p className="text-sm font-semibold text-stone-900">Följdfrågor</p>
              <p className="mt-2 text-sm leading-7 text-stone-700">
                Besvara bara de frågor som hör till de renoveringstyper du valt. De används för att styra
                vilket underlag som behöver bifogas i nästa steg.
              </p>

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
        </div>
      )
    }

    if (stepId === 3) {
      return (
        <div className="grid gap-4">
          <div className="rounded-3xl border border-stone-200 bg-white p-5">
            <p className="text-sm leading-7 text-stone-700">
              Här ser du vad som normalt behöver bifogas utifrån de renoveringstyper du valt. Om något saknas nu kan
              du ändå spara utkastet och komplettera senare.
            </p>
          </div>
          {!activeDraftToken ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Fyll först i lägenhet och kontakt så att utkastet kan skapas innan du laddar upp dokument.
            </div>
          ) : null}
          {beforePhaseRequirements.length === 0 ? (
            <div className="rounded-3xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
              Välj först minst en renoveringstyp i steg 2.
            </div>
          ) : (
            beforePhaseRequirements.map((requirement) => (
              <div key={requirement.documentTypeId} className="rounded-3xl border border-stone-200 bg-white p-5">
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
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                      disabled={!activeDraftToken || uploadingDocumentTypeId === requirement.documentTypeId}
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null
                        void uploadDocument(requirement.documentTypeId, file)
                        event.currentTarget.value = ''
                      }}
                    />
                    {uploadingDocumentTypeId === requirement.documentTypeId ? 'Laddar upp...' : 'Ladda upp dokument'}
                  </label>
                </div>
                {uploadedDocuments.filter((item) => item.documentTypeId === requirement.documentTypeId).length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {uploadedDocuments
                      .filter((item) => item.documentTypeId === requirement.documentTypeId)
                      .map((item) => (
                        <li
                          key={item.id}
                          className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700"
                        >
                          <p className="font-medium text-stone-900">{item.fileName ?? 'Dokument'}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-stone-500">
                            {item.status} · uppladdad {formatDateTime(item.uploadedAt)}
                          </p>
                          {item.note ? <p className="mt-1 text-stone-500">{item.note}</p> : null}
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            ))
          )}
        </div>
      )
    }

    if (stepId === 4) {
      return (
        <div className="grid gap-4">
          {mergedParticipantRoles.length > 0 ? (
            <div className="rounded-3xl border border-stone-200 bg-white p-5">
              <p className="text-sm font-semibold text-stone-900">Medverkande som behövs</p>
              <p className="mt-2 text-sm leading-7 text-stone-700">
                Utifrån valda renoveringstyper och dina svar behöver följande entreprenörer eller konsulter normalt finnas med i projektet.
              </p>
              <div className="mt-4 text-sm text-stone-700">
                {renderParticipantRoleList(mergedParticipantRoles)}
              </div>
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
              placeholder="Beskriv kort vad du vill göra, hur omfattande arbetet är och om du redan har ritningar eller annan dokumentation klar."
            />
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white p-5">
            <p className="text-sm font-semibold text-stone-900">Entreprenör</p>
            <p className="mt-2 text-sm leading-7 text-stone-700">
              Vi fokuserar på vem som ska utföra arbetet och om rätt behörighet finns, i stället för att fråga efter
              tekniska detaljval i detta steg.
            </p>
            {contractorRequirementTexts.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-stone-700">
                {contractorRequirementTexts.map((item) => (
                  <li key={item} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <input
                value={form.contractorName}
                onChange={(event) => updateField('contractorName', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                placeholder="Företag eller entreprenör"
              />
              <input
                value={form.contractorOrgNumber}
                onChange={(event) => updateField('contractorOrgNumber', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Organisationsnummer"
              />
              <input
                value={form.contractorPhone}
                onChange={(event) => updateField('contractorPhone', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Telefon"
              />
              <input
                value={form.contractorEmail}
                onChange={(event) => updateField('contractorEmail', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                placeholder="E-post"
                type="email"
              />
            </div>
            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <input
                checked={form.contractorHasRequiredCertification}
                onChange={(event) => updateField('contractorHasRequiredCertification', event.target.checked)}
                type="checkbox"
                className="mt-1"
              />
              <span>Jag bekräftar att entreprenören har den behörighet eller certifiering som arbetet kräver.</span>
            </label>
          </div>
        </div>
      )
    }

    return (
      <div className="grid gap-4">
        <div className="rounded-3xl border border-stone-200 bg-white p-5">
          <p className="text-sm font-semibold text-stone-900">Sammanfattning</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
          </div>
        </div>

        {submitResult ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
            <p className="font-semibold">{submitResult.status === 'draft' ? 'Utkast sparat' : 'Ansökan registrerad'}</p>
            <p className="mt-2">Ärendenummer: {submitResult.caseNumber}</p>
            <p className="mt-2 break-all">
              {submitResult.status === 'draft' ? 'Fortsätt senare via:' : 'Öppna ärendet via:'}{' '}
              {submitResult.status === 'draft' ? submitResult.resumeUrl : submitResult.accessUrl}
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
            <p className="font-semibold">Du arbetar i ett sparat utkast.</p>
            <p className="mt-2">
              Ärendenummer {draftInfo.case.caseNumber} uppdaterades senast {formatDateTime(draftInfo.case.updatedAt)}.
            </p>
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-stone-200 bg-white/80 p-4 md:mt-6 md:rounded-3xl md:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Ansökan steg för steg</p>
              <h2 className="mt-2 text-2xl font-semibold text-stone-900">Fyll ett steg i taget</h2>
              <p className="mt-2 text-sm text-stone-600">
                Varje steg öppnas direkt under sin egen rad. Du kan alltid öppna ett tidigare steg igen och ändra något.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2 md:mt-6 md:space-y-3">
            {STEP_ITEMS.map((item) => {
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
                        {item.id}
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

          {autosaveEligible && !submitResult ? (
            <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              {autosaving
                ? 'Autosparar utkast...'
                : lastAutosavedAt
                  ? `Utkast autosparat ${formatDateTime(lastAutosavedAt)}.`
                  : 'Fyll i kontakt och lägenhet och välj sedan Spara utkast för att skapa ansökan.'}
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {step !== 5 ? (
              <button
                type="button"
                onClick={() => setStep((current) => (current == null ? 1 : Math.min(5, current + 1)))}
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
                {submitting ? 'Skickar...' : 'Skicka ansökan'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void submitApplication('draft')}
              disabled={savingDraft}
              className="rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingDraft ? 'Sparar...' : 'Spara och fortsätt senare'}
            </button>
            <button
              type="button"
              onClick={clearForm}
              className="rounded-full border border-rose-300 px-5 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              Rensa formulär
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

