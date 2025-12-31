import 'server-only'

import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import type { StandardTextId } from '@/content/standardtexts/registry'

type BuildingDataRubric =
  | 'V\u00e4derlek:'
  | 'Byggnadstyp:'
  | 'Byggnads\u00e5r:'
  | 'Grundl\u00e4ggning:'
  | 'Stomme:'
  | 'Bj\u00e4lklag:'
  | 'Fasad:'
  | 'F\u00f6nster:'
  | 'Yttertak:'
  | 'Uppv\u00e4rmning:'
  | 'Ventilation:'
  | 'Vatten:'
  | 'Avlopp:'

export type BuildingDataMap = Record<BuildingDataRubric, string>
export type BuildingTypeParts = {
  TYPE: string
  FLOORS_TEXT: string
  ATTIC_TEXT: string
  BASEMENT_TEXT: string
}

export type OverviewItem = {
  id: string
  key: string
  label?: string | null
  sort_order?: number | null
}

export type OverviewGroup = {
  id: string
  overview_item_id: string
  key: string
  label?: string | null
  sort_order?: number | null
}

export type OverviewOption = {
  group_id: string
  value: string
  label: string
}

export type OverviewSelection = {
  overview_item_id: string
  floor_key?: string | null
  set_index?: number | null
  values: Record<string, unknown> | null
  note?: string | null
}

export type InspectionConditions = {
  weather?: string | null
  weather_note?: string | null
  building_type?: string | null
  building_form?: string | null
  building_year?: number | string | null
  foundation?: string | null
  frame?: string | null
  joists?: string | null
  facade?: string | null
  windows?: string | null
  roof?: string | null
  heating?: string | null
  ventilation?: string | null
  water?: string | null
  sewer?: string | null
}

const TEMPLATE_ID: StandardTextId = 'STD_BUILDING_DATA_TEMPLATE'

const RUBRICS: BuildingDataRubric[] = [
  'V\u00e4derlek:',
  'Byggnadstyp:',
  'Byggnads\u00e5r:',
  'Grundl\u00e4ggning:',
  'Stomme:',
  'Bj\u00e4lklag:',
  'Fasad:',
  'F\u00f6nster:',
  'Yttertak:',
  'Uppv\u00e4rmning:',
  'Ventilation:',
  'Vatten:',
  'Avlopp:',
]

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COMPONENT_DEFS: Array<{
  rubric: BuildingDataRubric
  itemKeys: string[]
  conditionKeys: Array<keyof InspectionConditions>
  kind?: 'weather'
}> = [
  { rubric: 'V\u00e4derlek:', itemKeys: ['weather'], conditionKeys: ['weather_note', 'weather'], kind: 'weather' },
  {
    rubric: 'Byggnadstyp:',
    itemKeys: ['building_type', 'building_form'],
    conditionKeys: ['building_type', 'building_form'],
  },
  {
    rubric: 'Byggnads\u00e5r:',
    itemKeys: ['building_year'],
    conditionKeys: ['building_year'],
  },
  {
    rubric: 'Grundl\u00e4ggning:',
    itemKeys: ['foundation'],
    conditionKeys: ['foundation'],
  },
  {
    rubric: 'Stomme:',
    itemKeys: ['structure', 'frame'],
    conditionKeys: ['frame'],
  },
  {
    rubric: 'Bj\u00e4lklag:',
    itemKeys: ['joist', 'joists'],
    conditionKeys: ['joists'],
  },
  {
    rubric: 'Fasad:',
    itemKeys: ['facade'],
    conditionKeys: ['facade'],
  },
  {
    rubric: 'F\u00f6nster:',
    itemKeys: ['windows'],
    conditionKeys: ['windows'],
  },
  {
    rubric: 'Yttertak:',
    itemKeys: ['roof'],
    conditionKeys: ['roof'],
  },
  {
    rubric: 'Uppv\u00e4rmning:',
    itemKeys: ['heating'],
    conditionKeys: ['heating'],
  },
  {
    rubric: 'Ventilation:',
    itemKeys: ['ventilation'],
    conditionKeys: ['ventilation'],
  },
  {
    rubric: 'Vatten:',
    itemKeys: ['water'],
    conditionKeys: ['water'],
  },
  {
    rubric: 'Avlopp:',
    itemKeys: ['sewage', 'sewer'],
    conditionKeys: ['sewer'],
  },
]

const FLOOR_LABELS: Record<string, string> = {
  'k\u00e4llare': 'k\u00e4llare',
  'k\u00e4llare_delvis': 'K\u00e4llare (delvis)',
  'entr\u00e9plan': 'entr\u00e9plan',
  'plan2': 'Plan 2',
  'plan3': 'Plan 3',
}

const FLOOR_ORDER = ['k\u00e4llare', 'k\u00e4llare_delvis', 'entr\u00e9plan', 'plan2', 'plan3']

const valueOrFallback = (value: string | number | null | undefined, fallback = '--') => {
  if (value === null || value === undefined) return fallback
  const text = String(value).trim()
  return text.length > 0 ? text : fallback
}

const normalizeValue = (value: unknown): string[] => {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeValue(entry))
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim()
    return text.length > 0 ? [text] : []
  }
  return [JSON.stringify(value)]
}

const resolveOptionLabel = (
  value: unknown,
  optionMap: Map<string, string> | undefined
): string => {
  const parts = normalizeValue(value)
  if (parts.length === 0) return ''
  if (!optionMap) return parts.join(', ')
  return parts
    .map((part) => optionMap.get(part) ?? part)
    .filter((part) => part && part.length > 0)
    .join(', ')
}

const resolveGroupValue = (
  values: Record<string, unknown>,
  groupKey: string,
  groups: OverviewGroup[],
  optionsByGroupId: Map<string, Map<string, string>>
) => {
  const group = groups.find((entry) => entry.key === groupKey)
  const raw = values[groupKey]
  if (raw === null || raw === undefined) return ''
  if (!group) {
    return resolveOptionLabel(raw, undefined)
  }
  return resolveOptionLabel(raw, optionsByGroupId.get(group.id))
}

const renderFloorsText = (raw: unknown) => {
  if (raw === null || raw === undefined) return '--'
  const value = String(raw).trim()
  if (!value) return '--'
  if (value === '1') return '1 v\u00e5ningsplan'
  if (value === '1.5' || value === '1_5' || value === '1,5') return '1\u00bd v\u00e5ningsplan'
  if (value === '2') return '2 v\u00e5ningsplan'
  if (value === '3') return '3 v\u00e5ningsplan'
  return value
}

const renderBasementText = (raw: unknown) => {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'boolean') return raw ? ' och k\u00e4llare' : ''
  const value = String(raw).trim().toLowerCase()
  if (value === 'ja' || value === 'yes' || value === 'true') return ' och k\u00e4llare'
  if (value === 'delvis' || value === 'partial') return ' och delvis k\u00e4llare'
  return ''
}

const resolveBuildingTypeParts = (
  row: OverviewSelection,
  groups: OverviewGroup[],
  optionsByGroupId: Map<string, Map<string, string>>
) => {
  const values = (row.values ?? {}) as Record<string, unknown>
  const typeValue = resolveGroupValue(values, 'type', groups, optionsByGroupId)
  const atticValue = resolveGroupValue(values, 'attic', groups, optionsByGroupId)
  const floorsValue = renderFloorsText(values['floors'])
  const basementText = renderBasementText(values['basement'])

  const typeText = typeValue && typeValue.trim().length > 0 ? typeValue : '--'
  const floorsText = floorsValue && floorsValue.trim().length > 0 ? floorsValue : '--'
  const atticText =
    atticValue && atticValue.trim().length > 0 ? ` samt ${atticValue}` : ''

  return {
    TYPE: typeText,
    FLOORS_TEXT: floorsText,
    ATTIC_TEXT: atticText,
    BASEMENT_TEXT: basementText,
  }
}

const renderBuildingTypeSentenceFromParts = (parts: BuildingTypeParts) =>
  `Byggnaden \u00e4r uppf\u00f6rd som ${parts.TYPE} med ${parts.FLOORS_TEXT}${parts.ATTIC_TEXT}${parts.BASEMENT_TEXT}.`

const renderBuildingTypeSentence = (
  row: OverviewSelection,
  groups: OverviewGroup[],
  optionsByGroupId: Map<string, Map<string, string>>
) => renderBuildingTypeSentenceFromParts(resolveBuildingTypeParts(row, groups, optionsByGroupId))

const formatSelectionRow = (
  row: OverviewSelection,
  groups: OverviewGroup[],
  optionsByGroupId: Map<string, Map<string, string>>
) => {
  const values = row.values ?? {}
  const segments: string[] = []
  const usedKeys = new Set<string>()

  groups.forEach((group) => {
    if (!(group.key in values)) return
    const raw = (values as Record<string, unknown>)[group.key]
    const resolved = resolveOptionLabel(raw, optionsByGroupId.get(group.id))
    if (!resolved) return
    usedKeys.add(group.key)
    segments.push(resolved)
  })

  Object.entries(values).forEach(([key, raw]) => {
    if (usedKeys.has(key)) return
    const resolved = resolveOptionLabel(raw, undefined)
    if (!resolved) return
    segments.push(resolved)
  })

  const noteText = (row.note ?? '').trim()
  let base = segments.join(', ')
  if (!base && noteText) {
    base = noteText
  } else if (base && noteText) {
    base = `${base} ${noteText}`
  }

  if (!base) return ''

  if (row.floor_key) {
    const label = FLOOR_LABELS[row.floor_key] ?? row.floor_key
    return `${label}: ${base}`
  }
  return base
}

const createBuildingDataContext = ({
  selections,
  items,
  groups,
  options,
}: {
  selections: OverviewSelection[]
  items: OverviewItem[]
  groups: OverviewGroup[]
  options: OverviewOption[]
}) => {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const itemsByKey = new Map(items.map((item) => [item.key, item]))

  const groupsByItemId = new Map<string, OverviewGroup[]>()
  groups.forEach((group) => {
    const list = groupsByItemId.get(group.overview_item_id) ?? []
    list.push(group)
    groupsByItemId.set(group.overview_item_id, list)
  })
  groupsByItemId.forEach((list, key) => {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    groupsByItemId.set(key, list)
  })

  const optionsByGroupId = new Map<string, Map<string, string>>()
  options.forEach((option) => {
    const map = optionsByGroupId.get(option.group_id) ?? new Map<string, string>()
    map.set(option.value, option.label)
    optionsByGroupId.set(option.group_id, map)
  })

  const selectionsByItemKey = new Map<string, OverviewSelection[]>()
  selections.forEach((row) => {
    const item = itemsById.get(row.overview_item_id)
    if (!item) {
      console.warn('BuildingData: saknar settings_overview_item for selection', row.overview_item_id)
      return
    }
    const list = selectionsByItemKey.get(item.key) ?? []
    list.push({
      ...row,
      values: (row.values as Record<string, unknown>) ?? {},
    })
    selectionsByItemKey.set(item.key, list)
  })

  return {
    itemsById,
    itemsByKey,
    groupsByItemId,
    optionsByGroupId,
    selectionsByItemKey,
  }
}

const sortSelectionRows = (rows: OverviewSelection[]) =>
  rows.slice().sort((a, b) => {
    const floorA = FLOOR_ORDER.indexOf(a.floor_key ?? '')
    const floorB = FLOOR_ORDER.indexOf(b.floor_key ?? '')
    if (floorA !== floorB) return floorA - floorB
    return (a.set_index ?? 0) - (b.set_index ?? 0)
  })

export function buildBuildingTypeParts({
  selections,
  items,
  groups,
  options,
  conditions,
}: {
  selections: OverviewSelection[]
  items: OverviewItem[]
  groups: OverviewGroup[]
  options: OverviewOption[]
  conditions?: InspectionConditions | null
}): BuildingTypeParts {
  const context = createBuildingDataContext({ selections, items, groups, options })
  const buildingTypeDef = COMPONENT_DEFS.find((def) => def.rubric === 'Byggnadstyp:')
  const itemKey =
    buildingTypeDef?.itemKeys.find((key) => context.itemsByKey.has(key)) ?? null

  if (!itemKey) {
    const fallbackType = valueOrFallback(
      conditions?.building_type ?? conditions?.building_form ?? null,
      '--'
    )
    return {
      TYPE: fallbackType,
      FLOORS_TEXT: '--',
      ATTIC_TEXT: '',
      BASEMENT_TEXT: '',
    }
  }

  const item = context.itemsByKey.get(itemKey)!
  const rows = sortSelectionRows(context.selectionsByItemKey.get(itemKey) ?? [])
  const groupsForItem = context.groupsByItemId.get(item.id) ?? []

  if (rows.length === 0) {
    const fallbackType = valueOrFallback(
      conditions?.building_type ?? conditions?.building_form ?? null,
      '--'
    )
    return {
      TYPE: fallbackType,
      FLOORS_TEXT: '--',
      ATTIC_TEXT: '',
      BASEMENT_TEXT: '',
    }
  }

  return resolveBuildingTypeParts(rows[0], groupsForItem, context.optionsByGroupId)
}

export function buildBuildingDataMap({
  selections,
  items,
  groups,
  options,
  conditions,
}: {
  selections: OverviewSelection[]
  items: OverviewItem[]
  groups: OverviewGroup[]
  options: OverviewOption[]
  conditions?: InspectionConditions | null
}): BuildingDataMap {
  const result = {} as BuildingDataMap

  const context = createBuildingDataContext({ selections, items, groups, options })

  COMPONENT_DEFS.forEach((def) => {
    const itemKey = def.itemKeys.find((key) => context.itemsByKey.has(key)) ?? null
    if (!itemKey && def.itemKeys.length > 0) {
      console.warn('BuildingData: saknar itemKey for komponent', {
        rubric: def.rubric,
        candidates: def.itemKeys,
      })
    }
    let selectionValue = ''

    if (itemKey) {
      const item = context.itemsByKey.get(itemKey)!
      const rows = sortSelectionRows(context.selectionsByItemKey.get(itemKey) ?? [])
      const groupsForItem = context.groupsByItemId.get(item.id) ?? []
      if (def.rubric === 'Byggnadstyp:' && rows.length > 0) {
        selectionValue = renderBuildingTypeSentence(
          rows[0],
          groupsForItem,
          context.optionsByGroupId
        )
        const noteText = (rows[0].note ?? '').trim()
        if (noteText) {
          selectionValue = `${selectionValue} ${noteText}`
        }
      } else {
        const rowTexts = rows
          .map((row) => formatSelectionRow(row, groupsForItem, context.optionsByGroupId))
          .filter((rowText) => rowText && rowText.trim().length > 0)

        if (rowTexts.length > 0) {
          selectionValue = rowTexts.join(' | ')
        }
      }
    }

    let resolvedValue = selectionValue
    if (!resolvedValue) {
      if (def.rubric === 'Byggnadstyp:') {
        const typeFallback = valueOrFallback(
          conditions?.building_type ?? conditions?.building_form ?? null,
          '--'
        )
        resolvedValue = `Byggnaden \u00e4r uppf\u00f6rd som ${typeFallback} med --.`
      } else if (def.kind === 'weather') {
        const weatherNote = conditions?.weather_note ?? null
        const weather = conditions?.weather ?? null
        if (weather && weatherNote) {
          resolvedValue = `${String(weather).trim()} (${String(weatherNote).trim()})`
        } else if (weatherNote) {
          resolvedValue = String(weatherNote).trim()
        } else if (weather) {
          resolvedValue = String(weather).trim()
        }
      } else {
        const fallbackValue = def.conditionKeys
          .map((key) => conditions?.[key])
          .find((value) => value !== null && value !== undefined && String(value).trim().length > 0)
        if (fallbackValue !== undefined && fallbackValue !== null) {
          resolvedValue = String(fallbackValue).trim()
        }
      }
    }

    result[def.rubric] = valueOrFallback(resolvedValue, '--')
  })

  return result
}

export function renderBuildingDataTextFromTemplate(
  map: BuildingDataMap,
  templateId: StandardTextId = TEMPLATE_ID,
  buildingTypeParts?: BuildingTypeParts
): string {
  const templateText = loadStandardText(templateId)
  return renderBuildingDataText(map, templateText, buildingTypeParts)
}

export function renderBuildingDataText(
  map: BuildingDataMap,
  templateText: string,
  buildingTypeParts?: BuildingTypeParts
): string {
  const lines = templateText.split(/\r?\n/)
  const updated = [...lines]
  const appended: string[] = []

  RUBRICS.forEach((rubric) => {
    const value = map[rubric] ?? '--'
    let valueText = value
    const index = updated.findIndex((row) => row.trim().startsWith(rubric))
    if (index >= 0) {
      const templateLine = updated[index]
      if (rubric === 'Byggnadstyp:' && templateLine.includes('{TYPE}')) {
        const parts = buildingTypeParts ?? {
          TYPE: '--',
          FLOORS_TEXT: '--',
          ATTIC_TEXT: '',
          BASEMENT_TEXT: '',
        }
        const templateValue = templateLine.replace(
          new RegExp(`^\\s*${escapeRegExp(rubric)}\\s*`),
          ''
        )
        const resolvedValue = templateValue
          .replace(/\{TYPE\}/g, parts.TYPE)
          .replace(/\{FLOORS_TEXT\}/g, parts.FLOORS_TEXT)
          .replace(/\{ATTIC_TEXT\}/g, parts.ATTIC_TEXT)
          .replace(/\{BASEMENT_TEXT\}/g, parts.BASEMENT_TEXT)
        valueText = resolvedValue.trim().length > 0 ? resolvedValue.trim() : valueText
      }
      updated[index] = `${rubric} ${valueText}`
    } else {
      appended.push(`${rubric} ${valueText}`)
    }
  })

  if (appended.length > 0) {
    if (updated.length > 0 && updated[updated.length - 1].trim().length > 0) {
      updated.push('')
    }
    updated.push(...appended)
  }

  return updated.join('\n')
}



