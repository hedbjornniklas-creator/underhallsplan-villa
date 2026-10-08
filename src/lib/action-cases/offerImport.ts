import type { ActionCaseItemView } from './contracts'
import type { CustomerOfferItem } from './customerOffers'

export const offerSourceFields = [
  { key: 'title', label: 'Rubrik' },
  { key: 'scope', label: 'Arbetets omfattning' },
  { key: 'scopeConditions', label: 'Förutsättningar' },
  { key: 'scopeExclusions', label: 'Ingår inte' },
  { key: 'scopeAdvice', label: 'Avrådan' },
  { key: 'amountOre', label: 'Kundpris inkl. moms' },
] as const
export type OfferSourceField = (typeof offerSourceFields)[number]['key']
export type PreparedOfferSource = {
  id: string
  values: Partial<Pick<CustomerOfferItem, OfferSourceField>>
  fingerprints: NonNullable<CustomerOfferItem['sourceReview']>
}

export type OfferSourceSelection = { sourceId: string; targetId?: string | null }

export function offerSourceTargets(existing: CustomerOfferItem[], sources: PreparedOfferSource[]) {
  const targets = new Map<string, string | null | undefined>()
  const used = new Set<string>()
  const sourceIds = new Set(sources.map((source) => source.id))
  const title = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv-SE')
  for (const source of sources) {
    const matches = existing.filter((item) => item.sourceItemId === source.id || (!item.sourceItemId && item.id === source.id))
    if (matches.length > 1 || (matches[0] && used.has(matches[0].id))) throw new Error('CUSTOMER_OFFER_INVALID')
    if (matches[0]) { targets.set(source.id, matches[0].id); used.add(matches[0].id) }
  }
  const legacy = existing.filter((item) => item.kind === 'included' && !item.sourceItemId && !sourceIds.has(item.id))
  // Only unique exact titles are safe to link automatically in older drafts.
  for (const source of sources.filter((row) => !targets.has(row.id))) {
    const name = title(source.values.title ?? '')
    const matches = legacy.filter((item) => !used.has(item.id) && title(item.title) === name)
    const sameName = sources.filter((row) => !targets.has(row.id) && title(row.values.title ?? '') === name)
    if (name && matches.length === 1 && sameName.length === 1) { targets.set(source.id, matches[0].id); used.add(matches[0].id) }
  }
  const unlinked = legacy.some((item) => !used.has(item.id))
  for (const source of sources) if (!targets.has(source.id)) targets.set(source.id, unlinked ? undefined : null)
  return targets
}

export function importOfferSources(existing: CustomerOfferItem[], sources: PreparedOfferSource[], selected: OfferSourceSelection[], withPrice: boolean): CustomerOfferItem[] {
  const targets = offerSourceTargets(existing, sources)
  const reserved = new Set([...targets.values()].filter((id): id is string => typeof id === 'string'))
  const used = new Set<string>()
  const selectedIds = new Set<string>()
  const replacements = new Map<string, CustomerOfferItem>()
  const added: CustomerOfferItem[] = []
  for (const selection of selected) {
    const source = sources.find((row) => row.id === selection.sourceId)
    if (!source || selectedIds.has(source.id)) throw new Error('CUSTOMER_OFFER_INVALID')
    selectedIds.add(source.id)
    const automatic = targets.get(source.id)
    const targetId = automatic === undefined ? selection.targetId : automatic
    if (targetId === undefined || (automatic !== undefined && selection.targetId !== undefined && selection.targetId !== automatic)) throw new Error('CUSTOMER_OFFER_INVALID')
    const target = targetId === null ? null : existing.find((item) => item.id === targetId)
    if (targetId !== null && (!target || used.has(targetId) || (automatic === undefined && (reserved.has(targetId) || target.sourceItemId || target.kind !== 'included')))) throw new Error('CUSTOMER_OFFER_INVALID')
    if (targetId === null && existing.some((item) => item.id === source.id)) throw new Error('CUSTOMER_OFFER_INVALID')
    if (targetId) used.add(targetId)
    const result: CustomerOfferItem = target ? { ...target } : { id: source.id, title: '', scope: '', kind: 'included', amountOre: null }
    for (const { key } of offerSourceFields) {
      if (key === 'amountOre' || source.values[key] === undefined) continue
      result[key] = source.values[key] ?? ''
    }
    if (withPrice && result.kind === 'included' && source.values.amountOre != null) result.amountOre = source.values.amountOre
    result.sourceItemId = source.id
    result.sourceReview = { ...target?.sourceReview, ...source.fingerprints }
    if (target) replacements.set(target.id, result)
    else added.push(result)
  }
  if (existing.length + added.length > 200) throw new Error('CUSTOMER_OFFER_INVALID')
  return [...existing.map((item) => replacements.get(item.id) ?? item), ...added]
}

// Fingerprint only the transferable customer fields, never internal costs or UE data.
export async function prepareOfferSource(source: ActionCaseItemView): Promise<PreparedOfferSource> {
  const values: PreparedOfferSource['values'] = {
    title: source.title.trim(), scope: (source.scope ?? '').trim(),
    ...(source.scopeConditionsAvailable ? { scopeConditions: (source.scopeConditions ?? '').trim() } : {}),
    ...(source.scopeNotesAvailable ? { scopeExclusions: (source.scopeExclusions ?? '').trim(), scopeAdvice: (source.scopeAdvice ?? '').trim() } : {}),
    amountOre: importableCustomerPrice(source),
  }
  const fingerprints: PreparedOfferSource['fingerprints'] = {}
  for (const { key } of offerSourceFields) {
    if (values[key] === undefined) continue
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values[key])))
    fingerprints[key] = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return { id: source.id, values, fingerprints }
}

export function offerSourceDifferences(source: PreparedOfferSource, target: CustomerOfferItem, withPrice: boolean) {
  return offerSourceFields.filter(({ key }) => {
    if (source.values[key] === undefined || (key === 'amountOre' && (!withPrice || target.kind !== 'included'))) return false
    const current = key === 'amountOre' ? target[key] : (target[key] ?? '').trim()
    return current !== source.values[key]
  })
}

export function offerSourceNeedsReview(source: PreparedOfferSource, target: CustomerOfferItem, withPrice: boolean) {
  return offerSourceDifferences(source, target, withPrice).some(({ key }) => target.sourceReview?.[key] !== source.fingerprints[key])
}

export function addOfferSources(existing: CustomerOfferItem[], selected: PreparedOfferSource[], withPrice: boolean): CustomerOfferItem[] {
  const ids = new Set(existing.map((item) => item.id))
  const added: CustomerOfferItem[] = []
  for (const source of selected) {
    if (ids.has(source.id)) continue
    ids.add(source.id)
    added.push({ id: source.id, title: source.values.title ?? '', scope: source.values.scope ?? '',
      ...source.values, kind: 'included', amountOre: withPrice ? source.values.amountOre ?? null : null,
      sourceReview: { ...source.fingerprints } })
  }
  return [...existing, ...added]
}

export function reviewOfferSource(target: CustomerOfferItem, source: PreparedOfferSource, replace: OfferSourceField[], withPrice: boolean): CustomerOfferItem {
  if (target.id !== source.id) return target
  const result = { ...target, sourceReview: { ...target.sourceReview } }
  for (const { key } of offerSourceFields) {
    if (source.values[key] === undefined || (key === 'amountOre' && (!withPrice || target.kind !== 'included'))) continue
    result.sourceReview[key] = source.fingerprints[key]
    if (!replace.includes(key)) continue
    if (key === 'amountOre') result.amountOre = source.values.amountOre ?? null
    else result[key] = source.values[key] ?? ''
  }
  return result
}

export function scopeNotesDiffer(source: ActionCaseItemView, target: CustomerOfferItem): boolean {
  return (source.scopeConditionsAvailable === true && (source.scopeConditions ?? '') !== (target.scopeConditions ?? '')) || (source.scopeNotesAvailable === true && (
    (source.scopeExclusions ?? '') !== (target.scopeExclusions ?? '') ||
    (source.scopeAdvice ?? '') !== (target.scopeAdvice ?? '')
  ))
}

// Re-import only the explicitly selected notes; preserve the customer's edited scope and price.
export function importOfferItems(existing: CustomerOfferItem[], selected: ActionCaseItemView[], withPrices: boolean): CustomerOfferItem[] {
  const notes = (source: ActionCaseItemView) => ({
    ...(source.scopeConditionsAvailable ? { scopeConditions: source.scopeConditions ?? '' } : {}),
    ...(source.scopeNotesAvailable ? { scopeExclusions: source.scopeExclusions ?? '', scopeAdvice: source.scopeAdvice ?? '' } : {}),
  })
  return [
    ...existing.map((item) => {
      const source = selected.find((s) => s.id === item.id)
      return source && scopeNotesDiffer(source, item) ? { ...item, ...notes(source) } : item
    }),
    ...selected.filter((source, index) => !existing.some((i) => i.id === source.id) && selected.findIndex((s) => s.id === source.id) === index)
      .map((source): CustomerOfferItem => ({ id: source.id, title: source.title, scope: source.scope ?? '',
        ...notes(source), kind: 'included', amountOre: withPrices ? importableCustomerPrice(source) : null })),
  ]
}

// Only customer prices cross into an offer. Internal costs and supplier notes stay private.
export function importableCustomerPrice(item: ActionCaseItemView): number | null {
  if (item.lumpSum) return item.lumpSum.verified && item.lumpSum.customerPrice !== null
    ? Math.round(item.lumpSum.customerPrice * (1 + item.lumpSum.vatRate / 100) * 100) : null
  const lines = item.costLines.filter((line) => !line.coveredByQuoteId)
  if (!lines.length || lines.some((line) => !line.verified || line.quantity === null || line.unitCost === null)) return null
  return Math.round(lines.reduce((sum, line) => sum + line.quantity! * line.unitCost! * (1 + line.markupPercent / 100) * (1 + line.vatRate / 100), 0) * 100)
}
