'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, ChevronRight, ClipboardList, CloudSun, Droplets, Flame, House, Layers, Plus, Trash2, Wind, type LucideIcon } from 'lucide-react'
import Sheet from './ObRoundSheet'
import './ob-forms.css'
import type { Tables } from '@/types/supabase'
import DebouncedTextarea from './DebouncedTextarea'
import { useObFloorModel } from './ObFloorProvider'
import { useObBuilding, useObBuildingData } from './ObBuildingContext'
import { buildingDraftScope } from '@/lib/ob/buildingStructure'
import ObBuildingCover from './ObBuildingCover'
import { ObFloorEditor } from './ObFloorEditor'
import { floorModelKeys, modelFloorLabel } from '@/lib/ob/floorModel'
import {
  buildInteriorFloorKeysFromOverview,
  buildOverviewFloorOptionLookup,
} from '@/lib/ob/overviewFloors'

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
  field_type: 'select' | 'year' | null
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
  system_value: string | null
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

const SPECIAL_CONDITIONS_COLLAPSE_KEY = '__special_conditions__'
const YEAR_OPTION_START = 1850

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
  inspection,
}: {
  property: Property
  inspection: Inspection
}) {
  const building = useObBuilding()
  const { client: supabase } = useObBuildingData()
  const draftScope = buildingDraftScope(inspection.id, building?.part?.id)
  const collapsedStorageKey = `ob:forutsattningar:collapsed:${draftScope}`
  const { model: floorModel } = useObFloorModel()
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
  const [collapsedItemIds, setCollapsedItemIds] = useState<Set<string>>(() => new Set())
  const [usePanelLayout] = useState(true)
  const [activePanelKey, setActivePanelKey] = useState<string | null>(null)
  const isSpecialConditionsCollapsed = collapsedItemIds.has(SPECIAL_CONDITIONS_COLLAPSE_KEY)

  // Ignore stale save responses if the same note is saved again before Supabase responds.
  const noteSaveVersions = useRef<Record<string, number>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(collapsedStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const ids = parsed.filter((value): value is string => typeof value === 'string')
      setCollapsedItemIds(new Set(ids))
    } catch (e) {
      console.warn('Kunde inte läsa sparat visningsläge för förutsättningar:', e)
    }
  }, [collapsedStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        collapsedStorageKey,
        JSON.stringify(Array.from(collapsedItemIds.values()))
      )
    } catch (e) {
      console.warn('Kunde inte spara visningsläge för förutsättningar:', e)
    }
  }, [collapsedItemIds, collapsedStorageKey])

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
  const upsertSelection = async (
    sel: InspectionOverviewSelection,
    options?: { throwOnError?: boolean }
  ) => {
    if (isInspectionLocked) return sel
    setSaving(true)
    setError(null)

    try {
      const selectionPayload = {
        inspection_id: sel.inspection_id,
        overview_item_id: sel.overview_item_id,
        floor_key: sel.floor_key,
        set_index: sel.set_index,
        values: sel.values,
        note: sel.note,
      }

      const findExistingSelection = async () => {
        let query = supabase
          .from('inspection_overview_selections')
          .select('*')
          .eq('inspection_id', sel.inspection_id)
          .eq('overview_item_id', sel.overview_item_id)
          .eq('set_index', sel.set_index)

        query = sel.floor_key === null
          ? query.is('floor_key', null)
          : query.eq('floor_key', sel.floor_key)

        const { data, error } = await query
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)

        if (error) throw error
        return ((data ?? [])[0] ?? null) as InspectionOverviewSelection | null
      }

      const updateExistingSelection = async (id: string) => {
        const { data, error } = await supabase
          .from('inspection_overview_selections')
          .update({
            values: sel.values,
            note: sel.note,
          })
          .eq('id', id)
          .select('*')
          .single()

        if (error) throw error
        return data as InspectionOverviewSelection
      }

      if (sel.id) {
        return await updateExistingSelection(sel.id)
      } else {
        // Explicit lookup/insert also works with the legacy partial unique index
        // after the building cutover; no ambiguous ON CONFLICT target remains.
        const existing = await findExistingSelection()
        if (existing?.id && building?.part) throw Error('Byggnadsuppgiften har skapats i en annan vy. Uppdatera innan du ändrar den.')
        if (existing?.id) return await updateExistingSelection(existing.id)

        const { data: inserted, error: insErr } = await supabase
          .from('inspection_overview_selections')
          .insert(selectionPayload)
          .select('*')
          .single()

        if (insErr && isUniqueViolation(insErr) && !building?.part) {
          const createdByRace = await findExistingSelection()
          if (createdByRace?.id) return await updateExistingSelection(createdByRace.id)
        }
        if (insErr) throw insErr

        return inserted as InspectionOverviewSelection
      }
    } catch (e: unknown) {
      console.error('upsertSelection failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara val.')
      if (options?.throwOnError) throw e
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
    if (target?.id) {
      const { error } = await supabase.from('inspection_overview_selections').delete().eq('id', target.id)
      if (error) { setError(error.message || 'Uppgiften kunde inte tas bort.'); return }
    }
    setItemSelections(itemId, next)
  }

  const toggleItemCollapsed = (itemId: string) => {
    setCollapsedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
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

  const updateSelectionNote = async (itemId: string, selIndex: number, note: string) => {
    if (isInspectionLocked) return
    const arr = ensureSingleSelection(itemId)
    const next = [...arr]
    const sel = { ...next[selIndex], note }
    next[selIndex] = sel
    setItemSelections(itemId, next)

    const timerKey = `${itemId}:${sel.floor_key ?? 'nofloor'}:${sel.set_index}`
    const version = (noteSaveVersions.current[timerKey] ?? 0) + 1
    noteSaveVersions.current[timerKey] = version

    const saved = await upsertSelection(sel, { throwOnError: true })
    if (noteSaveVersions.current[timerKey] !== version) return
    const latest = getItemSelections(itemId).map(s => {
      if (s.set_index === saved.set_index && s.floor_key === saved.floor_key) {
        return { ...saved, note }
      }
      return s
    })
    setItemSelections(itemId, latest)
  }

  // -----------------------------
  // Floors derived from Byggnadstyp selection (settingsstyrt)
  // -----------------------------
  const floorKeys = useMemo(() => {
    if (floorModel) return floorModelKeys(floorModel)
    const buildingItem = items.find(i => i.key === 'building_type')
    if (!buildingItem) return [] as string[]

    const sels = getItemSelections(buildingItem.id)
    if (!sels.length) return [] as string[]

    return buildInteriorFloorKeysFromOverview(
      sels[0].values || {},
      buildOverviewFloorOptionLookup(buildingItem.groups)
    )
  }, [items, getItemSelections, floorModel])

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
  const itemIcons: Record<string, LucideIcon> = {
    weather: CloudSun,
    building_type: House,
    building_year: CalendarDays,
    foundation: Layers,
    structure: Layers,
    joist: Layers,
    facade: House,
    windows: House,
    roof: House,
    heating: Flame,
    ventilation: Wind,
    water: Droplets,
    sewage: Droplets,
  }

  const panelEntries = [
    {
      key: SPECIAL_CONDITIONS_COLLAPSE_KEY,
      label: 'Särskilda förutsättningar',
      icon: ClipboardList,
      item: null as ItemBundle | null,
    },
    ...items.map(item => ({
      key: item.id,
      label: item.label,
      icon: itemIcons[item.key] || ClipboardList,
      item,
    })),
  ]
  const selectedPanelEntry =
    panelEntries.find(entry => entry.key === activePanelKey) ?? null

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return Array.from({ length: currentYear - YEAR_OPTION_START + 1 }, (_, index) => {
      const year = String(currentYear - index)
      return {
        id: `year-${year}`,
        group_id: 'generated-years',
        value: year,
        label: year,
        system_value: null,
        sort_order: index,
        is_active: true,
      } satisfies SettingsOverviewOption
    })
  }, [])

  const getGroupOptions = (group: SettingsOverviewGroup & { options: SettingsOverviewOption[] }) =>
    group.field_type === 'year' ? yearOptions : group.options

  const resolveOptionLabel = (
    group: SettingsOverviewGroup & { options: SettingsOverviewOption[] },
    value: SelectionValue | undefined
  ) => {
    if (value === null || value === undefined || value === '') return null
    const normalized = String(value)
    const option = getGroupOptions(group).find(o => o.value === normalized)
    return option?.label ?? normalized
  }

  const getPanelEntrySummary = (entry: (typeof panelEntries)[number]) => {
    if (!entry.item) {
      if (furnishing === 'delvis_moblerad') return 'Delvis möblerad'
      if (furnishing === 'omoblerad') return 'Omöblerad'
      return 'Fullt möblerad'
    }

    const rows = getItemSelections(entry.item.id)
    const groups = entry.item.groups
    const values = rows.flatMap(row =>
      groups
        .map(group => resolveOptionLabel(group, row.values?.[group.key]))
        .filter((label): label is string => Boolean(label))
    )
    const hasNote = rows.some(row => (row.note ?? '').trim().length > 0)
    const firstNote = rows
      .map(row => (row.note ?? '').trim())
      .find(note => note.length > 0)
    const uniqueValues = Array.from(new Set(values))
    const summary = uniqueValues.slice(0, 3).join(', ')
    if (summary && hasNote) return `${summary} · notering`
    if (summary) return summary
    if (firstNote) return firstNote.length > 90 ? `${firstNote.slice(0, 90).trim()}...` : firstNote
    return 'Ej ifyllt'
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
      <label className="ob-form-field">
      <span className="ob-form-label">
        {label}
      </span>

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
    </label>
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
        <div className="ob-form-pair">
          {/* Vänster: vad är det? */}
          <div className="space-y-3">
            {leftGroups.map(g => (
              <SelectField
                key={g.id}
                label={g.label}
                value={values[g.key] ?? ''}
                options={getGroupOptions(g)}
                disabledEmpty
                disabled={isInspectionLocked}
                onChange={v => updateGroupValue(item.id, selIndex, g.key, v)}
              />
            ))}
          </div>

          {rightGroups.length > 0 && (
            <div className="space-y-3">
              {rightGroups.map(g => (
                <SelectField
                  key={g.id}
                  label={g.label}
                  value={values[g.key] ?? ''}
                  options={getGroupOptions(g)}
                  disabledEmpty
                  disabled={isInspectionLocked}
                  onChange={v => updateGroupValue(item.id, selIndex, g.key, v)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Notering */}
        {item.note_enabled && (
          <label className="ob-form-field">
            <span className="ob-form-label">Notering (valfritt)</span>
            <DebouncedTextarea
            draftKey={`ob:${draftScope}:forutsattningar:${item.id}:${sel.floor_key ?? 'nofloor'}:${sel.set_index}:note`}
              value={sel.note ?? ''}
              disabled={isInspectionLocked}
              onSave={note => updateSelectionNote(item.id, selIndex, note)}
              placeholder="Kort notering..."
              rows={2}
              className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </label>
        )}
      </div>
    )
  }

  const isRepeatableItem = (item: ItemBundle) =>
    item.selection_mode === 'multi_set'

  const isJoistItem = (item: ItemBundle) => item.key === 'joist' || item.key === 'joists'

  const getRepeatableItemTitle = (item: ItemBundle, sel: InspectionOverviewSelection, idx: number) => {
    if (item.key !== 'building_year') return `${item.label} ${idx + 1}`

    const partVal = sel.values?.['part']
    if (partVal === 'huvudbyggnad') return 'Huvudbyggnad'
    if (partVal === 'tillbyggnad') return idx === 0 ? 'Tillbyggnad' : `Tillbyggnad ${idx}`

    return idx === 0 ? 'Huvudbyggnad' : `Tillbyggnad ${idx}`
  }

  const renderItem = (item: ItemBundle) => {
    return <>{renderItemFields(item)}{item.key === 'building_type' && floorModel &&
        <ObFloorEditor inspectionId={inspection.id} disabled={isInspectionLocked || ['completed', 'klar', 'done'].includes(inspection.status ?? '')} />
    }</>
  }

  const renderItemFields = (item: ItemBundle) => {
    if (!isRepeatableItem(item) && item.selection_mode === 'single') {
      const arr = ensureSingleSelection(item.id)
      return renderSelectionSet(item, arr[0], 0)
    }

    if (isRepeatableItem(item)) {
      const arr = ensureSingleSelection(item.id)
      return (
        <div className="space-y-3">
          {arr.map((sel, idx) => (
            <div
              key={`${sel.set_index}`}
              className="ob-form-repeat"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">
                  {getRepeatableItemTitle(item, sel, idx)}
                </div>

                {arr.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSet(item.id, sel.set_index)}
                    disabled={isInspectionLocked}
                    className="ob-form-danger"
                    aria-label={`Ta bort ${getRepeatableItemTitle(item, sel, idx)}`}
                    title={`Ta bort ${getRepeatableItemTitle(item, sel, idx)}`}
                  >
                    <Trash2 size={20} />
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
            <Plus size={20} />Lägg till {item.label.toLowerCase()}
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
      if (floorModel && k) return modelFloorLabel(floorModel, k)
      if (k === 'källare') return 'Källare'
      if (k === 'källare_delvis') return 'Källare (delvis)'
      if (k === 'suterräng') return 'Suterräng'
      if (k === 'entréplan' || k === 'plan1') return 'Plan 1'
      if (k === 'plan2') return 'Plan 2'
      if (k === 'plan3') return 'Plan 3'
      if (k?.startsWith('plan')) return `Plan ${k.replace('plan', '')}`
      return k || ''
    }

    return (
      <div className="space-y-3">
        {next.map((sel, idx) => (
          <div
            key={sel.floor_key ?? idx}
            className="ob-form-repeat"
          >
            <div className="text-xs font-semibold text-gray-900">
              {floorLabel(sel.floor_key)}
              {isJoistItem(item) ? (
                <span className="ml-1 font-normal text-gray-500">(bjälklag under detta plan)</span>
              ) : null}
            </div>
            {renderSelectionSet(item, sel, idx)}
          </div>
        ))}
      </div>
    )
  }

  const renderSpecialConditionsContent = () => (
    <>
      <label className="ob-form-field">
        <span className="ob-form-label">Möblering vid besiktningstillfället</span>
        <select
          value={furnishing}
          onChange={e => {
            const lvl = e.target.value as FurnishingLevel
            setFurnishing(lvl)
            saveFurnishing(lvl)
          }}
          disabled={isInspectionLocked}
        >
          <option value="fullt_moblerad">fullt möblerad</option>
          <option value="delvis_moblerad">delvis möblerad</option>
          <option value="omoblerad">omöblerad</option>
        </select>
      </label>

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
    </>
  )

  if (loading) {
    return <div role="status" className="ob-form-root ob-form-muted p-4">Laddar förutsättningar…</div>
  }

  if (error) {
    return (
      <div role="alert" className="ob-form-root ob-form-error">
        {error}
      </div>
    )
  }

  if (usePanelLayout) {
    const panelEntry = selectedPanelEntry
    const panelIndex = panelEntry
      ? panelEntries.findIndex(entry => entry.key === panelEntry.key)
      : -1
    const previousPanelEntry = panelIndex > 0 ? panelEntries[panelIndex - 1] : null
    const nextPanelEntry =
      panelIndex >= 0 && panelIndex < panelEntries.length - 1
        ? panelEntries[panelIndex + 1]
        : null
    const closePanel = () => {
      // Escape must flush a focused text field just like clicking Back.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      setActivePanelKey(null)
    }
    const panelContent = panelEntry ? (
      <Sheet title={panelEntry.label} onClose={closePanel} className="ob-form-root ob-form-panel"
        footer={<div className="ob-form-panel-nav">
          <button type="button"
            onClick={() => previousPanelEntry && setActivePanelKey(previousPanelEntry.key)}
            disabled={!previousPanelEntry}>
            <ArrowLeft size={20} />Föregående
          </button>
          <button type="button"
            onClick={() => nextPanelEntry && setActivePanelKey(nextPanelEntry.key)}
            disabled={!nextPanelEntry}>
            Nästa<ArrowRight size={20} />
          </button>
        </div>}>
        {building?.part && <p className="ob-form-muted">{building.part.name}</p>}
        <div key={panelEntry.key} className="space-y-5">
          {panelEntry.item ? renderItem(panelEntry.item) : renderSpecialConditionsContent()}
        </div>
        {saving && <p role="status" className="ob-form-muted">Sparar…</p>}
      </Sheet>
    ) : null
    return (
      <div className="ob-form-root space-y-5">
        <header>
          <h2 className="text-xl font-semibold text-gray-900">Förutsättningar</h2>
        </header>
        <ObBuildingCover legacyPath={inspection.cover_path ?? null} locked={isInspectionLocked} />

        {isInspectionLocked ? (
          <div role="status" className="ob-form-notice">
            Besiktningen är låst. Förutsättningar är skrivskyddade.
          </div>
        ) : null}

        <section className="bg-white">
          <div className="ob-form-list">
            {panelEntries.map(entry => {
              const Icon = entry.icon
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setActivePanelKey(entry.key)}
                  className="ob-form-list-row"
                  aria-haspopup="dialog"
                >
                  <Icon size={24} aria-hidden="true" />
                  <div className="ob-form-list-text">
                    <div className="font-semibold">
                      {entry.label}
                    </div>
                    <div className="ob-form-muted">
                      {getPanelEntrySummary(entry)}
                    </div>
                  </div>
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </section>

        {panelContent}

        {!panelEntry && saving && <div role="status" className="ob-form-muted">Sparar…</div>}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-gray-900">Förutsättningar</h2>

        
      </header>

      {isInspectionLocked ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Besiktningen är låst. Förutsättningar är skrivskyddade.
        </div>
      ) : null}

      {/* SÄRSKILDA FÖRUTSÄTTNINGAR */}
      <ObBuildingCover legacyPath={inspection.cover_path ?? null} locked={isInspectionLocked} />
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-3">
        <header className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-900">Särskilda förutsättningar</h3>
          <button
            type="button"
            onClick={() => toggleItemCollapsed(SPECIAL_CONDITIONS_COLLAPSE_KEY)}
            className="shrink-0 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
            aria-expanded={!isSpecialConditionsCollapsed}
          >
            {isSpecialConditionsCollapsed ? 'Visa' : 'Dölj'}
          </button>
        </header>

        {!isSpecialConditionsCollapsed ? renderSpecialConditionsContent() : null}
      </section>

      {/* Dynamiskt från settings */}
      <section className="space-y-4">
        {items.map(item => {
          const isCollapsed = collapsedItemIds.has(item.id)

          return (
            <section
              key={item.id}
              className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-3"
            >
              <header className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-gray-900">
                  {item.label}
                </h3>
                <button
                  type="button"
                  onClick={() => toggleItemCollapsed(item.id)}
                  className="shrink-0 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? 'Visa' : 'Dölj'}
                </button>
              </header>

              {!isCollapsed ? renderItem(item) : null}
            </section>
          )
        })}
      </section>

      {saving && <div className="text-xs text-gray-500">Sparar…</div>}
    </div>
  )
}

