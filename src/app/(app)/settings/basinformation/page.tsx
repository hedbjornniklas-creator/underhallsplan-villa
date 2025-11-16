'use client'

import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type BasicField = {
  id: string
  key: string
  label: string
  field_type: 'number' | 'boolean' | 'select' | 'text'
  options: any | null
  field_group: string | null
  is_critical: boolean | null
  order_index: number | null
  is_active: boolean | null
}

const FIELD_TYPES: BasicField['field_type'][] = ['number', 'boolean', 'select', 'text']

export default function BasinformationSettingsPage() {
  const { isAdmin, loading } = useProfile()
  const [rows, setRows] = useState<BasicField[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    if (loading || !isAdmin) return
    loadRows()
  }, [loading, isAdmin])

  const loadRows = async () => {
    const { data, error } = await supabase
      .from('basic_fields')
      .select('*')
      .order('field_group', { ascending: true })
      .order('order_index', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }
    setRows((data ?? []) as BasicField[])
  }

  const addRow = async () => {
    const randomKey = `field_${Math.random().toString(36).slice(2, 7)}`
    const { data, error } = await supabase
      .from('basic_fields')
      .insert({
        key: randomKey,
        label: 'Nytt fält',
        field_type: 'text',
        field_group: 'Allmänt',
        order_index: (rows[rows.length - 1]?.order_index ?? 100) + 10,
        is_active: true,
        is_critical: false,
      })
      .select('*')
      .single()

    if (error) {
      alert(error.message)
      return
    }
    setRows(prev => [...prev, data as BasicField])
  }

  const saveRow = async (id: string, patch: Partial<BasicField>) => {
    const { error } = await supabase
      .from('basic_fields')
      .update(patch)
      .eq('id', id)

    if (error) {
      alert(error.message)
      return
    }

    setRows(prev => prev.map(r => (r.id === id ? ({ ...r, ...patch } as BasicField) : r)))
  }

  const delRow = async (id: string) => {
    if (!confirm('Ta bort fältet? Detta påverkar basinfon för alla byggnader.')) return
    const { error } = await supabase
      .from('basic_fields')
      .delete()
      .eq('id', id)

    if (error) {
      alert(error.message)
      return
    }
    setRows(prev => prev.filter(r => r.id !== id))
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r =>
      (r.label ?? '').toLowerCase().includes(s) ||
      (r.key ?? '').toLowerCase().includes(s) ||
      (r.field_group ?? '').toLowerCase().includes(s)
    )
  }, [rows, q])

  if (loading) {
    return (
      <Protected>
        <div className="p-6">Laddar…</div>
      </Protected>
    )
  }

  if (!isAdmin) {
    return (
      <Protected>
        <div className="p-6 text-rose-700">Åtkomst nekad.</div>
      </Protected>
    )
  }

  return (
    <Protected>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold">
            Basinformationsfält
          </h1>
          <Link href="/settings" className="text-sm underline">
            ← Till Settings
          </Link>
        </div>

        <p className="text-sm text-gray-600 max-w-3xl">
          Här definierar du vilka fält som ska ingå i basinfon för byggnader.
          Dessa fält visas sedan på byggnadssidan och kan fyllas i per objekt.
        </p>

        {/* Sök + ny */}
        <div className="flex items-center justify-between">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Sök på etikett, nyckel, grupp…"
            className="border rounded px-2 py-1 text-sm w-64"
          />
          <button
            onClick={addRow}
            className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
          >
            + Nytt fält
          </button>
        </div>

        {/* Tabell */}
        <div className="overflow-auto">
          <table className="w-full text-xs md:text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 pr-3">Nyckel</th>
                <th className="py-2 pr-3">Etikett</th>
                <th className="py-2 pr-3">Grupp</th>
                <th className="py-2 pr-3">Typ</th>
                <th className="py-2 pr-3">Alternativ (för select/boolean)</th>
                <th className="py-2 pr-3">Kritisk</th>
                <th className="py-2 pr-3">Ordning</th>
                <th className="py-2 pr-3">Aktiv</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(r => {
                const optsString = Array.isArray(r.options)
                  ? (r.options as string[]).join(';')
                  : ''

                return (
                  <tr key={r.id}>
                    {/* Nyckel */}
                    <td className="py-2 pr-3 align-top">
                      <input
                        className="border rounded px-2 py-1 w-40"
                        value={r.key}
                        onChange={e =>
                          saveRow(r.id, { key: e.target.value.trim() })
                        }
                      />
                    </td>

                    {/* Etikett */}
                    <td className="py-2 pr-3 align-top">
                      <input
                        className="border rounded px-2 py-1 w-40 md:w-56"
                        value={r.label}
                        onChange={e =>
                          saveRow(r.id, { label: e.target.value })
                        }
                      />
                    </td>

                    {/* Grupp */}
                    <td className="py-2 pr-3 align-top">
                      <input
                        className="border rounded px-2 py-1 w-32"
                        placeholder="t.ex. Allmänt, Grund…"
                        value={r.field_group ?? ''}
                        onChange={e =>
                          saveRow(r.id, { field_group: e.target.value || null })
                        }
                      />
                    </td>

                    {/* Typ */}
                    <td className="py-2 pr-3 align-top">
                      <select
                        className="border rounded px-2 py-1 w-28"
                        value={r.field_type}
                        onChange={e =>
                          saveRow(r.id, {
                            field_type: e.target.value as BasicField['field_type'],
                          })
                        }
                      >
                        {FIELD_TYPES.map(t => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Alternativ */}
                    <td className="py-2 pr-3 align-top">
                      <input
                        className="border rounded px-2 py-1 w-48 md:w-64"
                        placeholder="Separera med ; t.ex. Ja;Nej;Okänt"
                        value={optsString}
                        onChange={e =>
                          saveRow(r.id, {
                            options: e.target.value
                              ? e.target.value.split(';').map(x => x.trim())
                              : null,
                          })
                        }
                      />
                    </td>

                    {/* Kritisk */}
                    <td className="py-2 pr-3 align-top text-center">
                      <input
                        type="checkbox"
                        checked={!!r.is_critical}
                        onChange={e =>
                          saveRow(r.id, { is_critical: e.target.checked })
                        }
                      />
                    </td>

                    {/* Ordning */}
                    <td className="py-2 pr-3 align-top">
                      <input
                        type="number"
                        className="border rounded px-2 py-1 w-20"
                        value={r.order_index ?? ''}
                        onChange={e =>
                          saveRow(r.id, {
                            order_index:
                              e.target.value === ''
                                ? null
                                : Number(e.target.value),
                          })
                        }
                      />
                    </td>

                    {/* Aktiv */}
                    <td className="py-2 pr-3 align-top text-center">
                      <input
                        type="checkbox"
                        checked={r.is_active ?? true}
                        onChange={e =>
                          saveRow(r.id, { is_active: e.target.checked })
                        }
                      />
                    </td>

                    {/* Ta bort */}
                    <td className="py-2 pr-3 align-top">
                      <button
                        onClick={() => delRow(r.id)}
                        className="text-rose-600 underline"
                      >
                        Ta bort
                      </button>
                    </td>
                  </tr>
                )
              })}

              {filtered.length === 0 && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={9}>
                    Inga fält definierade ännu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Protected>
  )
}
