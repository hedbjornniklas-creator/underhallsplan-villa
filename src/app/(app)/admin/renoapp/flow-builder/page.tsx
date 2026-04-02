'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

type ActionTypeItem = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isActive: boolean
  requirementCount: number
  questionCount: number
  participantRoleCount: number
}

type RequirementItem = {
  id: string
  documentTypeId: string
  documentLabel: string
  sortOrder: number
  isRequired: boolean
}

type ActionTypeGroup = {
  actionType: ActionTypeItem
  requirements: RequirementItem[]
}

type ActionQuestionItem = {
  id: string
  questionId: string
  questionLabel: string
  isRequired: boolean
  sortOrder: number
}

type ActionTypeQuestionGroup = {
  actionType: ActionTypeItem
  questions: ActionQuestionItem[]
}

type ActionParticipantRoleItem = {
  id: string
  participantRoleId: string
  participantRoleLabel: string
  roleKind: 'contractor' | 'consultant'
  isRequired: boolean
  sortOrder: number
}

type ActionTypeParticipantRoleGroup = {
  actionType: ActionTypeItem
  participantRoles: ActionParticipantRoleItem[]
}

type QuestionOptionTriggerItem = {
  id: string
  triggerType: 'question' | 'document' | 'participant_role' | 'review_flag'
  questionId: string | null
  documentTypeId: string | null
  participantRoleId: string | null
  reviewFlagId: string | null
  sortOrder: number
  isActive: boolean
}

type QuestionOptionItem = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isActive: boolean
  metadata: unknown
  triggers: QuestionOptionTriggerItem[]
}

type QuestionItem = {
  id: string
  key: string
  label: string
  helpText: string | null
  responseType: 'single_select' | 'multi_select' | 'boolean'
  sortOrder: number
  isLocked: boolean
  isActive: boolean
  metadata: unknown
  options: QuestionOptionItem[]
}

type DocumentTypeItem = {
  id: string
  key: string
  label: string
  description: string | null
  defaultPhase: 'before_required' | 'during_execution' | 'after_completion'
  sortOrder: number
  isActive: boolean
}

type ParticipantRoleItem = {
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
  sortOrder: number
  isActive: boolean
}

type ReviewFlagItem = {
  id: string
  key: string
  label: string
  description: string | null
  severity: 'info' | 'warning' | 'high'
  category: string | null
  sortOrder: number
  isActive: boolean
}

type FlowNodeTone = 'stone' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

type FlowNodeRef =
  | { type: 'actionType'; actionTypeId: string }
  | { type: 'rootQuestion'; actionTypeId: string; questionId: string }
  | { type: 'rootRequirement'; actionTypeId: string; documentTypeId: string }
  | { type: 'rootParticipant'; actionTypeId: string; participantRoleId: string }
  | { type: 'question'; questionId: string }
  | { type: 'option'; questionId: string; optionId: string }
  | { type: 'optionQuestionTrigger'; questionId: string; optionId: string; targetQuestionId: string }
  | { type: 'optionDocumentTrigger'; questionId: string; optionId: string; targetDocumentTypeId: string }
  | { type: 'optionParticipantTrigger'; questionId: string; optionId: string; targetParticipantRoleId: string }
  | { type: 'optionReviewFlagTrigger'; questionId: string; optionId: string; targetReviewFlagId: string }
  | { type: 'status' }

type FlowNode = {
  id: string
  kind: 'root' | 'question' | 'option' | 'document' | 'participant' | 'flag' | 'status'
  title: string
  badges: string[]
  tone: FlowNodeTone
  children: FlowNode[]
  ref: FlowNodeRef
}

type AddType = 'question' | 'document' | 'participant' | 'flag'
type ModalMode = 'summary' | 'edit' | 'add'

type ActionTypeDraft = {
  id?: string
  key: string
  label: string
  description: string
  sortOrder: string
  isActive: boolean
}

type QuestionDraft = {
  id?: string
  key: string
  label: string
  helpText: string
  responseType: QuestionItem['responseType']
  sortOrder: string
  isLocked: boolean
  isActive: boolean
}

type DocumentDraft = {
  id?: string
  key: string
  label: string
  description: string
  defaultPhase: DocumentTypeItem['defaultPhase']
  sortOrder: string
  isActive: boolean
}

type ParticipantDraft = {
  id?: string
  key: string
  label: string
  description: string
  roleKind: ParticipantRoleItem['roleKind']
  verificationInstructions: string
  verificationUrl: string
  insuranceRequired: boolean
  requiresCompanyName: boolean
  requiresOrgNumber: boolean
  requiresContactName: boolean
  requiresEmail: boolean
  requiresPhone: boolean
  requiresCertification: boolean
  sortOrder: string
  isActive: boolean
}

type ReviewFlagDraft = {
  id?: string
  key: string
  label: string
  description: string
  severity: ReviewFlagItem['severity']
  category: string
  sortOrder: string
  isActive: boolean
}

const EMPTY_ACTION_TYPE_DRAFT: ActionTypeDraft = {
  key: '',
  label: '',
  description: '',
  sortOrder: '100',
  isActive: true,
}

const EMPTY_QUESTION_DRAFT: QuestionDraft = {
  key: '',
  label: '',
  helpText: '',
  responseType: 'single_select',
  sortOrder: '100',
  isLocked: false,
  isActive: true,
}

const EMPTY_DOCUMENT_DRAFT: DocumentDraft = {
  key: '',
  label: '',
  description: '',
  defaultPhase: 'before_required',
  sortOrder: '100',
  isActive: true,
}

const EMPTY_PARTICIPANT_DRAFT: ParticipantDraft = {
  key: '',
  label: '',
  description: '',
  roleKind: 'contractor',
  verificationInstructions: '',
  verificationUrl: '',
  insuranceRequired: false,
  requiresCompanyName: true,
  requiresOrgNumber: true,
  requiresContactName: true,
  requiresEmail: true,
  requiresPhone: true,
  requiresCertification: false,
  sortOrder: '100',
  isActive: true,
}

const EMPTY_REVIEW_FLAG_DRAFT: ReviewFlagDraft = {
  key: '',
  label: '',
  description: '',
  severity: 'warning',
  category: '',
  sortOrder: '100',
  isActive: true,
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

async function readJson<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T
}

function slugifyKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function labelForResponseType(value: QuestionItem['responseType']) {
  if (value === 'multi_select') return 'Flera val'
  if (value === 'boolean') return 'Ja / nej'
  return 'Ett val'
}

function labelForPhase(value: DocumentTypeItem['defaultPhase']) {
  if (value === 'during_execution') return 'Under'
  if (value === 'after_completion') return 'Efter'
  return 'Före'
}

function labelForSeverity(value: ReviewFlagItem['severity']) {
  if (value === 'high') return 'Hög risk'
  if (value === 'warning') return 'Varning'
  return 'Info'
}

function toneClasses(tone: FlowNodeTone) {
  if (tone === 'sky') return 'border-sky-200 bg-sky-50 text-sky-900'
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (tone === 'rose') return 'border-rose-200 bg-rose-50 text-rose-900'
  if (tone === 'violet') return 'border-violet-200 bg-violet-50 text-violet-900'
  return 'border-stone-300 bg-white text-stone-900'
}

function collectExpandableNodeIds(nodes: FlowNode[]) {
  const ids: string[] = []
  const visit = (node: FlowNode) => {
    if (node.children.length > 0) ids.push(node.id)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return ids
}

function questionToRequestPayload(question: QuestionItem) {
  return {
    question: {
      id: question.id,
      key: question.key,
      label: question.label,
      helpText: question.helpText,
      responseType: question.responseType,
      sortOrder: question.sortOrder,
      isLocked: question.isLocked,
      isActive: question.isActive,
      metadata: question.metadata ?? {},
    },
    options: question.options.map((option) => ({
      id: option.id,
      key: option.key,
      label: option.label,
      description: option.description,
      sortOrder: option.sortOrder,
      isActive: option.isActive,
      metadata: option.metadata ?? {},
      triggers: option.triggers.map((trigger) => ({
        triggerType: trigger.triggerType,
        questionId: trigger.questionId,
        documentTypeId: trigger.documentTypeId,
        participantRoleId: trigger.participantRoleId,
        reviewFlagId: trigger.reviewFlagId,
        sortOrder: trigger.sortOrder,
        isActive: trigger.isActive,
      })),
    })),
  }
}

function FlowNodeCard({
  node,
  expanded,
  onToggle,
  onOpen,
}: {
  node: FlowNode
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const expandable = node.children.length > 0

  return (
    <div className={cn('w-[174px] rounded-md border px-3 py-2 shadow-sm', toneClasses(node.tone))}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">{node.kind}</div>
          <div className="mt-1 text-sm font-semibold leading-5">{node.title}</div>
        </button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onOpen} className="rounded border border-current/15 bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold">
            Öppna
          </button>
          {expandable ? (
            <button type="button" onClick={onToggle} className="rounded border border-current/15 bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold" aria-expanded={expanded}>
              {expanded ? '−' : '+'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {node.badges.map((badge) => (
          <span key={badge} className="rounded-full border border-current/15 bg-white/80 px-2 py-0.5 text-[10px] font-semibold">
            {badge}
          </span>
        ))}
      </div>
    </div>
  )
}

function HorizontalBranch({
  node,
  expandedNodeIds,
  onToggle,
  onOpen,
}: {
  node: FlowNode
  expandedNodeIds: string[]
  onToggle: (id: string) => void
  onOpen: (node: FlowNode) => void
}) {
  const expanded = expandedNodeIds.includes(node.id)

  return (
    <div className="flex items-start gap-5">
      <FlowNodeCard node={node} expanded={expanded} onToggle={() => onToggle(node.id)} onOpen={() => onOpen(node)} />
      {node.children.length > 0 && expanded ? (
        <div className="mt-6 flex min-w-0 items-start">
          <div className="mr-4 mt-6 h-px w-6 bg-stone-300" />
          <div className="relative space-y-5 border-l border-stone-300 pl-5">
            {node.children.map((child) => (
              <div key={child.id} className="relative">
                <div className="absolute left-[-20px] top-6 h-px w-5 bg-stone-300" />
                <HorizontalBranch node={child} expandedNodeIds={expandedNodeIds} onToggle={onToggle} onOpen={onOpen} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ModalField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</span>
      {children}
    </label>
  )
}

export default function RenoAppFlowBuilderPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [actionTypes, setActionTypes] = useState<ActionTypeItem[]>([])
  const [questionItems, setQuestionItems] = useState<QuestionItem[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeItem[]>([])
  const [participantRoles, setParticipantRoles] = useState<ParticipantRoleItem[]>([])
  const [reviewFlags, setReviewFlags] = useState<ReviewFlagItem[]>([])
  const [requirementGroups, setRequirementGroups] = useState<ActionTypeGroup[]>([])
  const [questionGroups, setQuestionGroups] = useState<ActionTypeQuestionGroup[]>([])
  const [participantGroups, setParticipantGroups] = useState<ActionTypeParticipantRoleGroup[]>([])

  const [selectedActionTypeId, setSelectedActionTypeId] = useState<string | null>(null)
  const [expandedNodeIds, setExpandedNodeIds] = useState<string[]>([])

  const [activeNode, setActiveNode] = useState<FlowNode | null>(null)
  const [modalMode, setModalMode] = useState<ModalMode>('summary')
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSaving, setModalSaving] = useState(false)
  const [addType, setAddType] = useState<AddType | null>(null)
  const [addMode, setAddMode] = useState<'existing' | 'new'>('existing')
  const [existingTargetId, setExistingTargetId] = useState('')

  const [actionTypeDraft, setActionTypeDraft] = useState<ActionTypeDraft>(EMPTY_ACTION_TYPE_DRAFT)
  const [questionDraft, setQuestionDraft] = useState<QuestionDraft>(EMPTY_QUESTION_DRAFT)
  const [documentDraft, setDocumentDraft] = useState<DocumentDraft>(EMPTY_DOCUMENT_DRAFT)
  const [participantDraft, setParticipantDraft] = useState<ParticipantDraft>(EMPTY_PARTICIPANT_DRAFT)
  const [reviewFlagDraft, setReviewFlagDraft] = useState<ReviewFlagDraft>(EMPTY_REVIEW_FLAG_DRAFT)

  const loadData = async (preferredActionTypeId?: string | null) => {
    setLoading(true)
    setError(null)

    try {
      const [
        actionTypesResponse,
        questionsResponse,
        documentTypesResponse,
        participantRolesResponse,
        reviewFlagsResponse,
        requirementsResponse,
        questionConfigResponse,
        participantConfigResponse,
      ] = await Promise.all([
        fetch('/api/renoapp/admin/action-types', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/questions', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/document-types', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/participants', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/review-flags', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/requirements', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/action-type-questions', { cache: 'no-store' }),
        fetch('/api/renoapp/admin/action-type-participants', { cache: 'no-store' }),
      ])

      const [
        actionTypesPayload,
        questionsPayload,
        documentTypesPayload,
        participantRolesPayload,
        reviewFlagsPayload,
        requirementsPayload,
        questionConfigPayload,
        participantConfigPayload,
      ] = await Promise.all([
        readJson<{ items?: ActionTypeItem[]; error?: string }>(actionTypesResponse),
        readJson<{ items?: QuestionItem[]; error?: string }>(questionsResponse),
        readJson<{ items?: DocumentTypeItem[]; error?: string }>(documentTypesResponse),
        readJson<{ items?: ParticipantRoleItem[]; error?: string }>(participantRolesResponse),
        readJson<{ items?: ReviewFlagItem[]; error?: string }>(reviewFlagsResponse),
        readJson<{ actionTypes?: ActionTypeGroup[]; error?: string }>(requirementsResponse),
        readJson<{ actionTypes?: ActionTypeQuestionGroup[]; error?: string }>(questionConfigResponse),
        readJson<{ actionTypes?: ActionTypeParticipantRoleGroup[]; error?: string }>(participantConfigResponse),
      ])

      if (!actionTypesResponse.ok) throw new Error(actionTypesPayload.error ?? 'Kunde inte läsa renoveringstyper.')
      if (!questionsResponse.ok) throw new Error(questionsPayload.error ?? 'Kunde inte läsa frågor.')
      if (!documentTypesResponse.ok) throw new Error(documentTypesPayload.error ?? 'Kunde inte läsa underlagstyper.')
      if (!participantRolesResponse.ok) throw new Error(participantRolesPayload.error ?? 'Kunde inte läsa medverkande.')
      if (!reviewFlagsResponse.ok) throw new Error(reviewFlagsPayload.error ?? 'Kunde inte läsa flaggor.')
      if (!requirementsResponse.ok) throw new Error(requirementsPayload.error ?? 'Kunde inte läsa dokumentkopplingar.')
      if (!questionConfigResponse.ok) throw new Error(questionConfigPayload.error ?? 'Kunde inte läsa frågekopplingar.')
      if (!participantConfigResponse.ok) throw new Error(participantConfigPayload.error ?? 'Kunde inte läsa medverkandekopplingar.')

      const nextActionTypes = [...(actionTypesPayload.items ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
      )

      setActionTypes(nextActionTypes)
      setQuestionItems([...(questionsPayload.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
      setDocumentTypes([...(documentTypesPayload.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
      setParticipantRoles([...(participantRolesPayload.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
      setReviewFlags([...(reviewFlagsPayload.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
      setRequirementGroups(requirementsPayload.actionTypes ?? [])
      setQuestionGroups(questionConfigPayload.actionTypes ?? [])
      setParticipantGroups(participantConfigPayload.actionTypes ?? [])

      setSelectedActionTypeId((current) => {
        const candidate = preferredActionTypeId ?? current
        if (candidate && nextActionTypes.some((item) => item.id === candidate)) return candidate
        return nextActionTypes[0]?.id ?? null
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa flödesvisaren.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    setExpandedNodeIds([])
  }, [selectedActionTypeId])

  const visibleActionTypes = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return actionTypes.filter((item) => {
      if (!normalized) return true
      return [item.label, item.key, item.description ?? ''].join(' ').toLowerCase().includes(normalized)
    })
  }, [actionTypes, query])

  const selectedAction = useMemo(
    () => actionTypes.find((item) => item.id === selectedActionTypeId) ?? null,
    [actionTypes, selectedActionTypeId]
  )

  const questionMap = useMemo(() => new Map(questionItems.map((item) => [item.id, item])), [questionItems])
  const documentTypeMap = useMemo(() => new Map(documentTypes.map((item) => [item.id, item])), [documentTypes])
  const participantRoleMap = useMemo(() => new Map(participantRoles.map((item) => [item.id, item])), [participantRoles])
  const reviewFlagMap = useMemo(() => new Map(reviewFlags.map((item) => [item.id, item])), [reviewFlags])

  const rootRequirements = useMemo(() => {
    const group = requirementGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.requirements ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.documentLabel.localeCompare(b.documentLabel, 'sv'))
  }, [requirementGroups, selectedActionTypeId])

  const rootQuestions = useMemo(() => {
    const group = questionGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.questions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.questionLabel.localeCompare(b.questionLabel, 'sv'))
  }, [questionGroups, selectedActionTypeId])

  const rootParticipants = useMemo(() => {
    const group = participantGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.participantRoles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.participantRoleLabel.localeCompare(b.participantRoleLabel, 'sv'))
  }, [participantGroups, selectedActionTypeId])

  const flowRootChildren = useMemo(() => {
    const buildQuestionNode = (questionId: string, ancestry: string[], rootLink?: ActionQuestionItem): FlowNode => {
      const question = questionMap.get(questionId)
      if (!question) {
        return { id: `missing:${questionId}`, kind: 'status', title: 'Frågan saknas', badges: ['Fel'], tone: 'rose', children: [], ref: { type: 'status' } }
      }
      if (ancestry.includes(questionId)) {
        return { id: `cycle:${questionId}:${ancestry.join('>')}`, kind: 'status', title: 'Cirkelskydd', badges: ['Stopp'], tone: 'amber', children: [], ref: { type: 'status' } }
      }

      return {
        id: `question:${ancestry.join('>') || 'root'}:${question.id}`,
        kind: 'question',
        title: question.label,
        badges: [ancestry.length === 0 ? 'Startfråga' : 'Följdfråga', labelForResponseType(question.responseType), ...(rootLink ? [rootLink.isRequired ? 'Obligatorisk' : 'Valfri'] : [])],
        tone: 'stone',
        ref: ancestry.length === 0 && rootLink ? ({ type: 'rootQuestion', actionTypeId: selectedActionTypeId ?? '', questionId: question.id } as const) : ({ type: 'question', questionId: question.id } as const),
        children: [...question.options]
          .filter((option) => option.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv'))
          .map((option) => {
            const activeTriggers = [...option.triggers].filter((trigger) => trigger.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
            return {
              id: `option:${question.id}:${option.id}`,
              kind: 'option' as const,
              title: option.label,
              badges: activeTriggers.length > 0 ? [`${activeTriggers.length} kopplingar`] : ['Ingen koppling'],
              tone: 'stone' as const,
              ref: { type: 'option', questionId: question.id, optionId: option.id },
              children: [
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'question' && trigger.questionId)
                  .map((trigger) => ({
                    ...buildQuestionNode(trigger.questionId as string, [...ancestry, questionId]),
                    ref: {
                      type: 'optionQuestionTrigger' as const,
                      questionId: question.id,
                      optionId: option.id,
                      targetQuestionId: trigger.questionId as string,
                    },
                  })),
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'document' && trigger.documentTypeId)
                  .map((trigger) => {
                    const doc = documentTypeMap.get(trigger.documentTypeId as string)
                    return {
                      id: `document:${option.id}:${trigger.documentTypeId}`,
                      kind: 'document' as const,
                      title: doc?.label ?? 'Underlag saknas',
                      badges: [doc ? labelForPhase(doc.defaultPhase) : 'Fel'],
                      tone: (doc ? 'sky' : 'rose') as FlowNodeTone,
                      children: [],
                      ref: {
                        type: 'optionDocumentTrigger' as const,
                        questionId: question.id,
                        optionId: option.id,
                        targetDocumentTypeId: trigger.documentTypeId as string,
                      },
                    }
                  }),
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'participant_role' && trigger.participantRoleId)
                  .map((trigger) => {
                    const role = participantRoleMap.get(trigger.participantRoleId as string)
                    return {
                      id: `participant:${option.id}:${trigger.participantRoleId}`,
                      kind: 'participant' as const,
                      title: role?.label ?? 'Medverkande saknas',
                      badges: [role?.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'],
                      tone: (role?.roleKind === 'consultant' ? 'amber' : role ? 'emerald' : 'rose') as FlowNodeTone,
                      children: [],
                      ref: {
                        type: 'optionParticipantTrigger' as const,
                        questionId: question.id,
                        optionId: option.id,
                        targetParticipantRoleId: trigger.participantRoleId as string,
                      },
                    }
                  }),
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'review_flag' && trigger.reviewFlagId)
                  .map((trigger) => {
                    const flag = reviewFlagMap.get(trigger.reviewFlagId as string)
                    return {
                      id: `flag:${option.id}:${trigger.reviewFlagId}`,
                      kind: 'flag' as const,
                      title: flag?.label ?? 'Flagga saknas',
                      badges: [flag ? labelForSeverity(flag.severity) : 'Fel'],
                      tone: (flag?.severity === 'high' ? 'rose' : flag?.severity === 'warning' ? 'amber' : flag ? 'violet' : 'rose') as FlowNodeTone,
                      children: [],
                      ref: {
                        type: 'optionReviewFlagTrigger' as const,
                        questionId: question.id,
                        optionId: option.id,
                        targetReviewFlagId: trigger.reviewFlagId as string,
                      },
                    }
                  }),
              ],
            }
          }),
      }
    }

    if (!selectedActionTypeId) return []

    return [
      ...rootQuestions.map((item) => buildQuestionNode(item.questionId, [], item)),
      ...rootRequirements.map((item) => {
        const doc = documentTypeMap.get(item.documentTypeId)
        return { id: `root-document:${item.documentTypeId}`, kind: 'document' as const, title: item.documentLabel, badges: [doc ? labelForPhase(doc.defaultPhase) : 'Okänd fas', item.isRequired ? 'Obligatoriskt' : 'Valfritt'], tone: 'sky' as const, children: [], ref: { type: 'rootRequirement' as const, actionTypeId: selectedActionTypeId, documentTypeId: item.documentTypeId } }
      }),
      ...rootParticipants.map((item) => {
        const role = participantRoleMap.get(item.participantRoleId)
        return { id: `root-participant:${item.participantRoleId}`, kind: 'participant' as const, title: item.participantRoleLabel, badges: [role?.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör', item.isRequired ? 'Obligatorisk' : 'Valfri'], tone: (role?.roleKind === 'consultant' ? 'amber' : 'emerald') as FlowNodeTone, children: [], ref: { type: 'rootParticipant' as const, actionTypeId: selectedActionTypeId, participantRoleId: item.participantRoleId } }
      }),
    ]
  }, [documentTypeMap, participantRoleMap, questionMap, reviewFlagMap, rootParticipants, rootQuestions, rootRequirements, selectedActionTypeId])

  const allExpandableNodeIds = useMemo(() => collectExpandableNodeIds(flowRootChildren), [flowRootChildren])

  const openNodeModal = (node: FlowNode, nextMode: ModalMode = 'summary') => {
    setActiveNode(node)
    setModalMode(nextMode)
    setModalError(null)
    setModalSaving(false)
    setAddType(null)
    setAddMode('existing')
    setExistingTargetId('')

    const question =
      node.ref.type === 'rootQuestion'
        ? questionMap.get(node.ref.questionId)
        : node.ref.type === 'question'
          ? questionMap.get(node.ref.questionId)
          : node.ref.type === 'optionQuestionTrigger'
            ? questionMap.get(node.ref.targetQuestionId)
            : null

    setQuestionDraft(
      question
        ? {
            id: question.id,
            key: question.key,
            label: question.label,
            helpText: question.helpText ?? '',
            responseType: question.responseType,
            sortOrder: String(question.sortOrder),
            isLocked: question.isLocked,
            isActive: question.isActive,
          }
        : EMPTY_QUESTION_DRAFT
    )

    const documentType =
      node.ref.type === 'rootRequirement'
        ? documentTypeMap.get(node.ref.documentTypeId)
        : node.ref.type === 'optionDocumentTrigger'
          ? documentTypeMap.get(node.ref.targetDocumentTypeId)
          : null

    setDocumentDraft(
      documentType
        ? {
            id: documentType.id,
            key: documentType.key,
            label: documentType.label,
            description: documentType.description ?? '',
            defaultPhase: documentType.defaultPhase,
            sortOrder: String(documentType.sortOrder),
            isActive: documentType.isActive,
          }
        : EMPTY_DOCUMENT_DRAFT
    )

    const participant =
      node.ref.type === 'rootParticipant'
        ? participantRoleMap.get(node.ref.participantRoleId)
        : node.ref.type === 'optionParticipantTrigger'
          ? participantRoleMap.get(node.ref.targetParticipantRoleId)
          : null

    setParticipantDraft(
      participant
        ? {
            id: participant.id,
            key: participant.key,
            label: participant.label,
            description: participant.description ?? '',
            roleKind: participant.roleKind,
            verificationInstructions: participant.verificationInstructions ?? '',
            verificationUrl: participant.verificationUrl ?? '',
            insuranceRequired: participant.insuranceRequired,
            requiresCompanyName: participant.requiresCompanyName,
            requiresOrgNumber: participant.requiresOrgNumber,
            requiresContactName: participant.requiresContactName,
            requiresEmail: participant.requiresEmail,
            requiresPhone: participant.requiresPhone,
            requiresCertification: participant.requiresCertification,
            sortOrder: String(participant.sortOrder),
            isActive: participant.isActive,
          }
        : EMPTY_PARTICIPANT_DRAFT
    )

    const reviewFlag = node.ref.type === 'optionReviewFlagTrigger' ? reviewFlagMap.get(node.ref.targetReviewFlagId) : null
    setReviewFlagDraft(
      reviewFlag
        ? {
            id: reviewFlag.id,
            key: reviewFlag.key,
            label: reviewFlag.label,
            description: reviewFlag.description ?? '',
            severity: reviewFlag.severity,
            category: reviewFlag.category ?? '',
            sortOrder: String(reviewFlag.sortOrder),
            isActive: reviewFlag.isActive,
          }
        : EMPTY_REVIEW_FLAG_DRAFT
    )

    setActionTypeDraft(
      node.ref.type === 'actionType' && selectedAction
        ? {
            id: selectedAction.id,
            key: selectedAction.key,
            label: selectedAction.label,
            description: selectedAction.description ?? '',
            sortOrder: String(selectedAction.sortOrder),
            isActive: selectedAction.isActive,
          }
        : EMPTY_ACTION_TYPE_DRAFT
    )
  }

  const closeModal = () => {
    setActiveNode(null)
    setModalMode('summary')
    setModalError(null)
    setModalSaving(false)
    setAddType(null)
    setExistingTargetId('')
  }

  const toggleNode = (id: string) => setExpandedNodeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const canEditNode = Boolean(
    activeNode &&
      (activeNode.ref.type === 'actionType' ||
        activeNode.ref.type === 'rootQuestion' ||
        activeNode.ref.type === 'question' ||
        activeNode.ref.type === 'optionQuestionTrigger' ||
        activeNode.ref.type === 'rootRequirement' ||
        activeNode.ref.type === 'optionDocumentTrigger' ||
        activeNode.ref.type === 'rootParticipant' ||
        activeNode.ref.type === 'optionParticipantTrigger' ||
        activeNode.ref.type === 'optionReviewFlagTrigger')
  )

  const addableTypes = useMemo<AddType[]>(() => {
    if (!activeNode) return []
    if (activeNode.ref.type === 'actionType') return ['question', 'document', 'participant']
    if (activeNode.ref.type === 'option') return ['question', 'document', 'participant', 'flag']
    return []
  }, [activeNode])

  const canRemoveConnection = Boolean(
    activeNode &&
      (activeNode.ref.type === 'rootQuestion' ||
        activeNode.ref.type === 'rootRequirement' ||
        activeNode.ref.type === 'rootParticipant' ||
        activeNode.ref.type === 'optionQuestionTrigger' ||
        activeNode.ref.type === 'optionDocumentTrigger' ||
        activeNode.ref.type === 'optionParticipantTrigger' ||
        activeNode.ref.type === 'optionReviewFlagTrigger')
  )

  const existingAddOptions = useMemo(() => {
    if (!addType) return []
    if (addType === 'question') return questionItems.map((item) => ({ id: item.id, label: item.label }))
    if (addType === 'document') return documentTypes.map((item) => ({ id: item.id, label: item.label }))
    if (addType === 'participant') return participantRoles.map((item) => ({ id: item.id, label: item.label }))
    return reviewFlags.map((item) => ({ id: item.id, label: item.label }))
  }, [addType, documentTypes, participantRoles, questionItems, reviewFlags])

  const persistQuestionWithOptions = async (question: QuestionItem) => {
    const response = await fetch('/api/renoapp/admin/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(questionToRequestPayload(question)),
    })
    const payload = await readJson<{ error?: string }>(response)
    if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara frågan.')
  }

  const updateOptionTriggers = async (
    questionId: string,
    optionId: string,
    updater: (triggers: QuestionOptionTriggerItem[]) => QuestionOptionTriggerItem[]
  ) => {
    const question = questionMap.get(questionId)
    if (!question) throw new Error('Frågan kunde inte hittas.')
    const nextQuestion: QuestionItem = {
      ...question,
      options: question.options.map((option) => (option.id === optionId ? { ...option, triggers: updater(option.triggers) } : option)),
    }
    await persistQuestionWithOptions(nextQuestion)
  }

  const saveEdit = async () => {
    if (!activeNode) return
    setModalSaving(true)
    setModalError(null)

    try {
      if (activeNode.ref.type === 'actionType') {
        const response = await fetch('/api/renoapp/admin/action-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: actionTypeDraft.id,
            key: actionTypeDraft.key || slugifyKey(actionTypeDraft.label),
            label: actionTypeDraft.label,
            description: actionTypeDraft.description || null,
            sortOrder: Number(actionTypeDraft.sortOrder || 100),
            isActive: actionTypeDraft.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara renoveringstypen.')
      } else if (activeNode.ref.type === 'rootQuestion' || activeNode.ref.type === 'question' || activeNode.ref.type === 'optionQuestionTrigger') {
        const questionId =
          activeNode.ref.type === 'rootQuestion'
            ? activeNode.ref.questionId
            : activeNode.ref.type === 'question'
              ? activeNode.ref.questionId
              : activeNode.ref.targetQuestionId
        const currentQuestion = questionMap.get(questionId)
        if (!currentQuestion) throw new Error('Frågan kunde inte hittas.')
        await persistQuestionWithOptions({
          ...currentQuestion,
          key: questionDraft.key || slugifyKey(questionDraft.label),
          label: questionDraft.label,
          helpText: questionDraft.helpText || null,
          responseType: questionDraft.responseType,
          sortOrder: Number(questionDraft.sortOrder || 100),
          isLocked: questionDraft.isLocked,
          isActive: questionDraft.isActive,
        })
      } else if (activeNode.ref.type === 'rootRequirement' || activeNode.ref.type === 'optionDocumentTrigger') {
        const response = await fetch('/api/renoapp/admin/document-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: documentDraft.id,
            key: documentDraft.key || slugifyKey(documentDraft.label),
            label: documentDraft.label,
            description: documentDraft.description || null,
            defaultPhase: documentDraft.defaultPhase,
            sortOrder: Number(documentDraft.sortOrder || 100),
            isActive: documentDraft.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara underlaget.')
      } else if (activeNode.ref.type === 'rootParticipant' || activeNode.ref.type === 'optionParticipantTrigger') {
        const response = await fetch('/api/renoapp/admin/participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: participantDraft.id,
            key: participantDraft.key || slugifyKey(participantDraft.label),
            label: participantDraft.label,
            description: participantDraft.description || null,
            roleKind: participantDraft.roleKind,
            verificationInstructions: participantDraft.verificationInstructions || null,
            verificationUrl: participantDraft.verificationUrl || null,
            insuranceRequired: participantDraft.insuranceRequired,
            requiresCompanyName: participantDraft.requiresCompanyName,
            requiresOrgNumber: participantDraft.requiresOrgNumber,
            requiresContactName: participantDraft.requiresContactName,
            requiresEmail: participantDraft.requiresEmail,
            requiresPhone: participantDraft.requiresPhone,
            requiresCertification: participantDraft.requiresCertification,
            sortOrder: Number(participantDraft.sortOrder || 100),
            isActive: participantDraft.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara medverkandetypen.')
      } else if (activeNode.ref.type === 'optionReviewFlagTrigger') {
        const response = await fetch('/api/renoapp/admin/review-flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: reviewFlagDraft.id,
            key: reviewFlagDraft.key || slugifyKey(reviewFlagDraft.label),
            label: reviewFlagDraft.label,
            description: reviewFlagDraft.description || null,
            severity: reviewFlagDraft.severity,
            category: reviewFlagDraft.category || null,
            sortOrder: Number(reviewFlagDraft.sortOrder || 100),
            isActive: reviewFlagDraft.isActive,
          }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara flaggan.')
      }

      await loadData(selectedActionTypeId)
      closeModal()
    } catch (saveError) {
      setModalError(saveError instanceof Error ? saveError.message : 'Kunde inte spara.')
    } finally {
      setModalSaving(false)
    }
  }

  const removeConnection = async () => {
    if (!activeNode) return
    setModalSaving(true)
    setModalError(null)
    const ref = activeNode.ref

    try {
      if (ref.type === 'rootQuestion') {
        const link = rootQuestions.find((item) => item.questionId === ref.questionId)
        const response = await fetch('/api/renoapp/admin/action-type-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionTypeId: ref.actionTypeId, questionId: ref.questionId, isEnabled: false, isRequired: link?.isRequired ?? true, sortOrder: link?.sortOrder ?? 100 }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort frågekopplingen.')
      } else if (ref.type === 'rootRequirement') {
        const link = rootRequirements.find((item) => item.documentTypeId === ref.documentTypeId)
        const response = await fetch('/api/renoapp/admin/requirements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionTypeId: ref.actionTypeId, documentTypeId: ref.documentTypeId, isEnabled: false, isRequired: link?.isRequired ?? true, note: null, sortOrder: link?.sortOrder ?? 100 }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort dokumentkopplingen.')
      } else if (ref.type === 'rootParticipant') {
        const link = rootParticipants.find((item) => item.participantRoleId === ref.participantRoleId)
        const response = await fetch('/api/renoapp/admin/action-type-participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionTypeId: ref.actionTypeId, participantRoleId: ref.participantRoleId, isEnabled: false, isRequired: link?.isRequired ?? true, sortOrder: link?.sortOrder ?? 100 }),
        })
        const payload = await readJson<{ error?: string }>(response)
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort medverkandekopplingen.')
      } else if (ref.type === 'optionQuestionTrigger') {
        await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => triggers.filter((trigger) => !(trigger.triggerType === 'question' && trigger.questionId === ref.targetQuestionId)))
      } else if (ref.type === 'optionDocumentTrigger') {
        await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => triggers.filter((trigger) => !(trigger.triggerType === 'document' && trigger.documentTypeId === ref.targetDocumentTypeId)))
      } else if (ref.type === 'optionParticipantTrigger') {
        await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => triggers.filter((trigger) => !(trigger.triggerType === 'participant_role' && trigger.participantRoleId === ref.targetParticipantRoleId)))
      } else if (ref.type === 'optionReviewFlagTrigger') {
        await updateOptionTriggers(ref.questionId, ref.optionId, (triggers) => triggers.filter((trigger) => !(trigger.triggerType === 'review_flag' && trigger.reviewFlagId === ref.targetReviewFlagId)))
      }

      await loadData(selectedActionTypeId)
      closeModal()
    } catch (removeError) {
      setModalError(removeError instanceof Error ? removeError.message : 'Kunde inte ta bort kopplingen.')
    } finally {
      setModalSaving(false)
    }
  }

  const saveAdd = async () => {
    if (!activeNode || !addType) return
    setModalSaving(true)
    setModalError(null)

    try {
      let targetId = existingTargetId

      if (addMode === 'new') {
        if (addType === 'question') {
          const response = await fetch('/api/renoapp/admin/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: {
                id: null,
                key: questionDraft.key || slugifyKey(questionDraft.label),
                label: questionDraft.label,
                helpText: questionDraft.helpText || null,
                responseType: questionDraft.responseType,
                sortOrder: Number(questionDraft.sortOrder || 100),
                isLocked: questionDraft.isLocked,
                isActive: questionDraft.isActive,
                metadata: {},
              },
              options: [
                { id: null, key: 'alternativ-1', label: 'Alternativ 1', description: null, sortOrder: 10, isActive: true, metadata: {}, triggers: [] },
              ],
            }),
          })
          const payload = await readJson<{ item?: QuestionItem; error?: string }>(response)
          if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte skapa frågan.')
          targetId = payload.item.id
        } else if (addType === 'document') {
          const response = await fetch('/api/renoapp/admin/document-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: null, key: documentDraft.key || slugifyKey(documentDraft.label), label: documentDraft.label, description: documentDraft.description || null, defaultPhase: documentDraft.defaultPhase, sortOrder: Number(documentDraft.sortOrder || 100), isActive: documentDraft.isActive }),
          })
          const payload = await readJson<{ item?: DocumentTypeItem; error?: string }>(response)
          if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte skapa underlaget.')
          targetId = payload.item.id
        } else if (addType === 'participant') {
          const response = await fetch('/api/renoapp/admin/participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: null,
              key: participantDraft.key || slugifyKey(participantDraft.label),
              label: participantDraft.label,
              description: participantDraft.description || null,
              roleKind: participantDraft.roleKind,
              verificationInstructions: participantDraft.verificationInstructions || null,
              verificationUrl: participantDraft.verificationUrl || null,
              insuranceRequired: participantDraft.insuranceRequired,
              requiresCompanyName: participantDraft.requiresCompanyName,
              requiresOrgNumber: participantDraft.requiresOrgNumber,
              requiresContactName: participantDraft.requiresContactName,
              requiresEmail: participantDraft.requiresEmail,
              requiresPhone: participantDraft.requiresPhone,
              requiresCertification: participantDraft.requiresCertification,
              sortOrder: Number(participantDraft.sortOrder || 100),
              isActive: participantDraft.isActive,
            }),
          })
          const payload = await readJson<{ item?: ParticipantRoleItem; error?: string }>(response)
          if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte skapa medverkandetypen.')
          targetId = payload.item.id
        } else if (addType === 'flag') {
          const response = await fetch('/api/renoapp/admin/review-flags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: null, key: reviewFlagDraft.key || slugifyKey(reviewFlagDraft.label), label: reviewFlagDraft.label, description: reviewFlagDraft.description || null, severity: reviewFlagDraft.severity, category: reviewFlagDraft.category || null, sortOrder: Number(reviewFlagDraft.sortOrder || 100), isActive: reviewFlagDraft.isActive }),
          })
          const payload = await readJson<{ item?: ReviewFlagItem; error?: string }>(response)
          if (!response.ok || !payload.item) throw new Error(payload.error ?? 'Kunde inte skapa flaggan.')
          targetId = payload.item.id
        }
      }

      if (!targetId) throw new Error('Välj först vad som ska läggas till.')

      if (activeNode.ref.type === 'actionType') {
        if (addType === 'question') {
          const response = await fetch('/api/renoapp/admin/action-type-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionTypeId: activeNode.ref.actionTypeId, questionId: targetId, isEnabled: true, isRequired: true, sortOrder: (rootQuestions.at(-1)?.sortOrder ?? 0) + 10 }),
          })
          const payload = await readJson<{ error?: string }>(response)
          if (!response.ok) throw new Error(payload.error ?? 'Kunde inte koppla frågan.')
        } else if (addType === 'document') {
          const response = await fetch('/api/renoapp/admin/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionTypeId: activeNode.ref.actionTypeId, documentTypeId: targetId, isEnabled: true, isRequired: true, note: null, sortOrder: (rootRequirements.at(-1)?.sortOrder ?? 0) + 10 }),
          })
          const payload = await readJson<{ error?: string }>(response)
          if (!response.ok) throw new Error(payload.error ?? 'Kunde inte koppla underlaget.')
        } else if (addType === 'participant') {
          const response = await fetch('/api/renoapp/admin/action-type-participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionTypeId: activeNode.ref.actionTypeId, participantRoleId: targetId, isEnabled: true, isRequired: true, sortOrder: (rootParticipants.at(-1)?.sortOrder ?? 0) + 10 }),
          })
          const payload = await readJson<{ error?: string }>(response)
          if (!response.ok) throw new Error(payload.error ?? 'Kunde inte koppla medverkandetypen.')
        }
      } else if (activeNode.ref.type === 'option') {
        await updateOptionTriggers(activeNode.ref.questionId, activeNode.ref.optionId, (triggers) => {
          const exists = triggers.some((trigger) => {
            if (addType === 'question') return trigger.triggerType === 'question' && trigger.questionId === targetId
            if (addType === 'document') return trigger.triggerType === 'document' && trigger.documentTypeId === targetId
            if (addType === 'participant') return trigger.triggerType === 'participant_role' && trigger.participantRoleId === targetId
            return trigger.triggerType === 'review_flag' && trigger.reviewFlagId === targetId
          })
          if (exists) return triggers

          return [
            ...triggers,
            {
              id: `new-${Date.now()}`,
              triggerType: addType === 'question' ? 'question' : addType === 'document' ? 'document' : addType === 'participant' ? 'participant_role' : 'review_flag',
              questionId: addType === 'question' ? targetId : null,
              documentTypeId: addType === 'document' ? targetId : null,
              participantRoleId: addType === 'participant' ? targetId : null,
              reviewFlagId: addType === 'flag' ? targetId : null,
              sortOrder: Math.max(0, ...triggers.map((item) => item.sortOrder)) + 10,
              isActive: true,
            },
          ]
        })
      }

      await loadData(selectedActionTypeId)
      closeModal()
    } catch (addError) {
      setModalError(addError instanceof Error ? addError.message : 'Kunde inte lägga till kopplingen.')
    } finally {
      setModalSaving(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 pb-8 pt-4 md:px-6">
      {error ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 lg:hidden">
        Flödesvisaren är byggd för större skärmar.
      </div>

      <div className="hidden space-y-4 lg:block">
        <div className="overflow-x-auto border-b border-stone-200 pb-3">
          <div className="flex min-w-max items-center gap-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök renoveringstyp..." className="mr-3 w-64 rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900" />
            {visibleActionTypes.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedActionTypeId(item.id)} className={cn('rounded-md border px-3 py-2 text-sm font-semibold transition', item.id === selectedActionTypeId ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {!selectedAction ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center text-sm text-stone-600">Välj en renoveringstyp ovan.</div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-stone-200 pb-3 text-sm">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Namn</div>
                  <div className="mt-1 font-semibold text-stone-900">{selectedAction.label}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Nyckel</div>
                  <div className="mt-1 text-stone-700">{selectedAction.key}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setExpandedNodeIds(allExpandableNodeIds)} className="rounded-md border border-stone-300 bg-white px-3 py-2 font-semibold text-stone-800 hover:bg-stone-100">Expandera alla</button>
                <button type="button" onClick={() => setExpandedNodeIds([])} className="rounded-md border border-stone-300 bg-white px-3 py-2 font-semibold text-stone-800 hover:bg-stone-100">Återställ vy</button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-stone-200 bg-slate-100 px-6 py-6">
              <div className="min-w-max">
                <div className="flex items-start gap-6">
                  <FlowNodeCard
                    node={{ id: `action-type:${selectedAction.id}`, kind: 'root', title: selectedAction.label, badges: [`${rootQuestions.length} frågor`, `${rootRequirements.length} underlag`, `${rootParticipants.length} medverkande`], tone: 'stone', children: flowRootChildren, ref: { type: 'actionType' as const, actionTypeId: selectedAction.id } }}
                    expanded
                    onToggle={() => setExpandedNodeIds((current) => (current.length === 0 ? allExpandableNodeIds : []))}
                    onOpen={() => openNodeModal({ id: `action-type:${selectedAction.id}`, kind: 'root', title: selectedAction.label, badges: [`${rootQuestions.length} frågor`, `${rootRequirements.length} underlag`, `${rootParticipants.length} medverkande`], tone: 'stone', children: flowRootChildren, ref: { type: 'actionType' as const, actionTypeId: selectedAction.id } })}
                  />

                  <div className="mt-8 h-px w-8 bg-stone-300" />

                  <div className="space-y-5">
                    {loading ? (
                      <div className="rounded-md border border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">Laddar flöde...</div>
                    ) : flowRootChildren.length > 0 ? (
                      flowRootChildren.map((node) => <HorizontalBranch key={node.id} node={node} expandedNodeIds={expandedNodeIds} onToggle={toggleNode} onOpen={openNodeModal} />)
                    ) : (
                      <div className="rounded-md border border-dashed border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">Inga frågor, underlag eller medverkande är kopplade ännu.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {activeNode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 p-6">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-stone-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-stone-200 px-6 py-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Nod</div>
                <h2 className="mt-1 text-2xl font-semibold text-stone-900">{activeNode.title}</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">{activeNode.badges.map((badge) => <span key={badge} className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-semibold text-stone-700">{badge}</span>)}</div>
              </div>
              <button type="button" onClick={closeModal} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">Stäng</button>
            </div>

            <div className="space-y-6 px-6 py-5">
              {modalError ? <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{modalError}</div> : null}

              <div className="flex flex-wrap gap-2">
                {canEditNode ? <button type="button" onClick={() => setModalMode('edit')} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', modalMode === 'edit' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Redigera</button> : null}
                {addableTypes.length > 0 ? <button type="button" onClick={() => setModalMode('add')} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', modalMode === 'add' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Lägg till</button> : null}
                <button type="button" onClick={() => setModalMode('summary')} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', modalMode === 'summary' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Översikt</button>
                {canRemoveConnection ? <button type="button" onClick={() => { if (window.confirm('Ta bort denna koppling från flödet?')) void removeConnection() }} className="rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Ta bort koppling</button> : null}
              </div>

              {modalMode === 'summary' ? <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700"><p>Klicka på <span className="font-semibold">Redigera</span> för att ändra noden eller på <span className="font-semibold">Lägg till</span> för att skapa nästa steg.</p><p className="text-xs text-stone-500">Nya frågor skapas med en standardoption och kan sedan byggas ut vidare i <Link href="/admin/renoapp/questions" className="font-semibold underline">Frågor</Link>.</p></div> : null}

              {modalMode === 'edit' && canEditNode ? (
                <div className="space-y-4">
                  {activeNode?.ref.type === 'actionType' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input value={actionTypeDraft.label} onChange={(event) => setActionTypeDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Intern nyckel">
                        <input value={actionTypeDraft.key} onChange={(event) => setActionTypeDraft((current) => ({ ...current, key: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                    </div>
                  ) : null}
                  {(activeNode?.ref.type === 'rootQuestion' || activeNode?.ref.type === 'question' || activeNode?.ref.type === 'optionQuestionTrigger') ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input value={questionDraft.label} onChange={(event) => setQuestionDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Intern nyckel">
                        <input value={questionDraft.key} onChange={(event) => setQuestionDraft((current) => ({ ...current, key: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                    </div>
                  ) : null}
                  {(activeNode?.ref.type === 'rootRequirement' || activeNode?.ref.type === 'optionDocumentTrigger') ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input value={documentDraft.label} onChange={(event) => setDocumentDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Fas">
                        <select value={documentDraft.defaultPhase} onChange={(event) => setDocumentDraft((current) => ({ ...current, defaultPhase: event.target.value as DocumentDraft['defaultPhase'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="before_required">Före</option><option value="during_execution">Under</option><option value="after_completion">Efter</option></select>
                      </ModalField>
                    </div>
                  ) : null}
                  {(activeNode?.ref.type === 'rootParticipant' || activeNode?.ref.type === 'optionParticipantTrigger') ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input value={participantDraft.label} onChange={(event) => setParticipantDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Typ">
                        <select value={participantDraft.roleKind} onChange={(event) => setParticipantDraft((current) => ({ ...current, roleKind: event.target.value as ParticipantDraft['roleKind'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="contractor">Entreprenör</option><option value="consultant">Konsult</option></select>
                      </ModalField>
                    </div>
                  ) : null}
                  {activeNode?.ref.type === 'optionReviewFlagTrigger' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ModalField label="Visningsnamn">
                        <input value={reviewFlagDraft.label} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
                      </ModalField>
                      <ModalField label="Allvar">
                        <select value={reviewFlagDraft.severity} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, severity: event.target.value as ReviewFlagDraft['severity'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="info">Info</option><option value="warning">Varning</option><option value="high">Hög risk</option></select>
                      </ModalField>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setModalMode('summary')} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">Avbryt</button>
                    <button type="button" onClick={() => void saveEdit()} disabled={modalSaving} className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{modalSaving ? 'Sparar...' : 'Spara'}</button>
                  </div>
                </div>
              ) : null}

              {modalMode === 'add' && addableTypes.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {addableTypes.map((type) => (
                      <button key={type} type="button" onClick={() => { setAddType(type); setExistingTargetId('') }} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', addType === type ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>
                        {type === 'question' ? 'Fråga' : type === 'document' ? 'Dokument' : type === 'participant' ? 'Medverkande' : 'Flagga'}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setAddMode('existing'); setExistingTargetId('') }} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', addMode === 'existing' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Lägg till befintlig</button>
                    <button type="button" onClick={() => setAddMode('new')} className={cn('rounded-md border px-3 py-2 text-sm font-semibold', addMode === 'new' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100')}>Skapa ny</button>
                  </div>
                  {addMode === 'existing' ? (
                    <ModalField label="Välj objekt">
                      <select value={existingTargetId} onChange={(event) => setExistingTargetId(event.target.value)} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="">Välj...</option>{existingAddOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                    </ModalField>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {addType === 'question' ? <>
                        <ModalField label="Visningsnamn"><input value={questionDraft.label} onChange={(event) => setQuestionDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Intern nyckel"><input value={questionDraft.key} onChange={(event) => setQuestionDraft((current) => ({ ...current, key: event.target.value }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                      </> : null}
                      {addType === 'document' ? <>
                        <ModalField label="Visningsnamn"><input value={documentDraft.label} onChange={(event) => setDocumentDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Fas"><select value={documentDraft.defaultPhase} onChange={(event) => setDocumentDraft((current) => ({ ...current, defaultPhase: event.target.value as DocumentDraft['defaultPhase'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="before_required">Före</option><option value="during_execution">Under</option><option value="after_completion">Efter</option></select></ModalField>
                      </> : null}
                      {addType === 'participant' ? <>
                        <ModalField label="Visningsnamn"><input value={participantDraft.label} onChange={(event) => setParticipantDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Typ"><select value={participantDraft.roleKind} onChange={(event) => setParticipantDraft((current) => ({ ...current, roleKind: event.target.value as ParticipantDraft['roleKind'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="contractor">Entreprenör</option><option value="consultant">Konsult</option></select></ModalField>
                      </> : null}
                      {addType === 'flag' ? <>
                        <ModalField label="Visningsnamn"><input value={reviewFlagDraft.label} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, label: event.target.value, key: current.key || slugifyKey(event.target.value) }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" /></ModalField>
                        <ModalField label="Allvar"><select value={reviewFlagDraft.severity} onChange={(event) => setReviewFlagDraft((current) => ({ ...current, severity: event.target.value as ReviewFlagDraft['severity'] }))} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="info">Info</option><option value="warning">Varning</option><option value="high">Hög risk</option></select></ModalField>
                      </> : null}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setModalMode('summary')} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">Avbryt</button>
                    <button type="button" onClick={() => void saveAdd()} disabled={modalSaving} className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{modalSaving ? 'Sparar...' : 'Spara'}</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
