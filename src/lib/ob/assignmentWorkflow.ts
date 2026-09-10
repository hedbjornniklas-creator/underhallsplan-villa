export type ObAssignmentSnapshot = Record<string, string | number | null | Array<{
  key: string; name: string; price: number; currency: string
}>>

export type ObAssignmentWorkflow = {
  inspectionId: string
  assignmentId: string
  status: string
  startedAt: string
  startReason: string
  acceptedAt: string | null
  bookedAt: string | null
  initialSnapshot: ObAssignmentSnapshot
  currentSnapshot: ObAssignmentSnapshot
  reviewToken: string
  needsReview: boolean
  paused: boolean
  canDeliver: boolean
  reason: string | null
}

export const obAssignmentFieldLabels: Record<string, string> = {
  customer_name: 'Kund', customer_email: 'E-post', customer_phone: 'Telefon',
  customer_address: 'Kundadress', customer_postal_code: 'Kundens postnummer', customer_city: 'Kundens ort',
  property_address: 'Objektadress', property_postal_code: 'Objektets postnummer', property_city: 'Objektets ort',
  property_municipality: 'Kommun', property_owner_name: 'Fastighetsägare', cadastral_id: 'Fastighetsbeteckning',
  brf_name: 'Bostadsrättsförening', apartment_number: 'Lägenhetsnummer', apartment_holder_name: 'Lägenhetsinnehavare',
  orderer_role: 'Uppdragsgivarroll', preferred_date: 'Besiktningsdag', preferred_time: 'Tid',
  scope_description: 'Omfattning', price_amount: 'Pris', currency: 'Valuta', invoice_name: 'Fakturanamn',
  invoice_address: 'Fakturaadress', invoice_email: 'Faktura-e-post', addons: 'Tilläggsuppdrag',
  terms_version: 'Villkorsversion',
}

export function formatObAssignmentValue(value: ObAssignmentSnapshot[string]) {
  if (Array.isArray(value)) return value.map(row => `${row.name}: ${row.price} ${row.currency}`).join('; ') || '-'
  return value === null || value === undefined || value === '' ? '-' : String(value)
}

export function getObAssignmentChanges(before: ObAssignmentSnapshot, after: ObAssignmentSnapshot) {
  return Object.keys(obAssignmentFieldLabels).filter(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
}

export function validateObEarlyStartReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const reason = value.trim()
  return reason.length >= 5 && reason.length <= 1000 ? reason : null
}
