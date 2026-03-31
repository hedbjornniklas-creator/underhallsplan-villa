'use client'

import { useEffect, useMemo, useState } from 'react'

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

type QuestionOptionTriggerItem = {
  id: string
  triggerType: 'question' | 'document'
  questionId: string | null
  questionLabel: string | null
  documentTypeId: string | null
  documentTypeLabel: string | null
  sortOrder: number
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

type DraftQuestion = {
  id?: string
  key: string
  label: string
  helpText: string
  responseType: QuestionItem['responseType']
  sortOrder: string
  isLocked: boolean
  isActive: boolean
}

type DraftOption = {
  id?: string
  key: string
  label: string
  description: string
  sortOrder: string
  isActive: boolean
  triggeredQuestionIds: string[]
  triggeredDocumentTypeIds: string[]
}

type SortKey = 'label' | 'key' | 'responseType' | 'optionCount' | 'isActive'
type OptionsModalMode = 'options' | 'rules'

const EMPTY_QUESTION: DraftQuestion = {
  key: '',
  label: '',
  helpText: '',
  responseType: 'single_select',
  sortOrder: '100',
  isLocked: false,
  isActive: true,
}

function slugifyQuestionKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function renderSortIcon(active: boolean, dir: 'asc' | 'desc') {
  if (!active) return <span className="text-gray-300">{'\u25c7'}</span>
  return <span className="text-gray-500">{dir === 'asc' ? '\u2191' : '\u2193'}</span>
}

function labelForResponseType(value: QuestionItem['responseType']) {
  switch (value) {
    case 'multi_select':
      return 'Flerval'
    case 'boolean':
      return 'Ja/Nej'
    default:
      return 'Envalslista'
  }
}

function createDraftFromQuestion(item: QuestionItem): DraftQuestion {
  return {
    id: item.id,
    key: item.key,
    label: item.label,
    helpText: item.helpText ?? '',
    responseType: item.responseType,
    sortOrder: String(item.sortOrder),
    isLocked: item.isLocked,
    isActive: item.isActive,
  }
}

function createOptionDrafts(item: QuestionItem): DraftOption[] {
  return item.options.map((option) => ({
    id: option.id,
    key: option.key,
    label: option.label,
    description: option.description ?? '',
    sortOrder: String(option.sortOrder),
    isActive: option.isActive,
    triggeredQuestionIds: option.triggers
      .filter((trigger) => trigger.triggerType === 'question' && trigger.questionId)
      .map((trigger) => trigger.questionId as string),
    triggeredDocumentTypeIds: option.triggers
      .filter((trigger) => trigger.triggerType === 'document' && trigger.documentTypeId)
      .map((trigger) => trigger.documentTypeId as string),
  }))
}

export default function RenoAppQuestionsAdminPage() {
  const [items, setItems] = useState<QuestionItem[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [responseTypeFilter, setResponseTypeFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'label',
    dir: 'asc',
  })
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [questionModalOpen, setQuestionModalOpen] = useState(false)
  const [questionDraft, setQuestionDraft] = useState<DraftQuestion>(EMPTY_QUESTION)
  const [optionsQuestionId, setOptionsQuestionId] = useState<string | null>(null)
  const [optionsModalMode, setOptionsModalMode] = useState<OptionsModalMode>('options')
  const [optionDrafts, setOptionDrafts] = useState<DraftOption[]>([])

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const [questionsResponse, documentTypesResponse] = await Promise.all([
          fetch('/api/renoapp/admin/questions', { cache: 'no-store' }),
          fetch('/api/renoapp/admin/document-types', { cache: 'no-store' }),
        ])

        const questionsPayload = (await questionsResponse.json().catch(() => ({}))) as {
          items?: QuestionItem[]
          error?: string
        }
        const documentTypesPayload = (await documentTypesResponse.json().catch(() => ({}))) as {
          items?: DocumentTypeItem[]
          error?: string
        }

        if (!questionsResponse.ok) {
          throw new Error(questionsPayload.error ?? 'Kunde inte lasa fragor.')
        }

        if (!documentTypesResponse.ok) {
          throw new Error(documentTypesPayload.error ?? 'Kunde inte lasa dokumenttyper.')
        }

        if (!active) return
        setItems(questionsPayload.items ?? [])
        setDocumentTypes(documentTypesPayload.items ?? [])
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte lasa fragor.')
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

  const sortedItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = items.filter((item) => {
      const haystack = [
        item.label,
        item.key,
        item.helpText ?? '',
        labelForResponseType(item.responseType),
        ...item.options.map((option) => `${option.label} ${option.key}`),
      ]
        .join(' ')
        .toLowerCase()

      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false
      if (activeFilter === 'active' && !item.isActive) return false
      if (activeFilter === 'inactive' && item.isActive) return false
      if (responseTypeFilter && item.responseType !== responseTypeFilter) return false
      return true
    })

    return [...filtered].sort((left, right) => {
      let comparison = 0

      switch (sort.key) {
        case 'key':
          comparison = left.key.localeCompare(right.key, 'sv')
          break
        case 'responseType':
          comparison = labelForResponseType(left.responseType).localeCompare(
            labelForResponseType(right.responseType),
            'sv'
          )
          break
        case 'optionCount':
          comparison = left.options.length - right.options.length
          break
        case 'isActive':
          comparison = Number(left.isActive) - Number(right.isActive)
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
  }, [activeFilter, items, query, responseTypeFilter, sort])

  const optionsQuestion = optionsQuestionId
    ? items.find((item) => item.id === optionsQuestionId) ?? null
    : null

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )
  }

  const saveBundle = async (
    draft: DraftQuestion,
    options: DraftOption[],
    stateKey: string
  ) => {
    setSavingKey(stateKey)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: {
            id: draft.id,
            key: draft.key || slugifyQuestionKey(draft.label),
            label: draft.label,
            helpText: draft.helpText,
            responseType: draft.responseType,
            sortOrder: Number(draft.sortOrder || '100'),
            isLocked: draft.isLocked,
            isActive: draft.isActive,
            metadata: {},
          },
          options: options.map((option) => ({
            id: option.id,
            key: option.key || slugifyQuestionKey(option.label),
            label: option.label,
            description: option.description,
            sortOrder: Number(option.sortOrder || '100'),
            isActive: option.isActive,
            metadata: {},
            triggers: [
              ...option.triggeredQuestionIds.map((questionId, index) => ({
                triggerType: 'question' as const,
                questionId,
                sortOrder: (index + 1) * 10,
                isActive: true,
              })),
              ...option.triggeredDocumentTypeIds.map((documentTypeId, index) => ({
                triggerType: 'document' as const,
                documentTypeId,
                sortOrder: (option.triggeredQuestionIds.length + index + 1) * 10,
                isActive: true,
              })),
            ],
          })),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        item?: QuestionItem
        error?: string
      }

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Kunde inte spara fraga.')
      }

      const saved = payload.item
      setItems((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort(
          (left, right) =>
            left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
      )

      if (optionsQuestionId === saved.id) {
        setOptionsQuestionId(saved.id)
        setOptionDrafts(createOptionDrafts(saved))
      }

      return saved
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara fraga.')
      return null
    } finally {
      setSavingKey(null)
    }
  }

  const openNewQuestionModal = () => {
    setQuestionDraft(EMPTY_QUESTION)
    setQuestionModalOpen(true)
  }

  const openEditQuestionModal = (item: QuestionItem) => {
    setQuestionDraft(createDraftFromQuestion(item))
    setQuestionModalOpen(true)
  }

  const openOptionsModal = (item: QuestionItem, mode: OptionsModalMode = 'options') => {
    setOptionsQuestionId(item.id)
    setOptionsModalMode(mode)
    setOptionDrafts(createOptionDrafts(item))
  }

  const saveQuestionOnly = async () => {
    const existing = questionDraft.id ? items.find((item) => item.id === questionDraft.id) ?? null : null
    const saved = await saveBundle(
      questionDraft,
      existing ? createOptionDrafts(existing) : [],
      questionDraft.id ?? 'new-question'
    )
    if (saved) setQuestionModalOpen(false)
  }

  const saveOptions = async () => {
    if (!optionsQuestion) return
    const saved = await saveBundle(
      createDraftFromQuestion(optionsQuestion),
      optionDrafts,
      `options:${optionsQuestion.id}`
    )
    if (saved) {
      setOptionsQuestionId(saved.id)
      setOptionDrafts(createOptionDrafts(saved))
    }
  }

  const deleteItem = async (item: QuestionItem) => {
    if (!window.confirm(`Radera fragan "${item.label}"?`)) return

    setDeletingId(item.id)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/questions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera fraga.')
      }

      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      setOptionsQuestionId((current) => (current === item.id ? null : current))
      if (questionModalOpen && questionDraft.id === item.id) {
        setQuestionModalOpen(false)
        setQuestionDraft(EMPTY_QUESTION)
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera fraga.')
    } finally {
      setDeletingId(null)
    }
  }

  const generatedQuestionKey =
    questionDraft.id && questionDraft.key ? questionDraft.key : slugifyQuestionKey(questionDraft.label)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-8 md:px-6 md:pb-10">
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl bg-white p-4 shadow">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Frågebank</h2>
            <div className="text-xs text-gray-500">renoapp_apply_questions</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Sök..."
              className="border rounded px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={openNewQuestionModal}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white"
            >
              + Ny
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="text-gray-400">Sortera:</span>
            {[
              ['label', 'Term'],
              ['key', 'Kod'],
              ['responseType', 'Svarstyp'],
              ['optionCount', 'Svar'],
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

          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="text-gray-400">Filtrera:</span>
            <select
              className="border rounded-full px-2.5 py-1 bg-white"
              value={responseTypeFilter}
              onChange={(event) => setResponseTypeFilter(event.target.value)}
            >
              <option value="">Svarstyp</option>
              <option value="single_select">Envalslista</option>
              <option value="multi_select">Flerval</option>
              <option value="boolean">Ja/Nej</option>
            </select>
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

          <div className="space-y-2">
            <table className="w-full table-fixed border-separate border-spacing-y-2 text-[11px]">
              <thead>
                <tr className="whitespace-nowrap text-left text-[10px] uppercase text-gray-400">
                  <th className="w-[28%] px-3 py-1">Term</th>
                  <th className="w-[18%] px-3 py-1">Kod</th>
                  <th className="w-[14%] px-3 py-1">Svarstyp</th>
                  <th className="w-[8%] px-3 py-1">Svar</th>
                  <th className="w-[6%] px-3 py-1">Aktiv</th>
                  <th className="w-[22%] px-3 py-1 text-center">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="py-4 text-xs text-gray-500" colSpan={6}>
                      Laddar frågor...
                    </td>
                  </tr>
                ) : sortedItems.length === 0 ? (
                  <tr>
                    <td className="py-4 text-xs text-gray-500" colSpan={6}>
                      Inga rader.
                    </td>
                  </tr>
                ) : (
                  sortedItems.map((item) => (
                    <tr key={item.id} className="group transition-colors hover:bg-blue-50">
                      <td className="rounded-l-xl border border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate font-medium text-gray-900">{item.label}</div>
                        <div className="truncate text-[10px] text-gray-500">{item.helpText || '-'}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{item.key}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        {labelForResponseType(item.responseType)}
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        {item.options.length}
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        {item.isActive ? 'Ja' : 'Nej'}
                      </td>
                      <td className="rounded-r-xl border border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="grid grid-cols-4 gap-1 whitespace-nowrap text-[11px]">
                          <button
                            type="button"
                            onClick={() => openOptionsModal(item, 'options')}
                            className="w-full rounded-md border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
                          >
                            Svar
                          </button>
                          <button
                            type="button"
                            onClick={() => openOptionsModal(item, 'rules')}
                            className="w-full rounded-md border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          >
                            Regler
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditQuestionModal(item)}
                            className="w-full rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          >
                            Editera
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteItem(item)}
                            disabled={deletingId === item.id}
                            className="w-full rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          >
                            {deletingId === item.id ? 'Raderar...' : 'Radera'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {questionModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {questionDraft.id ? 'Redigera fråga' : 'Ny fråga'}
                </h3>
                {generatedQuestionKey ? (
                  <div className="mt-1 text-xs text-gray-500">Kod: {generatedQuestionKey}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuestionModalOpen(false)}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => void saveQuestionOnly()}
                  disabled={savingKey === (questionDraft.id ?? 'new-question')}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingKey === (questionDraft.id ?? 'new-question') ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Frågetext</div>
                <input
                  value={questionDraft.label}
                  onChange={(event) =>
                    setQuestionDraft((current) => ({ ...current, label: event.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Intern nyckel</div>
                <input
                  value={generatedQuestionKey}
                  readOnly
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Svarstyp</div>
                <select
                  value={questionDraft.responseType}
                  onChange={(event) =>
                    setQuestionDraft((current) => ({
                      ...current,
                      responseType: event.target.value as DraftQuestion['responseType'],
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="single_select">Envalslista</option>
                  <option value="multi_select">Flerval</option>
                  <option value="boolean">Ja/Nej</option>
                </select>
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Sortering</div>
                <input
                  value={questionDraft.sortOrder}
                  onChange={(event) =>
                    setQuestionDraft((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <div className="text-xs font-medium text-gray-600">Hjälptext</div>
                <textarea
                  value={questionDraft.helpText}
                  onChange={(event) =>
                    setQuestionDraft((current) => ({ ...current, helpText: event.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={questionDraft.isLocked}
                  onChange={(event) =>
                    setQuestionDraft((current) => ({ ...current, isLocked: event.target.checked }))
                  }
                />
                Låst
              </label>
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={questionDraft.isActive}
                  onChange={(event) =>
                    setQuestionDraft((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                Aktiv
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {optionsQuestion ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-xl bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {optionsModalMode === 'rules'
                    ? `Regler för svar - ${optionsQuestion.label}`
                    : `Svarsalternativ - ${optionsQuestion.label}`}
                </h3>
                <div className="mt-1 text-xs text-gray-500">{optionsQuestion.key}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOptionsQuestionId(null)}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Stäng
                </button>
                {optionsModalMode === 'options' ? (
                  <button
                    type="button"
                    onClick={() =>
                      setOptionDrafts((current) => [
                        ...current,
                        {
                          key: '',
                          label: '',
                          description: '',
                          sortOrder: String(current.length * 10 + 10),
                          isActive: true,
                          triggeredQuestionIds: [],
                          triggeredDocumentTypeIds: [],
                        },
                      ])
                    }
                    className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-800 hover:bg-blue-100"
                  >
                    + Nytt svar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void saveOptions()}
                  disabled={savingKey === `options:${optionsQuestion.id}`}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingKey === `options:${optionsQuestion.id}` ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {optionDrafts.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                  {optionsModalMode === 'rules'
                    ? 'Skapa först minst ett svarsalternativ innan du kopplar regler.'
                    : 'Inga svarsalternativ ännu.'}
                </div>
              ) : (
                optionDrafts.map((option, index) => {
                  const generatedOptionKey =
                    option.key || slugifyQuestionKey(option.label)

                  if (optionsModalMode === 'rules') {
                    return (
                      <div
                        key={option.id ?? `option-${index}`}
                        className="grid gap-3 rounded-md border border-gray-200 p-3 md:grid-cols-[280px_1fr]"
                      >
                        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                          <div className="font-medium text-gray-900">
                            {option.label.trim() || `Svar ${index + 1}`}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {option.description.trim() || 'Ingen beskrivning ännu.'}
                          </div>
                          <div className="mt-3 text-xs text-gray-600">
                            {option.triggeredQuestionIds.length} följdfrågor,{' '}
                            {option.triggeredDocumentTypeIds.length} underlag
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1">
                            <div className="text-xs font-medium text-gray-600">Följdfrågor</div>
                            <select
                              multiple
                              value={option.triggeredQuestionIds}
                              onChange={(event) => {
                                const values = Array.from(event.target.selectedOptions)
                                  .map((selectedOption) => selectedOption.value)
                                  .filter(Boolean)
                                setOptionDrafts((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, triggeredQuestionIds: values } : item
                                  )
                                )
                              }}
                              className="min-h-32 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                              {items
                                .filter((question) => question.id !== optionsQuestion.id)
                                .map((question) => (
                                  <option key={question.id} value={question.id}>
                                    {question.label}
                                  </option>
                                ))}
                            </select>
                          </label>

                          <label className="space-y-1">
                            <div className="text-xs font-medium text-gray-600">Underlag</div>
                            <select
                              multiple
                              value={option.triggeredDocumentTypeIds}
                              onChange={(event) => {
                                const values = Array.from(event.target.selectedOptions)
                                  .map((selectedOption) => selectedOption.value)
                                  .filter(Boolean)
                                setOptionDrafts((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, triggeredDocumentTypeIds: values }
                                      : item
                                  )
                                )
                              }}
                              className="min-h-32 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                              {documentTypes
                                .filter((documentType) => documentType.isActive)
                                .map((documentType) => (
                                  <option key={documentType.id} value={documentType.id}>
                                    {documentType.label}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={option.id ?? `option-${index}`}
                      className="grid gap-3 rounded-md border border-gray-200 p-3 md:grid-cols-[1.1fr_1fr_120px_120px_auto]"
                    >
                      <div className="space-y-2">
                        <input
                          value={option.label}
                          onChange={(event) =>
                            setOptionDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, label: event.target.value } : item
                              )
                            )
                          }
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Svarsalternativ"
                        />
                        <input
                          value={option.description}
                          onChange={(event) =>
                            setOptionDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, description: event.target.value }
                                  : item
                              )
                            )
                          }
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Kort beskrivning"
                        />
                      </div>
                      <div className="space-y-2">
                        <input
                          value={generatedOptionKey}
                          readOnly
                          className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                        />
                        <div className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-500">
                          Nyckeln genereras från svarets etikett.
                        </div>
                      </div>
                      <input
                        value={option.sortOrder}
                        onChange={(event) =>
                          setOptionDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, sortOrder: event.target.value } : item
                            )
                          )
                        }
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Sortering"
                      />
                      <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={option.isActive}
                          onChange={(event) =>
                            setOptionDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, isActive: event.target.checked } : item
                              )
                            )
                          }
                        />
                        Aktivt
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setOptionDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                        }
                        className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100"
                      >
                        Ta bort
                      </button>

                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
