'use client'

import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

export const dynamic = 'force-dynamic'

type SelectionMode = 'single' | 'multi_set' | 'per_floor'
type InspectionSide = 'buyer' | 'seller' | 'apartment'

type SettingsOverviewItem = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  selection_mode: SelectionMode
  note_enabled: boolean
  applies_to?: InspectionSide[] | null
  created_at?: string | null
  updated_at?: string | null
}

type SettingsOverviewGroup = {
  id: string
  overview_item_id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  conditional_on_group_key: string | null
  conditional_on_values: any | null
  created_at?: string | null
  updated_at?: string | null
}

type SettingsOverviewOption = {
  id: string
  group_id: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
  trigger_tags?: any | null
  created_at?: string | null
  updated_at?: string | null
}

const SELECTION_MODES: SelectionMode[] = ['single', 'multi_set', 'per_floor']
const APPLIES_TO_ALL: InspectionSide[] = ['buyer', 'seller', 'apartment']

const normalizeAppliesTo = (value: unknown): InspectionSide[] => {
  if (!Array.isArray(value)) return [...APPLIES_TO_ALL]
  const allowed = new Set<InspectionSide>(APPLIES_TO_ALL)
  const parsed = value.filter((v): v is InspectionSide => typeof v === 'string' && allowed.has(v as InspectionSide))
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [...APPLIES_TO_ALL]
}

const appliesToLabel = (value?: InspectionSide[] | null) => {
  const sides = normalizeAppliesTo(value)
  const labels = sides.map(side => {
    if (side === 'buyer') return 'Köpare'
    if (side === 'seller') return 'Säljare'
    return 'Lägenhet'
  })
  return labels.join(', ')
}

export default function ForutsattningarSettingsPage() {
  const { isAdmin, loading } = useProfile()

  const [items, setItems] = useState<SettingsOverviewItem[]>([])
  const [groups, setGroups] = useState<SettingsOverviewGroup[]>([])
  const [options, setOptions] = useState<SettingsOverviewOption[]>([])

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const [qItems, setQItems] = useState('')
  const [qGroups, setQGroups] = useState('')
  const [qOptions, setQOptions] = useState('')

  const [saving, setSaving] = useState(false)

  // historik-guard per item
  const [itemHistoryCount, setItemHistoryCount] = useState<Record<string, number>>({})

  // -----------------------------
  // LOAD
  // -----------------------------
  useEffect(() => {
    if (loading || !isAdmin) return
    loadItems()
  }, [loading, isAdmin])

  const loadItems = async () => {
    const { data, error } = await supabase
      .from('settings_overview_items')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }
    const arr = ((data ?? []) as SettingsOverviewItem[]).map(item => ({
      ...item,
      applies_to: normalizeAppliesTo(item.applies_to),
    }))
    setItems(arr)

    // prefetch historik för alla items (head+count är billigt)
    const counts: Record<string, number> = {}
    for (const it of arr) {
      const { count, error: cErr } = await supabase
        .from('inspection_overview_selections')
        .select('id', { count: 'exact', head: true })
        .eq('overview_item_id', it.id)

      if (!cErr) counts[it.id] = count ?? 0
      else counts[it.id] = 0
    }
    setItemHistoryCount(counts)

    if (!selectedItemId && arr.length) {
      setSelectedItemId(arr[0].id)
    }
  }

  const loadGroups = async (overviewItemId: string) => {
    const { data, error } = await supabase
      .from('settings_overview_groups')
      .select('*')
      .eq('overview_item_id', overviewItemId)
      .order('sort_order', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }
    const arr = (data ?? []) as SettingsOverviewGroup[]
    setGroups(arr)

    if (!arr.find(g => g.id === selectedGroupId)) {
      setSelectedGroupId(arr[0]?.id ?? null)
    }
  }

  const loadOptions = async (groupId: string) => {
    const { data, error } = await supabase
      .from('settings_overview_options')
      .select('*')
      .eq('group_id', groupId)
      .order('sort_order', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }
    setOptions((data ?? []) as SettingsOverviewOption[])
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

  const selectedItem = items.find(i => i.id === selectedItemId) || null
  const selectedGroup = groups.find(g => g.id === selectedGroupId) || null
  const selectedItemHasHistory = selectedItem ? (itemHistoryCount[selectedItem.id] ?? 0) > 0 : false

  // -----------------------------
  // CRUD HELPERS
  // -----------------------------
  const addItem = async () => {
    setSaving(true)
    const key = `item_${Math.random().toString(36).slice(2, 7)}`
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0)

    const { data, error } = await supabase
      .from('settings_overview_items')
      .insert({
        key,
        label: 'Ny kategori',
        sort_order: maxSort + 10,
        is_active: true,
        selection_mode: 'single',
        note_enabled: true,
        applies_to: APPLIES_TO_ALL,
      })
      .select('*')
      .single()

    setSaving(false)
    if (error) return alert(error.message)

    const newItem = {
      ...(data as SettingsOverviewItem),
      applies_to: normalizeAppliesTo((data as SettingsOverviewItem).applies_to),
    }
    setItems(prev => [...prev, newItem].sort((a, b) => a.sort_order - b.sort_order))
    setItemHistoryCount(prev => ({ ...prev, [newItem.id]: 0 }))
    setSelectedItemId(newItem.id)
  }

  const saveItem = async (id: string, patch: Partial<SettingsOverviewItem>) => {
    setItems(prev =>
      prev.map(i =>
        i.id === id
          ? {
              ...i,
              ...patch,
              applies_to:
                patch.applies_to === undefined
                  ? i.applies_to
                  : normalizeAppliesTo(patch.applies_to),
            }
          : i
      )
    )
    const { error } = await supabase
      .from('settings_overview_items')
      .update(patch)
      .eq('id', id)
    if (error) alert(error.message)
  }

  const toggleItemAppliesTo = (item: SettingsOverviewItem, side: InspectionSide, checked: boolean) => {
    const current = normalizeAppliesTo(item.applies_to)
    const next = checked
      ? Array.from(new Set([...current, side]))
      : current.filter(x => x !== side)
    saveItem(item.id, { applies_to: normalizeAppliesTo(next) })
  }

  const delItem = async (id: string) => {
    const hasHistory = (itemHistoryCount[id] ?? 0) > 0

    if (hasHistory) {
      if (!confirm('Denna kategori har historik. Den kommer INTE raderas utan bara inaktiveras. Fortsätt?')) return
      setSaving(true)
      const { error } = await supabase
        .from('settings_overview_items')
        .update({ is_active: false })
        .eq('id', id)
      setSaving(false)
      if (error) return alert(error.message)

      setItems(prev => prev.map(i => (i.id === id ? { ...i, is_active: false } : i)))
      return
    }

    if (!confirm('Ta bort kategori? Detta går inte att ångra.')) return
    setSaving(true)
    const { error } = await supabase
      .from('settings_overview_items')
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
      .from('settings_overview_groups')
      .insert({
        overview_item_id: selectedItemId,
        key,
        label: 'Ny parameter',
        sort_order: maxSort + 10,
        is_active: true,
        conditional_on_group_key: null,
        conditional_on_values: null,
      })
      .select('*')
      .single()

    setSaving(false)
    if (error) return alert(error.message)

    const newGroup = data as SettingsOverviewGroup
    const next = [...groups, newGroup].sort((a, b) => a.sort_order - b.sort_order)
    setGroups(next)
    setSelectedGroupId(newGroup.id)
  }

  const saveGroup = async (id: string, patch: Partial<SettingsOverviewGroup>) => {
    setGroups(prev => prev.map(g => (g.id === id ? { ...g, ...patch } : g)))
    const { error } = await supabase
      .from('settings_overview_groups')
      .update(patch)
      .eq('id', id)
    if (error) alert(error.message)
  }

  const delGroup = async (id: string) => {
    if (!selectedItem) return
    const hasHistory = (itemHistoryCount[selectedItem.id] ?? 0) > 0

    if (hasHistory) {
      if (!confirm('Denna parameter har historik via sin kategori. Den kommer INTE raderas utan bara inaktiveras. Fortsätt?')) return
      setSaving(true)
      const { error } = await supabase
        .from('settings_overview_groups')
        .update({ is_active: false })
        .eq('id', id)
      setSaving(false)
      if (error) return alert(error.message)

      setGroups(prev => prev.map(g => (g.id === id ? { ...g, is_active: false } : g)))
      return
    }

    if (!confirm('Ta bort parameter? Detta går inte att ångra.')) return
    setSaving(true)
    const { error } = await supabase
      .from('settings_overview_groups')
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
      .from('settings_overview_options')
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

    const newOpt = data as SettingsOverviewOption
    const next = [...options, newOpt].sort((a, b) => a.sort_order - b.sort_order)
    setOptions(next)
  }

  const saveOption = async (id: string, patch: Partial<SettingsOverviewOption>) => {
    setOptions(prev => prev.map(o => (o.id === id ? { ...o, ...patch } : o)))
    const { error } = await supabase
      .from('settings_overview_options')
      .update(patch)
      .eq('id', id)
    if (error) alert(error.message)
  }

  const delOption = async (id: string) => {
    if (!selectedItem) return
    const hasHistory = (itemHistoryCount[selectedItem.id] ?? 0) > 0

    if (hasHistory) {
      if (!confirm('Detta val har historik via sin kategori. Det kommer INTE raderas utan bara inaktiveras. Fortsätt?')) return
      setSaving(true)
      const { error } = await supabase
        .from('settings_overview_options')
        .update({ is_active: false })
        .eq('id', id)
      setSaving(false)
      if (error) return alert(error.message)

      setOptions(prev => prev.map(o => (o.id === id ? { ...o, is_active: false } : o)))
      return
    }

    if (!confirm('Ta bort val? Detta går inte att ångra.')) return
    setSaving(true)
    const { error } = await supabase
      .from('settings_overview_options')
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
        <div className="p-6">Laddar...</div>
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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Förutsättningar – Settings</h1>
            <p className="text-sm text-gray-600 mt-1">
              Här redigerar du dropdown-listor för ÖB-steg “Förutsättningar”.
            </p>
          </div>

          <Link href="/settings" className="text-sm underline">
            ← Till Settings
          </Link>
        </div>

        {/* Historik-varning */}
        {selectedItem && selectedItemHasHistory && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-semibold">Historik finns för denna kategori.</div>
            <div className="text-xs mt-1">
              Därför är <b>key</b> (kategori/parameter) och <b>value</b> (val-kod) låsta.
              Ändra gärna labels/sortering eller inaktivera val istället.
            </div>
          </div>
        )}

        {/* 3-kolumns layout */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* =========================
              KOL 1: ITEMS
          ========================== */}
          <section className="rounded-2xl border bg-white p-4 space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Kategorier</h2>
              <button
                onClick={addItem}
                disabled={saving}
                className="text-xs rounded-md bg-emerald-600 text-white px-2.5 py-1.5 disabled:opacity-50"
              >
                + Ny kategori
              </button>
            </header>

            <input
              value={qItems}
              onChange={e => setQItems(e.target.value)}
              placeholder="Sök kategori..."
              className="w-full rounded-md border px-2 py-1 text-sm"
            />

            <div className="space-y-1 max-h-[60vh] overflow-auto pr-1">
              {filteredItems.map(i => {
                const hasHist = (itemHistoryCount[i.id] ?? 0) > 0
                return (
                  <button
                    key={i.id}
                    onClick={() => setSelectedItemId(i.id)}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm border
                      ${selectedItemId === i.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white hover:bg-gray-50 border-gray-200'}`}
                  >
                    <div className="font-medium flex items-center justify-between">
                      <span>{i.label}</span>
                      {hasHist && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full
                          ${selectedItemId === i.id ? 'bg-white/10 text-white' : 'bg-amber-100 text-amber-800'}`}>
                          historik
                        </span>
                      )}
                    </div>
                    <div className={`text-xs ${selectedItemId === i.id ? 'text-gray-200' : 'text-gray-500'}`}>
                      key: {i.key}
                    </div>
                    <div className={`text-[11px] ${selectedItemId === i.id ? 'text-gray-300' : 'text-gray-500'}`}>
                      gäller för: {appliesToLabel(i.applies_to)}
                    </div>
                  </button>
                )
              })}

              {filteredItems.length === 0 && (
                <div className="text-xs text-gray-500 py-3">Inga kategorier.</div>
              )}
            </div>

            {selectedItem && (
              <div className="pt-3 mt-2 border-t space-y-2">
                <div className="text-xs font-semibold text-gray-700">Redigera kategori</div>

                <label className="text-xs text-gray-600">Label</label>
                <input
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  value={selectedItem.label}
                  onChange={e => saveItem(selectedItem.id, { label: e.target.value })}
                />

                <label className="text-xs text-gray-600">Key (unik)</label>
                <input
                  className={`w-full rounded-md border px-2 py-1 text-sm ${selectedItemHasHistory ? 'bg-gray-100 text-gray-500' : ''}`}
                  value={selectedItem.key}
                  readOnly={selectedItemHasHistory}
                  onChange={e => {
                    if (selectedItemHasHistory) return
                    saveItem(selectedItem.id, { key: e.target.value.trim() })
                  }}
                />
                {selectedItemHasHistory && (
                  <div className="text-[11px] text-gray-500">
                    Key är låst p.g.a. historik.
                  </div>
                )}

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

                  <div>
                    <label className="text-xs text-gray-600">Selection mode</label>
                    <select
                      className={`w-full rounded-md border px-2 py-1 text-sm ${selectedItemHasHistory ? 'bg-gray-100 text-gray-500' : ''}`}
                      value={selectedItem.selection_mode}
                      disabled={selectedItemHasHistory}
                      onChange={e =>
                        saveItem(selectedItem.id, {
                          selection_mode: e.target.value as SelectionMode,
                        })
                      }
                    >
                      {SELECTION_MODES.map(m => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {selectedItemHasHistory && (
                      <div className="text-[11px] text-gray-500 mt-1">
                        Selection mode är låst p.g.a. historik.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-600">Gäller för</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border rounded-md px-2 py-2">
                    <label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={normalizeAppliesTo(selectedItem.applies_to).includes('buyer')}
                        onChange={e => toggleItemAppliesTo(selectedItem, 'buyer', e.target.checked)}
                      />
                      Köpare
                    </label>
                    <label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={normalizeAppliesTo(selectedItem.applies_to).includes('seller')}
                        onChange={e => toggleItemAppliesTo(selectedItem, 'seller', e.target.checked)}
                      />
                      Säljare
                    </label>
                    <label className="text-xs flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={normalizeAppliesTo(selectedItem.applies_to).includes('apartment')}
                        onChange={e => toggleItemAppliesTo(selectedItem, 'apartment', e.target.checked)}
                      />
                      Lägenhet
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <label className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!selectedItem.note_enabled}
                      onChange={e =>
                        saveItem(selectedItem.id, { note_enabled: e.target.checked })
                      }
                    />
                    Noteringsruta
                  </label>

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

                <button
                  onClick={() => delItem(selectedItem.id)}
                  className="text-xs text-rose-700 underline pt-1"
                >
                  {selectedItemHasHistory ? 'Inaktivera kategori' : 'Ta bort kategori'}
                </button>
              </div>
            )}
          </section>

          {/* =========================
              KOL 2: GROUPS
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
              <div className="text-sm text-gray-500">Välj en kategori till vänster.</div>
            ) : (
              <>
                <input
                  value={qGroups}
                  onChange={e => setQGroups(e.target.value)}
                  placeholder="Sök parameter..."
                  className="w-full rounded-md border px-2 py-1 text-sm"
                />

                <div className="space-y-1 max-h-[60vh] overflow-auto pr-1">
                  {filteredGroups.map(g => (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGroupId(g.id)}
                      className={`w-full text-left rounded-lg px-3 py-2 text-sm border
                        ${selectedGroupId === g.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white hover:bg-gray-50 border-gray-200'}`}
                    >
                      <div className="font-medium">{g.label}</div>
                      <div className={`text-xs ${selectedGroupId === g.id ? 'text-gray-200' : 'text-gray-500'}`}>
                        key: {g.key}
                      </div>
                    </button>
                  ))}

                  {filteredGroups.length === 0 && (
                    <div className="text-xs text-gray-500 py-3">Inga parametrar.</div>
                  )}
                </div>

                {selectedGroup && (
                  <div className="pt-3 mt-2 border-t space-y-2">
                    <div className="text-xs font-semibold text-gray-700">Redigera parameter</div>

                    <label className="text-xs text-gray-600">Label</label>
                    <input
                      className="w-full rounded-md border px-2 py-1 text-sm"
                      value={selectedGroup.label}
                      onChange={e => saveGroup(selectedGroup.id, { label: e.target.value })}
                    />

                    <label className="text-xs text-gray-600">Key (unik inom kategori)</label>
                    <input
                      className={`w-full rounded-md border px-2 py-1 text-sm ${selectedItemHasHistory ? 'bg-gray-100 text-gray-500' : ''}`}
                      value={selectedGroup.key}
                      readOnly={selectedItemHasHistory}
                      onChange={e => {
                        if (selectedItemHasHistory) return
                        saveGroup(selectedGroup.id, { key: e.target.value.trim() })
                      }}
                    />
                    {selectedItemHasHistory && (
                      <div className="text-[11px] text-gray-500">
                        Key är låst p.g.a. historik i kategorin.
                      </div>
                    )}

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

                      <div className="flex items-center pt-5">
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
                    </div>

                    <label className="text-xs text-gray-600">
                      Conditional on group key (valfritt)
                    </label>
                    <input
                      className="w-full rounded-md border px-2 py-1 text-sm"
                      placeholder="t.ex. type"
                      value={selectedGroup.conditional_on_group_key ?? ''}
                      onChange={e =>
                        saveGroup(selectedGroup.id, {
                          conditional_on_group_key: e.target.value || null,
                        })
                      }
                    />

                    <label className="text-xs text-gray-600">
                      Conditional values (JSON array / string)
                    </label>
                    <input
                      className="w-full rounded-md border px-2 py-1 text-sm"
                      placeholder='t.ex. ["platta_isolerad"]'
                      value={
                        selectedGroup.conditional_on_values
                          ? JSON.stringify(selectedGroup.conditional_on_values)
                          : ''
                      }
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
                        saveGroup(selectedGroup.id, {
                          conditional_on_values: parsed,
                        })
                      }}
                    />

                    <button
                      onClick={() => delGroup(selectedGroup.id)}
                      className="text-xs text-rose-700 underline pt-1"
                    >
                      {selectedItemHasHistory ? 'Inaktivera parameter' : 'Ta bort parameter'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* =========================
              KOL 3: OPTIONS
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
                  placeholder="Sök val..."
                  className="w-full rounded-md border px-2 py-1 text-sm"
                />

                <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
                  {filteredOptions.map(o => (
                    <div key={o.id} className="rounded-xl border border-gray-200 p-3 space-y-2">
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
                            className={`w-full rounded-md border px-2 py-1 text-sm ${selectedItemHasHistory ? 'bg-gray-100 text-gray-500' : ''}`}
                            value={o.value}
                            readOnly={selectedItemHasHistory}
                            onChange={e => {
                              if (selectedItemHasHistory) return
                              saveOption(o.id, { value: e.target.value.trim() })
                            }}
                          />
                          {selectedItemHasHistory && (
                            <div className="text-[11px] text-gray-500 mt-1">
                              Value är låst p.g.a. historik i kategorin.
                            </div>
                          )}
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

                      {/* trigger_tags */}
                      <div className="space-y-1">
                        <label className="text-xs text-gray-600">Trigger tags (JSON, valfritt)</label>
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
                          {selectedItemHasHistory ? 'Inaktivera val' : 'Ta bort val'}
                        </button>
                      </div>
                    </div>
                  ))}

                  {filteredOptions.length === 0 && (
                    <div className="text-xs text-gray-500 py-3">Inga val i denna parameter ännu.</div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {saving && <div className="text-xs text-gray-500">Sparar...</div>}
      </div>
    </Protected>
  )
}

