'use client'

import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type DocRow = {
  id: string
  code: string
  label: string
  category: string | null
  scope: 'property' | 'building' | null
  description: string | null
  is_default: boolean | null
  // nya fält
  result_label: string | null
  result_unit: string | null
  validity_years: number | null
  recommended_interval_years: number | null
  interval_note: string | null
  is_active: boolean | null
}

export default function HandlingarSettingsPage() {
  const [rows, setRows] = useState<DocRow[]>([])
  const [q, setQ] = useState('')

  // Ladda handlingstyper
  useEffect(() => {
    loadRows()
  }, [])

  const loadRows = async () => {
    const { data, error } = await supabase
      .from('document_types')
      .select(
        'id, code, label, category, scope, description, is_default, result_label, result_unit, validity_years, recommended_interval_years, interval_note, is_active'
      )
      .order('category', { ascending: true })
      .order('label', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }

    setRows((data ?? []) as DocRow[])
  }

  // Lägg till ny handling
  const addRow = async () => {
    const code = `DOC_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const { data, error } = await supabase
      .from('document_types')
      .insert({
        code,
        label: 'Ny handling',
        category: null,
        scope: 'building',
        is_default: true,
        is_active: true,
      })
      .select(
        'id, code, label, category, scope, description, is_default, result_label, result_unit, validity_years, recommended_interval_years, interval_note, is_active'
      )
      .single()

    if (error) {
      alert(error.message)
      return
    }

    setRows(prev => [data as DocRow, ...prev])
  }

  const saveRow = async (id: string, patch: Partial<DocRow>) => {
    const { error } = await supabase
      .from('document_types')
      .update(patch)
      .eq('id', id)

    if (error) {
      alert(error.message)
      return
    }

    setRows(prev =>
      prev.map(r => (r.id === id ? ({ ...r, ...patch } as DocRow) : r))
    )
  }

  const delRow = async (id: string) => {
    if (!confirm('Ta bort handlingstypen?')) return
    const { error } = await supabase
      .from('document_types')
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
      (r.code ?? '').toLowerCase().includes(s) ||
      (r.category ?? '').toLowerCase().includes(s) ||
      (r.result_label ?? '').toLowerCase().includes(s)
    )
  }, [rows, q])

  return (
    <Protected>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold">
            Handlingar (dokumenttyper)
          </h1>
          <Link href="/settings" className="text-sm underline">
            ← Till Settings
          </Link>
        </div>

        <p className="text-sm text-gray-600 max-w-4xl">
          Här lägger du upp de handlingar som kan kopplas till en fastighet eller byggnad,
          t.ex. energideklaration, radonmätning, sotarintyg m.m. Upplysningar från ägaren
          skrivs manuellt per byggnad och hanteras inte här.
        </p>

        {/* Sök + ny */}
        <div className="flex items-center justify-between">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Sök på namn, kod, kategori…"
            className="border rounded px-2 py-1 text-sm w-64"
          />
          <button
            onClick={addRow}
            className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
          >
            + Ny handling
          </button>
        </div>

        {/* Tabell */}
        <div className="overflow-auto">
          <table className="w-full text-xs md:text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 pr-3">Kod</th>
                <th className="py-2 pr-3">Namn</th>
                <th className="py-2 pr-3">Kategori</th>
                <th className="py-2 pr-3">Gäller</th>
                <th className="py-2 pr-3">Standard</th>
                <th className="py-2 pr-3">Resultatnamn</th>
                <th className="py-2 pr-3">Enhet</th>
                <th className="py-2 pr-3">Giltighet (år)</th>
                <th className="py-2 pr-3">Intervall (år)</th>
                <th className="py-2 pr-3">Intervall-kommentar</th>
                <th className="py-2 pr-3">Aktiv</th>
                <th className="py-2 pr-3">Beskrivning</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(r => (
                <tr key={r.id}>
                  {/* Kod */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      className="border rounded px-2 py-1 w-28"
                      value={r.code ?? ''}
                      onChange={e =>
                        saveRow(r.id, { code: e.target.value || (r.code as string) })
                      }
                    />
                  </td>

                  {/* Namn */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      className="border rounded px-2 py-1 w-40 md:w-56"
                      value={r.label}
                      onChange={e =>
                        saveRow(r.id, { label: e.target.value })
                      }
                    />
                  </td>

                  {/* Kategori */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      className="border rounded px-2 py-1 w-32"
                      placeholder="t.ex. energi, myndighet…"
                      value={r.category ?? ''}
                      onChange={e =>
                        saveRow(r.id, { category: e.target.value || null })
                      }
                    />
                  </td>

                  {/* Gäller (scope) */}
                  <td className="py-2 pr-3 align-top">
                    <select
                      className="border rounded px-2 py-1 w-28"
                      value={r.scope ?? 'building'}
                      onChange={e =>
                        saveRow(r.id, {
                          scope: e.target.value as DocRow['scope'],
                        })
                      }
                    >
                      <option value="building">byggnad</option>
                      <option value="property">fastighet</option>
                    </select>
                  </td>

                  {/* Standard (is_default) */}
                  <td className="py-2 pr-3 align-top text-center">
                    <input
                      type="checkbox"
                      checked={!!r.is_default}
                      onChange={e =>
                        saveRow(r.id, { is_default: e.target.checked })
                      }
                    />
                  </td>

                  {/* Resultatnamn */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      className="border rounded px-2 py-1 w-32"
                      placeholder="t.ex. Energiklass"
                      value={r.result_label ?? ''}
                      onChange={e =>
                        saveRow(r.id, { result_label: e.target.value || null })
                      }
                    />
                  </td>

                  {/* Enhet */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      className="border rounded px-2 py-1 w-24"
                      placeholder="t.ex. A–G, Bq/m³"
                      value={r.result_unit ?? ''}
                      onChange={e =>
                        saveRow(r.id, { result_unit: e.target.value || null })
                      }
                    />
                  </td>

                  {/* Giltighet år */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-20"
                      value={r.validity_years ?? ''}
                      onChange={e =>
                        saveRow(r.id, {
                          validity_years:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </td>

                  {/* Intervall år */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-20"
                      value={r.recommended_interval_years ?? ''}
                      onChange={e =>
                        saveRow(r.id, {
                          recommended_interval_years:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </td>

                  {/* Intervall-kommentar */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      className="border rounded px-2 py-1 w-40 md:w-56"
                      placeholder="t.ex. vid försäljning eller minst var 10:e år"
                      value={r.interval_note ?? ''}
                      onChange={e =>
                        saveRow(r.id, { interval_note: e.target.value || null })
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

                  {/* Beskrivning */}
                  <td className="py-2 pr-3 align-top">
                    <input
                      className="border rounded px-2 py-1 w-48 md:w-64"
                      value={r.description ?? ''}
                      onChange={e =>
                        saveRow(r.id, { description: e.target.value || null })
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
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={13}>
                    Inga handlingar upplagda ännu.
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
