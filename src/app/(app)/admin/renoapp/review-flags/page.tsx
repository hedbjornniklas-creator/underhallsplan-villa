'use client'

import { useEffect, useMemo, useState } from 'react'

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

type DraftReviewFlag = {
  id?: string
  key: string
  label: string
  description: string
  severity: 'info' | 'warning' | 'high'
  category: string
  sortOrder: string
  isActive: boolean
}

const EMPTY_DRAFT: DraftReviewFlag = {
  key: '',
  label: '',
  description: '',
  severity: 'warning',
  category: 'general',
  sortOrder: '100',
  isActive: true,
}

function slugifyKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
}

export default function RenoAppReviewFlagsAdminPage() {
  const [items, setItems] = useState<ReviewFlagItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState<DraftReviewFlag>(EMPTY_DRAFT)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/admin/review-flags', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          items?: ReviewFlagItem[]
          error?: string
        }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte lasa granskningsflaggor.')
        }

        if (!active) return
        setItems(payload.items ?? [])
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte lasa granskningsflaggor.')
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

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...items]
      .filter((item) => {
        if (!normalizedQuery) return true
        return [item.label, item.key, item.description ?? '', item.category, item.severity]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
      })
      .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
  }, [items, query])

  const generatedKey = draft.id && draft.key ? draft.key : slugifyKey(draft.label)

  const openNewModal = () => {
    setDraft(EMPTY_DRAFT)
    setModalOpen(true)
  }

  const openEditModal = (item: ReviewFlagItem) => {
    setDraft({
      id: item.id,
      key: item.key,
      label: item.label,
      description: item.description ?? '',
      severity: item.severity,
      category: item.category,
      sortOrder: String(item.sortOrder),
      isActive: item.isActive,
    })
    setModalOpen(true)
  }

  const saveItem = async () => {
    setSavingKey(draft.id ?? 'new')
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/review-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          key: generatedKey,
          sortOrder: Number(draft.sortOrder || '100'),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        item?: ReviewFlagItem
        error?: string
      }

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Kunde inte spara granskningsflagga.')
      }

      const saved = payload.item
      setItems((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
      )
      setModalOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara granskningsflagga.')
    } finally {
      setSavingKey(null)
    }
  }

  const deleteItem = async (item: ReviewFlagItem) => {
    if (!window.confirm(`Radera granskningsflaggan "${item.label}"?`)) return

    setDeletingId(item.id)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/review-flags', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera granskningsflagga.')
      }

      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera granskningsflagga.')
    } finally {
      setDeletingId(null)
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
            <h3 className="text-lg font-semibold text-stone-900">Flaggor</h3>
            <p className="mt-1 text-sm leading-6 text-stone-600">renoapp_review_flags</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Sok..."
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
            Laddar granskningsflaggor...
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
            Inga granskningsflaggor hittades.
          </div>
        ) : (
          <div className="mt-5 space-y-2 overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-y-2 text-[11px]">
              <thead>
                <tr className="whitespace-nowrap text-left text-[10px] uppercase text-gray-400">
                  <th className="w-[20%] px-3 py-1">Term</th>
                  <th className="w-[16%] px-3 py-1">Kod</th>
                  <th className="w-[10%] px-3 py-1">Niva</th>
                  <th className="w-[12%] px-3 py-1">Kategori</th>
                  <th className="w-[24%] px-3 py-1">Beskrivning</th>
                  <th className="w-[6%] px-3 py-1">Aktiv</th>
                  <th className="w-[12%] px-3 py-1 text-center">Atgarder</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td className="rounded-l-xl border border-gray-200 bg-white px-3 py-2">
                      <div className="truncate font-medium text-gray-900">{item.label}</div>
                    </td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2">{item.key}</td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2">{item.severity}</td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2">{item.category}</td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2">
                      <div className="truncate">{item.description || '-'}</div>
                    </td>
                    <td className="border-y border-gray-200 bg-white px-3 py-2">{item.isActive ? 'Ja' : 'Nej'}</td>
                    <td className="rounded-r-xl border border-gray-200 bg-white px-3 py-2">
                      <div className="grid grid-cols-2 gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        >
                          Editera
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteItem(item)}
                          disabled={deletingId === item.id}
                          className="rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                        >
                          {deletingId === item.id ? 'Raderar...' : 'Radera'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-stone-900">
                  {draft.id ? 'Redigera flagga' : 'Ny flagga'}
                </h3>
                {generatedKey ? <div className="mt-1 text-xs text-stone-500">Kod: {generatedKey}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => void saveItem()}
                  disabled={savingKey === (draft.id ?? 'new')}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingKey === (draft.id ?? 'new') ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 md:col-span-2">
                <div className="text-xs font-medium text-stone-600">Namn</div>
                <input
                  value={draft.label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm text-stone-900"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-stone-600">Intern nyckel</div>
                <input
                  value={generatedKey}
                  readOnly
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-stone-600">Kategori</div>
                <input
                  value={draft.category}
                  onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm text-stone-900"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-stone-600">Niva</div>
                <select
                  value={draft.severity}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, severity: event.target.value as DraftReviewFlag['severity'] }))
                  }
                  className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm text-stone-900"
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-stone-600">Sortering</div>
                <input
                  value={draft.sortOrder}
                  onChange={(event) => setDraft((current) => ({ ...current, sortOrder: event.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm text-stone-900"
                />
              </label>
              <label className="space-y-1 md:col-span-2">
                <div className="text-xs font-medium text-stone-600">Beskrivning till styrelsen</div>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  rows={4}
                  className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm text-stone-900"
                />
              </label>
            </div>

            <label className="mt-4 flex items-center gap-2 rounded-xl border border-stone-200 px-4 py-3 text-sm text-stone-800">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Aktiv
            </label>
          </div>
        </div>
      ) : null}
    </main>
  )
}
