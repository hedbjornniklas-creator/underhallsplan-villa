'use client'

import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type ExteriorItem = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type ExteriorGroup = {
  id: string
  item_id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  field_type: string
}

type ExteriorOption = {
  id: string
  group_id: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
  trigger_tags: any | null
}

const FIELD_TYPES = ['select', 'boolean', 'text'] as const
type FieldType = (typeof FIELD_TYPES)[number]

export default function ObUtsidaSettingsPage() {
  const { isAdmin, loading } = useProfile()

  const [items, setItems] = useState<ExteriorItem[]>([])
  const [groups, setGroups] = useState<ExteriorGroup[]>([])
  const [options, setOptions] = useState<ExteriorOption[]>([])

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const [qItems, setQItems] = useState('')
  const [qGroups, setQGroups] = useState('')
  const [qOptions, setQOptions] = useState('')

  const [saving, setSaving] = useState(false)

  // -----------------------------
  // LOAD
  // -----------------------------
  useEffect(() => {
    if (loading || !isAdmin) return
    loadItems()
  }, [loading, isAdmin])

  const loadItems = async () => {
    const { data, error } = await supabase
      .from('settings_exterior_items')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }

    const arr = (data ?? []) as ExteriorItem[]
    setItems(arr)
    if (!selectedItemId && arr.length) {
      setSelectedItemId(arr[0].id)
    }
  }

  const loadGroups = async (itemId: string) => {
    const { data, error } = await supabase
      .from('settings_exterior_groups')
      .select('*')
      .eq('item_id', itemId)
      .order('sort_order', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }

    const arr = (data ?? []) as ExteriorGroup[]
    setGroups(arr)

    if (!arr.find(g => g.id === selectedGroupId)) {
      setSelectedGroupId(arr[0]?.id ?? null)
    }
  }

  const loadOptions = async (groupId: string) => {
    const { data, error } = await supabase
      .from('settings_exterior_options')
      .select('*')
      .eq('group_id', groupId)
      .order('sort_order', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }

    setOptions((data ?? []) as ExteriorOption[])
  }

  // när item väljs -> ladda grupper
  useEffect(() => {
    if (!selectedItemId) {
      setGroups([])
      setSelectedGroupId(null)
      return
    }
    loadGroups(selectedItemId)
  }, [selectedItemId])

  // när group väljs -> ladda options
  useEffect(() => {
    if (!selectedGroupId) {
      setOptions([])
      return
    }
    loadOptions(selectedGroupId)
  }, [selectedGroupId])

  // -----------------------------
  // CRUD HELPERS
  // -----------------------------
  const addItem = async () => {
    setSaving(true)
    const key = `item_${Math.random().toString(36).slice(2, 7)}`
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0)

    const { data, error } = await supabase
      .from('settings_exterior_items')
      .insert({
        key,
        label: 'Ny utsida-del',
        sort_order: maxSort + 10,
        is_active: true,
      })
      .select('*')
      .single()

    setSaving(false)
    if (error) return alert(error.message)

    const newItem = data as ExteriorItem
    setItems(prev => [...prev, newItem].sort((a, b) => a.sort_order - b.sort_order))
    setSelectedItemId(newItem.id)
  }

  const saveItem = async (id: string, patch: Partial<ExteriorItem>) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)))
    const { error } = await supabase
      .from('settings_exterior_items')
      .update(patch)
      .eq('id', id)

    if (error) alert(error.message)
  }

  const delItem = async (id: string) => {
    if (!confirm('Ta bort utsida-del? Detta påverkar ÖB Utsida.')) return
    setSaving(true)
    const { error } = await supabase
      .from('settings_exterior_items')
      .delete()
      .eq('id', id)

    setSaving(false)
    if (error) return alert(error.message)

    const next = items.filter(i => i.id !== id)
    setItems(next)
    setSelectedItemId(next[0]?.id ?? null)
  }

  const addGroup = async () => {
    if (!selectedItemId) return
    setSaving(true)
    const key = `group_${Math.random().toString(36).slice(2, 7)}`
    const maxSort = groups.reduce((m, g) => Math.max(m, g.sort_order ?? 0), 0)

    const { data, error } = await supabase
      .from('settings_exterior_groups')
      .insert({
        item_id: selectedItemId,
        key,
        label: 'Ny parameter',
        sort_order: maxSort + 10,
        is_active: true,
        field_type: 'select',
      })
      .select('*')
      .single()

    setSaving(false)
    if (error) return alert(error.message)

    const newGroup = data as ExteriorGroup
    const next = [...groups, newGroup].sort((a, b) => a.sort_order - b.sort_order)
    setGroups(next)
    setSelectedGroupId(newGroup.id)
  }

  const saveGroup = async (id: string, patch: Partial<ExteriorGroup>) => {
    setGroups(prev => prev.map(g => (g.id === id ? { ...g, ...patch } : g)))
    const { error } = await supabase
      .from('settings_exterior_groups')
      .update(patch)
      .eq('id', id)

    if (error) alert(error.message)
  }

  const delGroup = async (id: string) => {
    if (!confirm('Ta bort parameter?')) return
    setSaving(true)
    const { error } = await supabase
      .from('settings_exterior_groups')
      .delete()
      .eq('id', id)

    setSaving(false)
    if (error) return alert(error.message)

    const next = groups.filter(g => g.id !== id)
    setGroups(next)
    setSelectedGroupId(next[0]?.id ?? null)
  }

  const addOption = async () => {
    if (!selectedGroupId) return
    setSaving(true)
    const value = `val_${Math.random().toString(36).slice(2, 6)}`
    const maxSort = options.reduce((m, o) => Math.max(m, o.sort_order ?? 0), 0)

    const { data, error } = await supabase
      .from('settings_exterior_options')
      .insert({
        group_id: selectedGroupId,
        value,
        label: 'Nytt val',
        sort_order: maxSort + 10,
        is_active: true,
        trigger_tags: null,
      })
      .select('*')
      .single()

    setSaving(false)
    if (error) return alert(error.message)

    const newOpt = data as ExteriorOption
    const next = [...options, newOpt].sort((a, b) => a.sort_order - b.sort_order)
    setOptions(next)
  }

  const saveOption = async (id: string, patch: Partial<ExteriorOption>) => {
    setOptions(prev => prev.map(o => (o.id === id ? { ...o, ...patch } : o)))
    const { error } = await supabase
      .from('settings_exterior_options')
      .update(patch)
      .eq('id', id)

    if (error) alert(error.message)
  }

  const delOption = async (id: string) => {
    if (!confirm('Ta bort val?')) return
    setSaving(true)
    const { error } = await supabase
      .from('settings_exterior_options')
      .delete()
      .eq('id', id)

    setSaving(false)
    if (error) return alert(error.message)

    setOptions(prev => prev.filter(o => o.id !== id))
  }

  // -----------------------------
  // FILTERS
  // -----------------------------
  const filteredItems = useMemo(() => {
    const s = qItems.trim().toLowerCase()
    if (!s) return items
    return items.filter(i =>
      (i.label ?? '').toLowerCase().includes(s) ||
      (i.key ?? '').toLowerCase().includes(s)
    )
  }, [items, qItems])

  const filteredGroups = useMemo(() => {
    const s = qGroups.trim().toLowerCase()
    if (!s) return groups
    return groups.filter(g =>
      (g.label ?? '').toLowerCase().includes(s) ||
      (g.key ?? '').toLowerCase().includes(s)
    )
  }, [groups, qGroups])

  const filteredOptions = useMemo(() => {
    const s = qOptions.trim().toLowerCase()
    if (!s) return options
    return options.filter(o =>
      (o.label ?? '').toLowerCase().includes(s) ||
      (o.value ?? '').toLowerCase().includes(s)
    )
  }, [options, qOptions])

  // -----------------------------
  // GUARDS
  // -----------------------------
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

  const selectedItem = items.find(i => i.id === selectedItemId) || null
  const selectedGroup = groups.find(g => g.id === selectedGroupId) || null

  return (
    <Protected>
      <div className="p-4 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">ÖB – Utsida (settings)</h1>
            <p className="text-sm text-gray-600 mt-1">
              Här styr du vilka val som finns när du fyller i Utsida i Överlåtelsebesiktningen,
              enligt SBR:s rubriker (Mark, Grundmur, Fasad, etc.).
            </p>
          </div>

          <Link href="/settings" className="text-sm underline">
            ← Till Settings
          </Link>
        </div>

        {/* 3-kolumns layout */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* =========================
              KOL 1: RUBRIKER (ITEMS)
          ========================== */}
          <section className="rounded-2xl border bg-white p-4 space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Delar – Utsida</h2>
              <button
                onClick={addItem}
                disabled={saving}
                className="text-xs rounded-md bg-emerald-600 text-white px-2.5 py-1.5 disabled:opacity-50"
              >
                + Ny del
              </button>
            </header>

            <input
              value={qItems}
              onChange={e => setQItems(e.target.value)}
              placeholder="Sök t.ex. Fasad…"
              className="w-full rounded-md border px-2 py-1 text-sm"
            />

            <div className="space-y-1 max-h-[60vh] overflow-auto pr-1">
              {filteredItems.map(i => (
                <button
                  key={i.id}
                  onClick={() => setSelectedItemId(i.id)}
                  className={`w-full text-left rounded-lg px-3 py-2 text-sm border
                    ${selectedItemId === i.id
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white hover:bg-gray-50 border-gray-200'
                    }`}
                >
                  <div className="font-medium">{i.label}</div>
                  <div
                    className={`text-xs ${
                      selectedItemId === i.id ? 'text-gray-200' : 'text-gray-500'
                    }`}
                  >
                    key: {i.key}
                  </div>
                </button>
              ))}

              {filteredItems.length === 0 && (
                <div className="text-xs text-gray-500 py-3">Inga delar definierade ännu.</div>
              )}
            </div>

            {selectedItem && (
              <div className="pt-3 mt-2 border-t space-y-2">
                <div className="text-xs font-semibold text-gray-700">
                  Redigera del
                </div>

                <label className="text-xs text-gray-600">Label (visas i Utsida)</label>
                <input
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  value={selectedItem.label}
                  onChange={e => saveItem(selectedItem.id, { label: e.target.value })}
                />

                <label className="text-xs text-gray-600">Key (unik, används i kod)</label>
                <input
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  value={selectedItem.key}
                  onChange={e => saveItem(selectedItem.id, { key: e.target.value.trim() })}
                />

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-600">Sort order</label>
                    <input
                      type="number"
                      className="w-full rounded-md border px-2 py-1 text-sm"
                      value={selectedItem.sort_order}
                      onChange={e =>
                        saveItem(selectedItem.id, {
                          sort_order: Number(e.target.value || 0),
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center pt-5">
                    <label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!selectedItem.is_active}
                        onChange={e =>
                          saveItem(selectedItem.id, { is_active: e.target.checked })
                        }
                      />
                      Aktiv
                    </label>
                  </div>
                </div>

                <button
                  onClick={() => delItem(selectedItem.id)}
                  className="text-xs text-rose-700 underline pt-1"
                >
                  Ta bort del
                </button>
              </div>
            )}
          </section>

          {/* =========================
              KOL 2: PARAMETRAR (GROUPS)
          ========================== */}
          <section className="rounded-2xl border bg-white p-4 space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Parametrar {selectedItem ? `– ${selectedItem.label}` : ''}
              </h2>
              <button
                onClick={addGroup}
                disabled={!selectedItemId || saving}
                className="text-xs rounded-md bg-emerald-600 text-white px-2.5 py-1.5 disabled:opacity-50"
              >
                + Ny parameter
              </button>
            </header>

            {!selectedItemId ? (
              <div className="text-sm text-gray-500">Välj en utsida-del till vänster.</div>
            ) : (
              <>
                <input
                  value={qGroups}
                  onChange={e => setQGroups(e.target.value)}
                  placeholder="Sök parameter…"
                  className="w-full rounded-md border px-2 py-1 text-sm"
                />

                <div className="space-y-1 max-h-[60vh] overflow-auto pr-1">
                  {filteredGroups.map(g => (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGroupId(g.id)}
                      className={`w-full text-left rounded-lg px-3 py-2 text-sm border
                        ${selectedGroupId === g.id
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
                        key: {g.key} · typ: {g.field_type}
                      </div>
                    </button>
                  ))}

                  {filteredGroups.length === 0 && (
                    <div className="text-xs text-gray-500 py-3">Inga parametrar ännu.</div>
                  )}
                </div>

                {selectedGroup && (
                  <div className="pt-3 mt-2 border-t space-y-2">
                    <div className="text-xs font-semibold text-gray-700">
                      Redigera parameter
                    </div>

                    <label className="text-xs text-gray-600">Label</label>
                    <input
                      className="w-full rounded-md border px-2 py-1 text-sm"
                      value={selectedGroup.label}
                      onChange={e => saveGroup(selectedGroup.id, { label: e.target.value })}
                    />

                    <label className="text-xs text-gray-600">Key (unik inom delen)</label>
                    <input
                      className="w-full rounded-md border px-2 py-1 text-sm"
                      value={selectedGroup.key}
                      onChange={e => saveGroup(selectedGroup.id, { key: e.target.value.trim() })}
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-600">Sort order</label>
                        <input
                          type="number"
                          className="w-full rounded-md border px-2 py-1 text-sm"
                          value={selectedGroup.sort_order}
                          onChange={e =>
                            saveGroup(selectedGroup.id, {
                              sort_order: Number(e.target.value || 0),
                            })
                          }
                        />
                      </div>

                      <div>
                        <label className="text-xs text-gray-600">Fälttyp</label>
                        <select
                          className="w-full rounded-md border px-2 py-1 text-sm"
                          value={selectedGroup.field_type}
                          onChange={e =>
                            saveGroup(selectedGroup.id, {
                              field_type: e.target.value as FieldType,
                            })
                          }
                        >
                          {FIELD_TYPES.map(t => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center pt-1">
                      <label className="text-xs flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!selectedGroup.is_active}
                          onChange={e =>
                            saveGroup(selectedGroup.id, { is_active: e.target.checked })
                          }
                        />
                        Aktiv
                      </label>
                    </div>

                    <button
                      onClick={() => delGroup(selectedGroup.id)}
                      className="text-xs text-rose-700 underline pt-1"
                    >
                      Ta bort parameter
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* =========================
              KOL 3: VAL (OPTIONS)
          ========================== */}
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

            {!selectedGroupId ? (
              <div className="text-sm text-gray-500">Välj en parameter i mitten.</div>
            ) : (
              <>
                <input
                  value={qOptions}
                  onChange={e => setQOptions(e.target.value)}
                  placeholder="Sök val…"
                  className="w-full rounded-md border px-2 py-1 text-sm"
                />

                <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
                  {filteredOptions.map(o => (
                    <div
                      key={o.id}
                      className="rounded-xl border border-gray-200 p-3 space-y-2"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-600">Label</label>
                          <input
                            className="w-full rounded-md border px-2 py-1 text-sm"
                            value={o.label}
                            onChange={e => saveOption(o.id, { label: e.target.value })}
                          />
                        </div>

                        <div>
                          <label className="text-xs text-gray-600">Value (kod)</label>
                          <input
                            className="w-full rounded-md border px-2 py-1 text-sm"
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
                            className="w-full rounded-md border px-2 py-1 text-sm"
                            value={o.sort_order}
                            onChange={e =>
                              saveOption(o.id, {
                                sort_order: Number(e.target.value || 0),
                              })
                            }
                          />
                        </div>

                        <div className="flex items-center pt-5">
                          <label className="text-xs flex items-center gap-2">
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

                      {/* trigger_tags – för risk/FTU-logik senare */}
                      <div className="space-y-1">
                        <label className="text-xs text-gray-600">
                          Trigger tags (JSON, valfritt)
                        </label>
                        <input
                          className="w-full rounded-md border px-2 py-1 text-sm"
                          placeholder='t.ex. ["riskkonstruktion"]'
                          value={o.trigger_tags ? JSON.stringify(o.trigger_tags) : ''}
                          onChange={e => {
                            const v = e.target.value.trim()
                            let parsed: any = null
                            if (v) {
                              try {
                                parsed = JSON.parse(v)
                              } catch {
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
                      Inga val för denna parameter ännu.
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {saving && <div className="text-xs text-gray-500">Sparar…</div>}
      </div>
    </Protected>
  )
}
