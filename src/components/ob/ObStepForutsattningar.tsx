'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/supabase'

type FurnishingLevel = 'fullt_moblerad' | 'delvis_moblerad' | 'omoblerad'
type SelectionMode = 'single' | 'multi_set' | 'per_floor'
type InspectionSide = 'buyer' | 'seller' | 'apartment'
type SelectionValue = string | number | boolean | null
type SelectionValues = Record<string, SelectionValue>

// Hämta direkt från Supabase-typerna
type Property = Tables<'properties'>
type Inspection = Tables<'inspections'>

interface InspectionConditionsRow {
  id: string
  inspection_id: string
  furnishing_level: FurnishingLevel | null
  created_at: string | null
  updated_at: string | null
}

interface SettingsOverviewItem {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  selection_mode: SelectionMode
  note_enabled: boolean
  applies_to?: unknown
}

interface SettingsOverviewGroup {
  id: string
  overview_item_id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  conditional_on_group_key: string | null
  conditional_on_values: unknown
}

interface SettingsOverviewOption {
  id: string
  group_id: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
}

interface InspectionOverviewSelection {
  id?: string
  inspection_id: string
  overview_item_id: string
  floor_key: string | null
  set_index: number
  values: SelectionValues
  note: string | null
}

type ItemBundle = SettingsOverviewItem & {
  groups: (SettingsOverviewGroup & { options: SettingsOverviewOption[] })[]
}

const toErrorLike = (error: unknown): Record<string, unknown> | null => {
  if (!error || typeof error !== 'object') return null
  return error as Record<string, unknown>
}

const serializeLoadError = (error: unknown) => {
  const err = toErrorLike(error)
  if (!err) return null
  return {
    code: err.code ?? null,
    message: err.message ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
    status: err.status ?? null,
  }
}

const isUniqueViolation = (error: unknown) => {
  const err = toErrorLike(error)
  const text = `${err?.message ?? ''} ${err?.details ?? ''}`.toLowerCase()
  return err?.code === '23505' || text.includes('duplicate key')
}

const normalizeSwedishToken = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll('å', 'a')
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')

const parseInspectionSideToken = (value: string): InspectionSide | null => {
  const token = normalizeSwedishToken(value)
  if (token.includes('seller') || token.includes('salj')) return 'seller'
  if (token.includes('apartment') || token.includes('lagenhet') || token.includes('apt')) {
    return 'apartment'
  }
  if (token.includes('buyer') || token.includes('kop')) return 'buyer'
  return null
}

const normalizeInspectionSide = (value: unknown): InspectionSide => {
  if (typeof value !== 'string') return 'buyer'
  return parseInspectionSideToken(value) ?? 'buyer'
}

const parseAppliesTo = (item: SettingsOverviewItem): InspectionSide[] | null => {
  const raw = item.applies_to
  if (raw == null) return null

  let tokens: string[] = []
  if (Array.isArray(raw)) {
    tokens = raw.filter((value): value is string => typeof value === 'string')
  } else if (typeof raw === 'string') {
    tokens = raw.split(/[,;|]/g)
  } else {
    return null
  }

  const parsed = Array.from(
    new Set(
      tokens
        .map(token => parseInspectionSideToken(token))
        .filter((token): token is InspectionSide => token !== null)
    )
  )

  return parsed.length > 0 ? parsed : null
}

export default function ObStepForutsattningar({
  property,
  inspection,
}: {
  property: Property
  inspection: Inspection
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isInspectionLocked = Boolean(
    (inspection as Inspection & { locked_at?: string | null }).locked_at
  )

  // inspection_conditions (bara för furnishing)
  const [condRow, setCondRow] = useState<InspectionConditionsRow | null>(null)
  const [furnishing, setFurnishing] = useState<FurnishingLevel>('fullt_moblerad')

  // settings + selections
  const [items, setItems] = useState<ItemBundle[]>([])
  const [selections, setSelections] = useState<Record<string, InspectionOverviewSelection[]>>({})

  // debounce timers för note
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // -----------------------------
  // LOAD: inspection_conditions + settings + selections
  // -----------------------------
  useEffect(() => {
    const loadAll = async () => {
      try {
        setLoading(true)
        setError(null)

        // A) inspection_conditions: load or create
        const { data: existingCond, error: selErr } = await supabase
          .from('inspection_conditions')
          .select('*')
          .eq('inspection_id', inspection.id)
          .maybeSingle()

        if (selErr) throw selErr

        if (existingCond) {
          const r = existingCond as InspectionConditionsRow
          setCondRow(r)
          setFurnishing((r.furnishing_level ?? 'fullt_moblerad') as FurnishingLevel)
        } else {
          if (isInspectionLocked) {
            setCondRow(null)
            setFurnishing('fullt_moblerad')
          } else {
          const { data: inserted, error: insErr } = await supabase
            .from('inspection_conditions')
            .insert({
              inspection_id: inspection.id,
              furnishing_level: 'fullt_moblerad',
            })
            .select('*')
            .single()

          if (insErr) {
            if (!isUniqueViolation(insErr)) throw insErr

            const { data: raceRow, error: raceErr } = await supabase
              .from('inspection_conditions')
              .select('*')
              .eq('inspection_id', inspection.id)
              .maybeSingle()

            if (raceErr || !raceRow) {
              throw raceErr ?? insErr
            }

            const r = raceRow as InspectionConditionsRow
            setCondRow(r)
            setFurnishing((r.furnishing_level ?? 'fullt_moblerad') as FurnishingLevel)
          } else {
            const r = inserted as InspectionConditionsRow
            setCondRow(r)
            setFurnishing((r.furnishing_level ?? 'fullt_moblerad') as FurnishingLevel)
          }
          }
        }

        // B) settings items
        const { data: itemsData, error: itemsErr } = await supabase
          .from('settings_overview_items')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })

        if (itemsErr) throw itemsErr
        const inspectionSide = normalizeInspectionSide(inspection.inspection_side)
        const itemsArr = (itemsData ?? []) as SettingsOverviewItem[]
        const filteredItems = itemsArr.filter(item => {
          const appliesTo = parseAppliesTo(item)
          return !appliesTo || appliesTo.includes(inspectionSide)
        })
        const itemIds = filteredItems.map(i => i.id)

        // C) groups
        let groupsArr: SettingsOverviewGroup[] = []
        if (itemIds.length > 0) {
          const { data: groupsData, error: groupsErr } = await supabase
            .from('settings_overview_groups')
            .select('*')
            .in('overview_item_id', itemIds)
            .eq('is_active', true)
            .order('sort_order', { ascending: true })

          if (groupsErr) throw groupsErr
          groupsArr = (groupsData ?? []) as SettingsOverviewGroup[]
        }
        const groupIds = groupsArr.map(g => g.id)

        // D) options
        let optionsArr: SettingsOverviewOption[] = []
        if (groupIds.length > 0) {
          const { data: optionsData, error: optErr } = await supabase
            .from('settings_overview_options')
            .select('*')
            .in('group_id', groupIds)
            .eq('is_active', true)
            .order('sort_order', { ascending: true })

          if (optErr) throw optErr
          optionsArr = (optionsData ?? []) as SettingsOverviewOption[]
        }

        // E) selections for inspection
        const { data: selData, error: selDataErr } = await supabase
          .from('inspection_overview_selections')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('set_index', { ascending: true })

        if (selDataErr) throw selDataErr
        const selArr = (selData ?? []) as InspectionOverviewSelection[]

        // Build bundles
        const optionsByGroup: Record<string, SettingsOverviewOption[]> = {}
        for (const o of optionsArr) {
          optionsByGroup[o.group_id] = optionsByGroup[o.group_id] || []
          optionsByGroup[o.group_id].push(o)
        }

        const groupsByItem: Record<
          string,
          (SettingsOverviewGroup & { options: SettingsOverviewOption[] })[]
        > = {}
        for (const g of groupsArr) {
          groupsByItem[g.overview_item_id] = groupsByItem[g.overview_item_id] || []
          groupsByItem[g.overview_item_id].push({
            ...g,
            options: optionsByGroup[g.id] || [],
          })
        }

        const bundles: ItemBundle[] = filteredItems.map(it => ({
          ...it,
          groups: groupsByItem[it.id] || [],
        }))

        setItems(bundles)

        // selections map
        const selMap: Record<string, InspectionOverviewSelection[]> = {}
        for (const s of selArr) {
          selMap[s.overview_item_id] = selMap[s.overview_item_id] || []
          selMap[s.overview_item_id].push({
            ...s,
            values: (s.values as SelectionValues) || {},
          })
        }
        setSelections(selMap)
      } catch (e: unknown) {
        console.error('loadAll failed:', serializeLoadError(e) ?? e)
        setError(e instanceof Error ? e.message : 'Kunde inte läsa inställningar/besiktningsdata.')
      } finally {
        setLoading(false)
      }
    }

    if (inspection?.id) loadAll()
  }, [inspection?.id, inspection?.inspection_side, isInspectionLocked])

  // -----------------------------
  // Save furnishing
  // -----------------------------
  const saveFurnishing = async (lvl: FurnishingLevel) => {
    if (isInspectionLocked) return
    if (!condRow) return
    setSaving(true)
    setError(null)

    const { data, error: updErr } = await supabase
      .from('inspection_conditions')
      .update({ furnishing_level: lvl })
      .eq('id', condRow.id)
      .select('*')
      .single()

    if (updErr) {
      setError(updErr.message || 'Kunde inte spara.')
    } else {
      setCondRow(data as InspectionConditionsRow)
    }

    setSaving(false)
  }

  // -----------------------------
  // Upsert selection row
  // -----------------------------
  const upsertSelection = async (sel: InspectionOverviewSelection) => {
    if (isInspectionLocked) return sel
    setSaving(true)
    setError(null)

    try {
      if (sel.id) {
        const { data, error: updErr } = await supabase
          .from('inspection_overview_selections')
          .update({
            values: sel.values,
            note: sel.note,
          })
          .eq('id', sel.id)
          .select('*')
          .single()

        if (updErr) throw updErr
        return data as InspectionOverviewSelection
      } else {
        const { data, error: insErr } = await supabase
          .from('inspection_overview_selections')
          .insert({
            inspection_id: sel.inspection_id,
            overview_item_id: sel.overview_item_id,
            floor_key: sel.floor_key,
            set_index: sel.set_index,
            values: sel.values,
            note: sel.note,
          })
          .select('*')
          .single()

        if (insErr) throw insErr
        return data as InspectionOverviewSelection
      }
    } catch (e: unknown) {
      console.error('upsertSelection failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara val.')
      return sel
    } finally {
      setSaving(false)
    }
  }

  // -----------------------------
  // Local helpers
  // -----------------------------
  const getItemSelections = useCallback(
    (itemId: string) => selections[itemId] || [],
    [selections]
  )

  const setItemSelections = (itemId: string, next: InspectionOverviewSelection[]) => {
    setSelections(prev => ({ ...prev, [itemId]: next }))
  }

  const ensureSingleSelection = (itemId: string) => {
    const arr = getItemSelections(itemId)
    if (arr.length > 0) return arr
    const empty: InspectionOverviewSelection = {
      inspection_id: inspection.id,
      overview_item_id: itemId,
      floor_key: null,
      set_index: 0,
      values: {},
      note: null,
    }
    const next = [empty]
    setItemSelections(itemId, next)
    return next
  }

  const addMultiSet = (itemId: string) => {
    if (isInspectionLocked) return
    const arr = getItemSelections(itemId)
    const nextIndex = arr.length ? Math.max(...arr.map(a => a.set_index)) + 1 : 0
    const empty: InspectionOverviewSelection = {
      inspection_id: inspection.id,
      overview_item_id: itemId,
      floor_key: null,
      set_index: nextIndex,
      values: {},
      note: null,
    }
    const next = [...arr, empty]
    setItemSelections(itemId, next)
  }

  const removeSet = async (itemId: string, setIndex: number) => {
    if (isInspectionLocked) return
    const arr = getItemSelections(itemId)
    const target = arr.find(a => a.set_index === setIndex)
    const next = arr.filter(a => a.set_index !== setIndex)
    setItemSelections(itemId, next)
    if (target?.id) {
      await supabase.from('inspection_overview_selections').delete().eq('id', target.id)
    }
  }

  const updateGroupValue = async (
    itemId: string,
    selIndex: number,
    groupKey: string,
    value: SelectionValue
  ) => {
    if (isInspectionLocked) return
    const arr = ensureSingleSelection(itemId)
    const next = [...arr]
    const sel = { ...next[selIndex] }
    sel.values = { ...(sel.values || {}), [groupKey]: value }
    next[selIndex] = sel
    setItemSelections(itemId, next)
    const saved = await upsertSelection(sel)
    next[selIndex] = saved
    setItemSelections(itemId, next)
  }

  const updateSelectionNote = (itemId: string, selIndex: number, note: string) => {
    if (isInspectionLocked) return
    const arr = ensureSingleSelection(itemId)
    const next = [...arr]
    const sel = { ...next[selIndex], note }
    next[selIndex] = sel
    setItemSelections(itemId, next)

    const timerKey = `${itemId}:${sel.floor_key ?? 'nofloor'}:${sel.set_index}`
    if (noteTimers.current[timerKey]) clearTimeout(noteTimers.current[timerKey])
    noteTimers.current[timerKey] = setTimeout(async () => {
      const saved = await upsertSelection(sel)
      const latest = getItemSelections(itemId).map(s =>
        s.set_index === saved.set_index && s.floor_key === saved.floor_key ? saved : s
      )
      setItemSelections(itemId, latest)
    }, 500)
  }

  // -----------------------------
  // Floors derived from Byggnadstyp selection (settingsstyrt)
  // -----------------------------
  const floorKeys = useMemo(() => {
    const buildingItem = items.find(i => i.key === 'building_type')
    if (!buildingItem) return [] as string[]

    const sels = getItemSelections(buildingItem.id)
    if (!sels.length) return [] as string[]

    const v = sels[0].values || {}
    const floorsVal = v['floors'] ?? v['våningar'] ?? v['våning'] ?? null
    const basementVal = v['basement'] ?? v['källare'] ?? null

    const count =
      floorsVal === '1_5'
        ? 2
        : floorsVal === '2'
          ? 2
          : floorsVal === '3'
            ? 3
            : floorsVal === '1'
              ? 1
              : typeof floorsVal === 'number'
                ? floorsVal
                : 0

    const keys: string[] = []
    if (basementVal === 'yes' || basementVal === 'ja' || basementVal === true) {
      keys.push('källare')
    } else if (basementVal === 'partial' || basementVal === 'delvis') {
      keys.push('källare_delvis')
    }

    if (count >= 1) keys.push('entréplan')
    if (count >= 2) keys.push('plan2')
    if (count >= 3) keys.push('plan3')

    return keys
  }, [items, getItemSelections])

  // -----------------------------
  // Conditional group visibility
  // -----------------------------
  const groupVisible = (group: SettingsOverviewGroup, selValues: SelectionValues) => {
    if (!group.conditional_on_group_key) return true
    const key = group.conditional_on_group_key
    const want = group.conditional_on_values

    const current = selValues?.[key]
    if (!want) return !!current

    if (Array.isArray(want)) return want.includes(current)
    if (typeof want === 'string') return want === current
    return true
  }

  // -----------------------------
  // UI helpers (endast layout)
  // -----------------------------
  const itemEmoji: Record<string, string> = {
    weather: '🌤️',
    building_type: '🏠',
    building_year: '📅',
    foundation: '🧱',
    structure: '🏗️',
    joist: '🪵',
    facade: '🧱',
    windows: '🪟',
    roof: '🏡',
    heating: '🔥',
    ventilation: '💨',
    water: '🚰',
    sewage: '🕳️',
  }

  const SelectField = ({
    label,
    value,
    onChange,
    options,
    disabledEmpty,
    disabled,
  }: {
    label: string
    value: SelectionValue | ''
    onChange: (v: string) => void
    options: SettingsOverviewOption[]
    disabledEmpty?: boolean
    disabled?: boolean
  }) => {
    const normalizedValue =
      typeof value === 'boolean' ? String(value) : (value ?? '')

    return (
      <div className="grid grid-cols-1 gap-1 md:grid-cols-[140px_1fr] md:items-center md:gap-2">
      <label className="text-xs font-medium text-gray-700 md:text-sm md:text-gray-800 md:whitespace-nowrap">
        {label}
      </label>

      <select
        value={normalizedValue}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900
                   focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <option value="">Välj…</option>
        {options.length === 0 && (
          <option disabled value="">
            {disabledEmpty ? 'Inga val i settings' : '—'}
          </option>
        )}
        {options.map(o => (
          <option key={o.id} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
    )
  }

  // -----------------------------
  // Layout-regel: högerkolumn = ålder/underhåll
  // -----------------------------
  const isRightGroupKey = (key: string) => {
    if (!key) return false
    return (
      key === 'install_year' ||
      key.endsWith('_year') ||
      key.startsWith('maintenance_') ||
      key === 'renewal_year' ||
      key === 'drainage_year'
    )
  }

  const renderSelectionSet = (item: ItemBundle, sel: InspectionOverviewSelection, selIndex: number) => {
    const values = sel.values || {}

    const visibleGroups = item.groups.filter(g => groupVisible(g, values))
    const leftGroups = visibleGroups.filter(g => !isRightGroupKey(g.key))
    const rightGroups = visibleGroups.filter(g => isRightGroupKey(g.key))

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Vänster: vad är det? */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase md:hidden">
              Vad är det?
            </div>
            {leftGroups.map(g => (
              <SelectField
                key={g.id}
                label={g.label}
                value={values[g.key] ?? ''}
                options={g.options}
                disabledEmpty
                disabled={isInspectionLocked}
                onChange={v => updateGroupValue(item.id, selIndex, g.key, v)}
              />
            ))}
          </div>

          {/* Höger: ålder/underhåll */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase md:hidden">
              Ålder & underhåll
            </div>

            {rightGroups.length === 0 ? (
              <div className="text-xs text-gray-400 md:mt-6">
                Inga ålder-/underhållsfält för denna del.
              </div>
            ) : (
              rightGroups.map(g => (
                <SelectField
                  key={g.id}
                  label={g.label}
                  value={values[g.key] ?? ''}
                  options={g.options}
                  disabledEmpty
                  disabled={isInspectionLocked}
                  onChange={v => updateGroupValue(item.id, selIndex, g.key, v)}
                />
              ))
            )}
          </div>
        </div>

        {/* Notering */}
        {item.note_enabled && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Notering (valfritt)</label>
            <textarea
              value={sel.note ?? ''}
              onChange={e => updateSelectionNote(item.id, selIndex, e.target.value)}
              disabled={isInspectionLocked}
              placeholder="Kort notering…"
              rows={2}
              className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm
                         placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
        )}
      </div>
    )
  }

  const getBuildingYearTitle = (item: ItemBundle, sel: InspectionOverviewSelection, idx: number) => {
    if (item.key !== 'building_year') return `${item.label} ${idx + 1}`

    const partVal = sel.values?.['part']
    if (partVal === 'huvudbyggnad') return 'Huvudbyggnad'
    if (partVal === 'tillbyggnad') return idx === 0 ? 'Tillbyggnad' : `Tillbyggnad ${idx}`

    return idx === 0 ? 'Huvudbyggnad' : `Tillbyggnad ${idx}`
  }

  const renderItem = (item: ItemBundle) => {
    if (item.selection_mode === 'single') {
      const arr = ensureSingleSelection(item.id)
      return renderSelectionSet(item, arr[0], 0)
    }

    if (item.selection_mode === 'multi_set') {
      const arr = ensureSingleSelection(item.id)
      return (
        <div className="space-y-3">
          {arr.map((sel, idx) => (
            <div
              key={`${sel.set_index}`}
              className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3 md:p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">
                  {getBuildingYearTitle(item, sel, idx)}
                </div>

                {arr.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSet(item.id, sel.set_index)}
                    disabled={isInspectionLocked}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Ta bort
                  </button>
                )}
              </div>

              {renderSelectionSet(item, sel, idx)}
            </div>
          ))}

          <button
            type="button"
            onClick={() => addMultiSet(item.id)}
            disabled={isInspectionLocked}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium
                       text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            + Lägg till fler
          </button>
        </div>
      )
    }

    // per_floor
    const floors = floorKeys
    if (floors.length === 0) {
      const arr = ensureSingleSelection(item.id)
      return (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Fyll i &quot;Byggnadstyp&quot; (våningar/källare) så skapas val per våning.
          </p>
          {renderSelectionSet(item, arr[0], 0)}
        </div>
      )
    }

    // säkerställ selection per floor
    const existing = getItemSelections(item.id)
    const next: InspectionOverviewSelection[] = []

    floors.forEach(fk => {
      const found = existing.find(s => s.floor_key === fk && s.set_index === 0)
      next.push(
        found || {
          inspection_id: inspection.id,
          overview_item_id: item.id,
          floor_key: fk,
          set_index: 0,
          values: {},
          note: null,
        }
      )
    })

    if (next.length !== existing.length) {
      setItemSelections(item.id, next)
    }

    const floorLabel = (k?: string | null) => {
      if (k === 'källare') return 'Källare'
      if (k === 'källare_delvis') return 'Källare (delvis)'
      if (k === 'entréplan') return 'Entréplan'
      if (k === 'plan2') return 'Plan 2'
      if (k === 'plan3') return 'Plan 3'
      return k || ''
    }

    return (
      <div className="space-y-3">
        {next.map((sel, idx) => (
          <div
            key={sel.floor_key ?? idx}
            className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3 md:p-4 space-y-3"
          >
            <div className="text-xs font-semibold text-gray-900">
              {floorLabel(sel.floor_key)}
            </div>
            {renderSelectionSet(item, sel, idx)}
          </div>
        ))}
      </div>
    )
  }

  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Laddar förutsättningar…</div>
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">
        {error}
        <div className="mt-2 text-xs text-gray-500">
          Tips: Om detta händer direkt efter du skapade tabellerna är det ofta RLS/policy
          som blockerar. Kontrollera att du är inloggad och att policies finns.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-gray-900">Förutsättningar</h2>

        {property && (
          <p className="text-sm text-gray-700">
            <span className="font-medium">{property.name || 'Fastighet'}</span>
            {property.address && ` – ${property.address}`}
          </p>
        )}

        {inspection && (
          <p className="text-xs text-gray-600">
            Besiktning {inspection.assignment_number || inspection.id} ·{' '}
            {inspection.date || 'datum ej angivet'}
          </p>
        )}
      </header>

      {isInspectionLocked ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Besiktningen är låst. Förutsättningar är skrivskyddade.
        </div>
      ) : null}

      {/* SÄRSKILDA FÖRUTSÄTTNINGAR */}
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-3">
        <div className="text-sm text-gray-900">
          Utrymmet var{' '}
          <select
            value={furnishing}
            onChange={e => {
              const lvl = e.target.value as FurnishingLevel
              setFurnishing(lvl)
              saveFurnishing(lvl)
            }}
            disabled={isInspectionLocked}
            className="mx-1 h-9 rounded-lg border border-gray-300 bg-gray-50 px-2 text-sm
                       focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <option value="fullt_moblerad">fullt möblerad</option>
            <option value="delvis_moblerad">delvis möblerad</option>
            <option value="omoblerad">omöblerad</option>
          </select>{' '}
          vid besiktningstillfället.
        </div>

        <p className="text-sm text-gray-700">
          Besiktning har skett av de delar som varit normalt åtkomliga utan omflyttning av
          möbler och belamrade ytor. Bakomliggande ytor ingår i köparens undersökningsplikt.
        </p>

        <p className="text-sm text-gray-700">
          För ytor, utrymmen och byggnadsdelar som noterats helt eller delvis ej
          besiktningsbara eller belamrade har besiktningsmannen inget ansvar.
        </p>

        <p className="text-sm text-gray-700">
          Notering ”-----” innebär att utrymmet/ytan bedöms vara i normalt skick med hänsyn
          taget till byggnadens ålder och byggnadssätt.
        </p>
      </section>

      {/* PUNKT 2 – dynamiskt från settings */}
      <section className="space-y-4">
        {items.map(item => (
          <section
            key={item.id}
            className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-3"
          >
            <header className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                <span className="mr-2">{itemEmoji[item.key] || '•'}</span>
                {item.label}
              </h3>
              <span className="text-xs text-gray-500">Punkt 2</span>
            </header>

            {renderItem(item)}
          </section>
        ))}
      </section>

      {saving && <div className="text-xs text-gray-500">Sparar…</div>}
    </div>
  )
}
