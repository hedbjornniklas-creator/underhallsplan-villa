'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

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
  questionLabel: string | null
  documentTypeId: string | null
  documentTypeLabel: string | null
  participantRoleId: string | null
  participantRoleLabel: string | null
  reviewFlagId: string | null
  reviewFlagLabel: string | null
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
  category: string
  sortOrder: number
  isActive: boolean
}

type ActionDraft = {
  id?: string
  key: string
  label: string
  description: string
  sortOrder: string
  isActive: boolean
}

type LinkModalState =
  | {
      kind: 'question'
      actionTypeId: string
      selectedId: string
      isRequired: boolean
      sortOrder: string
    }
  | {
      kind: 'document'
      actionTypeId: string
      selectedId: string
      isRequired: boolean
      sortOrder: string
      note: string
    }
  | {
      kind: 'participant'
      actionTypeId: string
      selectedId: string
      isRequired: boolean
      sortOrder: string
    }
  | null

type CreateModalState =
  | {
      kind: 'question'
      actionTypeId: string
      label: string
      helpText: string
      responseType: QuestionItem['responseType']
      sortOrder: string
      isActive: boolean
      linkRequired: boolean
      linkSortOrder: string
    }
  | {
      kind: 'document'
      actionTypeId: string
      label: string
      description: string
      defaultPhase: DocumentTypeItem['defaultPhase']
      sortOrder: string
      isActive: boolean
      linkRequired: boolean
      linkSortOrder: string
      note: string
    }
  | {
      kind: 'participant'
      actionTypeId: string
      label: string
      description: string
      roleKind: ParticipantRoleItem['roleKind']
      sortOrder: string
      isActive: boolean
      linkRequired: boolean
      linkSortOrder: string
    }
  | null

const EMPTY_ACTION_DRAFT: ActionDraft = {
  key: '',
  label: '',
  description: '',
  sortOrder: '100',
  isActive: true,
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function slugifyHyphenKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function slugifyUnderscoreKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
}

function labelForResponseType(value: QuestionItem['responseType']) {
  if (value === 'multi_select') return 'Flerval'
  if (value === 'boolean') return 'Ja/Nej'
  return 'Envalslista'
}

function labelForPhase(value: DocumentTypeItem['defaultPhase']) {
  if (value === 'during_execution') return 'Under'
  if (value === 'after_completion') return 'Efter'
  return 'Före'
}

function toneForFlag(severity: ReviewFlagItem['severity']) {
  if (severity === 'high') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-sky-200 bg-sky-50 text-sky-800'
}

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>
}

export default function RenoAppFlowBuilderPage() {
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
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
  const [actionDraft, setActionDraft] = useState<ActionDraft | null>(null)
  const [linkModal, setLinkModal] = useState<LinkModalState>(null)
  const [createModal, setCreateModal] = useState<CreateModalState>(null)
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
        throw new Error((actionTypesPayload.error as string) ?? 'Kunde inte lasa renoveringstyper.')
      }
      if (!questionsResponse.ok) {
        throw new Error((questionsPayload.error as string) ?? 'Kunde inte lasa fragor.')
      }
      if (!documentTypesResponse.ok) {
        throw new Error((documentTypesPayload.error as string) ?? 'Kunde inte lasa underlagstyper.')
      }
      if (!participantRolesResponse.ok) {
        throw new Error((participantRolesPayload.error as string) ?? 'Kunde inte lasa medverkande.')
      }
      if (!reviewFlagsResponse.ok) {
        throw new Error((reviewFlagsPayload.error as string) ?? 'Kunde inte läsa flaggor.')
      }
      if (!requirementsResponse.ok) {
        throw new Error((requirementsPayload.error as string) ?? 'Kunde inte lasa underlagskopplingar.')
      }
      if (!questionConfigResponse.ok) {
        throw new Error((questionConfigPayload.error as string) ?? 'Kunde inte lasa fragekopplingar.')
      }
      if (!participantConfigResponse.ok) {
        throw new Error((participantConfigPayload.error as string) ?? 'Kunde inte lasa medverkandekopplingar.')
      }

      const nextActionTypes = [...((actionTypesPayload.items as ActionTypeItem[] | undefined) ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
      )
      const nextQuestions = [...((questionsPayload.items as QuestionItem[] | undefined) ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
      )
      const nextDocumentTypes = [...((documentTypesPayload.items as DocumentTypeItem[] | undefined) ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
      )
      const nextParticipantRoles = [
        ...((participantRolesPayload.items as ParticipantRoleItem[] | undefined) ?? []),
      ].sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
      const nextReviewFlags = [...((reviewFlagsPayload.items as ReviewFlagItem[] | undefined) ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
      )

      setActionTypes(nextActionTypes)
      setQuestionItems(nextQuestions)
      setDocumentTypes(nextDocumentTypes)
      setParticipantRoles(nextParticipantRoles)
      setReviewFlags(nextReviewFlags)
      setRequirementGroups((requirementsPayload.actionTypes as ActionTypeGroup[] | undefined) ?? [])
      setQuestionGroups((questionConfigPayload.actionTypes as ActionTypeQuestionGroup[] | undefined) ?? [])
      setParticipantGroups(
        (participantConfigPayload.actionTypes as ActionTypeParticipantRoleGroup[] | undefined) ?? []
      )
      setSelectedActionTypeId((current) => {
        if (current && nextActionTypes.some((item) => item.id === current)) return current
        return nextActionTypes[0]?.id ?? null
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa flödesbyggaren.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

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
  const documentTypeMap = useMemo(
    () => new Map(documentTypes.map((item) => [item.id, item])),
    [documentTypes]
  )
  const participantRoleMap = useMemo(
    () => new Map(participantRoles.map((item) => [item.id, item])),
    [participantRoles]
  )
  const reviewFlagMap = useMemo(
    () => new Map(reviewFlags.map((item) => [item.id, item])),
    [reviewFlags]
  )

  const selectedRequirementGroup = useMemo(
    () => requirementGroups.find((group) => group.actionType.id === selectedActionTypeId) ?? null,
    [requirementGroups, selectedActionTypeId]
  )
  const selectedQuestionGroup = useMemo(
    () => questionGroups.find((group) => group.actionType.id === selectedActionTypeId) ?? null,
    [questionGroups, selectedActionTypeId]
  )
  const selectedParticipantGroup = useMemo(
    () => participantGroups.find((group) => group.actionType.id === selectedActionTypeId) ?? null,
    [participantGroups, selectedActionTypeId]
  )

  const rootRequirements = useMemo(
    () =>
      [...(selectedRequirementGroup?.requirements ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.documentLabel.localeCompare(right.documentLabel, 'sv')
      ),
    [selectedRequirementGroup]
  )
  const rootQuestions = useMemo(
    () =>
      [...(selectedQuestionGroup?.questions ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.questionLabel.localeCompare(right.questionLabel, 'sv')
      ),
    [selectedQuestionGroup]
  )
  const rootParticipants = useMemo(
    () =>
      [...(selectedParticipantGroup?.participantRoles ?? [])].sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.participantRoleLabel.localeCompare(right.participantRoleLabel, 'sv')
      ),
    [selectedParticipantGroup]
  )

  const rootChildren = useMemo(() => {
    const questionNodes = rootQuestions.map((item) => ({
      id: `root-question:${item.questionId}`,
      sortOrder: item.sortOrder,
      kind: 'question' as const,
      questionLink: item,
    }))
    const documentNodes = rootRequirements.map((item) => ({
      id: `root-document:${item.documentTypeId}`,
      sortOrder: item.sortOrder,
      kind: 'document' as const,
      requirement: item,
    }))
    const participantNodes = rootParticipants.map((item) => ({
      id: `root-participant:${item.participantRoleId}`,
      sortOrder: item.sortOrder,
      kind: 'participant' as const,
      participantRole: item,
    }))

    return [...questionNodes, ...documentNodes, ...participantNodes].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id, 'sv')
    )
  }, [rootParticipants, rootQuestions, rootRequirements])

  const isExpanded = (id: string) => expandedNodeIds.includes(id)
  const toggleExpanded = (id: string) =>
    setExpandedNodeIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const nextSortOrderFor = (values: number[]) => {
    if (values.length === 0) return '10'
    return String(Math.max(...values) + 10)
  }

  const availableQuestionItems = useMemo(() => {
    const selectedIds = new Set(rootQuestions.map((item) => item.questionId))
    return questionItems.filter((item) => !selectedIds.has(item.id) && item.isActive)
  }, [questionItems, rootQuestions])
  const availableDocumentTypeItems = useMemo(() => {
    const selectedIds = new Set(rootRequirements.map((item) => item.documentTypeId))
    return documentTypes.filter((item) => !selectedIds.has(item.id) && item.isActive)
  }, [documentTypes, rootRequirements])
  const availableParticipantRoleItems = useMemo(() => {
    const selectedIds = new Set(rootParticipants.map((item) => item.participantRoleId))
    return participantRoles.filter((item) => !selectedIds.has(item.id) && item.isActive)
  }, [participantRoles, rootParticipants])

  const openNewActionModal = () => setActionDraft(EMPTY_ACTION_DRAFT)
  const openEditActionModal = (item: ActionTypeItem) =>
    setActionDraft({
      id: item.id,
      key: item.key,
      label: item.label,
      description: item.description ?? '',
      sortOrder: String(item.sortOrder),
      isActive: item.isActive,
    })

  const openLinkQuestionModal = (actionTypeId: string) =>
    setLinkModal({
      kind: 'question',
      actionTypeId,
      selectedId: '',
      isRequired: true,
      sortOrder: nextSortOrderFor(rootQuestions.map((item) => item.sortOrder)),
    })
  const openLinkDocumentModal = (actionTypeId: string) =>
    setLinkModal({
      kind: 'document',
      actionTypeId,
      selectedId: '',
      isRequired: true,
      sortOrder: nextSortOrderFor(rootRequirements.map((item) => item.sortOrder)),
      note: '',
    })
  const openLinkParticipantModal = (actionTypeId: string) =>
    setLinkModal({
      kind: 'participant',
      actionTypeId,
      selectedId: '',
      isRequired: true,
      sortOrder: nextSortOrderFor(rootParticipants.map((item) => item.sortOrder)),
    })

  const openCreateQuestionModal = (actionTypeId: string) =>
    setCreateModal({
      kind: 'question',
      actionTypeId,
      label: '',
      helpText: '',
      responseType: 'single_select',
      sortOrder: nextSortOrderFor(questionItems.map((item) => item.sortOrder)),
      isActive: true,
      linkRequired: true,
      linkSortOrder: nextSortOrderFor(rootQuestions.map((item) => item.sortOrder)),
    })
  const openCreateDocumentModal = (actionTypeId: string) =>
    setCreateModal({
      kind: 'document',
      actionTypeId,
      label: '',
      description: '',
      defaultPhase: 'before_required',
      sortOrder: nextSortOrderFor(documentTypes.map((item) => item.sortOrder)),
      isActive: true,
      linkRequired: true,
      linkSortOrder: nextSortOrderFor(rootRequirements.map((item) => item.sortOrder)),
      note: '',
    })
  const openCreateParticipantModal = (actionTypeId: string) =>
    setCreateModal({
      kind: 'participant',
      actionTypeId,
      label: '',
      description: '',
      roleKind: 'contractor',
      sortOrder: nextSortOrderFor(participantRoles.map((item) => item.sortOrder)),
      isActive: true,
      linkRequired: true,
      linkSortOrder: nextSortOrderFor(rootParticipants.map((item) => item.sortOrder)),
    })

  const requestSucceeded = async (response: Response, fallbackMessage: string) => {
    const payload = await readJson(response)
    if (!response.ok) throw new Error((payload.error as string) ?? fallbackMessage)
    return payload
  }

  const saveAction = async () => {
    if (!actionDraft) return
    setSavingKey(actionDraft.id ?? 'new-action')
    setError(null)
    try {
      await requestSucceeded(
        await fetch('/api/renoapp/admin/action-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: actionDraft.id,
            key: actionDraft.id ? actionDraft.key : slugifyHyphenKey(actionDraft.label),
            label: actionDraft.label,
            description: actionDraft.description,
            sortOrder: Number(actionDraft.sortOrder || '100'),
            isActive: actionDraft.isActive,
          }),
        }),
        'Kunde inte spara renoveringstyp.'
      )
      setActionDraft(null)
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara renoveringstyp.')
    } finally {
      setSavingKey(null)
    }
  }

  const saveLinkModal = async () => {
    if (!linkModal) return
    if (!linkModal.selectedId) {
      setError('Välj vad som ska läggas till i flödet.')
      return
    }

    setSavingKey(`link:${linkModal.kind}`)
    setError(null)

    try {
      if (linkModal.kind === 'question') {
        await requestSucceeded(
          await fetch('/api/renoapp/admin/action-type-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: linkModal.actionTypeId,
              questionId: linkModal.selectedId,
              isEnabled: true,
              isRequired: linkModal.isRequired,
              sortOrder: Number(linkModal.sortOrder || '100'),
            }),
          }),
          'Kunde inte lägga till fråga.'
        )
      } else if (linkModal.kind === 'document') {
        await requestSucceeded(
          await fetch('/api/renoapp/admin/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: linkModal.actionTypeId,
              documentTypeId: linkModal.selectedId,
              isEnabled: true,
              isRequired: linkModal.isRequired,
              note: linkModal.note,
              sortOrder: Number(linkModal.sortOrder || '100'),
            }),
          }),
          'Kunde inte lägga till underlag.'
        )
      } else {
        await requestSucceeded(
          await fetch('/api/renoapp/admin/action-type-participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: linkModal.actionTypeId,
              participantRoleId: linkModal.selectedId,
              isEnabled: true,
              isRequired: linkModal.isRequired,
              sortOrder: Number(linkModal.sortOrder || '100'),
            }),
          }),
          'Kunde inte lägga till medverkande.'
        )
      }

      setLinkModal(null)
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte uppdatera flödet.')
    } finally {
      setSavingKey(null)
    }
  }

  const saveCreateModal = async () => {
    if (!createModal) return

    setSavingKey(`create:${createModal.kind}`)
    setError(null)

    try {
      if (createModal.kind === 'question') {
        const questionPayload = await requestSucceeded(
          await fetch('/api/renoapp/admin/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: {
                key: slugifyHyphenKey(createModal.label),
                label: createModal.label,
                helpText: createModal.helpText,
                responseType: createModal.responseType,
                sortOrder: Number(createModal.sortOrder || '100'),
                isLocked: false,
                isActive: createModal.isActive,
                metadata: {},
              },
              options: [],
            }),
          }),
          'Kunde inte skapa fråga.'
        )
        const question = questionPayload.item as QuestionItem
        await requestSucceeded(
          await fetch('/api/renoapp/admin/action-type-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: createModal.actionTypeId,
              questionId: question.id,
              isEnabled: true,
              isRequired: createModal.linkRequired,
              sortOrder: Number(createModal.linkSortOrder || '100'),
            }),
          }),
          'Kunde inte koppla frågan till renoveringstypen.'
        )
      } else if (createModal.kind === 'document') {
        const documentPayload = await requestSucceeded(
          await fetch('/api/renoapp/admin/document-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: slugifyHyphenKey(createModal.label),
              label: createModal.label,
              description: createModal.description,
              defaultPhase: createModal.defaultPhase,
              sortOrder: Number(createModal.sortOrder || '100'),
              isActive: createModal.isActive,
            }),
          }),
          'Kunde inte skapa underlagstyp.'
        )
        const documentType = documentPayload.item as DocumentTypeItem
        await requestSucceeded(
          await fetch('/api/renoapp/admin/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: createModal.actionTypeId,
              documentTypeId: documentType.id,
              isEnabled: true,
              isRequired: createModal.linkRequired,
              note: createModal.note,
              sortOrder: Number(createModal.linkSortOrder || '100'),
            }),
          }),
          'Kunde inte koppla underlaget till renoveringstypen.'
        )
      } else {
        const participantPayload = await requestSucceeded(
          await fetch('/api/renoapp/admin/participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: slugifyUnderscoreKey(createModal.label),
              label: createModal.label,
              description: createModal.description,
              roleKind: createModal.roleKind,
              verificationInstructions: '',
              verificationUrl: '',
              insuranceRequired: false,
              requiresCompanyName: true,
              requiresOrgNumber: true,
              requiresContactName: true,
              requiresEmail: true,
              requiresPhone: true,
              requiresCertification: false,
              sortOrder: Number(createModal.sortOrder || '100'),
              isActive: createModal.isActive,
            }),
          }),
          'Kunde inte skapa medverkandetyp.'
        )
        const participantRole = participantPayload.item as ParticipantRoleItem
        await requestSucceeded(
          await fetch('/api/renoapp/admin/action-type-participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actionTypeId: createModal.actionTypeId,
              participantRoleId: participantRole.id,
              isEnabled: true,
              isRequired: createModal.linkRequired,
              sortOrder: Number(createModal.linkSortOrder || '100'),
            }),
          }),
          'Kunde inte koppla medverkandetypen till renoveringstypen.'
        )
      }

      setCreateModal(null)
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte skapa nytt innehall.')
    } finally {
      setSavingKey(null)
    }
  }

  const removeRootQuestion = async (questionId: string) => {
    if (!selectedAction) return
    setSavingKey(`remove-question:${questionId}`)
    setError(null)
    try {
      await requestSucceeded(
        await fetch('/api/renoapp/admin/action-type-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionTypeId: selectedAction.id,
            questionId,
            isEnabled: false,
            isRequired: false,
            sortOrder: 100,
          }),
        }),
        'Kunde inte ta bort frågan från flödet.'
      )
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte ta bort frågan.')
    } finally {
      setSavingKey(null)
    }
  }

  const removeRootRequirement = async (documentTypeId: string) => {
    if (!selectedAction) return
    setSavingKey(`remove-document:${documentTypeId}`)
    setError(null)
    try {
      await requestSucceeded(
        await fetch('/api/renoapp/admin/requirements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionTypeId: selectedAction.id,
            documentTypeId,
            isEnabled: false,
            isRequired: false,
            note: '',
            sortOrder: 100,
          }),
        }),
        'Kunde inte ta bort underlaget från flödet.'
      )
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte ta bort underlaget.')
    } finally {
      setSavingKey(null)
    }
  }

  const removeRootParticipant = async (participantRoleId: string) => {
    if (!selectedAction) return
    setSavingKey(`remove-participant:${participantRoleId}`)
    setError(null)
    try {
      await requestSucceeded(
        await fetch('/api/renoapp/admin/action-type-participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionTypeId: selectedAction.id,
            participantRoleId,
            isEnabled: false,
            isRequired: false,
            sortOrder: 100,
          }),
        }),
        'Kunde inte ta bort medverkandetypen från flödet.'
      )
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte ta bort medverkandetypen.')
    } finally {
      setSavingKey(null)
    }
  }

  const renderDocumentNode = ({
    nodeId,
    requirement,
    compact = false,
  }: {
    nodeId: string
    requirement: RequirementItem
    compact?: boolean
  }) => {
    const documentType = documentTypeMap.get(requirement.documentTypeId)
    const expanded = isExpanded(nodeId)

    return (
      <div className="rounded-[22px] border border-stone-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => toggleExpanded(nodeId)}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-stone-300 bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-700">
                Underlag
              </span>
              {documentType ? (
                <span className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                  {labelForPhase(documentType.defaultPhase)}
                </span>
              ) : null}
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                {requirement.isRequired ? 'Obligatoriskt' : 'Valfritt'}
              </span>
            </div>
            <div className="text-base font-semibold text-stone-900">{requirement.documentLabel}</div>
            {!expanded && compact && requirement.documentDescription ? (
              <div className="line-clamp-2 text-sm leading-6 text-stone-600">{requirement.documentDescription}</div>
            ) : null}
          </div>
          <span className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
            {expanded ? 'Minimera' : 'Öppna'}
          </span>
        </button>

        {expanded ? (
          <div className="mt-4 space-y-3">
            {requirement.documentDescription ? (
              <p className="text-sm leading-6 text-stone-600">{requirement.documentDescription}</p>
            ) : null}
            {requirement.note ? (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                Notering: {requirement.note}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/renoapp/document-types"
                className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Öppna i Underlagstyper
              </Link>
              {nodeId.startsWith('root-document:') ? (
                <button
                  type="button"
                  onClick={() => void removeRootRequirement(requirement.documentTypeId)}
                  disabled={savingKey === `remove-document:${requirement.documentTypeId}`}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                >
                  {savingKey === `remove-document:${requirement.documentTypeId}` ? 'Tar bort...' : 'Ta bort'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const renderParticipantNode = ({
    nodeId,
    participantRole,
    compact = false,
  }: {
    nodeId: string
    participantRole: ActionParticipantRoleItem
    compact?: boolean
  }) => {
    const role = participantRoleMap.get(participantRole.participantRoleId)
    const expanded = isExpanded(nodeId)

    return (
      <div className="rounded-[22px] border border-stone-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => toggleExpanded(nodeId)}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-stone-300 bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-700">
                {participantRole.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'}
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                {participantRole.isRequired ? 'Obligatorisk' : 'Valfri'}
              </span>
            </div>
            <div className="text-base font-semibold text-stone-900">{participantRole.participantRoleLabel}</div>
            {!expanded && compact && participantRole.participantRoleDescription ? (
              <div className="line-clamp-2 text-sm leading-6 text-stone-600">{participantRole.participantRoleDescription}</div>
            ) : null}
          </div>
          <span className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
            {expanded ? 'Minimera' : 'Öppna'}
          </span>
        </button>

        {expanded ? (
          <div className="mt-4 space-y-3">
            {participantRole.participantRoleDescription ? (
              <p className="text-sm leading-6 text-stone-600">{participantRole.participantRoleDescription}</p>
            ) : null}
            {role?.verificationInstructions ? (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                Verifieringsinstruktion finns på rollen.
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/renoapp/participants"
                className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Öppna i Medverkande
              </Link>
              {nodeId.startsWith('root-participant:') ? (
                <button
                  type="button"
                  onClick={() => void removeRootParticipant(participantRole.participantRoleId)}
                  disabled={savingKey === `remove-participant:${participantRole.participantRoleId}`}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                >
                  {savingKey === `remove-participant:${participantRole.participantRoleId}` ? 'Tar bort...' : 'Ta bort'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const renderFlagNode = (nodeId: string, reviewFlag: ReviewFlagItem) => {
    const expanded = isExpanded(nodeId)

    return (
      <div className={cn('rounded-[22px] border p-4 shadow-sm', toneForFlag(reviewFlag.severity))}>
        <button
          type="button"
          onClick={() => toggleExpanded(nodeId)}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-current/30 bg-white/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                Flagga
              </span>
              <span className="rounded-full border border-current/30 bg-white/70 px-2.5 py-1 text-[11px] font-semibold">
                {reviewFlag.severity}
              </span>
            </div>
            <div className="text-base font-semibold">{reviewFlag.label}</div>
          </div>
          <span className="rounded-full border border-current/30 bg-white/70 px-2.5 py-1 text-[11px] font-semibold">
            {expanded ? 'Minimera' : 'Öppna'}
          </span>
        </button>

        {expanded ? (
          <div className="mt-4 space-y-2 text-sm leading-6">
            {reviewFlag.description ? <p>{reviewFlag.description}</p> : null}
            <Link
              href="/admin/renoapp/review-flags"
              className="inline-flex rounded-xl border border-current/30 bg-white/70 px-3 py-2 text-xs font-semibold transition hover:bg-white"
            >
              Öppna i Flaggor
            </Link>
          </div>
        ) : null}
      </div>
    )
  }

  const renderQuestionTree = (
    questionId: string,
    depth: number,
    ancestry: string[],
    rootLink?: ActionQuestionItem
  ): ReactNode => {
    const question = questionMap.get(questionId)
    const nodeId = `question:${ancestry.join('>') || 'root'}:${questionId}`
    if (!question) {
      return (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Frågan finns inte längre i frågebanken.
        </div>
      )
    }

    if (ancestry.includes(questionId)) {
      return (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Cirkelskydd: {question.label} visas redan hoger upp i samma gren.
        </div>
      )
    }

    const expanded = isExpanded(nodeId)

    return (
      <div className={cn(depth > 0 && 'pt-2')}>
        <div className="rounded-[24px] border border-stone-200 bg-white p-4 shadow-sm">
          <button
            type="button"
            onClick={() => toggleExpanded(nodeId)}
            className="flex w-full items-start justify-between gap-3 text-left"
          >
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-stone-300 bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-700">
                  {depth === 0 ? 'Startfråga' : 'Följdfråga'}
                </span>
                <span className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                  {labelForResponseType(question.responseType)}
                </span>
                {rootLink ? (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                    {rootLink.isRequired ? 'Obligatorisk' : 'Valfri'}
                  </span>
                ) : null}
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900">{question.label}</h3>
                {!expanded && question.helpText ? (
                  <p className="mt-1 line-clamp-2 max-w-3xl text-sm leading-6 text-stone-600">{question.helpText}</p>
                ) : null}
              </div>
            </div>
            <span className="rounded-full border border-stone-300 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
              {expanded ? 'Minimera' : 'Öppna'}
            </span>
          </button>

          {expanded ? (
            <div className="mt-4 space-y-4">
              {question.helpText ? <p className="text-sm leading-6 text-stone-600">{question.helpText}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/admin/renoapp/questions"
                  className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Öppna i Frågor
                </Link>
                {depth === 0 ? (
                  <button
                    type="button"
                    onClick={() => void removeRootQuestion(question.id)}
                    disabled={savingKey === `remove-question:${question.id}`}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    {savingKey === `remove-question:${question.id}` ? 'Tar bort...' : 'Ta bort'}
                  </button>
                ) : null}
              </div>

              {question.options.length > 0 ? (
                [...question.options]
                  .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
                  .map((option) => {
                    const activeTriggers = option.triggers.filter((trigger) => trigger.isActive)
                    const childQuestionIds = activeTriggers
                      .filter((trigger) => trigger.triggerType === 'question' && trigger.questionId)
                      .map((trigger) => trigger.questionId as string)
                    const childDocumentIds = activeTriggers
                      .filter((trigger) => trigger.triggerType === 'document' && trigger.documentTypeId)
                      .map((trigger) => trigger.documentTypeId as string)
                    const childParticipantIds = activeTriggers
                      .filter((trigger) => trigger.triggerType === 'participant_role' && trigger.participantRoleId)
                      .map((trigger) => trigger.participantRoleId as string)
                    const childReviewFlagIds = activeTriggers
                      .filter((trigger) => trigger.triggerType === 'review_flag' && trigger.reviewFlagId)
                      .map((trigger) => trigger.reviewFlagId as string)

                    return (
                      <div key={option.id} className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-base font-semibold text-stone-900">{option.label}</div>
                            {option.description ? (
                              <div className="mt-1 text-sm leading-6 text-stone-600">{option.description}</div>
                            ) : null}
                          </div>
                          <div className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-700">
                            {activeTriggers.length} kopplingar
                          </div>
                        </div>

                        {activeTriggers.length > 0 ? (
                          <div className="mt-4 flex flex-wrap gap-3">
                            {childQuestionIds.map((childQuestionId) => (
                              <div key={`question:${option.id}:${childQuestionId}`} className="min-w-[280px] flex-1 basis-[320px]">
                                {renderQuestionTree(childQuestionId, depth + 1, [...ancestry, questionId])}
                              </div>
                            ))}
                            {childDocumentIds.map((documentId) => {
                              const documentType = documentTypeMap.get(documentId)
                              if (!documentType) return null
                              return (
                                <div key={`document:${option.id}:${documentId}`} className="min-w-[280px] flex-1 basis-[320px]">
                                  {renderDocumentNode({
                                    nodeId: `question-document:${option.id}:${documentId}`,
                                    requirement: {
                                      id: `virtual-document:${option.id}:${documentId}`,
                                      documentTypeId: documentId,
                                      documentKey: documentType.key,
                                      documentLabel: documentType.label,
                                      documentDescription: documentType.description,
                                      isRequired: true,
                                      note: null,
                                      sortOrder: documentType.sortOrder,
                                    },
                                    compact: true,
                                  })}
                                </div>
                              )
                            })}
                            {childParticipantIds.map((participantId) => {
                              const participantRole = participantRoleMap.get(participantId)
                              if (!participantRole) return null
                              return (
                                <div key={`participant:${option.id}:${participantId}`} className="min-w-[280px] flex-1 basis-[320px]">
                                  {renderParticipantNode({
                                    nodeId: `question-participant:${option.id}:${participantId}`,
                                    participantRole: {
                                      id: `virtual-participant:${option.id}:${participantId}`,
                                      participantRoleId: participantId,
                                      participantRoleKey: participantRole.key,
                                      participantRoleLabel: participantRole.label,
                                      participantRoleDescription: participantRole.description,
                                      roleKind: participantRole.roleKind,
                                      isRequired: true,
                                      sortOrder: participantRole.sortOrder,
                                    },
                                    compact: true,
                                  })}
                                </div>
                              )
                            })}
                            {childReviewFlagIds.map((flagId) => {
                              const reviewFlag = reviewFlagMap.get(flagId)
                              if (!reviewFlag) return null
                              return (
                                <div key={`flag:${option.id}:${flagId}`} className="min-w-[280px] flex-1 basis-[320px]">
                                  {renderFlagNode(`question-flag:${option.id}:${flagId}`, reviewFlag)}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">
                            Inga noder kopplade till detta svar än.
                          </div>
                        )}
                      </div>
                    )
                  })
              ) : (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">
                  Frågan har inga svarsalternativ än. Öppna den i Frågor för att skapa logik och grenar.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8 md:px-6 md:pb-10">
      {error ? (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.98),rgba(247,244,239,0.96))] p-6 shadow-[0_30px_90px_-48px_rgba(41,37,36,0.45)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Ny adminyta</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">Flödesbyggare</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-700">
              Den här sidan visar RenoApp som ett flöde i stället för separata parameterlistor. De gamla adminflikarna finns
              kvar som reservväg medan vi bygger den nya arbetsytan.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/renoapp/action-types"
              className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
            >
              Gammal renoveringstypsadmin
            </Link>
            <Link
              href="/admin/renoapp/questions"
              className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
            >
              Frågebank
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-6 space-y-6">
        <section className="rounded-[28px] border border-stone-200 bg-white/95 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-stone-900">Renoveringstyper</h3>
              <p className="mt-1 text-sm text-stone-600">Välj vilket flöde du vill bygga.</p>
            </div>
            <button
              type="button"
              onClick={openNewActionModal}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              + Ny
            </button>
          </div>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sök renoveringstyp..."
            className="mt-4 w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm text-stone-900"
          />

          {loading ? (
            <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-600">
              Laddar flödet...
            </div>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visibleActionTypes.map((item) => {
                const active = item.id === selectedActionTypeId
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedActionTypeId(item.id)}
                    className={cn(
                      'w-full rounded-2xl border px-4 py-3 text-left transition',
                      active
                        ? 'border-stone-900 bg-stone-900 text-white shadow-lg shadow-stone-900/10'
                        : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{item.label}</div>
                        <div className={cn('mt-1 text-xs', active ? 'text-stone-300' : 'text-stone-500')}>
                          {item.key}
                        </div>
                      </div>
                      <div
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
                          active ? 'bg-white/10 text-white' : 'bg-stone-100 text-stone-700'
                        )}
                      >
                        {item.questionCount} fragor
                      </div>
                    </div>
                  </button>
                )
              })}

              {visibleActionTypes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                  Inga renoveringstyper matchar sökningen.
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-stone-200 bg-white/95 p-5 shadow-sm">
          {!selectedAction ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center text-sm text-stone-600">
              Välj en renoveringstyp ovan för att visa dess flöde.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-[28px] border border-stone-900 bg-[linear-gradient(145deg,rgba(28,25,23,0.98),rgba(68,64,60,0.96))] p-6 text-white shadow-[0_30px_90px_-50px_rgba(28,25,23,0.75)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-100">
                        Renoveringstyp
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-100">
                        {selectedAction.isActive ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </div>
                    <div>
                      <h2 className="text-3xl font-semibold tracking-tight">{selectedAction.label}</h2>
                      {selectedAction.description ? (
                        <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-200">{selectedAction.description}</p>
                      ) : (
                        <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-300">
                          Ingen beskrivning än. Använd detta huvudkort som startpunkt och bygg sedan grenarna under.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-stone-200">
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">{rootQuestions.length} startfrågor</span>
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">{rootRequirements.length} underlag</span>
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">{rootParticipants.length} medverkande</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEditActionModal(selectedAction)}
                      className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
                    >
                      Redigera renoveringstyp
                    </button>
                    <button
                      type="button"
                      onClick={() => openLinkQuestionModal(selectedAction.id)}
                      className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/25"
                    >
                      Lägg till fråga
                    </button>
                    <button
                      type="button"
                      onClick={() => openLinkDocumentModal(selectedAction.id)}
                      className="rounded-xl border border-sky-400/30 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/25"
                    >
                      Lägg till underlag
                    </button>
                    <button
                      type="button"
                      onClick={() => openLinkParticipantModal(selectedAction.id)}
                      className="rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/25"
                    >
                      Lägg till medverkandetyp
                    </button>
                  </div>
                </div>
              </div>
              {false && (
                <div className="mt-6 space-y-6">
                <section className="rounded-[28px] border border-stone-200 bg-stone-50/70 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-stone-900">Frågegrenar</h3>
                      <p className="mt-1 text-sm text-stone-600">
                        Frågor fungerar som de enda riktiga grenarna i flödet. Under varje svar syns dess underlag, medverkande, flaggor och följdfrågor.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openLinkQuestionModal(selectedAction!.id)}
                        className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                      >
                        Lägg till befintlig
                      </button>
                      <button
                        type="button"
                        onClick={() => openCreateQuestionModal(selectedAction!.id)}
                        className="rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-stone-700"
                      >
                        Skapa ny fråga
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 space-y-4">
                    {rootQuestions.length > 0 ? (
                      rootQuestions.map((questionLink) => (
                        <div key={questionLink.id}>{renderQuestionTree(questionLink.questionId, 0, [], questionLink)}</div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-600">
                        Inga startfrågor än. Lägg till en befintlig fråga eller skapa en ny direkt här.
                      </div>
                    )}
                  </div>
                </section>

                <div className="grid gap-6 xl:grid-cols-2">
                  <section className="rounded-[28px] border border-stone-200 bg-stone-50/70 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-stone-900">Underlag direkt på renoveringstypen</h3>
                        <p className="mt-1 text-sm text-stone-600">
                          Dessa underlag krävs direkt av renoveringstypen innan någon svarsstyrd logik kommer in.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openLinkDocumentModal(selectedAction!.id)}
                          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                        >
                          Lägg till befintligt
                        </button>
                        <button
                          type="button"
                          onClick={() => openCreateDocumentModal(selectedAction!.id)}
                          className="rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-stone-700"
                        >
                          Skapa nytt underlag
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {rootRequirements.length > 0 ? (
                        rootRequirements.map((requirement) => {
                          const documentType = documentTypeMap.get(requirement.documentTypeId)
                          return (
                            <div key={requirement.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-stone-300 bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-700">
                                      Underlag
                                    </span>
                                    {documentType ? (
                                      <span className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                                        {labelForPhase(documentType.defaultPhase)}
                                      </span>
                                    ) : null}
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                                      {requirement.isRequired ? 'Obligatoriskt' : 'Valfritt'}
                                    </span>
                                  </div>
                                  <div className="text-base font-semibold text-stone-900">{requirement.documentLabel}</div>
                                  {requirement.documentDescription ? (
                                    <p className="text-sm leading-6 text-stone-600">{requirement.documentDescription}</p>
                                  ) : null}
                                  {requirement.note ? (
                                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                                      Notering: {requirement.note}
                                    </div>
                                  ) : null}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <Link
                                    href="/admin/renoapp/document-types"
                                    className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100"
                                  >
                                    Öppna i Underlagstyper
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => void removeRootRequirement(requirement.documentTypeId)}
                                    disabled={savingKey === `remove-document:${requirement.documentTypeId}`}
                                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                                  >
                                    {savingKey === `remove-document:${requirement.documentTypeId}` ? 'Tar bort...' : 'Ta bort'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-600">
                          Inga direkta underlag kopplade ännu.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-stone-200 bg-stone-50/70 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-stone-900">Medverkande direkt på renoveringstypen</h3>
                        <p className="mt-1 text-sm text-stone-600">
                          Dessa roller behövs direkt av renoveringstypen. Fler roller kan tillkomma i frågeträdet ovan.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openLinkParticipantModal(selectedAction!.id)}
                          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                        >
                          Lägg till befintlig
                        </button>
                        <button
                          type="button"
                          onClick={() => openCreateParticipantModal(selectedAction!.id)}
                          className="rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-stone-700"
                        >
                          Skapa ny medverkandetyp
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {rootParticipants.length > 0 ? (
                        rootParticipants.map((participantRole) => {
                          const role = participantRoleMap.get(participantRole.participantRoleId)
                          return (
                            <div key={participantRole.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-stone-300 bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-700">
                                      {participantRole.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'}
                                    </span>
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                                      {participantRole.isRequired ? 'Obligatorisk' : 'Valfri'}
                                    </span>
                                  </div>
                                  <div className="text-base font-semibold text-stone-900">{participantRole.participantRoleLabel}</div>
                                  {participantRole.participantRoleDescription ? (
                                    <p className="text-sm leading-6 text-stone-600">{participantRole.participantRoleDescription}</p>
                                  ) : null}
                                  {role?.verificationInstructions ? (
                                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                                      Verifieringsinstruktion finns på rollen.
                                    </div>
                                  ) : null}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <Link
                                    href="/admin/renoapp/participants"
                                    className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100"
                                  >
                                    Öppna i Medverkande
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => void removeRootParticipant(participantRole.participantRoleId)}
                                    disabled={savingKey === `remove-participant:${participantRole.participantRoleId}`}
                                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                                  >
                                    {savingKey === `remove-participant:${participantRole.participantRoleId}` ? 'Tar bort...' : 'Ta bort'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-600">
                          Inga direkta medverkandetyper kopplade ännu.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>)}
                <div className="mt-6 rounded-[28px] border border-stone-200 bg-stone-50/70 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-stone-900">Direkta barn till renoveringstypen</h3>
                      <p className="mt-1 text-sm text-stone-600">
                        Alla frågor, underlag och medverkandetyper som ligger direkt under renoveringstypen visas här på samma rad. Klicka på en box för att öppna och arbeta i den.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openLinkQuestionModal(selectedAction.id)}
                        className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                      >
                        Lägg till fråga
                      </button>
                      <button
                        type="button"
                        onClick={() => openLinkDocumentModal(selectedAction.id)}
                        className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                      >
                        Lägg till underlag
                      </button>
                      <button
                        type="button"
                        onClick={() => openLinkParticipantModal(selectedAction.id)}
                        className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                      >
                        Lägg till medverkandetyp
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    {rootChildren.length > 0 ? (
                      rootChildren.map((node) => {
                        if (node.kind === 'question') {
                          return (
                            <div key={node.id} className="min-w-[280px] flex-1 basis-[320px]">
                              {renderQuestionTree(node.questionLink.questionId, 0, [], node.questionLink)}
                            </div>
                          )
                        }
                        if (node.kind === 'document') {
                          return (
                            <div key={node.id} className="min-w-[280px] flex-1 basis-[320px]">
                              {renderDocumentNode({ nodeId: node.id, requirement: node.requirement, compact: true })}
                            </div>
                          )
                        }
                        return (
                          <div key={node.id} className="min-w-[280px] flex-1 basis-[320px]">
                            {renderParticipantNode({ nodeId: node.id, participantRole: node.participantRole, compact: true })}
                          </div>
                        )
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-5 text-sm text-stone-600">
                        Inga frågor, underlag eller medverkandetyper kopplade ännu.
                      </div>
                    )}
                  </div>
                </div>
            </div>
          )}
        </section>
      </div>

      {actionDraft ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  {actionDraft.id ? 'Redigera renoveringstyp' : 'Ny renoveringstyp'}
                </h3>
                <p className="mt-1 text-sm text-stone-600">Detta ändrar bara renoveringstypens huvudkort i den nya arbetsytan. Flödet under byggs separat.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActionDraft(null)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => void saveAction()}
                  disabled={savingKey === (actionDraft.id ?? 'new-action')}
                  className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
                >
                  {savingKey === (actionDraft.id ?? 'new-action') ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Visningsnamn</span>
                <input
                  value={actionDraft.label}
                  onChange={(event) =>
                    setActionDraft((current) => (current ? { ...current, label: event.target.value } : current))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Intern nyckel</span>
                <input
                  value={actionDraft.id ? actionDraft.key : slugifyHyphenKey(actionDraft.label)}
                  readOnly
                  className="w-full rounded-2xl border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering</span>
                <input
                  value={actionDraft.sortOrder}
                  onChange={(event) =>
                    setActionDraft((current) => (current ? { ...current, sortOrder: event.target.value } : current))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={actionDraft.isActive}
                  onChange={(event) =>
                    setActionDraft((current) => (current ? { ...current, isActive: event.target.checked } : current))
                  }
                />
                Aktiv
              </label>
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Beskrivning</span>
                <textarea
                  value={actionDraft.description}
                  onChange={(event) =>
                    setActionDraft((current) => (current ? { ...current, description: event.target.value } : current))
                  }
                  rows={4}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {linkModal ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  {linkModal.kind === 'question'
                    ? 'Lägg till befintlig fråga'
                    : linkModal.kind === 'document'
                      ? 'Lägg till befintligt underlag'
                      : 'Lägg till befintlig medverkandetyp'}
                </h3>
                <p className="mt-1 text-sm text-stone-600">Knyt en befintlig post direkt till renoveringstypen utan att skapa dubbletter.</p>
              </div>
              <button
                type="button"
                onClick={() => setLinkModal(null)}
                className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Stäng
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Val</span>
                <select
                  value={linkModal.selectedId}
                  onChange={(event) =>
                    setLinkModal((current) => (current ? { ...current, selectedId: event.target.value } : current))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                >
                  <option value="">Välj...</option>
                  {(linkModal.kind === 'question'
                    ? availableQuestionItems
                    : linkModal.kind === 'document'
                      ? availableDocumentTypeItems
                      : availableParticipantRoleItems
                  ).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={linkModal.isRequired}
                  onChange={(event) =>
                    setLinkModal((current) => (current ? { ...current, isRequired: event.target.checked } : current))
                  }
                />
                Obligatorisk direkt här
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering</span>
                <input
                  value={linkModal.sortOrder}
                  onChange={(event) =>
                    setLinkModal((current) => (current ? { ...current, sortOrder: event.target.value } : current))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>
              {linkModal.kind === 'document' ? (
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Notering</span>
                  <textarea
                    value={linkModal.note}
                    onChange={(event) =>
                      setLinkModal((current) => (current && current.kind === 'document' ? { ...current, note: event.target.value } : current))
                    }
                    rows={3}
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => void saveLinkModal()}
                disabled={savingKey === `link:${linkModal.kind}`}
                className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
              >
                {savingKey === `link:${linkModal.kind}` ? 'Sparar...' : 'Lägg till'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createModal ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  {createModal.kind === 'question'
                    ? 'Skapa ny fråga'
                    : createModal.kind === 'document'
                      ? 'Skapa nytt underlag'
                      : 'Skapa ny medverkandetyp'}
                </h3>
                <p className="mt-1 text-sm text-stone-600">Posten skapas i listan och kopplas sedan direkt till den valda renoveringstypen.</p>
              </div>
              <button
                type="button"
                onClick={() => setCreateModal(null)}
                className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Stäng
              </button>
            </div>
            {createModal.kind === 'question' ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Frågetext</span>
                  <input
                    value={createModal.label}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'question' ? { ...current, label: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Hjälptext</span>
                  <textarea
                    value={createModal.helpText}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'question' ? { ...current, helpText: event.target.value } : current))
                    }
                    rows={3}
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Svarstyp</span>
                  <select
                    value={createModal.responseType}
                    onChange={(event) =>
                      setCreateModal((current) =>
                        current && current.kind === 'question'
                          ? { ...current, responseType: event.target.value as QuestionItem['responseType'] }
                          : current
                      )
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  >
                    <option value="single_select">Envalslista</option>
                    <option value="multi_select">Flerval</option>
                    <option value="boolean">Ja/Nej</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering i listan</span>
                  <input
                    value={createModal.sortOrder}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'question' ? { ...current, sortOrder: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={createModal.isActive}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'question' ? { ...current, isActive: event.target.checked } : current))
                    }
                  />
                  Aktiv i listan
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={createModal.linkRequired}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'question' ? { ...current, linkRequired: event.target.checked } : current))
                    }
                  />
                  Obligatorisk direkt här
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering i flödet</span>
                  <input
                    value={createModal.linkSortOrder}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'question' ? { ...current, linkSortOrder: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
              </div>
            ) : null}
            {createModal.kind === 'document' ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Namn</span>
                  <input
                    value={createModal.label}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'document' ? { ...current, label: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Fas</span>
                  <select
                    value={createModal.defaultPhase}
                    onChange={(event) =>
                      setCreateModal((current) =>
                        current && current.kind === 'document'
                          ? { ...current, defaultPhase: event.target.value as DocumentTypeItem['defaultPhase'] }
                          : current
                      )
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  >
                    <option value="before_required">Före</option>
                    <option value="during_execution">Under</option>
                    <option value="after_completion">Efter</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Beskrivning</span>
                  <textarea
                    value={createModal.description}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'document' ? { ...current, description: event.target.value } : current))
                    }
                    rows={3}
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering i listan</span>
                  <input
                    value={createModal.sortOrder}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'document' ? { ...current, sortOrder: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Notering i flödet</span>
                  <input
                    value={createModal.note}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'document' ? { ...current, note: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={createModal.isActive}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'document' ? { ...current, isActive: event.target.checked } : current))
                    }
                  />
                  Aktiv i listan
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={createModal.linkRequired}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'document' ? { ...current, linkRequired: event.target.checked } : current))
                    }
                  />
                  Obligatorisk direkt här
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering i flödet</span>
                  <input
                    value={createModal.linkSortOrder}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'document' ? { ...current, linkSortOrder: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
              </div>
            ) : null}
            {createModal.kind === 'participant' ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Namn</span>
                  <input
                    value={createModal.label}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'participant' ? { ...current, label: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Typ</span>
                  <select
                    value={createModal.roleKind}
                    onChange={(event) =>
                      setCreateModal((current) =>
                        current && current.kind === 'participant'
                          ? { ...current, roleKind: event.target.value as ParticipantRoleItem['roleKind'] }
                          : current
                      )
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  >
                    <option value="contractor">Entreprenör</option>
                    <option value="consultant">Konsult</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Beskrivning</span>
                  <textarea
                    value={createModal.description}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'participant' ? { ...current, description: event.target.value } : current))
                    }
                    rows={3}
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering i listan</span>
                  <input
                    value={createModal.sortOrder}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'participant' ? { ...current, sortOrder: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering i flödet</span>
                  <input
                    value={createModal.linkSortOrder}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'participant' ? { ...current, linkSortOrder: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={createModal.isActive}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'participant' ? { ...current, isActive: event.target.checked } : current))
                    }
                  />
                  Aktiv i listan
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={createModal.linkRequired}
                    onChange={(event) =>
                      setCreateModal((current) => (current && current.kind === 'participant' ? { ...current, linkRequired: event.target.checked } : current))
                    }
                  />
                  Obligatorisk direkt här
                </label>
              </div>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => void saveCreateModal()}
                disabled={savingKey === `create:${createModal.kind}`}
                className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
              >
                {savingKey === `create:${createModal.kind}` ? 'Sparar...' : 'Skapa och koppla'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
