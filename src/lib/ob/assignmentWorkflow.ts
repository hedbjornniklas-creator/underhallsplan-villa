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
  // Optional until the reconciliation migration has been applied. Never fall back to
  // the old acknowledgment-only operation when these values are missing.
  inspectionSnapshot?: ObAssignmentSnapshot
  reconciliationToken?: string
  inspectionLocked?: boolean
}

export const obAssignmentTransferFields = [
  'customer_name', 'customer_email', 'customer_phone', 'customer_address', 'customer_postal_code', 'customer_city',
  'property_address', 'property_postal_code', 'property_city', 'property_municipality', 'property_owner_name',
  'cadastral_id', 'brf_name', 'apartment_number', 'apartment_holder_name',
  'orderer_role', 'preferred_date', 'preferred_time',
] as const
export type ObAssignmentTransferField = typeof obAssignmentTransferFields[number]

export function isObAssignmentTransferFields(value: unknown): value is ObAssignmentTransferField[] {
  return Array.isArray(value) && value.length <= obAssignmentTransferFields.length &&
    new Set(value).size === value.length && value.every(field =>
      typeof field === 'string' && (obAssignmentTransferFields as readonly string[]).includes(field))
}

export function normalizeObAssignmentRole(value: string) {
  const role = value.trim().toLowerCase()
  if (/(sell|sälj|salj)/.test(role)) return 'seller'
  if (/(apt|apartment|lägenhet|lagenhet)/.test(role)) return 'apartment'
  return 'buyer'
}

export function comparableObAssignmentValue(key: string, value: ObAssignmentSnapshot[string]) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return JSON.stringify(value)
  const text = value.trim()
  if (!text) return ''
  if (key === 'orderer_role') return normalizeObAssignmentRole(text)
  if (key === 'customer_email') return text.toLowerCase()
  if (key === 'preferred_time') return text.replace(/:00(?:\.0+)?$/, match => text.split(':').length === 3 ? '' : match)
  return text
}

export function getObAssignmentTransferRows(workflow: ObAssignmentWorkflow) {
  if (!workflow.inspectionSnapshot) return []
  return obAssignmentTransferFields.map(key => {
    const before = workflow.inspectionSnapshot![key]
    const after = workflow.currentSnapshot[key]
    const current = comparableObAssignmentValue(key, before)
    const proposed = comparableObAssignmentValue(key, after)
    return { key, before, after, differs: current !== proposed,
      canTransfer: proposed !== '' && current !== proposed,
      preselected: current === '' && proposed !== '' }
  })
}

export type ObAssignmentReconciledDetail = { workflow: ObAssignmentWorkflow; fields: ObAssignmentTransferField[] }

// Patch only the selected values in the open page; do not reload/remount notes or
// replace unrelated local state when the reconciliation succeeds.
export function getObAssignmentReconciliationPatches({ workflow, fields }: ObAssignmentReconciledDetail) {
  const inspection: Record<string, string | null> = {}
  const property: Record<string, string | null> = {}
  const snapshot = workflow.inspectionSnapshot
  if (!snapshot) return { inspection, property }
  const propertyKeys: Record<string, string> = {
    property_address: 'address', property_postal_code: 'postal_code', property_city: 'city',
    property_municipality: 'municipality', property_owner_name: 'owner_name',
    cadastral_id: 'cadastral_id', brf_name: 'brf_name', apartment_number: 'apartment_number',
    apartment_holder_name: 'apartment_holder_name',
  }
  for (const key of fields) {
    const value = typeof snapshot[key] === 'string' ? snapshot[key] as string : null
    if (key.startsWith('customer_')) { inspection[key] = value; property[key] = value }
    else if (propertyKeys[key]) property[propertyKeys[key]] = value
    else if (key === 'preferred_date') {
      inspection.date = value
      if (typeof snapshot.assignment_number === 'string') inspection.assignment_number = snapshot.assignment_number
    }
    else if (key === 'preferred_time') inspection.inspection_time = value
    else if (key === 'orderer_role' && value) inspection.inspection_side = normalizeObAssignmentRole(value)
  }
  if (fields.includes('customer_name')) inspection.client_name = inspection.customer_name
  if (fields.includes('customer_phone') || fields.includes('customer_email')) {
    inspection.client_contact = [snapshot.customer_phone, snapshot.customer_email].filter(Boolean).join(' | ') || null
  }
  return { inspection, property }
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
