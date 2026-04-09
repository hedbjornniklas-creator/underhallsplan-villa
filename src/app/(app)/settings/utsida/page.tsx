'use client'

import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Row = {
  id: string
  code: string | null
  name: string
  scope: string | null
  category: string | null
  default_lifespan_years: number | null
  maintenance_interval_years: number | null
  notes: string | null
  is_active: boolean | null
}

export default function UtsidaSettingsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    loadRows()
  }, [])

  const loadRows = async () => {
    const { data, error } = await supabase
      .from('component_types')
      .select(
        'id, code, name, scope, category, default_lifespan_years, maintenance_interval_years, notes, is_active'
      )
      .or('scope.eq.exterior,scope.is.null')
      .order('category', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }

    setRows((data ?? []) as Row[])
  }

  const addRow = async () => {
    const { data, error } = await supabase
      .from('component_types')
      .insert({
        name: 'Ny komponent utsida',
        scope: 'exterior',
        is_active: true,
      })
      .select(
        'id, code, name, scope, category, default_lifespan_years, maintenance_interval_years, notes, is_active'
      )
      .single()

    if (error) {
      alert(error.message)
      return
    }

    const r = data as Row
    setRows(prev => [...prev, r])
  }

  const saveRow = async (id: string, patch: Partial<Row>) => {
    const { error } = await supabase
      .from('component_types')
      .update(patch)
      .eq('id', id)

    if (error) {
      alert(error.message)
      return
    }

    setRows(prev =>
      prev.map(r => (r.id === id ? ({ ...r, ...patch } as Row) : r))
    )
  }

  const delRow = async (id: string) => {
    if (!confirm('Ta bort komponenttypen?')) return
    const { error } = await supabase
      .from('component_types')
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
      (r.name ?? '').toLowerCase().includes(s) ||
      (r.code ?? '').toLowerCase().includes(s) ||
      (r.category ?? '').toLowerCase().includes(s)
    )
  }, [rows, q])

  return (
    <Protected>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold">
            Utsida – komponenttyper
          </h1>
          <Link href="/settings" className="text-sm underline">
            ← Till Settings
          </Link>
        </div>

        <p className="text-sm text-gray-600">
          Här definierar du komponenttyper för utsidan (tak, fasad, balkonger, mark m.m.).
          Dessa används sedan när du beskriver byggnader och underhållsplan.
        </p>

        <div className="flex items-center justify-between">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Sök…"
            className="border rounded px-2 py-1 text-sm"
          />
          <button
            onClick={addRow}
            className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
          >
            + Ny komponent
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 pr-3">Kod</th>
                <th className="py-2 pr-3">Namn</th>
                <th className="py-2 pr-3">Kategori</th>
                <th className="py-2 pr-3">Livslängd (år)</th>
                <th className="py-2 pr-3">Underhållsintervall (år)</th>
                <th className="py-2 pr-3">Aktiv</th>
                <th className="py-2 pr-3">Anteckning</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>

            <tbody className="divide-y">
              {filtered.map(r => (
                <tr key={r.id}>
                  <td className="py-2 pr-3">
                    <input
                      className="border rounded px-2 py-1 w-32"
                      value={r.code ?? ''}
                      onChange={e =>
                        saveRow(r.id, { code: e.target.value || null })
                      }
                    />
                  </td>

                  <td className="py-2 pr-3">
                    <input
                      className="border rounded px-2 py-1 w-64"
                      value={r.name}
                      onChange={e => saveRow(r.id, { name: e.target.value })}
                    />
                  </td>

                  <td className="py-2 pr-3">
                    <input
                      className="border rounded px-2 py-1 w-40"
                      placeholder="tak, fasad, balkong…"
                      value={r.category ?? ''}
                      onChange={e =>
                        saveRow(r.id, { category: e.target.value || null })
                      }
                    />
                  </td>

                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-32"
                      value={r.default_lifespan_years ?? ''}
                      onChange={e =>
                        saveRow(r.id, {
                          default_lifespan_years:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </td>

                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-40"
                      value={r.maintenance_interval_years ?? ''}
                      onChange={e =>
                        saveRow(r.id, {
                          maintenance_interval_years:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </td>

                  <td className="py-2 pr-3 text-center">
                    <input
                      type="checkbox"
                      checked={!!r.is_active}
                      onChange={e =>
                        saveRow(r.id, { is_active: e.target.checked })
                      }
                    />
                  </td>

                  <td className="py-2 pr-3">
                    <input
                      className="border rounded px-2 py-1 w-[18rem]"
                      value={r.notes ?? ''}
                      onChange={e =>
                        saveRow(r.id, { notes: e.target.value || null })
                      }
                    />
                  </td>

                  <td className="py-2 pr-3">
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
                  <td className="py-4 text-gray-500" colSpan={8}>
                    Inga rader.
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
