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
