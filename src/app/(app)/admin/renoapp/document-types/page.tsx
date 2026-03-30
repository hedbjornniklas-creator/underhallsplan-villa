'use client'

import { useEffect, useState } from 'react'

type DocumentTypeItem = {
  id: string
  key: string
  label: string
  description: string | null
  sortOrder: number
  isActive: boolean
}

type DraftDocumentType = {
  id?: string
  key: string
  label: string
  description: string
  sortOrder: string
  isActive: boolean
}

const EMPTY_DRAFT: DraftDocumentType = {
  key: '',
  label: '',
  description: '',
  sortOrder: '100',
  isActive: true,
}

export default function RenoAppDocumentTypesAdminPage() {
  const [items, setItems] = useState<DocumentTypeItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftDocumentType>>({})
  const [newDraft, setNewDraft] = useState<DraftDocumentType>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/admin/document-types', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          items?: DocumentTypeItem[]
          error?: string
        }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa dokumenttyper.')
        }

        if (!active) return

        const nextItems = payload.items ?? []
        setItems(nextItems)
        setDrafts(
          Object.fromEntries(
            nextItems.map((item) => [
              item.id,
              {
                id: item.id,
                key: item.key,
                label: item.label,
                description: item.description ?? '',
                sortOrder: String(item.sortOrder),
                isActive: item.isActive,
              },
            ])
          )
        )
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa dokumenttyper.')
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

  const updateDraft = (id: string, field: keyof DraftDocumentType, value: string | boolean) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [field]: value,
      },
    }))
  }

  const saveDraft = async (draft: DraftDocumentType, stateKey: string) => {
    setSavingKey(stateKey)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/document-types', {
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
      const payload = (await response.json().catch(() => ({}))) as { item?: DocumentTypeItem; error?: string }

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Kunde inte spara dokumenttyp.')
      }

      setItems((current) => {
        const exists = current.some((item) => item.id === payload.item!.id)
        return exists
          ? current
              .map((item) => (item.id === payload.item!.id ? payload.item! : item))
              .sort((left, right) => left.sortOrder - right.sortOrder)
          : [...current, payload.item!].sort((left, right) => left.sortOrder - right.sortOrder)
      })

      setDrafts((current) => ({
        ...current,
        [payload.item!.id]: {
          id: payload.item!.id,
          key: payload.item!.key,
          label: payload.item!.label,
          description: payload.item!.description ?? '',
          sortOrder: String(payload.item!.sortOrder),
          isActive: payload.item!.isActive,
        },
      }))

      if (!draft.id) {
        setNewDraft(EMPTY_DRAFT)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara dokumenttyp.')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp admin</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Dokumenttyper</h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
          Här hanterar du den centrala listan av dokument som RenoApp kan använda i ansökningsguiden.
          Inaktivera en typ om den inte längre ska gå att koppla till nya krav.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </section>

      <section className="mt-6 rounded-[28px] border border-stone-200/80 bg-white/90 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <h2 className="text-xl font-semibold text-stone-900">Lägg till ny dokumenttyp</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <input
            value={newDraft.label}
            onChange={(event) => setNewDraft((current) => ({ ...current, label: event.target.value }))}
            className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
            placeholder="Visningsnamn"
          />
          <input
            value={newDraft.key}
            onChange={(event) => setNewDraft((current) => ({ ...current, key: event.target.value.toLowerCase() }))}
            className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
            placeholder="Intern nyckel, t.ex. permit"
          />
          <input
            value={newDraft.sortOrder}
            onChange={(event) => setNewDraft((current) => ({ ...current, sortOrder: event.target.value }))}
            className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
            placeholder="Sortering"
          />
          <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={newDraft.isActive}
              onChange={(event) => setNewDraft((current) => ({ ...current, isActive: event.target.checked }))}
            />
            Aktiv
          </label>
          <textarea
            value={newDraft.description}
            onChange={(event) => setNewDraft((current) => ({ ...current, description: event.target.value }))}
            rows={3}
            className="rounded-2xl border border-stone-300 px-4 py-3 text-sm md:col-span-2"
            placeholder="Kort hjälptext om vad dokumenttypen betyder."
          />
        </div>
        <button
          type="button"
          onClick={() => void saveDraft(newDraft, 'new')}
          disabled={savingKey === 'new'}
          className="mt-4 rounded-full bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
        >
          {savingKey === 'new' ? 'Sparar...' : 'Lägg till dokumenttyp'}
        </button>
      </section>

      <section className="mt-6 grid gap-4">
        {loading ? (
          <div className="rounded-[28px] border border-stone-200/80 bg-white/90 p-6 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            Laddar dokumenttyper...
          </div>
        ) : (
          items.map((item) => {
            const draft = drafts[item.id]
            if (!draft) return null

            return (
              <article
                key={item.id}
                className="rounded-[28px] border border-stone-200/80 bg-white/90 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <input
                    value={draft.label}
                    onChange={(event) => updateDraft(item.id, 'label', event.target.value)}
                    className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                  <input
                    value={draft.key}
                    onChange={(event) => updateDraft(item.id, 'key', event.target.value.toLowerCase())}
                    className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                  <input
                    value={draft.sortOrder}
                    onChange={(event) => updateDraft(item.id, 'sortOrder', event.target.value)}
                    className="rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                  />
                  <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.isActive}
                      onChange={(event) => updateDraft(item.id, 'isActive', event.target.checked)}
                    />
                    Aktiv
                  </label>
                  <textarea
                    value={draft.description}
                    onChange={(event) => updateDraft(item.id, 'description', event.target.value)}
                    rows={3}
                    className="rounded-2xl border border-stone-300 px-4 py-3 text-sm md:col-span-2"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void saveDraft(draft, item.id)}
                  disabled={savingKey === item.id}
                  className="mt-4 rounded-full border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:opacity-60"
                >
                  {savingKey === item.id ? 'Sparar...' : 'Spara'}
                </button>
              </article>
            )
          })
        )}
      </section>
    </main>
  )
}
