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

const NEW_ACTION_TYPE_ID = '__new__'

const EMPTY_ACTION_TYPE_DRAFT: DraftActionType = {
  key: '',
  label: '',
  description: '',
  sortOrder: '100',
  isActive: true,
}

export default function RenoAppActionTypesAdminPage() {
  const [items, setItems] = useState<ActionTypeItem[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftActionType>>({})
  const [requirementDrafts, setRequirementDrafts] = useState<Record<string, DraftRequirementState>>({})
  const [selectedActionTypeId, setSelectedActionTypeId] = useState<string | null>(null)
  const [newDraft, setNewDraft] = useState<DraftActionType>(EMPTY_ACTION_TYPE_DRAFT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingActionKey, setSavingActionKey] = useState<string | null>(null)
  const [savingRequirementKey, setSavingRequirementKey] = useState<string | null>(null)

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
          throw new Error(actionPayload.error ?? 'Kunde inte läsa renoveringstyper.')
        }

        if (!requirementResponse.ok) {
          throw new Error(requirementPayload.error ?? 'Kunde inte läsa dokumentkrav.')
        }

        if (!active) return

        const nextItems = [...(actionPayload.items ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
        const nextDocumentTypes = [...(requirementPayload.documentTypes ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
        const groups = requirementPayload.actionTypes ?? []

        const nextDrafts = Object.fromEntries(
          nextItems.map((item) => [
            item.id,
            {
              id: item.id,
              key: item.key,
              label: item.label,
              description: item.description ?? '',
              sortOrder: String(item.sortOrder),
              isActive: item.isActive,
            } satisfies DraftActionType,
          ])
        )

        const nextRequirementDrafts: Record<string, DraftRequirementState> = {}
        for (const actionType of nextItems) {
          const group = groups.find((candidate) => candidate.actionType.id === actionType.id)
          for (const documentType of nextDocumentTypes) {
            const requirement = group?.requirements.find((item) => item.documentTypeId === documentType.id)
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
        setDrafts(nextDrafts)
        setRequirementDrafts(nextRequirementDrafts)
        setSelectedActionTypeId((current) => {
          if (current === NEW_ACTION_TYPE_ID) return current
          if (current && nextItems.some((item) => item.id === current)) return current
          return nextItems[0]?.id ?? null
        })
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa RenoApp-adminen.')
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

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
      ),
    [items]
  )

  const selectedDraft =
    selectedActionTypeId === NEW_ACTION_TYPE_ID
      ? newDraft
      : selectedActionTypeId
        ? drafts[selectedActionTypeId] ?? null
        : null

  const enabledRequirementCount = (actionTypeId: string) =>
    documentTypes.reduce(
      (count, documentType) =>
        requirementDrafts[`${actionTypeId}:${documentType.id}`]?.isEnabled ? count + 1 : count,
      0
    )

  const activeRequirementBadges =
    selectedActionTypeId && selectedActionTypeId !== NEW_ACTION_TYPE_ID
      ? documentTypes
          .filter((documentType) => requirementDrafts[`${selectedActionTypeId}:${documentType.id}`]?.isEnabled)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
      : []

  const updateActionDraft = (
    id: string,
    field: keyof DraftActionType,
    value: string | boolean
  ) => {
    if (id === NEW_ACTION_TYPE_ID) {
      setNewDraft((current) => ({ ...current, [field]: value }))
      return
    }

    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [field]: value,
      },
    }))
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

  const saveActionType = async (draft: DraftActionType, stateKey: string) => {
    setSavingActionKey(stateKey)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/action-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draft.id,
          key: draft.key,
          label: draft.label,
          description: draft.description,
          sortOrder: Number(draft.sortOrder || '100'),
          isActive: draft.isActive,
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
      setDrafts((current) => ({
        ...current,
        [savedItem.id]: {
          id: savedItem.id,
          key: savedItem.key,
          label: savedItem.label,
          description: savedItem.description ?? '',
          sortOrder: String(savedItem.sortOrder),
          isActive: savedItem.isActive,
        },
      }))

      setRequirementDrafts((current) => {
        const next = { ...current }
        for (const documentType of documentTypes) {
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

      if (!draft.id) {
        setNewDraft(EMPTY_ACTION_TYPE_DRAFT)
      }
      setSelectedActionTypeId(savedItem.id)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara renoveringstyp.')
    } finally {
      setSavingActionKey(null)
    }
  }

  const saveRequirement = async (actionTypeId: string, documentTypeId: string) => {
    const key = `${actionTypeId}:${documentTypeId}`
    const draft = requirementDrafts[key]
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
      <section className="rounded-[28px] border border-stone-200/80 bg-white/90 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              RenoApp admin
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">
              Renoveringstyper och dokumentkrav
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-700">
              Renoveringstyperna fungerar som kontrollpunkter. Dokumentkraven fungerar som kopplade
              chips till varje vald typ.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedActionTypeId(NEW_ACTION_TYPE_ID)}
            className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
          >
            + Ny renoveringstyp
          </button>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="rounded-[28px] border border-stone-200/80 bg-white/92 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 px-2">
            <div>
              <h3 className="text-lg font-semibold text-stone-900">Renoveringstyper</h3>
              <p className="text-sm text-stone-600">Välj en typ för att redigera detaljer och chips.</p>
            </div>
            <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">
              {sortedItems.length} st
            </div>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setSelectedActionTypeId(NEW_ACTION_TYPE_ID)}
              className={`w-full rounded-[24px] border p-4 text-left transition ${
                selectedActionTypeId === NEW_ACTION_TYPE_ID
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-dashed border-stone-300 bg-stone-50 text-stone-900 hover:bg-stone-100'
              }`}
            >
              <div className="text-sm font-semibold">Ny renoveringstyp</div>
              <p className={`mt-2 text-sm leading-6 ${selectedActionTypeId === NEW_ACTION_TYPE_ID ? 'text-stone-100' : 'text-stone-600'}`}>
                Skapa en ny typ och spara den innan du börjar koppla dokument.
              </p>
            </button>

            {loading ? (
              <div className="rounded-[24px] border border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                Laddar renoveringstyper...
              </div>
            ) : (
              sortedItems.map((item) => {
                const active = selectedActionTypeId === item.id
                const requirementCount = enabledRequirementCount(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedActionTypeId(item.id)}
                    className={`w-full rounded-[24px] border p-4 text-left transition ${
                      active
                        ? 'border-stone-900 bg-stone-900 text-white shadow-sm'
                        : 'border-stone-200 bg-stone-50/70 text-stone-900 hover:border-stone-300 hover:bg-stone-100/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{item.label}</div>
                        <div className={`mt-1 text-xs uppercase tracking-[0.18em] ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                          {item.key}
                        </div>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          active
                            ? 'border-stone-600 bg-stone-800 text-stone-100'
                            : 'border-stone-300 bg-white text-stone-700'
                        }`}
                      >
                        {requirementCount} dokument
                      </span>
                    </div>
                    <p className={`mt-3 line-clamp-2 text-sm leading-6 ${active ? 'text-stone-100' : 'text-stone-600'}`}>
                      {item.description?.trim() || 'Ingen beskrivning ännu.'}
                    </p>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="space-y-6">
          <article className="rounded-[28px] border border-stone-200/80 bg-white/92 p-6 shadow-sm">
            {selectedDraft ? (
              <>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                      {selectedActionTypeId === NEW_ACTION_TYPE_ID ? 'Ny renoveringstyp' : 'Vald renoveringstyp'}
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-stone-900">
                      {selectedActionTypeId === NEW_ACTION_TYPE_ID
                        ? 'Skapa renoveringstyp'
                        : selectedDraft.label || 'Namnlös renoveringstyp'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void saveActionType(
                        selectedDraft,
                        selectedDraft.id ?? NEW_ACTION_TYPE_ID
                      )
                    }
                    disabled={savingActionKey === (selectedDraft.id ?? NEW_ACTION_TYPE_ID)}
                    className="rounded-full bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
                  >
                    {savingActionKey === (selectedDraft.id ?? NEW_ACTION_TYPE_ID) ? 'Sparar...' : 'Spara renoveringstyp'}
                  </button>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-stone-800">Visningsnamn</span>
                    <input
                      value={selectedDraft.label}
                      onChange={(event) =>
                        updateActionDraft(
                          selectedDraft.id ?? NEW_ACTION_TYPE_ID,
                          'label',
                          event.target.value
                        )
                      }
                      className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm"
                      placeholder="Till exempel Badrum"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-stone-800">Intern nyckel</span>
                    <input
                      value={selectedDraft.key}
                      onChange={(event) =>
                        updateActionDraft(
                          selectedDraft.id ?? NEW_ACTION_TYPE_ID,
                          'key',
                          event.target.value.toLowerCase()
                        )
                      }
                      className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm"
                      placeholder="Till exempel bathroom"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering</span>
                    <input
                      value={selectedDraft.sortOrder}
                      onChange={(event) =>
                        updateActionDraft(
                          selectedDraft.id ?? NEW_ACTION_TYPE_ID,
                          'sortOrder',
                          event.target.value
                        )
                      }
                      className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm"
                    />
                  </label>

                  <label className="flex items-center gap-3 rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedDraft.isActive}
                      onChange={(event) =>
                        updateActionDraft(
                          selectedDraft.id ?? NEW_ACTION_TYPE_ID,
                          'isActive',
                          event.target.checked
                        )
                      }
                    />
                    Aktiv
                  </label>

                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-stone-800">Beskrivning</span>
                    <textarea
                      value={selectedDraft.description}
                      onChange={(event) =>
                        updateActionDraft(
                          selectedDraft.id ?? NEW_ACTION_TYPE_ID,
                          'description',
                          event.target.value
                        )
                      }
                      rows={4}
                      className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm"
                      placeholder="Kort hjälptext som visas för boende."
                    />
                  </label>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                Välj en renoveringstyp till vänster för att börja redigera.
              </div>
            )}
          </article>

          <article className="rounded-[28px] border border-stone-200/80 bg-white/92 p-6 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                  Dokumentkrav
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-stone-900">
                  Kopplade dokumenttyper
                </h3>
                <p className="mt-2 text-sm leading-7 text-stone-700">
                  Varje aktiv dokumenttyp fungerar som ett chip på den valda renoveringstypen.
                </p>
              </div>
              {selectedActionTypeId && selectedActionTypeId !== NEW_ACTION_TYPE_ID ? (
                <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">
                  {activeRequirementBadges.length} aktiva chips
                </div>
              ) : null}
            </div>

            {selectedActionTypeId === NEW_ACTION_TYPE_ID ? (
              <div className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                Spara renoveringstypen först. Därefter kan du koppla dokumenttyper som chips.
              </div>
            ) : !selectedActionTypeId ? (
              <div className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                Välj en renoveringstyp först.
              </div>
            ) : (
              <>
                <div className="mt-5 flex flex-wrap gap-2">
                  {activeRequirementBadges.length > 0 ? (
                    activeRequirementBadges.map((documentType) => {
                      const draft = requirementDrafts[`${selectedActionTypeId}:${documentType.id}`]
                      return (
                        <span
                          key={documentType.id}
                          className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-800"
                        >
                          {documentType.label}
                          {draft?.isRequired ? ' • obligatorisk' : ' • valfri'}
                        </span>
                      )
                    })
                  ) : (
                    <span className="rounded-full border border-dashed border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500">
                      Inga dokumentkrav valda ännu
                    </span>
                  )}
                </div>

                <div className="mt-6 grid gap-4">
                  {documentTypes
                    .filter((documentType) => documentType.isActive)
                    .map((documentType) => {
                      const draftKey = `${selectedActionTypeId}:${documentType.id}`
                      const draft = requirementDrafts[draftKey]
                      if (!draft) return null

                      return (
                        <div
                          key={draftKey}
                          className={`rounded-[24px] border p-5 transition ${
                            draft.isEnabled
                              ? 'border-stone-300 bg-stone-50'
                              : 'border-stone-200 bg-white'
                          }`}
                        >
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-base font-semibold text-stone-900">
                                  {documentType.label}
                                </h4>
                                <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-600">
                                  {documentType.key}
                                </span>
                              </div>
                              {documentType.description ? (
                                <p className="mt-2 text-sm leading-7 text-stone-700">
                                  {documentType.description}
                                </p>
                              ) : null}
                            </div>

                            <label className="flex items-center gap-3 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800">
                              <input
                                type="checkbox"
                                checked={draft.isEnabled}
                                onChange={(event) =>
                                  updateRequirementDraft(
                                    selectedActionTypeId,
                                    documentType.id,
                                    'isEnabled',
                                    event.target.checked
                                  )
                                }
                              />
                              Aktivt chip
                            </label>
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-[180px_180px_1fr_auto]">
                            <label className="block">
                              <span className="mb-2 block text-sm font-semibold text-stone-800">
                                Obligatorisk
                              </span>
                              <select
                                value={draft.isRequired ? 'required' : 'optional'}
                                onChange={(event) =>
                                  updateRequirementDraft(
                                    selectedActionTypeId,
                                    documentType.id,
                                    'isRequired',
                                    event.target.value === 'required'
                                  )
                                }
                                disabled={!draft.isEnabled}
                                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm disabled:bg-stone-100"
                              >
                                <option value="required">Ja</option>
                                <option value="optional">Nej</option>
                              </select>
                            </label>

                            <label className="block">
                              <span className="mb-2 block text-sm font-semibold text-stone-800">
                                Sortering
                              </span>
                              <input
                                value={draft.sortOrder}
                                onChange={(event) =>
                                  updateRequirementDraft(
                                    selectedActionTypeId,
                                    documentType.id,
                                    'sortOrder',
                                    event.target.value
                                  )
                                }
                                disabled={!draft.isEnabled}
                                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm disabled:bg-stone-100"
                              />
                            </label>

                            <label className="block">
                              <span className="mb-2 block text-sm font-semibold text-stone-800">
                                Notering
                              </span>
                              <input
                                value={draft.note}
                                onChange={(event) =>
                                  updateRequirementDraft(
                                    selectedActionTypeId,
                                    documentType.id,
                                    'note',
                                    event.target.value
                                  )
                                }
                                disabled={!draft.isEnabled}
                                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm disabled:bg-stone-100"
                                placeholder="Kort hjälptext eller specialkrav"
                              />
                            </label>

                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={() => void saveRequirement(selectedActionTypeId, documentType.id)}
                                disabled={savingRequirementKey === draftKey}
                                className="w-full rounded-full border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:opacity-60"
                              >
                                {savingRequirementKey === draftKey ? 'Sparar...' : 'Spara'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </>
            )}
          </article>
        </section>
      </section>
    </main>
  )
}
