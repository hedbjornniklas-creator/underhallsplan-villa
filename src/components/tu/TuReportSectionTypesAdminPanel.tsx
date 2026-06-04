'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { TU_STANDARD_REPORT_SECTION_TYPES } from '@/lib/tu/reportSectionTypes'

type TuReportSectionTypeRow = {
  id: string
  key: string
  title: string
  description: string | null
  sort_order: number
  is_active: boolean
  is_system: boolean
}

type TuReportSectionTypeDraft = {
  id?: string
  key: string
  title: string
  description: string
  sort_order: number
  is_active: boolean
  is_system?: boolean
}

type SettingsError = {
  message: string
} | null

type SettingsResponse<T> = {
  data: T | null
  error: SettingsError
}

type SettingsQuery = {
  select: (columns: string) => SettingsQuery
  order: (column: string, options?: { ascending?: boolean }) => SettingsQuery
  insert: (values: unknown) => SettingsQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => SettingsQuery
  update: (values: unknown) => SettingsQuery
  delete: () => SettingsQuery
  eq: (column: string, value: unknown) => SettingsQuery
  single: () => Promise<SettingsResponse<unknown>>
  then: <TResult1 = SettingsResponse<unknown[]>, TResult2 = never>(
    onfulfilled?: ((value: SettingsResponse<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => PromiseLike<TResult1 | TResult2>
}

type SettingsClient = {
  from: (table: string) => SettingsQuery
}

const EMPTY_DRAFT: TuReportSectionTypeDraft = {
  key: '',
  title: '',
  description: '',
  sort_order: 100,
  is_active: true,
}

function normalizeSectionKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function createKeyFromTitle(title: string) {
  return normalizeSectionKey(title) || `tu_section_${Math.random().toString(36).slice(2, 8)}`
}

export default function TuReportSectionTypesAdminPanel() {
  const [rows, setRows] = useState<TuReportSectionTypeRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<TuReportSectionTypeDraft | null>(null)
  const settingsClient = useMemo(() => supabase as unknown as SettingsClient, [])

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) =>
      [row.key, row.title, row.description ?? '', row.is_active ? 'aktiv' : 'inaktiv']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [query, rows])

  useEffect(() => {
    let cancelled = false

    async function loadRows() {
      const { data, error: loadError } = await settingsClient
        .from('settings_tu_report_section_types')
        .select('id, key, title, description, sort_order, is_active, is_system')
        .order('sort_order', { ascending: true })
        .order('title', { ascending: true })

      if (cancelled) return

      if (loadError) {
        setRows([])
        setError(
          `Kunde inte hämta TU-rubriker. Kontrollera att migrationen för settings_tu_report_section_types är körd. (${loadError.message})`
        )
        setLoading(false)
        return
      }

      setRows((data ?? []) as TuReportSectionTypeRow[])
      setLoading(false)
    }

    void loadRows()

    return () => {
      cancelled = true
    }
  }, [settingsClient])

  const openNewDraft = () => {
    setDraft({ ...EMPTY_DRAFT, sort_order: (rows.length + 1) * 100 })
  }

  const openEditDraft = (row: TuReportSectionTypeRow) => {
    setDraft({
      id: row.id,
      key: row.key,
      title: row.title,
      description: row.description ?? '',
      sort_order: row.sort_order,
      is_active: row.is_active,
      is_system: row.is_system,
    })
  }

  const seedStandardRows = async () => {
    setError(null)
    const payload = TU_STANDARD_REPORT_SECTION_TYPES.map((section) => ({
      key: section.key,
      title: section.title,
      description: section.description ?? null,
      sort_order: section.sortOrder ?? 100,
      is_active: section.isActive ?? true,
      is_system: true,
    }))

    const { data, error: seedError } = await settingsClient
      .from('settings_tu_report_section_types')
      .upsert(payload, { onConflict: 'key' })
      .select('id, key, title, description, sort_order, is_active, is_system')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })

    if (seedError) {
      setError(seedError.message)
      return
    }

    setRows((data ?? []) as TuReportSectionTypeRow[])
    setDraft(null)
  }

  const saveDraft = async () => {
    if (!draft) return
    const title = draft.title.trim()
    const key = draft.id ? draft.key.trim() : createKeyFromTitle(draft.key || title)

    if (!title) {
      setError('Rubrik måste fyllas i.')
      return
    }

    if (!/^[a-z0-9_]+$/.test(key)) {
      setError('Key får bara innehålla små bokstäver, siffror och underscore.')
      return
    }

    const payload = {
      key,
      title,
      description: draft.description.trim() || null,
      sort_order: Number.isFinite(draft.sort_order) ? draft.sort_order : 100,
      is_active: draft.is_active,
      is_system: Boolean(draft.is_system),
    }

    setError(null)
    if (draft.id) {
      const { error: updateError } = await settingsClient
        .from('settings_tu_report_section_types')
        .update(payload)
        .eq('id', draft.id)

      if (updateError) {
        setError(updateError.message)
        return
      }

      setRows((current) =>
        current.map((row) => (row.id === draft.id ? ({ ...row, ...payload } as TuReportSectionTypeRow) : row))
      )
      setDraft(null)
      return
    }

    const { data, error: insertError } = await settingsClient
      .from('settings_tu_report_section_types')
      .insert(payload)
      .select('id, key, title, description, sort_order, is_active, is_system')
      .single()

    if (insertError) {
      setError(insertError.message)
      return
    }

    setRows((current) =>
      [...current, data as TuReportSectionTypeRow].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'sv'))
    )
    setDraft(null)
  }

  const deleteRow = async (row: TuReportSectionTypeRow) => {
    if (row.is_system) {
      setError('Systemdelar kan inte tas bort. Inaktivera dem om de inte ska visas i dropdownen.')
      return
    }
    if (!confirm(`Ta bort "${row.title}"? Befintliga utlåtanden som redan använder delen påverkas inte.`)) return
    const { error: deleteError } = await settingsClient
      .from('settings_tu_report_section_types')
      .delete()
      .eq('id', row.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setRows((current) => current.filter((item) => item.id !== row.id))
    if (draft?.id === row.id) setDraft(null)
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-semibold">TU-rubriker</h2>
          <div className="text-xs text-gray-500">settings_tu_report_section_types</div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Styr vilka deltyper som visas i TU-utlåtandets dropdown. Befintliga utlåtanden behåller sina sparade
            rubriker även om en deltyp inaktiveras här.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sök..."
            className="h-9 rounded border border-gray-300 px-2 text-sm"
          />
          <button
            type="button"
            onClick={openNewDraft}
            className="h-9 rounded bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            + Ny deltyp
          </button>
          <button
            type="button"
            onClick={() => void seedStandardRows()}
            className="h-9 rounded border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 hover:bg-violet-50"
          >
            Lägg in standardrubriker
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {draft ? (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-950">
              {draft.id ? 'Redigera deltyp' : 'Ny deltyp'}
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void saveDraft()}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Spara
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Rubrik</div>
              <input
                value={draft.title}
                onChange={(event) => {
                  const title = event.target.value
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          title,
                          key: current.id ? current.key : createKeyFromTitle(title),
                        }
                      : current
                  )
                }}
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Key</div>
              <input
                value={draft.key}
                disabled={Boolean(draft.id)}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, key: normalizeSectionKey(event.target.value) } : current
                  )
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5 disabled:bg-gray-100 disabled:text-gray-500"
              />
              <div className="mt-1 text-xs text-gray-500">Key låses efter skapande så befintliga utlåtanden inte tappar koppling.</div>
            </label>
            <label className="text-sm md:col-span-2">
              <div className="mb-1 text-gray-600">Beskrivning</div>
              <textarea
                value={draft.description}
                rows={3}
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, description: event.target.value } : current))
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-gray-600">Sortering</div>
              <input
                type="number"
                value={draft.sort_order}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, sort_order: event.target.value === '' ? 100 : Number(event.target.value) } : current
                  )
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
            <label className="mt-6 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, is_active: event.target.checked } : current))
                }
              />
              Aktiv i TU-dropdown
            </label>
          </div>
        </div>
      ) : null}

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="py-2 pr-3">Key</th>
              <th className="py-2 pr-3">Rubrik</th>
              <th className="py-2 pr-3">Beskrivning</th>
              <th className="py-2 pr-3">Sortering</th>
              <th className="py-2 pr-3">Aktiv</th>
              <th className="py-2 pr-3">Typ</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredRows.map((row) => (
              <tr key={row.id}>
                <td className="py-2 pr-3 font-mono text-xs">{row.key}</td>
                <td className="py-2 pr-3 font-medium text-gray-950">{row.title}</td>
                <td className="max-w-[28rem] truncate py-2 pr-3 text-gray-600" title={row.description ?? ''}>
                  {row.description ?? ''}
                </td>
                <td className="py-2 pr-3">{row.sort_order}</td>
                <td className="py-2 pr-3">{row.is_active ? 'Ja' : 'Nej'}</td>
                <td className="py-2 pr-3">{row.is_system ? 'System' : 'Egen'}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => openEditDraft(row)}
                    className="mr-3 text-emerald-700 underline"
                  >
                    Editera
                  </button>
                  {!row.is_system ? (
                    <button
                      type="button"
                      onClick={() => void deleteRow(row)}
                      className="text-rose-700 underline"
                    >
                      Ta bort
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 ? (
              <tr>
                <td className="py-4 text-gray-500" colSpan={7}>
                  Inga rader.
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td className="py-4 text-gray-500" colSpan={7}>
                  Laddar...
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
