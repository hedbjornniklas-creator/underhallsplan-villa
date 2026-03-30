'use client'

import { useEffect, useMemo, useState } from 'react'

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
  actionType: {
    id: string
    key: string
    label: string
    description: string | null
    sortOrder: number
    isActive: boolean
  }
  requirements: RequirementItem[]
}

type DraftRequirementState = {
  isEnabled: boolean
  isRequired: boolean
  note: string
  sortOrder: string
}

export default function RenoAppRequirementsAdminPage() {
  const [documentTypes, setDocumentTypes] = useState<DocumentTypeItem[]>([])
  const [actionTypes, setActionTypes] = useState<ActionTypeGroup[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftRequirementState>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/admin/requirements', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          documentTypes?: DocumentTypeItem[]
          actionTypes?: ActionTypeGroup[]
          error?: string
        }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa dokumentkrav.')
        }

        if (!active) return

        const nextDocumentTypes = payload.documentTypes ?? []
        const nextActionTypes = payload.actionTypes ?? []
        setDocumentTypes(nextDocumentTypes)
        setActionTypes(nextActionTypes)

        const nextDrafts: Record<string, DraftRequirementState> = {}
        for (const actionType of nextActionTypes) {
          for (const documentType of nextDocumentTypes) {
            const requirement = actionType.requirements.find((item) => item.documentTypeId === documentType.id)
            nextDrafts[`${actionType.actionType.id}:${documentType.id}`] = {
              isEnabled: Boolean(requirement),
              isRequired: requirement?.isRequired ?? true,
              note: requirement?.note ?? '',
              sortOrder: String(requirement?.sortOrder ?? documentType.sortOrder ?? 100),
            }
          }
        }

        setDrafts(nextDrafts)
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa dokumentkrav.')
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

  const visibleDocumentTypes = useMemo(
    () => documentTypes.filter((item) => item.isActive),
    [documentTypes]
  )

  const updateDraft = (key: string, field: keyof DraftRequirementState, value: string | boolean) => {
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [field]: value,
      },
    }))
  }

  const saveRequirement = async (actionTypeId: string, documentTypeId: string) => {
    const key = `${actionTypeId}:${documentTypeId}`
    const draft = drafts[key]
    if (!draft) return

    setSavingKey(key)
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
      setSavingKey(null)
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp admin</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Dokumentkrav</h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
          Koppla dokumentkrav till varje renoveringstyp. Det här styr vad boende ser direkt i ansökningsguiden.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>

      {loading ? (
        <section className="mt-6 rounded-[28px] border border-stone-200/80 bg-white/90 p-6 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Laddar dokumentkrav...
        </section>
      ) : (
        <section className="mt-6 grid gap-5">
          {actionTypes.map((group) => (
            <article key={group.actionType.id} className="rounded-[28px] border border-stone-200/80 bg-white/90 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{group.actionType.key}</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">{group.actionType.label}</h2>
                {group.actionType.description ? (
                  <p className="mt-2 text-sm leading-7 text-stone-700">{group.actionType.description}</p>
                ) : null}
              </div>

              <div className="mt-6 grid gap-4">
                {visibleDocumentTypes.map((documentType) => {
                  const draftKey = `${group.actionType.id}:${documentType.id}`
                  const draft = drafts[draftKey]
                  if (!draft) return null

                  return (
                    <div key={draftKey} className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-stone-900">{documentType.label}</p>
                          {documentType.description ? (
                            <p className="mt-1 text-sm leading-7 text-stone-700">{documentType.description}</p>
                          ) : null}
                        </div>
                        <label className="flex items-center gap-3 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800">
                          <input
                            type="checkbox"
                            checked={draft.isEnabled}
                            onChange={(event) => updateDraft(draftKey, 'isEnabled', event.target.checked)}
                          />
                          Aktivt krav
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-[180px_180px_1fr_auto]">
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-stone-800">Obligatorisk</span>
                          <select
                            value={draft.isRequired ? 'required' : 'optional'}
                            onChange={(event) => updateDraft(draftKey, 'isRequired', event.target.value === 'required')}
                            disabled={!draft.isEnabled}
                            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm"
                          >
                            <option value="required">Ja</option>
                            <option value="optional">Nej</option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering</span>
                          <input
                            value={draft.sortOrder}
                            onChange={(event) => updateDraft(draftKey, 'sortOrder', event.target.value)}
                            disabled={!draft.isEnabled}
                            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-stone-800">Notering</span>
                          <input
                            value={draft.note}
                            onChange={(event) => updateDraft(draftKey, 'note', event.target.value)}
                            disabled={!draft.isEnabled}
                            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm"
                            placeholder="Kort hjälptext eller BRF-krav"
                          />
                        </label>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => void saveRequirement(group.actionType.id, documentType.id)}
                            disabled={savingKey === draftKey}
                            className="w-full rounded-full border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:opacity-60"
                          >
                            {savingKey === draftKey ? 'Sparar...' : 'Spara'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
