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

type DraftDocumentType = {
  id?: string
  key: string
  label: string
  description: string
  sortOrder: string
  isActive: boolean
}

type SortKey = 'label' | 'key' | 'sortOrder' | 'isActive'

const EMPTY_DRAFT: DraftDocumentType = {
  key: '',
  label: '',
  description: '',
  sortOrder: '100',
  isActive: true,
}

function renderSortIcon(active: boolean, dir: 'asc' | 'desc') {
  if (!active) return <span className="text-gray-300">◇</span>
  return <span className="text-gray-500">{dir === 'asc' ? '↑' : '↓'}</span>
}

export default function RenoAppDocumentTypesAdminPage() {
  const [items, setItems] = useState<DocumentTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'label',
    dir: 'asc',
  })
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState<DraftDocumentType>(EMPTY_DRAFT)

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
        setItems(payload.items ?? [])
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

  const sortedItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = items.filter((item) => {
      const haystack = [item.label, item.key, item.description ?? '', item.isActive ? 'aktiv' : 'inaktiv']
        .join(' ')
        .toLowerCase()

      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false
      if (activeFilter === 'active' && !item.isActive) return false
      if (activeFilter === 'inactive' && item.isActive) return false
      return true
    })

    return [...filtered].sort((left, right) => {
      let comparison = 0

      switch (sort.key) {
        case 'key':
          comparison = left.key.localeCompare(right.key, 'sv')
          break
        case 'sortOrder':
          comparison = left.sortOrder - right.sortOrder
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
  }, [activeFilter, items, query, sort])

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )
  }

  const openNewModal = () => {
    setDraft(EMPTY_DRAFT)
    setModalOpen(true)
  }

  const openEditModal = (item: DocumentTypeItem) => {
    setDraft({
      id: item.id,
      key: item.key,
      label: item.label,
      description: item.description ?? '',
      sortOrder: String(item.sortOrder),
      isActive: item.isActive,
    })
    setModalOpen(true)
  }

  const saveDraft = async () => {
    setSavingKey(draft.id ?? 'new')
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

      const payload = (await response.json().catch(() => ({}))) as {
        item?: DocumentTypeItem
        error?: string
      }

      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Kunde inte spara dokumenttyp.')
      }

      const saved = payload.item
      setItems((current) => [...current.filter((item) => item.id !== saved.id), saved])
      setModalOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara dokumenttyp.')
    } finally {
      setSavingKey(null)
    }
  }

  const deleteItem = async (item: DocumentTypeItem) => {
    if (!window.confirm(`Radera dokumenttypen "${item.label}"?`)) return

    setDeletingId(item.id)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/document-types', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera dokumenttyp.')
      }

      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera dokumenttyp.')
    } finally {
      setDeletingId(null)
    }
  }

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
            <h2 className="font-semibold">Dokumenttyper</h2>
            <div className="text-xs text-gray-500">renovation_document_types</div>
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
              onClick={openNewModal}
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
              ['sortOrder', 'Sortering'],
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
                  <th className="w-[26%] px-3 py-1">Term</th>
                  <th className="w-[18%] px-3 py-1">Kod</th>
                  <th className="w-[28%] px-3 py-1">Beskrivning</th>
                  <th className="w-[10%] px-3 py-1">Sortering</th>
                  <th className="w-[6%] px-3 py-1">Aktiv</th>
                  <th className="w-[12%] px-3 py-1 text-center">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="py-4 text-xs text-gray-500" colSpan={6}>
                      Laddar dokumenttyper...
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
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{item.key}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="truncate">{item.description || '-'}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        {item.sortOrder}
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        {item.isActive ? 'Ja' : 'Nej'}
                      </td>
                      <td className="rounded-r-xl border border-gray-200 bg-white px-3 py-2 transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                        <div className="grid grid-cols-2 gap-1 whitespace-nowrap text-[11px]">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
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

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {draft.id ? 'Redigera dokumenttyp' : 'Ny dokumenttyp'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={savingKey === (draft.id ?? 'new')}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingKey === (draft.id ?? 'new') ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Visningsnamn</div>
                <input
                  value={draft.label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Intern nyckel</div>
                <input
                  value={draft.key}
                  onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs font-medium text-gray-600">Sortering</div>
                <input
                  value={draft.sortOrder}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                Aktiv
              </label>

              <label className="space-y-1 md:col-span-2">
                <div className="text-xs font-medium text-gray-600">Beskrivning</div>
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={4}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
