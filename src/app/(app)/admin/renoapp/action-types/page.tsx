'use client'

import { useEffect, useMemo, useState } from 'react'

type ActionTypeItem = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isActive: boolean
}

type DraftActionType = {
  id?: string
  key: string
  label: string
  description: string
  sortOrder: string
  isActive: boolean
}

type DocumentTypeItem = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isActive: boolean
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

type QuestionItem = {
  id: string
  key: string
  label: string
  helpText: string | null
  responseType: 'single_select' | 'multi_select' | 'boolean'
  sortOrder: number
  isActive: boolean
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

type ActionTypeGroup = {
  actionType: ActionTypeItem
  requirements: RequirementItem[]
}

type ActionTypeQuestionGroup = {
  actionType: ActionTypeItem
  questions: ActionQuestionItem[]
}

type ParticipantRoleItem = {
  id: string
  key: string
  label: string
  description: string | null
  roleKind: 'contractor' | 'consultant'
  sortOrder: number
  isActive: boolean
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

type DraftRequirementState = {
  isEnabled: boolean
  isRequired: boolean
  note: string
  sortOrder: string
}

type DraftActionQuestionState = {
  isEnabled: boolean
  isRequired: boolean
  sortOrder: string
}

type DraftParticipantRoleState = {
  isEnabled: boolean
  isRequired: boolean
  sortOrder: string
}

type SortKey = 'label' | 'key' | 'isActive' | 'requirementCount'

const EMPTY_DRAFT: DraftActionType = {
  key: '',
  label: '',
  description: '',
  sortOrder: '100',
  isActive: true,
}

function slugifyActionTypeKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function renderSortIcon(active: boolean, dir: 'asc' | 'desc') {
  if (!active) return <span className="text-gray-300">◇</span>
  return <span className="text-gray-500">{dir === 'asc' ? '↑' : '↓'}</span>
}

export default function RenoAppActionTypesAdminPage() {
  const [items, setItems] = useState<ActionTypeItem[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeItem[]>([])
  const [questionItems, setQuestionItems] = useState<QuestionItem[]>([])
  const [participantRoles, setParticipantRoles] = useState<ParticipantRoleItem[]>([])
  const [requirementDrafts, setRequirementDrafts] = useState<Record<string, DraftRequirementState>>(
    {}
  )
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, DraftActionQuestionState>>({})
  const [participantRoleDrafts, setParticipantRoleDrafts] = useState<
    Record<string, DraftParticipantRoleState>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'label',
    dir: 'asc',
  })
  const [savingActionKey, setSavingActionKey] = useState<string | null>(null)
  const [savingRequirementKey, setSavingRequirementKey] = useState<string | null>(null)
  const [savingQuestionKey, setSavingQuestionKey] = useState<string | null>(null)
  const [savingParticipantRoleKey, setSavingParticipantRoleKey] = useState<string | null>(null)
  const [deletingActionId, setDeletingActionId] = useState<string | null>(null)
  const [actionModalOpen, setActionModalOpen] = useState(false)
  const [actionDraft, setActionDraft] = useState<DraftActionType>(EMPTY_DRAFT)
  const [documentsActionId, setDocumentsActionId] = useState<string | null>(null)
  const [questionsActionId, setQuestionsActionId] = useState<string | null>(null)
  const [participantRolesActionId, setParticipantRolesActionId] = useState<string | null>(null)

  const generatedActionKey =
    actionDraft.id && actionDraft.key ? actionDraft.key : slugifyActionTypeKey(actionDraft.label)

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const [actionResponse, requirementResponse, questionResponse, participantRoleResponse] =
          await Promise.all([
          fetch('/api/renoapp/admin/action-types', { cache: 'no-store' }),
          fetch('/api/renoapp/admin/requirements', { cache: 'no-store' }),
          fetch('/api/renoapp/admin/action-type-questions', { cache: 'no-store' }),
          fetch('/api/renoapp/admin/action-type-participants', { cache: 'no-store' }),
          ])

        const actionPayload = (await actionResponse.json().catch(() => ({}))) as {
          items?: ActionTypeItem[]
          error?: string
        }
        const requirementPayload = (await requirementResponse.json().catch(() => ({}))) as {
          documentTypes?: DocumentTypeItem[]
          actionTypes?: ActionTypeGroup[]
          error?: string
        }
        const questionPayload = (await questionResponse.json().catch(() => ({}))) as {
          questions?: QuestionItem[]
          actionTypes?: ActionTypeQuestionGroup[]
          error?: string
        }
        const participantRolePayload = (await participantRoleResponse.json().catch(() => ({}))) as {
          participantRoles?: ParticipantRoleItem[]
          actionTypes?: ActionTypeParticipantRoleGroup[]
          error?: string
        }

        if (!actionResponse.ok) {
          throw new Error(actionPayload.error ?? 'Kunde inte lasa renoveringstyper.')
        }

        if (!requirementResponse.ok) {
          throw new Error(requirementPayload.error ?? 'Kunde inte lasa dokumentkrav.')
        }

        if (!questionResponse.ok) {
          throw new Error(questionPayload.error ?? 'Kunde inte lasa fragekopplingar.')
        }
        if (!participantRoleResponse.ok) {
          throw new Error(participantRolePayload.error ?? 'Kunde inte lasa medverkandekopplingar.')
        }

        if (!active) return

        const nextItems = [...(actionPayload.items ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
        const nextDocumentTypes = [...(requirementPayload.documentTypes ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )

        const nextRequirementDrafts: Record<string, DraftRequirementState> = {}
        const nextQuestionDrafts: Record<string, DraftActionQuestionState> = {}
        const nextParticipantRoleDrafts: Record<string, DraftParticipantRoleState> = {}
        for (const actionType of nextItems) {
          const group = (requirementPayload.actionTypes ?? []).find(
            (candidate) => candidate.actionType.id === actionType.id
          )
          const questionGroup = (questionPayload.actionTypes ?? []).find(
            (candidate) => candidate.actionType.id === actionType.id
          )
          const participantRoleGroup = (participantRolePayload.actionTypes ?? []).find(
            (candidate) => candidate.actionType.id === actionType.id
          )
          for (const documentType of nextDocumentTypes) {
            const requirement = group?.requirements.find(
              (item) => item.documentTypeId === documentType.id
            )
            nextRequirementDrafts[`${actionType.id}:${documentType.id}`] = {
              isEnabled: Boolean(requirement),
              isRequired: requirement?.isRequired ?? true,
              note: requirement?.note ?? '',
              sortOrder: String(requirement?.sortOrder ?? documentType.sortOrder ?? 100),
            }
          }
          for (const question of questionPayload.questions ?? []) {
            const link = questionGroup?.questions.find((item) => item.questionId === question.id)
            nextQuestionDrafts[`${actionType.id}:${question.id}`] = {
              isEnabled: Boolean(link),
              isRequired: link?.isRequired ?? true,
              sortOrder: String(link?.sortOrder ?? question.sortOrder ?? 100),
            }
          }
          for (const participantRole of participantRolePayload.participantRoles ?? []) {
            const link = participantRoleGroup?.participantRoles.find(
              (item) => item.participantRoleId === participantRole.id
            )
            nextParticipantRoleDrafts[`${actionType.id}:${participantRole.id}`] = {
              isEnabled: Boolean(link),
              isRequired: link?.isRequired ?? true,
              sortOrder: String(link?.sortOrder ?? participantRole.sortOrder ?? 100),
            }
          }
        }

        setItems(nextItems)
        setDocumentTypes(nextDocumentTypes)
        setQuestionItems(questionPayload.questions ?? [])
        setParticipantRoles(participantRolePayload.participantRoles ?? [])
        setRequirementDrafts(nextRequirementDrafts)
        setQuestionDrafts(nextQuestionDrafts)
        setParticipantRoleDrafts(nextParticipantRoleDrafts)
        setDocumentsActionId((current) =>
          current && nextItems.some((item) => item.id === current) ? current : null
        )
        setQuestionsActionId((current) =>
          current && nextItems.some((item) => item.id === current) ? current : null
        )
        setParticipantRolesActionId((current) =>
          current && nextItems.some((item) => item.id === current) ? current : null
        )
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte lasa RenoApp-adminen.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return items.filter((item) => {
      const haystack = [item.label, item.key, item.description ?? '', item.isActive ? 'aktiv' : 'inaktiv']
        .join(' ')
        .toLowerCase()

      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false
      if (activeFilter === 'active' && !item.isActive) return false
      if (activeFilter === 'inactive' && item.isActive) return false
      return true
    })
  }, [activeFilter, items, query])

  const activeDocumentTypes = useMemo(
    () => documentTypes.filter((documentType) => documentType.isActive),
    [documentTypes]
  )

  const activeQuestions = useMemo(
    () => questionItems.filter((question) => question.isActive),
    [questionItems]
  )

  const documentsAction = documentsActionId
    ? items.find((item) => item.id === documentsActionId) ?? null
    : null

  const questionsAction = questionsActionId
    ? items.find((item) => item.id === questionsActionId) ?? null
    : null
  const participantRolesAction = participantRolesActionId
    ? items.find((item) => item.id === participantRolesActionId) ?? null
    : null

  const documentsChips = useMemo(() => {
    if (!documentsActionId) return []
    return activeDocumentTypes.filter(
      (documentType) => requirementDrafts[`${documentsActionId}:${documentType.id}`]?.isEnabled
    )
  }, [activeDocumentTypes, documentsActionId, requirementDrafts])

  const questionChips = useMemo(() => {
    if (!questionsActionId) return []
    return activeQuestions.filter(
      (question) => questionDrafts[`${questionsActionId}:${question.id}`]?.isEnabled
    )
  }, [activeQuestions, questionDrafts, questionsActionId])

  const activeParticipantRoles = useMemo(
    () => participantRoles.filter((participantRole) => participantRole.isActive),
    [participantRoles]
  )

  const participantRoleChips = useMemo(() => {
    if (!participantRolesActionId) return []
    return activeParticipantRoles.filter(
      (participantRole) =>
        participantRoleDrafts[`${participantRolesActionId}:${participantRole.id}`]?.isEnabled
    )
  }, [activeParticipantRoles, participantRoleDrafts, participantRolesActionId])

  const getRequirementDraft = (actionTypeId: string, documentTypeId: string) =>
    requirementDrafts[`${actionTypeId}:${documentTypeId}`]

  const requirementCountByActionId = useMemo(() => {
    return Object.fromEntries(
      items.map((item) => [
        item.id,
        activeDocumentTypes.reduce(
          (count, documentType) =>
            requirementDrafts[`${item.id}:${documentType.id}`]?.isEnabled ? count + 1 : count,
          0
        ),
      ])
    ) as Record<string, number>
  }, [activeDocumentTypes, items, requirementDrafts])

  const questionCountByActionId = useMemo(() => {
    return Object.fromEntries(
      items.map((item) => [
        item.id,
        activeQuestions.reduce(
          (count, question) =>
            questionDrafts[`${item.id}:${question.id}`]?.isEnabled ? count + 1 : count,
          0
        ),
      ])
    ) as Record<string, number>
  }, [activeQuestions, items, questionDrafts])

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((left, right) => {
      let comparison = 0

      switch (sort.key) {
        case 'key':
          comparison = left.key.localeCompare(right.key, 'sv')
          break
        case 'isActive':
          comparison = Number(left.isActive) - Number(right.isActive)
          break
        case 'requirementCount':
          comparison =
            (requirementCountByActionId[left.id] ?? 0) - (requirementCountByActionId[right.id] ?? 0)
          break
        default:
          comparison = left.label.localeCompare(right.label, 'sv')
          break
      }

      if (comparison === 0) {
        comparison =
          left.sortOrder - right.sortOrder ||
          left.label.localeCompare(right.label, 'sv') ||
          left.key.localeCompare(right.key, 'sv')
      }

      return sort.dir === 'asc' ? comparison : -comparison
    })
  }, [filteredItems, requirementCountByActionId, sort])

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )
  }

  const openNewModal = () => {
    setActionDraft(EMPTY_DRAFT)
    setActionModalOpen(true)
  }

  const openEditModal = (item: ActionTypeItem) => {
    setActionDraft({
      id: item.id,
      key: item.key,
      label: item.label,
      description: item.description ?? '',
      sortOrder: String(item.sortOrder),
      isActive: item.isActive,
    })
    setActionModalOpen(true)
  }

  const openDuplicateModal = (item: ActionTypeItem) => {
    setActionDraft({
      key: '',
      label: `${item.label} kopia`,
      description: item.description ?? '',
      sortOrder: String(item.sortOrder),
      isActive: item.isActive,
    })
    setActionModalOpen(true)
  }

  const saveActionType = async () => {
    setSavingActionKey(actionDraft.id ?? 'new')
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/action-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: actionDraft.id,
          key: generatedActionKey,
          label: actionDraft.label,
          description: actionDraft.description,
          sortOrder: Number(actionDraft.sortOrder || '100'),
          isActive: actionDraft.isActive,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        item?: ActionTypeItem
        error?: string
      }

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Kunde inte spara renoveringstyp.')
      }

      const savedItem = payload.item
      setItems((current) =>
        [...current.filter((item) => item.id !== savedItem.id), savedItem].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
      )
      setRequirementDrafts((current) => {
        const next = { ...current }
        for (const documentType of activeDocumentTypes) {
          const key = `${savedItem.id}:${documentType.id}`
          if (!next[key]) {
            next[key] = {
              isEnabled: false,
              isRequired: true,
              note: '',
              sortOrder: String(documentType.sortOrder ?? 100),
            }
          }
        }
        return next
      })
      setQuestionDrafts((current) => {
        const next = { ...current }
        for (const question of activeQuestions) {
          const key = `${savedItem.id}:${question.id}`
          if (!next[key]) {
            next[key] = {
              isEnabled: false,
              isRequired: true,
              sortOrder: String(question.sortOrder ?? 100),
            }
          }
        }
        return next
      })
      setParticipantRoleDrafts((current) => {
        const next = { ...current }
        for (const participantRole of activeParticipantRoles) {
          const key = `${savedItem.id}:${participantRole.id}`
          if (!next[key]) {
            next[key] = {
              isEnabled: false,
              isRequired: true,
              sortOrder: String(participantRole.sortOrder ?? 100),
            }
          }
        }
        return next
      })
      setActionModalOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara renoveringstyp.')
    } finally {
      setSavingActionKey(null)
    }
  }

  const updateRequirementDraft = (
    actionTypeId: string,
    documentTypeId: string,
    field: keyof DraftRequirementState,
    value: string | boolean
  ) => {
    const key = `${actionTypeId}:${documentTypeId}`
    setRequirementDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
      },
    }))
  }

  const updateQuestionDraft = (
    actionTypeId: string,
    questionId: string,
    field: keyof DraftActionQuestionState,
    value: string | boolean
  ) => {
    const key = `${actionTypeId}:${questionId}`
    setQuestionDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
      },
    }))
  }

  const updateParticipantRoleDraft = (
    actionTypeId: string,
    participantRoleId: string,
    field: keyof DraftParticipantRoleState,
    value: string | boolean
  ) => {
    const key = `${actionTypeId}:${participantRoleId}`
    setParticipantRoleDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
      },
    }))
  }

  const saveRequirement = async (actionTypeId: string, documentTypeId: string) => {
    const key = `${actionTypeId}:${documentTypeId}`
    const draft = getRequirementDraft(actionTypeId, documentTypeId)
    if (!draft) return

    setSavingRequirementKey(key)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionTypeId,
          documentTypeId,
          isEnabled: draft.isEnabled,
          isRequired: draft.isRequired,
          note: draft.note,
          sortOrder: Number(draft.sortOrder || '100'),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara dokumentkrav.')
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara dokumentkrav.')
    } finally {
      setSavingRequirementKey(null)
    }
  }

  const saveActionQuestion = async (actionTypeId: string, questionId: string) => {
    const key = `${actionTypeId}:${questionId}`
    const draft = questionDrafts[key]
    if (!draft) return

    setSavingQuestionKey(key)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/action-type-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionTypeId,
          questionId,
          isEnabled: draft.isEnabled,
          isRequired: draft.isRequired,
          sortOrder: Number(draft.sortOrder || '100'),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara fragekoppling.')
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara fragekoppling.')
    } finally {
      setSavingQuestionKey(null)
    }
  }

  const saveActionParticipantRole = async (actionTypeId: string, participantRoleId: string) => {
    const key = `${actionTypeId}:${participantRoleId}`
    const draft = participantRoleDrafts[key]
    if (!draft) return

    setSavingParticipantRoleKey(key)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/action-type-participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionTypeId,
          participantRoleId,
          isEnabled: draft.isEnabled,
          isRequired: draft.isRequired,
          sortOrder: Number(draft.sortOrder || '100'),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara medverkandekoppling.')
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Kunde inte spara medverkandekoppling.'
      )
    } finally {
      setSavingParticipantRoleKey(null)
    }
  }

  const deleteActionType = async (item: ActionTypeItem) => {
    if (!window.confirm(`Radera renoveringstypen "${item.label}"?`)) return

    setDeletingActionId(item.id)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/action-types', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera renoveringstyp.')
      }

      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      setRequirementDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => !key.startsWith(`${item.id}:`))
        )
      )
      setQuestionDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => !key.startsWith(`${item.id}:`))
        )
      )
      setParticipantRoleDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => !key.startsWith(`${item.id}:`))
        )
      )
      setDocumentsActionId((current) => (current === item.id ? null : current))
      setQuestionsActionId((current) => (current === item.id ? null : current))
      setParticipantRolesActionId((current) => (current === item.id ? null : current))
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Kunde inte radera renoveringstyp.'
      )
    } finally {
      setDeletingActionId(null)
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8 md:px-6 md:pb-10">
      {error ? (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-[28px] border border-stone-200/80 bg-white/92 p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-stone-900">Renoveringstyper</h3>
            <p className="mt-1 text-sm leading-6 text-stone-600">renovation_action_types</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Sök..."
              className="rounded-2xl border border-stone-300 px-4 py-2.5 text-sm text-stone-900"
            />
            <button
              type="button"
              onClick={openNewModal}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              + Ny
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span className="text-gray-400">Sortera:</span>
          {[
            ['label', 'Term'],
            ['key', 'Kod'],
            ['requirementCount', 'Underlag'],
            ['isActive', 'Aktiv'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSort(key as SortKey)}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
            >
              {label}
              {renderSortIcon(sort.key === key, sort.dir)}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span className="text-gray-400">Filtrera:</span>
          <select
            className="border rounded-full px-2.5 py-1 bg-white"
            value={activeFilter}
            onChange={(event) => setActiveFilter(event.target.value)}
          >
            <option value="">Aktiv</option>
            <option value="active">Endast aktiva</option>
            <option value="inactive">Endast inaktiva</option>
          </select>
        </div>

        {loading ? (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
            Laddar renoveringstyper...
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
            Inga renoveringstyper hittades.
          </div>
        ) : (
          <div className="mt-5 space-y-2 overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-y-2 text-[11px]">
              <thead>
                <tr className="whitespace-nowrap text-left text-[10px] uppercase text-gray-400">
                  <th className="w-[22%] px-3 py-1">Term</th>
                  <th className="w-[14%] px-3 py-1">Kod</th>
                  <th className="w-[28%] px-3 py-1">Beskrivning</th>
                  <th className="w-[10%] px-3 py-1">Underlag</th>
                  <th className="w-[8%] px-3 py-1">Aktiv</th>
                  <th className="w-[18%] px-3 py-1 text-center">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => {
                  const documentsOpen = documentsActionId === item.id
                  const questionsOpen = questionsActionId === item.id
                  const participantRolesOpen = participantRolesActionId === item.id
                  const requirementCount = requirementCountByActionId[item.id] ?? 0
                  const questionCount = questionCountByActionId[item.id] ?? 0
                  return (
                    <tr key={item.id} className="group transition-colors hover:bg-blue-50">
                      <td className="rounded-l-xl border border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate font-medium text-gray-900">{item.label}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{item.key}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{item.description || '-'}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{requirementCount}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{item.isActive ? 'Ja' : 'Nej'}</div>
                      </td>
                      <td className="rounded-r-xl border border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="grid grid-cols-3 gap-1 whitespace-nowrap text-[11px]">
                          <button
                            type="button"
                            onClick={() =>
                              setQuestionsActionId((current) => (current === item.id ? null : item.id))
                            }
                            className={`w-full rounded-md border ${
                              questionsOpen
                                ? 'border-sky-300 bg-sky-100 text-sky-900'
                                : 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100'
                            }`}
                          >
                            Frågor
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDocumentsActionId((current) => (current === item.id ? null : item.id))
                            }
                            className={`w-full rounded-md border ${
                              documentsOpen
                                ? 'border-blue-300 bg-blue-100 text-blue-900'
                                : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                            }`}
                          >
                            Underlag
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setParticipantRolesActionId((current) => (current === item.id ? null : item.id))
                            }
                            className={`w-full rounded-md border ${
                              participantRolesOpen
                                ? 'border-violet-300 bg-violet-100 text-violet-900'
                                : 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100'
                            }`}
                          >
                            Medverkande
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="w-full rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          >
                            Editera
                          </button>
                          <button
                            type="button"
                            onClick={() => openDuplicateModal(item)}
                            className="w-full rounded-md border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          >
                            Duplicera
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteActionType(item)}
                            disabled={deletingActionId === item.id}
                            className="w-full rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          >
                            {deletingActionId === item.id ? 'Raderar...' : 'Radera'}
                          </button>
                        </div>
                        <div className="mt-2 text-[10px] text-gray-500">
                          {questionCount} frågor, {requirementCount} underlag
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {documentsAction ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-6xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  Underlag för {documentsAction.label}
                </h3>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Underlagstyperna nedan styr vilket underlag som ska samlas in för den här renoveringstypen.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm text-stone-600">
                  {documentsChips.length} aktiva underlagstyper
                </div>
                <button
                  type="button"
                  onClick={() => setDocumentsActionId(null)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {documentsChips.length > 0 ? (
                documentsChips.map((documentType) => {
                  const draft = getRequirementDraft(documentsAction.id, documentType.id)
                  return (
                    <span
                      key={documentType.id}
                      className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-800"
                    >
                      {documentType.label}
                      {draft?.isRequired ? ' • obligatorisk' : ''}
                    </span>
                  )
                })
              ) : (
                <span className="rounded-full border border-dashed border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500">
                  Inga underlagstyper valda än
                </span>
              )}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Underlagstyp</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Aktivt</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Obligatoriskt</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Sortering</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Notering</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Åtgärd</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDocumentTypes.map((documentType) => {
                    const draft = getRequirementDraft(documentsAction.id, documentType.id)
                    if (!draft) return null
                    const draftKey = `${documentsAction.id}:${documentType.id}`

                    return (
                      <tr key={draftKey} className="border-t border-stone-200">
                        <td className="px-3 py-4 align-top">
                          <div className="font-medium text-stone-900">{documentType.label}</div>
                          {documentType.description ? (
                            <div className="mt-1 text-xs text-stone-600">{documentType.description}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-4 align-top">
                          <input
                            type="checkbox"
                            checked={draft.isEnabled}
                            onChange={(event) =>
                              updateRequirementDraft(
                                documentsAction.id,
                                documentType.id,
                                'isEnabled',
                                event.target.checked
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-4 align-top">
                          <select
                            value={draft.isRequired ? 'required' : 'optional'}
                            onChange={(event) =>
                              updateRequirementDraft(
                                documentsAction.id,
                                documentType.id,
                                'isRequired',
                                event.target.value === 'required'
                              )
                            }
                            disabled={!draft.isEnabled}
                            className="rounded-xl border border-stone-300 px-3 py-2 text-sm disabled:bg-stone-100"
                          >
                            <option value="required">Ja</option>
                            <option value="optional">Nej</option>
                          </select>
                        </td>
                        <td className="px-3 py-4 align-top">
                          <input
                            value={draft.sortOrder}
                            onChange={(event) =>
                              updateRequirementDraft(
                                documentsAction.id,
                                documentType.id,
                                'sortOrder',
                                event.target.value
                              )
                            }
                            disabled={!draft.isEnabled}
                            className="w-28 rounded-xl border border-stone-300 px-3 py-2 text-sm disabled:bg-stone-100"
                          />
                        </td>
                        <td className="px-3 py-4 align-top">
                          <input
                            value={draft.note}
                            onChange={(event) =>
                              updateRequirementDraft(
                                documentsAction.id,
                                documentType.id,
                                'note',
                                event.target.value
                              )
                            }
                            disabled={!draft.isEnabled}
                            className="w-full min-w-[240px] rounded-xl border border-stone-300 px-3 py-2 text-sm disabled:bg-stone-100"
                            placeholder="Kort hjälptext eller specialkrav"
                          />
                        </td>
                        <td className="px-3 py-4 align-top">
                          <button
                            type="button"
                            onClick={() => void saveRequirement(documentsAction.id, documentType.id)}
                            disabled={savingRequirementKey === draftKey}
                            className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100 disabled:opacity-60"
                          >
                            {savingRequirementKey === draftKey ? 'Sparar...' : 'Spara'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {participantRolesAction ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-6xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  Medverkande för {participantRolesAction.label}
                </h3>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Styr vilka entreprenörer och konsulter som normalt krävs för den här renoveringstypen.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm text-stone-600">
                  {participantRoleChips.length} aktiva medverkandetyper
                </div>
                <button
                  type="button"
                  onClick={() => setParticipantRolesActionId(null)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  StÃ¤ng
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {participantRoleChips.length > 0 ? (
                participantRoleChips.map((participantRole) => {
                  const draft =
                    participantRoleDrafts[`${participantRolesAction.id}:${participantRole.id}`]
                  return (
                    <span
                      key={participantRole.id}
                      className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-800"
                    >
                      {participantRole.label}
                      {draft?.isRequired ? ' • obligatorisk' : ''}
                    </span>
                  )
                })
              ) : (
                <span className="rounded-full border border-dashed border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500">
                  Inga medverkande valda än
                </span>
              )}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Medverkande</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Aktiv</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Obligatorisk</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Sortering</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Åtgärd</th>
                  </tr>
                </thead>
                <tbody>
                  {activeParticipantRoles.map((participantRole) => {
                    const draftKey = `${participantRolesAction.id}:${participantRole.id}`
                    const draft = participantRoleDrafts[draftKey]
                    if (!draft) return null

                    return (
                      <tr key={draftKey} className="border-t border-stone-200">
                        <td className="px-3 py-4 align-top">
                          <div className="font-medium text-stone-900">{participantRole.label}</div>
                          <div className="mt-1 text-xs text-stone-600">
                            {participantRole.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'}
                            {participantRole.description ? ` • ${participantRole.description}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-4 align-top">
                          <input
                            type="checkbox"
                            checked={draft.isEnabled}
                            onChange={(event) =>
                              updateParticipantRoleDraft(
                                participantRolesAction.id,
                                participantRole.id,
                                'isEnabled',
                                event.target.checked
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-4 align-top">
                          <select
                            value={draft.isRequired ? 'required' : 'optional'}
                            onChange={(event) =>
                              updateParticipantRoleDraft(
                                participantRolesAction.id,
                                participantRole.id,
                                'isRequired',
                                event.target.value === 'required'
                              )
                            }
                            disabled={!draft.isEnabled}
                            className="rounded-xl border border-stone-300 px-3 py-2 text-sm disabled:bg-stone-100"
                          >
                            <option value="required">Ja</option>
                            <option value="optional">Nej</option>
                          </select>
                        </td>
                        <td className="px-3 py-4 align-top">
                          <input
                            value={draft.sortOrder}
                            onChange={(event) =>
                              updateParticipantRoleDraft(
                                participantRolesAction.id,
                                participantRole.id,
                                'sortOrder',
                                event.target.value
                              )
                            }
                            disabled={!draft.isEnabled}
                            className="w-28 rounded-xl border border-stone-300 px-3 py-2 text-sm disabled:bg-stone-100"
                          />
                        </td>
                        <td className="px-3 py-4 align-top">
                          <button
                            type="button"
                            onClick={() =>
                              void saveActionParticipantRole(participantRolesAction.id, participantRole.id)
                            }
                            disabled={savingParticipantRoleKey === draftKey}
                            className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100 disabled:opacity-60"
                          >
                            {savingParticipantRoleKey === draftKey ? 'Sparar...' : 'Spara'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {questionsAction ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-6xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  Frågor för {questionsAction.label}
                </h3>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Välj vilka frågor som ska ställas när den här renoveringstypen används i apply.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm text-stone-600">
                  {questionChips.length} aktiva frågor
                </div>
                <button
                  type="button"
                  onClick={() => setQuestionsActionId(null)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {questionChips.length > 0 ? (
                questionChips.map((question) => {
                  const draft = questionDrafts[`${questionsAction.id}:${question.id}`]
                  return (
                    <span
                      key={question.id}
                      className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-800"
                    >
                      {question.label}
                      {draft?.isRequired ? ' • obligatorisk' : ''}
                    </span>
                  )
                })
              ) : (
                <span className="rounded-full border border-dashed border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500">
                  Inga frågor valda ännu
                </span>
              )}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Fråga</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Aktiv</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Obligatorisk</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Sortering</th>
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Åtgärd</th>
                  </tr>
                </thead>
                <tbody>
                  {activeQuestions.map((question) => {
                    const draftKey = `${questionsAction.id}:${question.id}`
                    const draft = questionDrafts[draftKey]
                    if (!draft) return null

                    return (
                      <tr key={draftKey} className="border-t border-stone-200">
                        <td className="px-3 py-4 align-top">
                          <div className="font-medium text-stone-900">{question.label}</div>
                          {question.helpText ? (
                            <div className="mt-1 text-xs text-stone-600">{question.helpText}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-4 align-top">
                          <input
                            type="checkbox"
                            checked={draft.isEnabled}
                            onChange={(event) =>
                              updateQuestionDraft(
                                questionsAction.id,
                                question.id,
                                'isEnabled',
                                event.target.checked
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-4 align-top">
                          <select
                            value={draft.isRequired ? 'required' : 'optional'}
                            onChange={(event) =>
                              updateQuestionDraft(
                                questionsAction.id,
                                question.id,
                                'isRequired',
                                event.target.value === 'required'
                              )
                            }
                            disabled={!draft.isEnabled}
                            className="rounded-xl border border-stone-300 px-3 py-2 text-sm disabled:bg-stone-100"
                          >
                            <option value="required">Ja</option>
                            <option value="optional">Nej</option>
                          </select>
                        </td>
                        <td className="px-3 py-4 align-top">
                          <input
                            value={draft.sortOrder}
                            onChange={(event) =>
                              updateQuestionDraft(
                                questionsAction.id,
                                question.id,
                                'sortOrder',
                                event.target.value
                              )
                            }
                            disabled={!draft.isEnabled}
                            className="w-28 rounded-xl border border-stone-300 px-3 py-2 text-sm disabled:bg-stone-100"
                          />
                        </td>
                        <td className="px-3 py-4 align-top">
                          <button
                            type="button"
                            onClick={() => void saveActionQuestion(questionsAction.id, question.id)}
                            disabled={savingQuestionKey === draftKey}
                            className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100 disabled:opacity-60"
                          >
                            {savingQuestionKey === draftKey ? 'Sparar...' : 'Spara'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {actionModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  {actionDraft.id ? 'Redigera renoveringstyp' : 'Ny renoveringstyp'}
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  Ändra grunddata här. Frågor och underlag hanteras via respektive knappar på raden.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActionModalOpen(false)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => void saveActionType()}
                  disabled={savingActionKey === (actionDraft.id ?? 'new')}
                  className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
                >
                  {savingActionKey === (actionDraft.id ?? 'new') ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Visningsnamn</span>
                <input
                  value={actionDraft.label}
                  onChange={(event) =>
                    setActionDraft((current) => ({ ...current, label: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Intern nyckel</span>
                <input
                  value={generatedActionKey}
                  readOnly
                  className="w-full rounded-2xl border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-700"
                />
                <div className="mt-2 text-xs text-stone-500">
                  Nyckeln genereras automatiskt från visningsnamnet.
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering</span>
                <input
                  value={actionDraft.sortOrder}
                  onChange={(event) =>
                    setActionDraft((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={actionDraft.isActive}
                  onChange={(event) =>
                    setActionDraft((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                Aktiv
              </label>

              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Beskrivning</span>
                <textarea
                  value={actionDraft.description}
                  onChange={(event) =>
                    setActionDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={4}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
