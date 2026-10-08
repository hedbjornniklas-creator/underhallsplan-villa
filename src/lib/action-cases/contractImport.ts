import type { CustomerOfferItem } from './customerOffers'

export type ContractImportSource = Pick<CustomerOfferItem, 'title' | 'scope' | 'scopeConditions' | 'scopeExclusions' | 'scopeAdvice' | 'amountOre' | 'kind'> & { id: string }

// Copy values, never share object references or synchronize an imported row later.
export function importContractParts(existing: CustomerOfferItem[], sources: ContractImportSource[], selected: string[], withPrices: boolean,
  newId: () => string = () => crypto.randomUUID()): CustomerOfferItem[] {
  const result = existing.map((item) => ({ ...item }))
  const chosen = new Set(selected)
  const used = new Set<string>()
  const name = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv-SE')
  for (const source of sources.filter((row) => chosen.has(row.id) && row.kind !== 'option')) {
    const linked = result.filter((row) => row.sourceItemId === source.id || row.id === source.id)
    const titled = result.filter((row) => name(row.title) === name(source.title) && row.kind === source.kind)
    const target = linked.length === 1 ? linked[0] : titled.length === 1 ? titled[0] : undefined
    if (target && used.has(target.id)) throw new Error('CUSTOMER_OFFER_INVALID')
    const values = { title: source.title, scope: source.scope,
      scopeConditions: source.scopeConditions ?? '', scopeExclusions: source.scopeExclusions ?? '', scopeAdvice: source.scopeAdvice ?? '',
      sourceItemId: source.id }
    if (target) {
      used.add(target.id)
      result[result.indexOf(target)] = { ...target, ...values, sourceReview: undefined,
        amountOre: withPrices ? source.amountOre : target.amountOre }
    } else {
      result.push({ id: newId(), ...values, kind: source.kind, amountOre: withPrices ? source.amountOre : null })
    }
  }
  const links = result.flatMap((row) => row.sourceItemId ? [row.sourceItemId] : [])
  if (result.length > 200 || new Set(result.map((row) => row.id)).size !== result.length || new Set(links).size !== links.length) throw new Error('CUSTOMER_OFFER_INVALID')
  return result
}
