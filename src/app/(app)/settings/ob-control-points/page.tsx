'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Scope = 'interior' | 'exterior'

type ControlPoint = {
  id?: string
  scope: Scope
  key: string
  title: string
  description: string | null
  sort_order: number
  exterior_item_key: string | null
  room_type_key: string | null
  // NYTT: vilka rumstyper denna punkt auto-förslås i
  trigger_room_types: string[]
  tags_array: string[]
  risk_tags_array: string[]
  is_active: boolean
}

type RoomType = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type ExteriorItem = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

const scopeLabel = (scope: Scope) =>
  scope === 'interior' ? 'Insida (invändigt)' : 'Utsida (utvändigt)'

// Visa snyggare namn för utsida-keys om du vill
const exteriorKeyLabel = (key: string, label: string) => {
  if (!key) return label
  if (key === 'mark') return 'Mark'
  if (key === 'grundmur_sockel') return 'Grundmur / sockel'
  if (key === 'fasad') return 'Fasad'
  if (key === 'dorrar_fonster') return 'Dörrar / fönster'
  if (key === 'yttertak') return 'Yttertak'
  if (key === 'ovrigt') return 'Allmänt'
  return label || key
}

export default function SettingsControlPointsPage() {
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [points, setPoints] = useState<ControlPoint[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [exteriorItems, setExteriorItems] = useState<ExteriorItem[]>([])

  const [filterScope, setFilterScope] = useState<Scope | 'all'>('all')
  const [search, setSearch] = useState('')

  // -----------------------------
  // Helpers för tags <-> text
  // -----------------------------
  const parseTags = (s: string): string[] =>
    s
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)

  const tagsToText = (arr: string[]) => arr.join(', ')

  // -----------------------------
  // Load all settings
  // -----------------------------
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true)
      setError(null)
      try {
        const [
          { data: cpData, error: cpErr },
          { data: rtData, error: rtErr },
          { data: exData, error: exErr },
        ] = await Promise.all([
          supabase
            .from('settings_control_points')
            .select('*')
            .order('scope', { ascending: true })
            .order('sort_order', { ascending: true })
            .order('title', { ascending: true }),
          supabase
            .from('settings_interior_room_types')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('settings_exterior_items')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
        ])

        if (cpErr) throw cpErr
        if (rtErr) throw rtErr
        if (exErr) throw exErr

        const cpArr = (cpData ?? []) as any[]

      const normalized: ControlPoint[] = cpArr.map(row => ({
        id: row.id,
        scope: row.scope as Scope,
        key: row.key,
        title: row.title,
        description: row.description,
        sort_order: row.sort_order,
          exterior_item_key: row.exterior_item_key ?? null,
          room_type_key: row.room_type_key ?? null,
          trigger_room_types: Array.isArray(row.trigger_room_types)
            ? row.trigger_room_types
            : [],
          tags_array: Array.isArray(row.tags) ? row.tags : [],
          risk_tags_array: Array.isArray(row.risk_tags) ? row.risk_tags : [],
          is_active: row.is_active,
        }))

        setPoints(normalized)
        setRoomTypes((rtData ?? []) as RoomType[])
        setExteriorItems((exData ?? []) as ExteriorItem[])
      } catch (e: any) {
        console.error('loadAll control points failed:', e)
        setError(e?.message ?? 'Kunde inte läsa kontrollpunkter.')
      } finally {
        setLoading(false)
      }
    }

    loadAll()
  }, [])

  // -----------------------------
  // CRUD helpers
  // -----------------------------
  const updateLocalPoint = (id: string | undefined, patch: Partial<ControlPoint>) => {
    setPoints(prev => {
      // Om vi har ett riktigt id
      if (id) {
        return prev.map(p => (p.id === id ? { ...p, ...patch } : p))
      }
      // Ny rad utan id: uppdatera första raden utan id
      let updated = false
      return prev.map(p => {
        if (!p.id && !updated) {
          updated = true
          return { ...p, ...patch }
        }
        return p
      })
    })
  }

  const addNewPoint = () => {
    setPoints(prev => [
      {
        scope: 'interior',
        key: '',
        title: '',
        description: '',
        sort_order: 100,
        exterior_item_key: null,
        room_type_key: null,
        trigger_room_types: [],
        tags_array: [],
        risk_tags_array: [],
        is_active: true,
      },
      ...prev,
    ])
    setSavingId('new')
  }

  const savePoint = async (p: ControlPoint) => {
    const isNew = !p.id

    if (!p.key.trim() || !p.title.trim()) {
      alert('Key och titel måste fyllas i.')
      return
    }

    setSavingId(p.id ?? 'new')
    setError(null)

    try {
      if (isNew) {
        const { data, error } = await supabase
          .from('settings_control_points')
          .insert({
            scope: p.scope,
            key: p.key.trim(),
            title: p.title.trim(),
            description: p.description?.trim() || null,
            sort_order: p.sort_order ?? 100,
            exterior_item_key: p.scope === 'exterior' ? p.exterior_item_key : null,
            room_type_key: p.scope === 'interior' ? p.room_type_key : null,
            trigger_room_types: p.scope === 'interior' ? p.trigger_room_types : [],
            tags: p.tags_array,
            risk_tags: p.risk_tags_array,
            is_active: p.is_active,
          })
          .select('*')
          .single()

        if (error) throw error

        const row: any = data
        const saved: ControlPoint = {
          id: row.id,
          scope: row.scope,
          key: row.key,
          title: row.title,
          description: row.description,
          sort_order: row.sort_order,
          exterior_item_key: row.exterior_item_key,
          room_type_key: row.room_type_key,
          trigger_room_types: Array.isArray(row.trigger_room_types)
            ? row.trigger_room_types
            : [],
          tags_array: Array.isArray(row.tags) ? row.tags : [],
          risk_tags_array: Array.isArray(row.risk_tags) ? row.risk_tags : [],
          is_active: row.is_active,
        }

        setPoints(prev => {
          const tmpIndex = prev.findIndex(x => !x.id)
          if (tmpIndex === -1) return [saved, ...prev]
          const clone = [...prev]
          clone[tmpIndex] = saved
          return clone
        })
      } else {
        const { data, error } = await supabase
          .from('settings_control_points')
          .update({
            scope: p.scope,
            title: p.title.trim(),
            description: p.description?.trim() || null,
            sort_order: p.sort_order ?? 100,
            exterior_item_key: p.scope === 'exterior' ? p.exterior_item_key : null,
            room_type_key: p.scope === 'interior' ? p.room_type_key : null,
            trigger_room_types: p.scope === 'interior' ? p.trigger_room_types : [],
            tags: p.tags_array,
            risk_tags: p.risk_tags_array,
            is_active: p.is_active,
          })
          .eq('id', p.id)
          .select('*')
          .single()

        if (error) throw error

        const row: any = data
        const saved: ControlPoint = {
          id: row.id,
          scope: row.scope,
          key: row.key,
          title: row.title,
          description: row.description,
          sort_order: row.sort_order,
          exterior_item_key: row.exterior_item_key,
          room_type_key: row.room_type_key,
          trigger_room_types: Array.isArray(row.trigger_room_types)
            ? row.trigger_room_types
            : [],
          tags_array: Array.isArray(row.tags) ? row.tags : [],
          risk_tags_array: Array.isArray(row.risk_tags) ? row.risk_tags : [],
          is_active: row.is_active,
        }

        setPoints(prev => prev.map(x => (x.id === saved.id ? saved : x)))
      }
    } catch (e: any) {
      console.error('save control point failed:', e)
      setError(e?.message ?? 'Kunde inte spara kontrollpunkt.')
    } finally {
      setSavingId(null)
    }
  }

  const deactivatePoint = async (p: ControlPoint) => {
    if (!p.id) return
    if (!confirm('Sätta kontrollpunkten som inaktiv?')) return

    setSavingId(p.id)
    try {
      const { error } = await supabase
        .from('settings_control_points')
        .update({ is_active: false })
        .eq('id', p.id)

      if (error) throw error

      setPoints(prev =>
        prev.map(x => (x.id === p.id ? { ...x, is_active: false } : x))
      )
    } catch (e: any) {
      console.error('deactivate control point failed:', e)
      setError(e?.message ?? 'Kunde inte uppdatera kontrollpunkt.')
    } finally {
      setSavingId(null)
    }
  }

  // -----------------------------
  // Derived lists
  // -----------------------------
  const filteredPoints = useMemo(() => {
    let list = points
    if (filterScope !== 'all') {
      list = list.filter(p => p.scope === filterScope)
    }
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(p =>
        (p.key && p.key.toLowerCase().includes(s)) ||
        (p.title && p.title.toLowerCase().includes(s))
      )
    }
    return list
  }, [points, filterScope, search])

  // -----------------------------
  // Render helpers
  // -----------------------------
  const renderScopeBadge = (scope: Scope) => (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ' +
        (scope === 'interior'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-emerald-50 text-emerald-700')
      }
    >
      {scopeLabel(scope)}
    </span>
  )

  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Laddar kontrollpunkter…</div>
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-gray-900">
          Kontrollpunkter – ÖB
        </h1>
        <p className="text-sm text-gray-700">
          Här definierar du kontrollpunkter som kan kopplas till insida/utsida.
          Varje punkt kan kopplas till en specifik rumstyp eller utside-komponent
          och auto-förslås i valda rumstyper via kryssrutorna.
        </p>
      </header>

      {/* Filter + ny-knapp */}
      <section className="flex flex-wrap items-center gap-2">
        <select
          value={filterScope}
          onChange={e => setFilterScope(e.target.value as Scope | 'all')}
          className="rounded-md border px-2 py-1.5 text-xs bg-white"
        >
          <option value="all">Alla scopes</option>
          <option value="interior">Insida</option>
          <option value="exterior">Utsida</option>
        </select>

        <input
          type="text"
          placeholder="Sök på key / titel / fråga…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-56 rounded-md border px-2 py-1.5 text-xs"
        />

        <button
          type="button"
          onClick={addNewPoint}
          className="ml-auto inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
        >
          + Ny kontrollpunkt
        </button>
      </section>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Lista med kontrollpunkter */}
      <section className="space-y-4">
        {filteredPoints.map(p => {
          const isSaving = savingId === p.id || (savingId === 'new' && !p.id)

          return (
            <article
              key={p.id ?? `new-${p.key}-${p.title}`}
              className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-3"
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {renderScopeBadge(p.scope)}
                  <span className="text-xs text-gray-500 font-mono">
                    {p.key || '(ny kontrollpunkt)'}
                  </span>
                  {!p.is_active && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                      Inaktiv
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <label className="inline-flex items-center gap-1 text-gray-700">
                    <input
                      type="checkbox"
                      checked={p.is_active}
                      onChange={e =>
                        updateLocalPoint(p.id, { is_active: e.target.checked })
                      }
                    />
                    Aktiv
                  </label>

                  {p.id && (
                    <button
                      type="button"
                      onClick={() => deactivatePoint(p)}
                      className="text-rose-600 hover:underline"
                    >
                      Sätt inaktiv
                    </button>
                  )}
                </div>
              </header>

              {/* Övre rad: scope, key, sort_order */}
              <div className="grid gap-3 md:grid-cols-4 text-sm">
                <div>
                  <label className="text-xs text-gray-600">Scope</label>
                  <select
                    className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-white"
                    value={p.scope}
                    onChange={e =>
                      updateLocalPoint(p.id, {
                        scope: e.target.value as Scope,
                        exterior_item_key:
                          e.target.value === 'exterior' ? p.exterior_item_key : null,
                        room_type_key:
                          e.target.value === 'interior' ? p.room_type_key : null,
                        trigger_room_types:
                          e.target.value === 'interior' ? p.trigger_room_types : [],
                      })
                    }
                  >
                    <option value="interior">Insida</option>
                    <option value="exterior">Utsida</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-600">Key (unik)</label>
                  <input
                    className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm font-mono"
                    value={p.key}
                    onChange={e =>
                      updateLocalPoint(p.id, { key: e.target.value })
                    }
                    placeholder="t.ex. badrum_vagg_tatskikt"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Sortering</label>
                  <input
                    type="number"
                    className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                    value={p.sort_order ?? 100}
                    onChange={e =>
                      updateLocalPoint(p.id, {
                        sort_order: Number(e.target.value) || 100,
                      })
                    }
                  />
                </div>

                {/* Koppling: rumstyp eller utsida-komponent */}
                {p.scope === 'interior' ? (
                  <div>
                    <label className="text-xs text-gray-600">
                      Primär rumstyp (valfritt)
                    </label>
                    <select
                      className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-white"
                      value={p.room_type_key ?? ''}
                      onChange={e =>
                        updateLocalPoint(p.id, {
                          room_type_key: e.target.value || null,
                        })
                      }
                    >
                      <option value="">(ingen specifik)</option>
                      {roomTypes.map(rt => (
                        <option key={rt.id} value={rt.key}>
                          {rt.label}
                        </option>
                      ))}
                    </select>

                    {/* NYTT: multi-select för auto-förslag i rumstyper */}
                    <div className="mt-2 space-y-1">
                      <div className="text-[11px] text-gray-600">
                        Auto-förslag i rumstyper
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {roomTypes.map(rt => {
                          const checked = p.trigger_room_types.includes(rt.key)
                          return (
                            <label
                              key={rt.id}
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] bg-gray-50"
                            >
                              <input
                                type="checkbox"
                                className="h-3 w-3"
                                checked={checked}
                                onChange={e => {
                                  const next = new Set(p.trigger_room_types)
                                  if (e.target.checked) {
                                    next.add(rt.key)
                                  } else {
                                    next.delete(rt.key)
                                  }
                                  updateLocalPoint(p.id, {
                                    trigger_room_types: Array.from(next),
                                  })
                                }}
                              />
                              <span>{rt.label}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-gray-600">
                      Kopplad utsida-komponent
                    </label>
                    <select
                      className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-white"
                      value={p.exterior_item_key ?? ''}
                      onChange={e =>
                        updateLocalPoint(p.id, {
                          exterior_item_key: e.target.value || null,
                        })
                      }
                    >
                      <option value="">(ingen specifik)</option>
                      {exteriorItems.map(ex => (
                        <option key={ex.id} value={ex.key}>
                          {exteriorKeyLabel(ex.key, ex.label)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Titel */}
              <div className="grid gap-3 md:grid-cols-2 text-sm">
                <div>
                  <label className="text-xs text-gray-600">Titel</label>
                  <input
                    className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                    value={p.title}
                    onChange={e =>
                      updateLocalPoint(p.id, { title: e.target.value })
                    }
                    placeholder="t.ex. Tätskikt på vägg"
                  />
                </div>
              </div>

              <div className="space-y-1 text-sm">
                <label className="text-xs text-gray-600">
                  Beskrivning (internt)
                </label>
                <textarea
                  rows={2}
                  className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                  value={p.description ?? ''}
                  onChange={e =>
                    updateLocalPoint(p.id, { description: e.target.value || null })
                  }
                  placeholder="Förklaring till vad kontrollpunkten avser…"
                />
              </div>

              {/* Tags */}
              <div className="grid gap-3 md:grid-cols-2 text-sm">
                <div>
                  <label className="text-xs text-gray-600">
                    Tags (komma-separerade)
                  </label>
                  <input
                    className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                    value={tagsToText(p.tags_array)}
                    onChange={e =>
                      updateLocalPoint(p.id, {
                        tags_array: parseTags(e.target.value),
                      })
                    }
                    placeholder="t.ex. badrum, vägg, tätskikt"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">
                    Risk-tags (komma-separerade)
                  </label>
                  <input
                    className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                    value={tagsToText(p.risk_tags_array)}
                    onChange={e =>
                      updateLocalPoint(p.id, {
                        risk_tags_array: parseTags(e.target.value),
                      })
                    }
                    placeholder="t.ex. fuktrisk, våtrum"
                  />
                </div>
              </div>

              <footer className="flex justify-end gap-2 pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => savePoint(p)}
                  disabled={!!savingId}
                  className="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {isSaving ? 'Sparar…' : 'Spara kontrollpunkt'}
                </button>
              </footer>
            </article>
          )
        })}

        {filteredPoints.length === 0 && (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-gray-500">
            Inga kontrollpunkter matchar filtret.
            <br />
            Justera filter eller lägg till en ny kontrollpunkt.
          </div>
        )}
      </section>
    </div>
  )
}

