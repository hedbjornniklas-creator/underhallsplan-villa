'use client'

import Link from 'next/link'
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
  documentKey: string
  documentLabel: string
  documentDescription: string | null
  isRequired: boolean
  note: string | null
  sortOrder: number
}

type ActionTypeGroup = {
  actionType: ActionTypeItem
  requirements: RequirementItem[]
}

type ActionQuestionItem = {
  id: string
  questionId: string
  questionKey: string
  questionLabel: string
  questionHelpText: string | null
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
  participantRoleKey: string
  participantRoleLabel: string
  participantRoleDescription: string | null
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
  triggers: QuestionOptionTriggerItem[]
}

type QuestionItem = {
  id: string
  key: string
  label: string
  helpText: string | null
  responseType: 'single_select' | 'multi_select' | 'boolean'
  sortOrder: number
  isActive: boolean
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
  sortOrder: number
  isActive: boolean
}

type ReviewFlagItem = {
  id: string
  key: string
  label: string
  description: string | null
  severity: 'info' | 'warning' | 'high'
  category: string
  sortOrder: number
  isActive: boolean
}

type FlowNodeTone = 'stone' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

type FlowNode = {
  id: string
  kind: 'question' | 'option' | 'document' | 'participant' | 'flag' | 'status'
  title: string
  description: string | null
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
  const result: string[] = []

  const visit = (node: FlowNode) => {
    if (node.children.length > 0) result.push(node.id)
    node.children.forEach(visit)
  }

  nodes.forEach(visit)
  return result
}

function FlowNodeChip({
  node,
  expanded,
  onToggle,
}: {
  node: FlowNode
  expanded: boolean
  onToggle: () => void
}) {
  const isExpandable = node.children.length > 0
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">{node.kind}</div>
          <div className="mt-1 text-base font-semibold leading-5">{node.title}</div>
          {node.description ? (
            <div className="mt-1 max-w-[240px] text-sm leading-5 text-stone-600">{node.description}</div>
          ) : null}
        </div>
        {isExpandable ? (
          <div className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-semibold text-stone-700">
            {expanded ? 'Dölj' : 'Visa'}
          </div>
        ) : null}
      </div>
      {node.badges.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {node.badges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-current/15 bg-white/70 px-2.5 py-1 text-[11px] font-semibold"
            >
              {badge}
            </span>
          ))}
        </div>
      ) : null}
    </>
  )

  if (!isExpandable) {
    return <div className={cn('w-[280px] rounded-md border px-3 py-3 shadow-sm', toneClasses(node.tone))}>{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'w-[280px] rounded-md border px-3 py-3 text-left shadow-sm transition hover:shadow-md',
        toneClasses(node.tone)
      )}
    >
      {content}
    </button>
  )
}

function FlowBranch({
  node,
  expandedNodeIds,
  onToggle,
}: {
  node: FlowNode
  expandedNodeIds: string[]
  onToggle: (nodeId: string) => void
}) {
  const expanded = expandedNodeIds.includes(node.id)

  return (
    <div className="flex flex-col items-center">
      <FlowNodeChip node={node} expanded={expanded} onToggle={() => onToggle(node.id)} />
      {node.children.length > 0 && expanded ? (
        <div className="mt-2 flex flex-col items-center">
          <div className="h-8 w-px bg-stone-300" />
          <div className="flex flex-wrap justify-center gap-6">
            {node.children.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="h-8 w-px bg-stone-300" />
                <FlowBranch node={child} expandedNodeIds={expandedNodeIds} onToggle={onToggle} />
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

      if (!actionTypesResponse.ok) {
        throw new Error((actionTypesPayload.error as string) ?? 'Kunde inte läsa renoveringstyper.')
      }
      if (!questionsResponse.ok) {
        throw new Error((questionsPayload.error as string) ?? 'Kunde inte läsa frågor.')
      }
      if (!documentTypesResponse.ok) {
        throw new Error((documentTypesPayload.error as string) ?? 'Kunde inte läsa underlagstyper.')
      }
      if (!participantRolesResponse.ok) {
        throw new Error((participantRolesPayload.error as string) ?? 'Kunde inte läsa medverkande.')
      }
      if (!reviewFlagsResponse.ok) {
        throw new Error((reviewFlagsPayload.error as string) ?? 'Kunde inte läsa flaggor.')
      }
      if (!requirementsResponse.ok) {
        throw new Error((requirementsPayload.error as string) ?? 'Kunde inte läsa underlagskopplingar.')
      }
      if (!questionConfigResponse.ok) {
        throw new Error((questionConfigPayload.error as string) ?? 'Kunde inte läsa frågekopplingar.')
      }
      if (!participantConfigResponse.ok) {
        throw new Error((participantConfigPayload.error as string) ?? 'Kunde inte läsa medverkandekopplingar.')
      }

      const nextActionTypes = [...((actionTypesPayload.items as ActionTypeItem[] | undefined) ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
      )

      setActionTypes(nextActionTypes)
      setQuestionItems(
        [...((questionsPayload.items as QuestionItem[] | undefined) ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
      )
      setDocumentTypes(
        [...((documentTypesPayload.items as DocumentTypeItem[] | undefined) ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
      )
      setParticipantRoles(
        [...((participantRolesPayload.items as ParticipantRoleItem[] | undefined) ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
      )
      setReviewFlags(
        [...((reviewFlagsPayload.items as ReviewFlagItem[] | undefined) ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
      )
      setRequirementGroups((requirementsPayload.actionTypes as ActionTypeGroup[] | undefined) ?? [])
      setQuestionGroups((questionConfigPayload.actionTypes as ActionTypeQuestionGroup[] | undefined) ?? [])
      setParticipantGroups((participantConfigPayload.actionTypes as ActionTypeParticipantRoleGroup[] | undefined) ?? [])
      setSelectedActionTypeId((current) => {
        if (current && nextActionTypes.some((item) => item.id === current)) return current
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
    const normalizedQuery = query.trim().toLowerCase()
    return actionTypes.filter((item) => {
      if (!normalizedQuery) return true
      return [item.label, item.key, item.description ?? ''].join(' ').toLowerCase().includes(normalizedQuery)
    })
  }, [actionTypes, query])

  const selectedAction = useMemo(
    () => actionTypes.find((item) => item.id === selectedActionTypeId) ?? null,
    [actionTypes, selectedActionTypeId]
  )

  const questionMap = useMemo(() => new Map(questionItems.map((item) => [item.id, item])), [questionItems])
  const documentTypeMap = useMemo(() => new Map(documentTypes.map((item) => [item.id, item])), [documentTypes])
  const participantRoleMap = useMemo(
    () => new Map(participantRoles.map((item) => [item.id, item])),
    [participantRoles]
  )
  const reviewFlagMap = useMemo(() => new Map(reviewFlags.map((item) => [item.id, item])), [reviewFlags])

  const rootRequirements = useMemo(() => {
    const group = requirementGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.requirements ?? [])].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.documentLabel.localeCompare(right.documentLabel, 'sv')
    )
  }, [requirementGroups, selectedActionTypeId])

  const rootQuestions = useMemo(() => {
    const group = questionGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.questions ?? [])].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.questionLabel.localeCompare(right.questionLabel, 'sv')
    )
  }, [questionGroups, selectedActionTypeId])

  const rootParticipants = useMemo(() => {
    const group = participantGroups.find((item) => item.actionType.id === selectedActionTypeId)
    return [...(group?.participantRoles ?? [])].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.participantRoleLabel.localeCompare(right.participantRoleLabel, 'sv')
    )
  }, [participantGroups, selectedActionTypeId])

  const flowRootChildren = useMemo(() => {
    const buildQuestionNode = (
      questionId: string,
      ancestry: string[],
      rootLink?: ActionQuestionItem
    ): FlowNode => {
      const question = questionMap.get(questionId)
      if (!question) {
        return {
          id: `missing-question:${questionId}`,
          kind: 'status',
          title: 'Frågan saknas',
          description: 'Frågan finns inte längre i frågebanken.',
          badges: ['Fel'],
          tone: 'rose',
          children: [],
        }
      }

      if (ancestry.includes(questionId)) {
        return {
          id: `cycle-question:${ancestry.join('>')}:${questionId}`,
          kind: 'status',
          title: 'Cirkelskydd',
          description: `${question.label} visas redan högre upp i samma gren.`,
          badges: ['Stopp'],
          tone: 'amber',
          children: [],
        }
      }

      const children = [...question.options]
        .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
        .map((option) => {
          const activeTriggers = [...option.triggers]
            .filter((trigger) => trigger.isActive)
            .sort((left, right) => left.sortOrder - right.sortOrder)

          const questionChildren = activeTriggers
            .filter((trigger) => trigger.triggerType === 'question' && trigger.questionId)
            .map((trigger) => buildQuestionNode(trigger.questionId as string, [...ancestry, questionId]))

          const documentChildren = activeTriggers
            .filter((trigger) => trigger.triggerType === 'document' && trigger.documentTypeId)
            .map((trigger) => {
              const documentType = documentTypeMap.get(trigger.documentTypeId as string)
              return {
                id: `document:${option.id}:${trigger.documentTypeId}`,
                kind: 'document' as const,
                title: documentType?.label ?? 'Underlag saknas',
                description: documentType?.description ?? 'Underlagstypen finns inte längre i katalogen.',
                badges: [documentType ? labelForPhase(documentType.defaultPhase) : 'Fel'],
                tone: (documentType ? 'sky' : 'rose') as FlowNodeTone,
                children: [],
              }
            })

          const participantChildren = activeTriggers
            .filter((trigger) => trigger.triggerType === 'participant_role' && trigger.participantRoleId)
            .map((trigger) => {
              const role = participantRoleMap.get(trigger.participantRoleId as string)
              return {
                id: `participant:${option.id}:${trigger.participantRoleId}`,
                kind: 'participant' as const,
                title: role?.label ?? 'Medverkande saknas',
                description: role?.description ?? 'Rollen finns inte längre i katalogen.',
                badges: [role?.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'],
                tone: (role?.roleKind === 'consultant' ? 'amber' : role ? 'emerald' : 'rose') as FlowNodeTone,
                children: [],
              }
            })

          const flagChildren = activeTriggers
            .filter((trigger) => trigger.triggerType === 'review_flag' && trigger.reviewFlagId)
            .map((trigger) => {
              const reviewFlag = reviewFlagMap.get(trigger.reviewFlagId as string)
              return {
                id: `flag:${option.id}:${trigger.reviewFlagId}`,
                kind: 'flag' as const,
                title: reviewFlag?.label ?? 'Flagga saknas',
                description: reviewFlag?.description ?? 'Flaggan finns inte längre i katalogen.',
                badges: [reviewFlag ? labelForSeverity(reviewFlag.severity) : 'Fel'],
                tone: (
                  reviewFlag?.severity === 'high'
                    ? 'rose'
                    : reviewFlag?.severity === 'warning'
                      ? 'amber'
                      : reviewFlag
                        ? 'violet'
                        : 'rose'
                ) as FlowNodeTone,
                children: [],
              }
            })

          return {
            id: `option:${questionId}:${option.id}`,
            kind: 'option' as const,
            title: option.label,
            description: option.description,
            badges: activeTriggers.length > 0 ? [`${activeTriggers.length} kopplingar`] : ['Ingen koppling'],
            tone: 'stone' as const,
            children: [...questionChildren, ...documentChildren, ...participantChildren, ...flagChildren],
          }
        })

      return {
        id: `question:${ancestry.join('>') || 'root'}:${question.id}`,
        kind: 'question',
        title: question.label,
        description: question.helpText,
        badges: [
          ancestry.length === 0 ? 'Startfråga' : 'Följdfråga',
          labelForResponseType(question.responseType),
          ...(rootLink ? [rootLink.isRequired ? 'Obligatorisk' : 'Valfri'] : []),
        ],
        tone: 'stone',
        children,
      }
    }

    const questionNodes = rootQuestions.map((item) => buildQuestionNode(item.questionId, [], item))
    const documentNodes = rootRequirements.map((item) => {
      const documentType = documentTypeMap.get(item.documentTypeId)
      return {
        id: `root-document:${item.documentTypeId}`,
        kind: 'document' as const,
        title: item.documentLabel,
        description: item.documentDescription,
        badges: [
          documentType ? labelForPhase(documentType.defaultPhase) : 'Okänd fas',
          item.isRequired ? 'Obligatoriskt' : 'Valfritt',
        ],
        tone: 'sky' as const,
        children: [],
      }
    })
    const participantNodes = rootParticipants.map((item) => {
      const role = participantRoleMap.get(item.participantRoleId)
      return {
        id: `root-participant:${item.participantRoleId}`,
        kind: 'participant' as const,
        title: item.participantRoleLabel,
        description: item.participantRoleDescription,
        badges: [
          role?.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör',
          item.isRequired ? 'Obligatorisk' : 'Valfri',
        ],
        tone: (role?.roleKind === 'consultant' ? 'amber' : 'emerald') as FlowNodeTone,
        children: [],
      }
    })

    return [...questionNodes, ...documentNodes, ...participantNodes]
  }, [
    documentTypeMap,
    participantRoleMap,
    questionMap,
    reviewFlagMap,
    rootParticipants,
    rootQuestions,
    rootRequirements,
  ])

  const allExpandableNodeIds = useMemo(() => collectExpandableNodeIds(flowRootChildren), [flowRootChildren])

  const toggleNode = (nodeId: string) => {
    setExpandedNodeIds((current) =>
      current.includes(nodeId) ? current.filter((item) => item !== nodeId) : [...current, nodeId]
    )
  }

  const expandAll = () => setExpandedNodeIds(allExpandableNodeIds)
  const collapseAll = () => setExpandedNodeIds([])

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pb-8 pt-4 md:px-6 md:pb-10">
      {error ? (
        <div className="mb-6 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 lg:hidden">
        Flödesvisaren är byggd för större skärmar. Öppna sidan på dator för att arbeta i visualiseringen.
      </div>

      <div className="hidden lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
        <aside className="border-r border-stone-200 pr-6">
          <div className="border-b border-stone-300 pb-4">
            <h2 className="text-2xl font-semibold text-stone-900">Renoveringstyper</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Välj ett flöde i listan. Klicka sedan på noderna i visualiseringen för att öppna vidare grenar.
            </p>
          </div>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sök renoveringstyp..."
            className="mt-4 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900"
          />

          {loading ? (
            <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 px-3 py-4 text-sm text-stone-600">
              Laddar renoveringstyper...
            </div>
          ) : null}

          <div className="mt-4 space-y-1">
            {visibleActionTypes.map((item) => {
              const active = item.id === selectedActionTypeId
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedActionTypeId(item.id)}
                  className={cn(
                    'w-full border-b border-stone-200 px-3 py-3 text-left transition',
                    active ? 'bg-stone-100 text-stone-900' : 'text-stone-700 hover:bg-stone-50'
                  )}
                >
                  <div className="font-semibold">{item.label}</div>
                  <div className="mt-1 text-xs text-stone-500">{item.key}</div>
                </button>
              )
            })}

            {!loading && visibleActionTypes.length === 0 ? (
              <div className="px-3 py-4 text-sm text-stone-600">Inga renoveringstyper matchar sökningen.</div>
            ) : null}
          </div>
        </aside>

        <section className="min-w-0">
          <div className="flex items-end justify-between border-b border-stone-300 pb-4">
            <div>
              <h1 className="text-3xl font-semibold text-stone-900">Flödesvisualisering</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-stone-600">
                Detta är en ren flödesvisare. Den visar hur frågor, svar, underlag, medverkande och flaggor hänger ihop.
                Redigering ligger kvar i de befintliga adminflikarna medan visualiseringen byggs upp på nytt.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/renoapp/action-types"
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Renoveringstyper
              </Link>
              <Link
                href="/admin/renoapp/questions"
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Frågebank
              </Link>
              <Link
                href="/admin/renoapp/document-types"
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Underlag
              </Link>
              <Link
                href="/admin/renoapp/participants"
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Medverkande
              </Link>
            </div>
          </div>

          {!selectedAction ? (
            <div className="mt-6 rounded-md border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center text-sm text-stone-600">
              Välj en renoveringstyp i listan till vänster för att visa dess flöde.
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-[minmax(0,2fr)_140px_140px_160px] gap-4 border-b border-stone-200 pb-3 text-sm">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Namn</div>
                  <div className="mt-2 font-semibold text-stone-900">{selectedAction.label}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Nyckel</div>
                  <div className="mt-2 text-stone-700">{selectedAction.key}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Typ</div>
                  <div className="mt-2 text-stone-700">Renoveringstyp</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Direkta barn</div>
                  <div className="mt-2 text-stone-700">{flowRootChildren.length}</div>
                </div>
              </div>

              <div className="mt-4 rounded-md border border-stone-200 bg-slate-100/80 px-6 py-6">
                <div className="text-center">
                  <h2 className="text-4xl font-semibold tracking-tight text-stone-900">{selectedAction.label}</h2>
                  <div className="mt-3 flex justify-center gap-3 text-sm text-stone-700">
                    <button type="button" onClick={expandAll} className="font-semibold hover:text-stone-900">
                      Expandera alla
                    </button>
                    <span>|</span>
                    <button type="button" onClick={collapseAll} className="font-semibold hover:text-stone-900">
                      Återställ vy
                    </button>
                  </div>
                  {selectedAction.description ? (
                    <p className="mx-auto mt-4 max-w-3xl text-sm leading-6 text-stone-600">{selectedAction.description}</p>
                  ) : null}
                </div>

                <div className="mt-10 min-h-[640px] overflow-x-auto">
                  <div className="mx-auto flex min-w-max flex-col items-center px-6 pb-10">
                    <div className="rounded-md border border-stone-900 bg-white px-4 py-3 shadow-sm">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Rot</div>
                      <div className="mt-1 text-lg font-semibold text-stone-900">{selectedAction.label}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                          {rootQuestions.length} frågor
                        </span>
                        <span className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                          {rootRequirements.length} underlag
                        </span>
                        <span className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                          {rootParticipants.length} medverkande
                        </span>
                      </div>
                    </div>

                    {flowRootChildren.length > 0 ? (
                      <>
                        <div className="h-10 w-px bg-stone-300" />
                        <div className="flex flex-wrap justify-center gap-8">
                          {flowRootChildren.map((node) => (
                            <div key={node.id} className="flex flex-col items-center">
                              <div className="h-8 w-px bg-stone-300" />
                              <FlowBranch node={node} expandedNodeIds={expandedNodeIds} onToggle={toggleNode} />
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="mt-10 rounded-md border border-dashed border-stone-300 bg-white px-5 py-5 text-sm text-stone-600">
                        Den här renoveringstypen har inga kopplade frågor, underlag eller medverkande ännu.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
