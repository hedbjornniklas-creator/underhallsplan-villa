import type { CustomerOfferDraft } from './customerOffers'

export type OfferHourEstimate = { version: 1; minHours: number | null; maxHours: number | null }

export function normalizeOfferHourEstimate(value: unknown): OfferHourEstimate | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_OFFER_INVALID')
  const estimate = value as Record<string, unknown>
  if (estimate.version !== 1) throw new Error('CUSTOMER_OFFER_INVALID')
  for (const key of ['minHours', 'maxHours']) {
    const hours = estimate[key]
    if (hours !== null && (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 100000 ||
      Math.abs(hours * 100 - Math.round(hours * 100)) > 0.00001)) throw new Error('CUSTOMER_OFFER_INVALID')
  }
  return { version: 1, minHours: estimate.minHours as number | null, maxHours: estimate.maxHours as number | null }
}

export function offerHourEstimateIssues(draft: CustomerOfferDraft): string[] {
  const estimate = draft.offerHourEstimate
  if (!estimate || !draft.contractPricing || draft.contractPricing.mode === 'fixed') return []
  const { minHours, maxHours } = estimate
  if (minHours === null || maxHours === null) return ['Ange både lägsta och högsta uppskattade timantal.']
  if (minHours > maxHours) return ['Det högsta timantalet får inte vara lägre än det lägsta.']
  if (estimatedLabourRange(draft) === null && draft.contractPricing.running.hourlyOre !== null)
    return ['Det beräknade arbetspriset är för stort. Kontrollera timmar och timpris.']
  return []
}

export function estimatedLabourRange(draft: CustomerOfferDraft): { minOre: number; maxOre: number } | null {
  const estimate = draft.offerHourEstimate, pricing = draft.contractPricing
  if (!estimate || !pricing || pricing.mode === 'fixed' || pricing.running.hourlyOre === null ||
    estimate.minHours === null || estimate.maxHours === null || estimate.minHours > estimate.maxHours) return null
  // Multiply hundredths of hours by ore and round once, without floating-point money arithmetic.
  const cost = (hours: number) => (BigInt(Math.round(hours * 100)) * BigInt(pricing.running.hourlyOre!) + BigInt(50)) / BigInt(100)
  const min = cost(estimate.minHours), max = cost(estimate.maxHours)
  if (max > BigInt(100_000_000_000)) return null
  return { minOre: Number(min), maxOre: Number(max) }
}

export function estimatedHoursLabel(estimate: OfferHourEstimate): string {
  const number = (value: number | null) => value === null ? '…' : new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(value)
  return `${number(estimate.minHours)}–${number(estimate.maxHours)} timmar`
}
