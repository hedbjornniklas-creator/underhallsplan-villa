export type OfferAlternatives = {
  version: 1
  issuedOn: string
  selectionTerms: string
  parts: { id: string; title: string; scope: string; amountExVatOre: number | null }[]
}

export function normalizeOfferAlternatives(value: unknown): OfferAlternatives | null {
  if (value === null) return null
  const invalid = (): never => { throw new Error('CUSTOMER_OFFER_INVALID') }
  const record = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
    return input as Record<string, unknown>
  }
  const text = (input: unknown, limit: number) => {
    if (typeof input !== 'string' || input.length > limit || input.includes('\u0000')) return invalid()
    return input.trim()
  }
  const input = record(value), issuedOn = text(input.issuedOn, 10)
  if (input.version !== 1 || !Array.isArray(input.parts) || input.parts.length > 50 ||
    issuedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || !Number.isFinite(Date.parse(issuedOn)) || new Date(issuedOn).toISOString().slice(0, 10) !== issuedOn)) return invalid()
  const seen = new Set<string>()
  return { version: 1, issuedOn, selectionTerms: text(input.selectionTerms, 6000), parts: input.parts.map(value => {
    const part = record(value), id = text(part.id, 36).toLowerCase(), amount = part.amountExVatOre
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || seen.has(id) ||
      amount !== null && (!Number.isSafeInteger(amount) || Number(amount) < 0 || Number(amount) > 100_000_000_000)) return invalid()
    seen.add(id)
    return { id, title: text(part.title, 250), scope: text(part.scope, 6000), amountExVatOre: amount as number | null }
  }) }
}
