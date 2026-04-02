'use client'

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
  label: string
  sortOrder: number
  triggers: QuestionOptionTriggerItem[]
}

type QuestionItem = {
  id: string
  label: string
  responseType: 'single_select' | 'multi_select' | 'boolean'
  sortOrder: number
  options: QuestionOptionItem[]
}

type DocumentTypeItem = {
  id: string
  label: string
  defaultPhase: 'before_required' | 'during_execution' | 'after_completion'
  sortOrder: number
}

type ParticipantRoleItem = {
  id: string
  label: string
  roleKind: 'contractor' | 'consultant'
  sortOrder: number
}

type ReviewFlagItem = {
  id: string
  label: string
  severity: 'info' | 'warning' | 'high'
  sortOrder: number
}

type FlowNodeTone = 'stone' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

type FlowNode = {
  id: string
  kind: 'question' | 'option' | 'document' | 'participant' | 'flag' | 'status'
  title: string
  badges: string[]
  tone: FlowNodeTone
  children: FlowNode[]
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>
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

function FlowNodeCard({
  node,
  expanded,
  onToggle,
}: {
  node: FlowNode
  expanded: boolean
  onToggle: () => void
}) {
  const expandable = node.children.length > 0
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">{node.kind}</div>
      <div className="mt-1 text-sm font-semibold leading-5">{node.title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {node.badges.map((badge) => (
          <span
            key={badge}
            className="rounded-full border border-current/15 bg-white/80 px-2 py-0.5 text-[10px] font-semibold"
          >
            {badge}
          </span>
        ))}
      </div>
      {expandable ? (
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          {expanded ? 'Dölj' : 'Visa'}
        </div>
      ) : null}
    </>
  )

  if (!expandable) {
    return <div className={cn('w-[170px] rounded-md border px-3 py-2 shadow-sm', toneClasses(node.tone))}>{body}</div>
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-[170px] rounded-md border px-3 py-2 text-left shadow-sm transition hover:shadow-md',
        toneClasses(node.tone)
      )}
      aria-expanded={expanded}
    >
      {body}
    </button>
  )
}

function HorizontalBranch({
  node,
  expandedNodeIds,
  onToggle,
}: {
  node: FlowNode
  expandedNodeIds: string[]
  onToggle: (id: string) => void
}) {
  const expanded = expandedNodeIds.includes(node.id)

  return (
    <div className="flex items-start gap-5">
      <FlowNodeCard node={node} expanded={expanded} onToggle={() => onToggle(node.id)} />
      {node.children.length > 0 && expanded ? (
        <div className="mt-6 flex min-w-0 items-start">
          <div className="mr-4 mt-6 h-px w-6 bg-stone-300" />
          <div className="relative space-y-5 border-l border-stone-300 pl-5">
            {node.children.map((child) => (
              <div key={child.id} className="relative">
                <div className="absolute left-[-20px] top-6 h-px w-5 bg-stone-300" />
                <HorizontalBranch node={child} expandedNodeIds={expandedNodeIds} onToggle={onToggle} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
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

  useEffect(() => {
    const loadData = async () => {
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
          readJson(actionTypesResponse),
          readJson(questionsResponse),
          readJson(documentTypesResponse),
          readJson(participantRolesResponse),
          readJson(reviewFlagsResponse),
          readJson(requirementsResponse),
          readJson(questionConfigResponse),
          readJson(participantConfigResponse),
        ])

        if (!actionTypesResponse.ok) throw new Error((actionTypesPayload.error as string) ?? 'Kunde inte läsa renoveringstyper.')
        if (!questionsResponse.ok) throw new Error((questionsPayload.error as string) ?? 'Kunde inte läsa frågor.')
        if (!documentTypesResponse.ok) throw new Error((documentTypesPayload.error as string) ?? 'Kunde inte läsa underlagstyper.')
        if (!participantRolesResponse.ok) throw new Error((participantRolesPayload.error as string) ?? 'Kunde inte läsa medverkande.')
        if (!reviewFlagsResponse.ok) throw new Error((reviewFlagsPayload.error as string) ?? 'Kunde inte läsa flaggor.')
        if (!requirementsResponse.ok) throw new Error((requirementsPayload.error as string) ?? 'Kunde inte läsa underlagskopplingar.')
        if (!questionConfigResponse.ok) throw new Error((questionConfigPayload.error as string) ?? 'Kunde inte läsa frågekopplingar.')
        if (!participantConfigResponse.ok) throw new Error((participantConfigPayload.error as string) ?? 'Kunde inte läsa medverkandekopplingar.')

        const nextActionTypes = [...((actionTypesPayload.items as ActionTypeItem[] | undefined) ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )

        setActionTypes(nextActionTypes)
        setQuestionItems(((questionsPayload.items as QuestionItem[] | undefined) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
        setDocumentTypes(((documentTypesPayload.items as DocumentTypeItem[] | undefined) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
        setParticipantRoles(((participantRolesPayload.items as ParticipantRoleItem[] | undefined) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
        setReviewFlags(((reviewFlagsPayload.items as ReviewFlagItem[] | undefined) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv')))
        setRequirementGroups((requirementsPayload.actionTypes as ActionTypeGroup[] | undefined) ?? [])
        setQuestionGroups((questionConfigPayload.actionTypes as ActionTypeQuestionGroup[] | undefined) ?? [])
        setParticipantGroups((participantConfigPayload.actionTypes as ActionTypeParticipantRoleGroup[] | undefined) ?? [])
        setSelectedActionTypeId((current) => current && nextActionTypes.some((item) => item.id === current) ? current : nextActionTypes[0]?.id ?? null)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa flödesvisaren.')
      } finally {
        setLoading(false)
      }
    }

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
        return { id: `missing:${questionId}`, kind: 'status', title: 'Frågan saknas', badges: ['Fel'], tone: 'rose', children: [] }
      }
      if (ancestry.includes(questionId)) {
        return { id: `cycle:${questionId}:${ancestry.join('>')}`, kind: 'status', title: 'Cirkelskydd', badges: ['Stopp'], tone: 'amber', children: [] }
      }

      return {
        id: `question:${ancestry.join('>') || 'root'}:${question.id}`,
        kind: 'question',
        title: question.label,
        badges: [
          ancestry.length === 0 ? 'Startfråga' : 'Följdfråga',
          labelForResponseType(question.responseType),
          ...(rootLink ? [rootLink.isRequired ? 'Obligatorisk' : 'Valfri'] : []),
        ],
        tone: 'stone',
        children: [...question.options]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'sv'))
          .map((option) => {
            const activeTriggers = [...option.triggers].filter((trigger) => trigger.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
            return {
              id: `option:${question.id}:${option.id}`,
              kind: 'option' as const,
              title: option.label,
              badges: activeTriggers.length > 0 ? [`${activeTriggers.length} kopplingar`] : ['Ingen koppling'],
              tone: 'stone' as const,
              children: [
                ...activeTriggers
                  .filter((trigger) => trigger.triggerType === 'question' && trigger.questionId)
                  .map((trigger) => buildQuestionNode(trigger.questionId as string, [...ancestry, questionId])),
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
                    }
                  }),
              ],
            }
          }),
      }
    }

    return [
      ...rootQuestions.map((item) => buildQuestionNode(item.questionId, [], item)),
      ...rootRequirements.map((item) => {
        const doc = documentTypeMap.get(item.documentTypeId)
        return {
          id: `root-document:${item.documentTypeId}`,
          kind: 'document' as const,
          title: item.documentLabel,
          badges: [doc ? labelForPhase(doc.defaultPhase) : 'Okänd fas', item.isRequired ? 'Obligatoriskt' : 'Valfritt'],
          tone: 'sky' as const,
          children: [],
        }
      }),
      ...rootParticipants.map((item) => {
        const role = participantRoleMap.get(item.participantRoleId)
        return {
          id: `root-participant:${item.participantRoleId}`,
          kind: 'participant' as const,
          title: item.participantRoleLabel,
          badges: [role?.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör', item.isRequired ? 'Obligatorisk' : 'Valfri'],
          tone: (role?.roleKind === 'consultant' ? 'amber' : 'emerald') as FlowNodeTone,
          children: [],
        }
      }),
    ]
  }, [documentTypeMap, participantRoleMap, questionMap, reviewFlagMap, rootParticipants, rootQuestions, rootRequirements])

  const allExpandableNodeIds = useMemo(() => collectExpandableNodeIds(flowRootChildren), [flowRootChildren])
  const toggleNode = (id: string) => setExpandedNodeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 pb-8 pt-4 md:px-6">
      {error ? (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 lg:hidden">
        Flödesvisaren är byggd för större skärmar.
      </div>

      <div className="hidden space-y-4 lg:block">
        <div className="overflow-x-auto border-b border-stone-200 pb-3">
          <div className="flex min-w-max items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Sök renoveringstyp..."
              className="mr-3 w-64 rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900"
            />
            {visibleActionTypes.map((item) => {
              const active = item.id === selectedActionTypeId
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedActionTypeId(item.id)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-sm font-semibold transition',
                    active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-100'
                  )}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>

        {!selectedAction ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center text-sm text-stone-600">
            Välj en renoveringstyp ovan.
          </div>
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
                <button type="button" onClick={() => setExpandedNodeIds(allExpandableNodeIds)} className="rounded-md border border-stone-300 bg-white px-3 py-2 font-semibold text-stone-800 hover:bg-stone-100">
                  Expandera alla
                </button>
                <button type="button" onClick={() => setExpandedNodeIds([])} className="rounded-md border border-stone-300 bg-white px-3 py-2 font-semibold text-stone-800 hover:bg-stone-100">
                  Återställ vy
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-stone-200 bg-slate-100 px-6 py-6">
              <div className="min-w-max">
                <div className="flex items-start gap-6">
                  <div className="w-[180px] rounded-md border border-stone-900 bg-white px-3 py-3 shadow-sm">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Rot</div>
                    <div className="mt-1 text-base font-semibold text-stone-900">{selectedAction.label}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700">{rootQuestions.length} frågor</span>
                      <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700">{rootRequirements.length} underlag</span>
                    </div>
                  </div>

                  <div className="mt-8 h-px w-8 bg-stone-300" />

                  <div className="space-y-5">
                    {loading ? (
                      <div className="rounded-md border border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">Laddar flöde...</div>
                    ) : flowRootChildren.length > 0 ? (
                      flowRootChildren.map((node) => (
                        <HorizontalBranch key={node.id} node={node} expandedNodeIds={expandedNodeIds} onToggle={toggleNode} />
                      ))
                    ) : (
                      <div className="rounded-md border border-dashed border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">
                        Inga frågor, underlag eller medverkande är kopplade ännu.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
