export type OverviewFloorValueMap = Record<string, unknown>

export type OverviewFloorOption = {
  value: string | null
  label: string | null
  system_value?: string | null
}

export type OverviewFloorGroup = {
  key: string | null
  options?: OverviewFloorOption[]
}

export type OverviewFloorOptionLookup = Record<string, OverviewFloorOption[]>

const repairSwedishText = (value: string) =>
  value
    .replace(/ÃƒÂ¥|Ã¥/g, 'å')
    .replace(/ÃƒÂ¤|Ã¤/g, 'ä')
    .replace(/ÃƒÂ¶|Ã¶/g, 'ö')
    .replace(/Ãƒâ€¦|Ã…/g, 'Å')
    .replace(/Ãƒâ€ž|Ã„/g, 'Ä')
    .replace(/Ãƒâ€“|Ã–/g, 'Ö')

const normalizeToken = (value: unknown) =>
  repairSwedishText(String(value ?? ''))
    .trim()
    .toLowerCase()
    .replaceAll('å', 'a')
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')
    .replace(/\s+/g, ' ')

const compactToken = (value: unknown) => normalizeToken(value).replace(/[^a-z0-9]/g, '')

const parseFloorCount = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }

  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!normalized) return 0

  const halfFloorMatch = normalized.match(/^(\d+)(?:_5|\.5)$/)
  if (halfFloorMatch) {
    return Number(halfFloorMatch[1]) + 1
  }

  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

const valueByAliases = (
  values: OverviewFloorValueMap,
  aliases: string[]
): unknown => {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(values, alias)) return values[alias]
  }
  return null
}

const optionLookupKey = (value: string | null | undefined) => compactToken(value)

export const buildOverviewFloorOptionLookup = (
  groups: OverviewFloorGroup[]
): OverviewFloorOptionLookup => {
  const lookup: OverviewFloorOptionLookup = {}
  for (const group of groups) {
    const key = optionLookupKey(group.key)
    if (!key) continue
    lookup[key] = group.options ?? []
  }
  return lookup
}

const optionsForAliases = (
  lookup: OverviewFloorOptionLookup,
  aliases: string[]
) => {
  for (const alias of aliases) {
    const options = lookup[optionLookupKey(alias)]
    if (options) return options
  }
  return []
}

const findMatchingOption = (
  rawValue: unknown,
  options: OverviewFloorOption[]
) => {
  const raw = compactToken(rawValue)
  if (!raw) return null
  return options.find(option => compactToken(option.value) === raw) ?? null
}

const basementFloorKey = (
  rawValue: unknown,
  lookup: OverviewFloorOptionLookup
) => {
  const options = optionsForAliases(lookup, ['basement', 'källare', 'kallare'])
  const option = findMatchingOption(rawValue, options)
  const systemToken = normalizeToken(option?.system_value)
  const candidates = [
    rawValue,
    option?.system_value,
    option?.label,
    option?.value,
  ].map(normalizeToken)

  if (systemToken === 'nej' || systemToken === 'no' || systemToken === 'false') return null

  if (systemToken === 'ja' || systemToken === 'yes' || systemToken === 'true') {
    if (candidates.some(candidate => candidate.includes('suterrang') || candidate.includes('souterrang'))) {
      return 'suterräng'
    }
    if (candidates.some(candidate => candidate.includes('delvis') || candidate === 'partial')) {
      return 'källare_delvis'
    }
    return 'källare'
  }

  if (candidates.some(candidate =>
    candidate === 'nej' ||
    candidate === 'no' ||
    candidate === 'false' ||
    candidate === 'none' ||
    candidate === 'utan kallare' ||
    candidate === 'ingen kallare' ||
    candidate.includes('krypgrund')
  )) {
    return null
  }

  if (candidates.some(candidate => candidate.includes('suterrang') || candidate.includes('souterrang'))) {
    return 'suterräng'
  }

  if (candidates.some(candidate => candidate.includes('delvis') || candidate === 'partial')) {
    return 'källare_delvis'
  }

  if (
    candidates.some(candidate =>
      candidate === 'ja' ||
      candidate === 'yes' ||
      candidate === 'true' ||
      candidate.includes('kallare')
    )
  ) {
    return 'källare'
  }

  return null
}

export const buildInteriorFloorKeysFromOverview = (
  values: OverviewFloorValueMap,
  optionLookup: OverviewFloorOptionLookup = {}
): string[] => {
  const floorsVal = valueByAliases(values, ['floors', 'våningar', 'våning'])
  const basementVal = valueByAliases(values, ['basement', 'källare', 'kallare'])
  const atticVal = valueByAliases(values, ['attic', 'vind'])

  const keys: string[] = []
  const basementKey = basementFloorKey(basementVal, optionLookup)
  if (basementKey) keys.push(basementKey)

  const count = parseFloorCount(floorsVal)
  for (let floor = 1; floor <= count; floor += 1) {
    keys.push(`plan${floor}`)
  }

  if (atticVal !== null && atticVal !== undefined && String(atticVal).trim() !== '') {
    keys.push('vind')
  }

  return keys
}
