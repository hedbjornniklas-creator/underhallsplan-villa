import type { CustomerChoiceCosting } from './customerChoiceCosting'

export const planningStatuses = {
  planned: 'Planerat',
  pricing: 'Behöver prissättas',
  deferred: 'Senare beslut',
  external: 'Beställaren ordnar'
} as const
export type CustomerPlannedItem = {
  id: string
  title: string
  scope: string
  status: keyof typeof planningStatuses
  budgetOre: number | null
  decisionBy: string
  optionGroup?: string
}
export type CustomerPlanning = {
  revision: number
  items: CustomerPlannedItem[]
  sharedItems: CustomerPlannedItem[]
  available: boolean
  costing?: CustomerChoiceCosting
  costingAvailable?: boolean
  rowCostingAvailable?: boolean
  categoriesAvailable?: boolean
  categoriesStored?: boolean
  categories?: CustomerChoiceCategory[]
  sharedChoices?: SharedCustomerChoices
  filesAvailable?: boolean
  optionFiles?: CustomerChoiceFileRef[]
  sharedFileRefs?: CustomerChoiceFileRef[]
}

export type CustomerChoiceFileRef = { optionId: string; fileId: string }
export type CustomerChoiceFile = { id: string; optionId: string; fileName: string; fileSizeBytes: number }

export type CustomerChoiceCategory = {
  id: string
  title: string
  specification: string
  decisionBy: string
  optionIds: string[]
}
export type CustomerChoice = {
  categoryId: string
  categoryVersion: string
  optionId: string | null
  revision: number
  selectedAt: string
}
export type SharedCustomerChoices = {
  revision: number
  categories: CustomerChoiceCategory[]
  items: CustomerPlannedItem[]
  versions: Record<string, string>
  choices: CustomerChoice[]
  files?: CustomerChoiceFile[]
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Legacy labels become a proposed hierarchy; reading never rewrites the plan.
export function legacyChoiceCategories(items: CustomerPlannedItem[]): CustomerChoiceCategory[] {
  const groups = new Map<string, CustomerChoiceCategory>()
  for (const item of items) {
    const group = item.optionGroup?.trim(), key = group ? `group:${group}` : `item:${item.id}`
    const category = groups.get(key)
    if (category) {
      category.optionIds.push(item.id)
      if (category.decisionBy !== item.decisionBy) category.decisionBy = ''
    } else groups.set(key, { id: item.id, title: group || item.title, specification: '', decisionBy: item.decisionBy, optionIds: [item.id] })
  }
  return [...groups.values()]
}

export function categoryOptions(category: CustomerChoiceCategory, items: CustomerPlannedItem[]) {
  return category.optionIds.flatMap((id) => items.find((item) => item.id === id) ?? [])
}

export function choiceDecisionDates(items: CustomerPlannedItem[], shared?: SharedCustomerChoices): { id: string; title: string; decisionBy: string }[] {
  const rows = shared ? shared.categories.filter((category) => category.decisionBy) : items.filter((item) => item.decisionBy)
  return rows.map(({ id, title, decisionBy }) => ({ id, title, decisionBy })).sort((a, b) => a.decisionBy.localeCompare(b.decisionBy))
}

export function normalizeChoiceFileRefs(value: unknown, items: CustomerPlannedItem[]): CustomerChoiceFileRef[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('CUSTOMER_CHOICE_FILES')
  const seen = new Set<string>()
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || !uuid.test(raw.optionId) || !uuid.test(raw.fileId) || !items.some((i) => i.id === raw.optionId)) throw new Error('CUSTOMER_CHOICE_FILES')
    const key = `${raw.optionId}/${raw.fileId}`
    if (seen.has(key)) throw new Error('CUSTOMER_CHOICE_FILES')
    seen.add(key)
    return { optionId: raw.optionId as string, fileId: raw.fileId as string }
  }).sort((a, b) => a.optionId.localeCompare(b.optionId) || a.fileId.localeCompare(b.fileId))
}

export function normalizeSharedChoiceFiles(value: unknown, items: CustomerPlannedItem[]): CustomerChoiceFile[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('CUSTOMER_CHOICE_FILES')
  const ids = new Set<string>()
  return value.map((raw) => {
    if (!raw || !uuid.test(raw.id) || ids.has(raw.id) || !items.some((i) => i.id === raw.optionId) || typeof raw.fileName !== 'string' || !raw.fileName.trim() || raw.fileName.length > 250 ||
      !Number.isSafeInteger(raw.fileSizeBytes) || raw.fileSizeBytes < 100 || raw.fileSizeBytes > 20_000_000) throw new Error('CUSTOMER_CHOICE_FILES')
    ids.add(raw.id)
    return { id: raw.id as string, optionId: raw.optionId as string, fileName: raw.fileName as string, fileSizeBytes: raw.fileSizeBytes as number }
  })
}

export function normalizeChoiceCategories(value: unknown, items: CustomerPlannedItem[], complete = false): CustomerChoiceCategory[] {
  const fail = (): never => { throw new Error('CUSTOMER_CHOICE_INVALID') }
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value.trim() : fail()
  if (!Array.isArray(value) || value.length > 200) return fail()
  const seen = new Set<string>(), assigned = new Set<string>(), available = new Set(items.map((i) => i.id))
  const categories = value.map((raw): CustomerChoiceCategory => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
    const row = raw as Record<string, unknown>
    const id = text(row.id, 36), title = text(row.title, 250), specification = text(row.specification, 12000), decisionBy = text(row.decisionBy, 10)
    if (!uuid.test(id) || seen.has(id) || !Array.isArray(row.optionIds) || row.optionIds.length > 200) return fail()
    seen.add(id)
    if (decisionBy && (!/^\d{4}-\d{2}-\d{2}$/.test(decisionBy) || !Number.isFinite(Date.parse(decisionBy)) || new Date(decisionBy).toISOString().slice(0, 10) !== decisionBy)) return fail()
    const optionIds = row.optionIds.map((value) => {
      const optionId = text(value, 36)
      if (!uuid.test(optionId) || !available.has(optionId) || assigned.has(optionId)) return fail()
      assigned.add(optionId)
      return optionId
    })
    if (complete && (!title || !optionIds.length)) return fail()
    return { id, title, specification, decisionBy, optionIds }
  })
  if (assigned.size !== items.length) return fail()
  return categories
}

export function currentCategoryChoice(shared: SharedCustomerChoices | undefined, categoryId: string) {
  const choice = shared?.choices.find((row) => row.categoryId === categoryId)
  return choice?.categoryVersion === shared?.versions[categoryId] ? choice : undefined
}

export function normalizeSharedChoices(raw: Record<string, unknown>): SharedCustomerChoices {
  const items = normalizePlannedItems(raw.items ?? [])
  const categories = normalizeChoiceCategories(raw.categories ?? [], items, true)
  const versions = raw.versions as Record<string, string> | undefined
  const choices = raw.choices as CustomerChoice[] | undefined
  if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0 || !versions || typeof versions !== 'object' || Array.isArray(versions) ||
      categories.some((category) => !uuid.test(versions[category.id] ?? '')) || !Array.isArray(choices)) throw new Error('CUSTOMER_CHOICE_INVALID')
  const seen = new Set<string>()
  const safeChoices = choices.map((choice) => {
    if (!choice || !uuid.test(choice.categoryId) || seen.has(choice.categoryId) || !uuid.test(choice.categoryVersion) ||
        (choice.optionId !== null && !uuid.test(choice.optionId)) || !Number.isSafeInteger(choice.revision) || choice.revision < 1 ||
        typeof choice.selectedAt !== 'string' || !Number.isFinite(Date.parse(choice.selectedAt))) throw new Error('CUSTOMER_CHOICE_INVALID')
    seen.add(choice.categoryId)
    const category = categories.find((c) => c.id === choice.categoryId)
    if (!category) throw new Error('CUSTOMER_CHOICE_INVALID')
    if (choice.categoryVersion === versions[category.id] && choice.optionId !== null && !category.optionIds.includes(choice.optionId)) throw new Error('CUSTOMER_CHOICE_INVALID')
    return { categoryId: choice.categoryId, categoryVersion: choice.categoryVersion, optionId: choice.optionId, revision: choice.revision, selectedAt: choice.selectedAt }
  })
  return { revision: Number(raw.revision), categories, items, versions: Object.fromEntries(categories.map((c) => [c.id, versions[c.id]])), choices: safeChoices,
    ...(raw.files !== undefined ? { files: normalizeSharedChoiceFiles(raw.files, items) } : {}) }
}
export function normalizePlannedItems(
  value: unknown,
  complete = false
): CustomerPlannedItem[] {
  const fail = (): never => {
    throw new Error('CUSTOMER_OFFER_INVALID')
  }
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length <= max ? v.trim() : fail()
  if (!Array.isArray(value) || value.length > 200) fail()
  const items = (value as unknown[]).map((v): CustomerPlannedItem => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail()
    const item = v as Record<string, unknown>
    const id = text(item.id, 36),
      title = text(item.title, 250),
      scope = text(item.scope, 12000),
      decisionBy = text(item.decisionBy, 10)
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      ) ||
      !Object.hasOwn(planningStatuses, String(item.status))
    )
      fail()
    if (complete && (!title || !scope)) fail()
    if (
      decisionBy &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(decisionBy) ||
        !Number.isFinite(Date.parse(decisionBy)) ||
        new Date(decisionBy).toISOString().slice(0, 10) !== decisionBy)
    )
      fail()
    if (
      item.budgetOre !== null &&
      (!Number.isSafeInteger(item.budgetOre) ||
        Number(item.budgetOre) < 0 ||
        Number(item.budgetOre) > 100_000_000_000)
    )
      fail()
    return {
      id,
      title,
      scope,
      status: item.status as CustomerPlannedItem['status'],
      budgetOre: item.budgetOre as number | null,
      decisionBy,
      ...(item.optionGroup !== undefined ? { optionGroup: text(item.optionGroup, 100) } : {})
    }
  })
  if (new Set(items.map((i) => i.id)).size !== items.length) fail()
  return items
}
