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

type ActionTypeGroup = {
  actionType: ActionTypeItem
  requirements: RequirementItem[]
}

type DraftRequirementState = {
  isEnabled: boolean
  isRequired: boolean
  note: string
  sortOrder: string
}

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

export default function RenoAppActionTypesAdminPage() {
  const [items, setItems] = useState<ActionTypeItem[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeItem[]>([])
  const [requirementDrafts, setRequirementDrafts] = useState<Record<string, DraftRequirementState>>(
    {}
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [savingActionKey, setSavingActionKey] = useState<string | null>(null)
  const [savingRequirementKey, setSavingRequirementKey] = useState<string | null>(null)
  const [actionModalOpen, setActionModalOpen] = useState(false)
  const [actionDraft, setActionDraft] = useState<DraftActionType>(EMPTY_DRAFT)
  const [documentsActionId, setDocumentsActionId] = useState<string | null>(null)

  const generatedActionKey =
    actionDraft.id && actionDraft.key ? actionDraft.key : slugifyActionTypeKey(actionDraft.label)

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const [actionResponse, requirementResponse] = await Promise.all([
          fetch('/api/renoapp/admin/action-types', { cache: 'no-store' }),
          fetch('/api/renoapp/admin/requirements', { cache: 'no-store' }),
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

        if (!actionResponse.ok) {
          throw new Error(actionPayload.error ?? 'Kunde inte lasa renoveringstyper.')
        }

        if (!requirementResponse.ok) {
          throw new Error(requirementPayload.error ?? 'Kunde inte lasa dokumentkrav.')
        }

        if (!active) return

        const nextItems = [...(actionPayload.items ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
        const nextDocumentTypes = [...(requirementPayload.documentTypes ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )

        const nextRequirementDrafts: Record<string, DraftRequirementState> = {}
        for (const actionType of nextItems) {
          const group = (requirementPayload.actionTypes ?? []).find(
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
        }

        setItems(nextItems)
        setDocumentTypes(nextDocumentTypes)
        setRequirementDrafts(nextRequirementDrafts)
        setDocumentsActionId((current) =>
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
    if (!normalizedQuery) return items

    return items.filter((item) =>
      [item.label, item.key, item.description ?? '', item.isActive ? 'aktiv' : 'inaktiv']
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    )
  }, [items, query])

  const activeDocumentTypes = useMemo(
    () => documentTypes.filter((documentType) => documentType.isActive),
    [documentTypes]
  )

  const documentsAction = documentsActionId
    ? items.find((item) => item.id === documentsActionId) ?? null
    : null

  const documentsChips = useMemo(() => {
    if (!documentsActionId) return []
    return activeDocumentTypes.filter(
      (documentType) => requirementDrafts[`${documentsActionId}:${documentType.id}`]?.isEnabled
    )
  }, [activeDocumentTypes, documentsActionId, requirementDrafts])

  const getRequirementDraft = (actionTypeId: string, documentTypeId: string) =>
    requirementDrafts[`${actionTypeId}:${documentTypeId}`]

  const countEnabledRequirements = (actionTypeId: string) =>
    activeDocumentTypes.reduce(
      (count, documentType) =>
        getRequirementDraft(actionTypeId, documentType.id)?.isEnabled ? count + 1 : count,
      0
    )

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

        {loading ? (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
            Laddar renoveringstyper...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
            Inga renoveringstyper hittades.
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500">
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Titel</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Nyckel</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Beskrivning</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Aktiv</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const documentsOpen = documentsActionId === item.id
                  return (
                    <tr key={item.id} className="border-t border-stone-200">
                      <td className="px-3 py-4 align-top">
                        <div className="font-medium text-stone-900">{item.label}</div>
                      </td>
                      <td className="px-3 py-4 align-top text-stone-700">{item.key}</td>
                      <td className="px-3 py-4 align-top text-stone-700">
                        <div className="max-w-[520px] truncate">{item.description || '-'}</div>
                      </td>
                      <td className="px-3 py-4 align-top text-stone-700">
                        {item.isActive ? 'Ja' : 'Nej'}
                      </td>
                      <td className="px-3 py-4 align-top">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setDocumentsActionId((current) => (current === item.id ? null : item.id))
                            }
                            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                              documentsOpen
                                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                : 'border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50'
                            }`}
                          >
                            Dokument
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                          >
                            Editera
                          </button>
                          <button
                            type="button"
                            onClick={() => openDuplicateModal(item)}
                            className="rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-50"
                          >
                            Duplicera
                          </button>
                        </div>
                        <div className="mt-2 text-xs text-stone-500">
                          {countEnabledRequirements(item.id)} dokument kopplade
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
                  Dokumentkrav för {documentsAction.label}
                </h3>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Dokumenttyperna nedan fungerar som RenoApps motsvarighet till chips.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm text-stone-600">
                  {documentsChips.length} aktiva dokumenttyper
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
                  Inga dokumenttyper valda ännu
                </span>
              )}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th className="px-3 py-3 font-semibold uppercase tracking-[0.16em]">Dokumenttyp</th>
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

      {actionModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  {actionDraft.id ? 'Redigera renoveringstyp' : 'Ny renoveringstyp'}
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  Ändra grunddata här. Dokumentkraven hanteras via knappen `Dokument` på respektive rad.
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
