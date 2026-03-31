'use client'

import { useEffect, useMemo, useState } from 'react'

type ParticipantRoleItem = {
  id: string
  key: string
  label: string
  description: string | null
  roleKind: 'contractor' | 'consultant'
  requiresCompanyName: boolean
  requiresOrgNumber: boolean
  requiresContactName: boolean
  requiresEmail: boolean
  requiresPhone: boolean
  requiresCertification: boolean
  sortOrder: number
  isActive: boolean
}

type DraftParticipantRole = {
  id?: string
  key: string
  label: string
  description: string
  roleKind: 'contractor' | 'consultant'
  requiresCompanyName: boolean
  requiresOrgNumber: boolean
  requiresContactName: boolean
  requiresEmail: boolean
  requiresPhone: boolean
  requiresCertification: boolean
  sortOrder: string
  isActive: boolean
}

const EMPTY_DRAFT: DraftParticipantRole = {
  key: '',
  label: '',
  description: '',
  roleKind: 'contractor',
  requiresCompanyName: true,
  requiresOrgNumber: true,
  requiresContactName: true,
  requiresEmail: true,
  requiresPhone: true,
  requiresCertification: false,
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

export default function RenoAppParticipantsAdminPage() {
  const [items, setItems] = useState<ParticipantRoleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState<DraftParticipantRole>(EMPTY_DRAFT)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/renoapp/admin/participants', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          items?: ParticipantRoleItem[]
          error?: string
        }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa medverkandetyper.')
        }

        if (!active) return
        setItems(payload.items ?? [])
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : 'Kunde inte läsa medverkandetyper.'
          )
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
        return [item.label, item.key, item.description ?? '', item.roleKind].join(' ').toLowerCase().includes(normalizedQuery)
      })
      .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv'))
  }, [items, query])

  const generatedKey = draft.id && draft.key ? draft.key : slugifyKey(draft.label)

  const openNewModal = () => {
    setDraft(EMPTY_DRAFT)
    setModalOpen(true)
  }

  const openEditModal = (item: ParticipantRoleItem) => {
    setDraft({
      id: item.id,
      key: item.key,
      label: item.label,
      description: item.description ?? '',
      roleKind: item.roleKind,
      requiresCompanyName: item.requiresCompanyName,
      requiresOrgNumber: item.requiresOrgNumber,
      requiresContactName: item.requiresContactName,
      requiresEmail: item.requiresEmail,
      requiresPhone: item.requiresPhone,
      requiresCertification: item.requiresCertification,
      sortOrder: String(item.sortOrder),
      isActive: item.isActive,
    })
    setModalOpen(true)
  }

  const saveItem = async () => {
    setSavingKey(draft.id ?? 'new')
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          key: generatedKey,
          sortOrder: Number(draft.sortOrder || '100'),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        item?: ParticipantRoleItem
        error?: string
      }
      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? 'Kunde inte spara medverkandetyp.')
      }

      const saved = payload.item
      setItems((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'sv')
        )
      )
      setModalOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara medverkandetyp.')
    } finally {
      setSavingKey(null)
    }
  }

  const deleteItem = async (item: ParticipantRoleItem) => {
    if (!window.confirm(`Radera medverkandetypen "${item.label}"?`)) return

    setDeletingId(item.id)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/admin/participants', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera medverkandetyp.')
      }

      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Kunde inte radera medverkandetyp.'
      )
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
            <h3 className="text-lg font-semibold text-stone-900">Medverkande</h3>
            <p className="mt-1 text-sm leading-6 text-stone-600">renoapp_participant_roles</p>
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
            Laddar medverkandetyper...
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
            Inga medverkandetyper hittades.
          </div>
        ) : (
          <div className="mt-5 space-y-2 overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-y-2 text-[11px]">
              <thead>
                <tr className="whitespace-nowrap text-left text-[10px] uppercase text-gray-400">
                  <th className="w-[22%] px-3 py-1">Term</th>
                  <th className="w-[16%] px-3 py-1">Kod</th>
                  <th className="w-[12%] px-3 py-1">Typ</th>
                  <th className="w-[28%] px-3 py-1">Informationskrav</th>
                  <th className="w-[8%] px-3 py-1">Aktiv</th>
                  <th className="w-[14%] px-3 py-1 text-center">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const infoSummary = [
                    item.requiresCompanyName ? 'Företag' : null,
                    item.requiresOrgNumber ? 'Org.nr' : null,
                    item.requiresContactName ? 'Kontakt' : null,
                    item.requiresEmail ? 'E-post' : null,
                    item.requiresPhone ? 'Telefon' : null,
                    item.requiresCertification ? 'Behörighet' : null,
                  ]
                    .filter(Boolean)
                    .join(', ')

                  return (
                    <tr key={item.id} className="group transition-colors hover:bg-blue-50">
                      <td className="rounded-l-xl border border-gray-200 bg-white px-3 py-2">
                        <div className="truncate font-medium text-gray-900">{item.label}</div>
                        <div className="truncate text-[10px] text-gray-500">{item.description || '-'}</div>
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2">{item.key}</td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2">
                        {item.roleKind === 'consultant' ? 'Konsult' : 'Entreprenör'}
                      </td>
                      <td className="border-y border-gray-200 bg-white px-3 py-2">{infoSummary || '-'}</td>
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
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-[28px] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-stone-900">
                  {draft.id ? 'Redigera medverkandetyp' : 'Ny medverkandetyp'}
                </h3>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => void saveItem()}
                  disabled={savingKey === (draft.id ?? 'new')}
                  className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
                >
                  {savingKey === (draft.id ?? 'new') ? 'Sparar...' : 'Spara'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Visningsnamn</span>
                <input
                  value={draft.label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Intern nyckel</span>
                <input
                  value={generatedKey}
                  readOnly
                  className="w-full rounded-2xl border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-700"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Typ</span>
                <select
                  value={draft.roleKind}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      roleKind: event.target.value === 'consultant' ? 'consultant' : 'contractor',
                    }))
                  }
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                >
                  <option value="contractor">Entreprenör</option>
                  <option value="consultant">Konsult</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Sortering</span>
                <input
                  value={draft.sortOrder}
                  onChange={(event) => setDraft((current) => ({ ...current, sortOrder: event.target.value }))}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>

              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Beskrivning</span>
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                />
              </label>

              {[
                ['requiresCompanyName', 'Företagsnamn'],
                ['requiresOrgNumber', 'Organisationsnummer'],
                ['requiresContactName', 'Kontaktperson'],
                ['requiresEmail', 'E-post'],
                ['requiresPhone', 'Telefon'],
                ['requiresCertification', 'Behörighet/intyg'],
              ].map(([field, label]) => (
                <label
                  key={field}
                  className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(draft[field as keyof DraftParticipantRole])}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field]: event.target.checked,
                      }))
                    }
                  />
                  {label}
                </label>
              ))}

              <label className="flex items-center gap-3 rounded-2xl border border-stone-300 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
                />
                Aktiv
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
