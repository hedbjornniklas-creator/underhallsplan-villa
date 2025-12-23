'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'
import { supabase } from '@/lib/supabaseClient'

type RoomType = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type InteriorGroup = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  field_type: string | null
}

type InteriorOption = {
  id: string
  group_id: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
  trigger_tags?: any | null
}

export default function InsidaSettingsPage() {
  const { isAdmin, loading } = useProfile()

  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [groups, setGroups] = useState<InteriorGroup[]>([])
  const [options, setOptions] = useState<InteriorOption[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const [qRoomTypes, setQRoomTypes] = useState('')
  const [qGroups, setQGroups] = useState('')
  const [qOptions, setQOptions] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loading || !isAdmin) return
    loadAll()
  }, [loading, isAdmin])

  const loadAll = async () => {
    setError(null)
    try {
      const [{ data: rtData, error: rtErr }, { data: gData, error: gErr }, { data: oData, error: oErr }] =
        await Promise.all([
          supabase
            .from('settings_interior_room_types')
            .select('*')
            .order('sort_order', { ascending: true }),
          supabase
            .from('settings_interior_groups')
            .select('*')
            .order('sort_order', { ascending: true }),
          supabase
            .from('settings_interior_options')
            .select('*')
            .order('sort_order', { ascending: true }),
        ])

      if (rtErr) throw rtErr
      if (gErr) throw gErr
      if (oErr) throw oErr

      setRoomTypes((rtData ?? []) as RoomType[])
      const gArr = (gData ?? []) as InteriorGroup[]
      setGroups(gArr)
      setOptions((oData ?? []) as InteriorOption[])

      if (!selectedGroupId && gArr.length) {
        setSelectedGroupId(gArr[0].id)
      }
    } catch (e: any) {
      console.error('loadAll insida settings failed:', e)
      setError(e?.message ?? 'Kunde inte ladda inställningar för insida.')
    }
  }

  // ----------------- RoomTypes CRUD -----------------
  const addRoomType = async () => {
    setSaving(true)
    try {
      const key = `room_${Math.random().toString(36).slice(2, 7)}`
      const maxSort = roomTypes.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0)
      const { data, error } = await supabase
        .from('settings_interior_room_types')
        .insert({
          key,
          label: 'Ny rumstyp',
          sort_order: maxSort + 10,
          is_active: true,
        })
        .select('*')
        .single()

      if (error) throw error
      const rt = data as RoomType
      setRoomTypes(prev => [...prev, rt].sort((a, b) => a.sort_order - b.sort_order))
    } catch (e: any) {
      console.error(e)
      alert(e?.message ?? 'Kunde inte skapa rumstyp.')
    } finally {
      setSaving(false)
    }
  }

  const saveRoomType = async (id: string, patch: Partial<RoomType>) => {
    setRoomTypes(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
    const { error } = await supabase
      .from('settings_interior_room_types')
      .update(patch)
      .eq('id', id)
    if (error) {
      console.error(error)
      alert(error.message)
    }
  }

  const delRoomType = async (id: string) => {
    if (!confirm('Ta bort rumstypen?')) return
    const { error } = await supabase
      .from('settings_interior_room_types')
      .delete()
      .eq('id', id)
    if (error) {
      console.error(error)
      alert(error.message)
      return
    }
    setRoomTypes(prev => prev.filter(r => r.id !== id))
  }

  // ----------------- Groups CRUD -----------------
  const addGroup = async () => {
    setSaving(true)
    try {
      const key = `grp_${Math.random().toString(36).slice(2, 7)}`
      const maxSort = groups.reduce((m, g) => Math.max(m, g.sort_order ?? 0), 0)
      const { data, error } = await supabase
        .from('settings_interior_groups')
        .insert({
          key,
          label: 'Ny grupp',
          sort_order: maxSort + 10,
          is_active: true,
          field_type: 'select',
        })
        .select('*')
        .single()

      if (error) throw error
      const g = data as InteriorGroup
      const next = [...groups, g].sort((a, b) => a.sort_order - b.sort_order)
      setGroups(next)
      setSelectedGroupId(g.id)
    } catch (e: any) {
      console.error(e)
      alert(e?.message ?? 'Kunde inte skapa grupp.')
    } finally {
      setSaving(false)
    }
  }

  const saveGroup = async (id: string, patch: Partial<InteriorGroup>) => {
    setGroups(prev => prev.map(g => (g.id === id ? { ...g, ...patch } : g)))
    const { error } = await supabase
      .from('settings_interior_groups')
      .update(patch)
      .eq('id', id)
    if (error) {
      console.error(error)
      alert(error.message)
    }
  }

  const delGroup = async (id: string) => {
    if (!confirm('Ta bort gruppen (och dess val)?')) return
    const { error } = await supabase
      .from('settings_interior_groups')
      .delete()
      .eq('id', id)
    if (error) {
      console.error(error)
      alert(error.message)
      return
    }
    const nextGroups = groups.filter(g => g.id !== id)
    setGroups(nextGroups)
    setOptions(prev => prev.filter(o => o.group_id !== id))
    setSelectedGroupId(nextGroups[0]?.id ?? null)
  }

  // ----------------- Options CRUD -----------------
  const addOption = async () => {
    if (!selectedGroupId) return
    setSaving(true)
    try {
      const value = `val_${Math.random().toString(36).slice(2, 7)}`
      const groupOptions = options.filter(o => o.group_id === selectedGroupId)
      const maxSort = groupOptions.reduce((m, o) => Math.max(m, o.sort_order ?? 0), 0)

      const { data, error } = await supabase
        .from('settings_interior_options')
        .insert({
          group_id: selectedGroupId,
          value,
          label: 'Nytt val',
          sort_order: maxSort + 10,
          is_active: true,
        })
        .select('*')
        .single()

      if (error) throw error
      const opt = data as InteriorOption
      setOptions(prev => [...prev, opt].sort((a, b) => a.sort_order - b.sort_order))
    } catch (e: any) {
      console.error(e)
      alert(e?.message ?? 'Kunde inte skapa val.')
    } finally {
      setSaving(false)
    }
  }

  const saveOption = async (id: string, patch: Partial<InteriorOption>) => {
    setOptions(prev => prev.map(o => (o.id === id ? { ...o, ...patch } : o)))
    const { error } = await supabase
      .from('settings_interior_options')
      .update(patch)
      .eq('id', id)
    if (error) {
      console.error(error)
      alert(error.message)
    }
  }

  const delOption = async (id: string) => {
    if (!confirm('Ta bort val?')) return
    const { error } = await supabase
      .from('settings_interior_options')
      .delete()
      .eq('id', id)
    if (error) {
      console.error(error)
      alert(error.message)
      return
    }
    setOptions(prev => prev.filter(o => o.id !== id))
  }

  // ----------------- FILTERS -----------------
  const filteredRoomTypes = useMemo(() => {
    const s = qRoomTypes.trim().toLowerCase()
    if (!s) return roomTypes
    return roomTypes.filter(
      r =>
        r.label.toLowerCase().includes(s) ||
        r.key.toLowerCase().includes(s)
    )
  }, [roomTypes, qRoomTypes])

  const filteredGroups = useMemo(() => {
    const s = qGroups.trim().toLowerCase()
    if (!s) return groups
    return groups.filter(
      g =>
        g.label.toLowerCase().includes(s) ||
        g.key.toLowerCase().includes(s)
    )
  }, [groups, qGroups])

  const selectedGroup = groups.find(g => g.id === selectedGroupId) || null

  const filteredOptions = useMemo(() => {
    if (!selectedGroup) return []
    const s = qOptions.trim().toLowerCase()
    const byGroup = options.filter(o => o.group_id === selectedGroup.id)
    if (!s) return byGroup
    return byGroup.filter(
      o =>
        o.label.toLowerCase().includes(s) ||
        o.value.toLowerCase().includes(s)
    )
  }, [options, selectedGroup, qOptions])

  // ----------------- GUARDS -----------------
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
      <div className="p-4 md:p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Insida – inställningar</h1>
            <p className="text-sm text-gray-600 mt-1">
              Här definierar du rumstyper och vilka fält/dropdowns som finns för invändiga rum.
            </p>
          </div>
          <Link href="/settings" className="text-sm underline">
            ← Till Settings
          </Link>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Rumstyper */}
          <section className="rounded-2xl border bg-white p-4 space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Rumstyper</h2>
              <button
                onClick={addRoomType}
                disabled={saving}
                className="text-xs rounded-md bg-emerald-600 text-white px-2.5 py-1.5 disabled:opacity-50"
              >
                + Ny rumstyp
              </button>
            </header>

            <input
              value={qRoomTypes}
              onChange={e => setQRoomTypes(e.target.value)}
              placeholder="Sök rumstyp…"
              className="w-full rounded-md border px-2 py-1 text-sm"
            />

            <div className="mt-2 space-y-2 max-h-[60vh] overflow-auto pr-1">
              {filteredRoomTypes.map(r => (
                <div
                  key={r.id}
                  className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 space-y-2 text-sm"
                >
                  <div>
                    <label className="text-xs text-gray-600">Label</label>
                    <input
                      className="mt-0.5 w-full rounded-md border px-2 py-1 text-sm"
                      value={r.label}
                      onChange={e => saveRoomType(r.id, { label: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-600">Key (intern kod)</label>
                    <input
                      className="mt-0.5 w-full rounded-md border px-2 py-1 text-xs font-mono"
                      value={r.key}
                      onChange={e => saveRoomType(r.id, { key: e.target.value.trim() })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <label className="text-xs text-gray-600">Sort order</label>
                      <input
                        type="number"
                        className="mt-0.5 w-20 rounded-md border px-2 py-1 text-sm"
                        value={r.sort_order}
                        onChange={e =>
                          saveRoomType(r.id, {
                            sort_order: Number(e.target.value || 0),
                          })
                        }
                      />
                    </div>
                    <label className="mt-4 text-xs flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={!!r.is_active}
                        onChange={e =>
                          saveRoomType(r.id, { is_active: e.target.checked })
                        }
                      />
                      Aktiv
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => delRoomType(r.id)}
                      className="text-xs text-rose-700 underline"
                    >
                      Ta bort
                    </button>
                  </div>
                </div>
              ))}

              {filteredRoomTypes.length === 0 && (
                <div className="text-xs text-gray-500 py-3">
                  Inga rumstyper hittades.
                </div>
              )}
            </div>
          </section>

          {/* Grupper */}
          <section className="rounded-2xl border bg-white p-4 space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Grupper / fält</h2>
              <button
                onClick={addGroup}
                disabled={saving}
                className="text-xs rounded-md bg-emerald-600 text-white px-2.5 py-1.5 disabled:opacity-50"
              >
                + Ny grupp
              </button>
            </header>

            <input
              value={qGroups}
              onChange={e => setQGroups(e.target.value)}
              placeholder="Sök grupp…"
              className="w-full rounded-md border px-2 py-1 text-sm"
            />

            <div className="mt-2 space-y-1 max-h-[60vh] overflow-auto pr-1">
              {filteredGroups.map(g => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`w-full text-left rounded-lg px-3 py-2 text-sm border ${
                    selectedGroupId === g.id
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white hover:bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="font-medium">{g.label}</div>
                  <div
                    className={`text-xs ${
                      selectedGroupId === g.id ? 'text-gray-200' : 'text-gray-500'
                    }`}
                  >
                    key: {g.key}
                  </div>
                </button>
              ))}

              {filteredGroups.length === 0 && (
                <div className="text-xs text-gray-500 py-3">
                  Inga grupper definierade.
                </div>
              )}
            </div>

            {selectedGroup && (
              <div className="mt-3 border-t pt-3 space-y-2">
                <div className="text-xs font-semibold text-gray-700">
                  Redigera vald grupp
                </div>

                <label className="text-xs text-gray-600">Label</label>
                <input
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  value={selectedGroup.label}
                  onChange={e =>
                    saveGroup(selectedGroup.id, { label: e.target.value })
                  }
                />

                <label className="text-xs text-gray-600">Key (unik)</label>
                <input
                  className="w-full rounded-md border px-2 py-1 text-xs font-mono"
                  value={selectedGroup.key}
                  onChange={e =>
                    saveGroup(selectedGroup.id, { key: e.target.value.trim() })
                  }
                />

                <div className="flex items-center justify-between gap-2">
                  <div>
                    <label className="text-xs text-gray-600">Sort order</label>
                    <input
                      type="number"
                      className="w-24 rounded-md border px-2 py-1 text-sm"
                      value={selectedGroup.sort_order}
                      onChange={e =>
                        saveGroup(selectedGroup.id, {
                          sort_order: Number(e.target.value || 0),
                        })
                      }
                    />
                  </div>

                  <label className="mt-4 text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!selectedGroup.is_active}
                      onChange={e =>
                        saveGroup(selectedGroup.id, {
                          is_active: e.target.checked,
                        })
                      }
                    />
                    Aktiv
                  </label>
                </div>

                <button
                  onClick={() => delGroup(selectedGroup.id)}
                  className="text-xs text-rose-700 underline pt-1"
                >
                  Ta bort grupp
                </button>
              </div>
            )}
          </section>

          {/* Val per grupp */}
          <section className="rounded-2xl border bg-white p-4 space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Val {selectedGroup ? `– ${selectedGroup.label}` : ''}
              </h2>
              <button
                onClick={addOption}
                disabled={!selectedGroupId || saving}
                className="text-xs rounded-md bg-emerald-600 text-white px-2.5 py-1.5 disabled:opacity-50"
              >
                + Nytt val
              </button>
            </header>

            {!selectedGroup ? (
              <div className="text-sm text-gray-500">
                Välj en grupp i mitten för att hantera dess val.
              </div>
            ) : (
              <>
                <input
                  value={qOptions}
                  onChange={e => setQOptions(e.target.value)}
                  placeholder="Sök val…"
                  className="w-full rounded-md border px-2 py-1 text-sm"
                />

                <div className="mt-2 space-y-2 max-h-[60vh] overflow-auto pr-1">
                  {filteredOptions.map(o => (
                    <div
                      key={o.id}
                      className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2 text-sm"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-600">Label</label>
                          <input
                            className="mt-0.5 w-full rounded-md border px-2 py-1 text-sm"
                            value={o.label}
                            onChange={e =>
                              saveOption(o.id, { label: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">
                            Value (intern kod)
                          </label>
                          <input
                            className="mt-0.5 w-full rounded-md border px-2 py-1 text-xs font-mono"
                            value={o.value}
                            onChange={e =>
                              saveOption(o.id, { value: e.target.value.trim() })
                            }
                          />
                        </div>

                        <div>
                          <label className="text-xs text-gray-600">Sort order</label>
                          <input
                            type="number"
                            className="mt-0.5 w-24 rounded-md border px-2 py-1 text-sm"
                            value={o.sort_order}
                            onChange={e =>
                              saveOption(o.id, {
                                sort_order: Number(e.target.value || 0),
                              })
                            }
                          />
                        </div>

                        <div className="flex items-center mt-5">
                          <label className="text-xs flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={!!o.is_active}
                              onChange={e =>
                                saveOption(o.id, { is_active: e.target.checked })
                              }
                            />
                            Aktiv
                          </label>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs text-gray-600">
                          Trigger tags (JSON, valfritt)
                        </label>
                        <input
                          className="w-full rounded-md border px-2 py-1 text-xs font-mono"
                          placeholder='t.ex. ["riskkonstruktion","våtrum"]'
                          value={o.trigger_tags ? JSON.stringify(o.trigger_tags) : ''}
                          onChange={e => {
                            const v = e.target.value.trim()
                            let parsed: any = null
                            if (v) {
                              try {
                                parsed = JSON.parse(v)
                              } catch {
                                // låt användaren skriva klart; spara inte trasig JSON
                                return
                              }
                            }
                            saveOption(o.id, { trigger_tags: parsed })
                          }}
                        />
                      </div>

                      <div className="flex justify-end">
                        <button
                          onClick={() => delOption(o.id)}
                          className="text-xs text-rose-700 underline"
                        >
                          Ta bort val
                        </button>
                      </div>
                    </div>
                  ))}

                  {filteredOptions.length === 0 && (
                    <div className="text-xs text-gray-500 py-3">
                      Inga val definierade för denna grupp ännu.
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {saving && (
          <div className="text-xs text-gray-500">
            Sparar…
          </div>
        )}
      </div>
    </Protected>
  )
}
