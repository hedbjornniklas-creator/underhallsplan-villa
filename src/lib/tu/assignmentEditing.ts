import type { AssignmentDetails } from '@/lib/assignments/server'

export const TU_ASSIGNMENT_FIELDS = [
  { key: 'customer_name', label: 'Namn', group: 'Beställare' },
  { key: 'customer_email', label: 'E-post', group: 'Beställare', type: 'email', required: true },
  { key: 'customer_phone', label: 'Telefon', group: 'Beställare' },
  { key: 'customer_address', label: 'Beställaradress', group: 'Beställare' },
  { key: 'customer_postal_code', label: 'Postnummer', group: 'Beställare' },
  { key: 'customer_city', label: 'Ort', group: 'Beställare' },
  { key: 'property_address', label: 'Objektadress', group: 'Objekt' },
  { key: 'property_postal_code', label: 'Postnummer', group: 'Objekt' },
  { key: 'property_city', label: 'Ort', group: 'Objekt' },
  { key: 'property_municipality', label: 'Kommun', group: 'Objekt' },
  { key: 'cadastral_id', label: 'Fastighetsbeteckning', group: 'Objekt' },
  { key: 'property_owner_name', label: 'Fastighetsägare', group: 'Objekt' },
  { key: 'brf_name', label: 'Bostadsrättsförening', group: 'Objekt' },
  { key: 'apartment_number', label: 'Lägenhetsnummer', group: 'Objekt' },
  { key: 'apartment_holder_name', label: 'Bostadsrättsinnehavare', group: 'Objekt' },
  { key: 'scope_description', label: 'Utredningens omfattning', group: 'Uppdrag', type: 'textarea' },
  { key: 'price_amount', label: 'Pris', group: 'Uppdrag', type: 'price' },
  { key: 'invoice_name', label: 'Fakturanamn', group: 'Fakturering' },
  { key: 'invoice_email', label: 'Faktura-e-post', group: 'Fakturering', type: 'email' },
  { key: 'invoice_address', label: 'Fakturaadress', group: 'Fakturering' },
  { key: 'personal_identity_number', label: 'Person-/organisationsnummer', group: 'Fakturering' },
  { key: 'notes_internal', label: 'Intern anteckning', group: 'Internt', type: 'textarea' },
] as const satisfies ReadonlyArray<{ key: keyof AssignmentDetails; label: string; group: string; type?: string; required?: boolean }>

export type TuAssignmentForm = Record<(typeof TU_ASSIGNMENT_FIELDS)[number]['key'], string>

export function tuAssignmentForm(assignment: AssignmentDetails): TuAssignmentForm {
  return Object.fromEntries(TU_ASSIGNMENT_FIELDS.map(({ key }) => [key,
    String(assignment[key] ?? (key === 'property_address' ? assignment.preliminary_address ?? '' : '')),
  ])) as TuAssignmentForm
}

export function parseTuAssignmentEdit(body: unknown): { patch: Record<string, string | number | null>; expectedUpdatedAt: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ogiltiga uppgifter.')
  const input = body as Record<string, unknown>
  const allowed = new Set<string>(['expectedUpdatedAt', ...TU_ASSIGNMENT_FIELDS.map(field => field.key)])
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('Ändringen innehåller fält som inte kan redigeras här.')
  if (typeof input.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new Error('Hämta aktuella uppgifter innan du sparar.')
  const patch: Record<string, string | number | null> = {}
  for (const { key } of TU_ASSIGNMENT_FIELDS) {
    if (!(key in input)) continue
    if (typeof input[key] !== 'string' || input[key].length > (key === 'scope_description' || key === 'notes_internal' ? 20000 : 1000)) throw new Error('Kontrollera textfälten. Någon uppgift är för lång eller ogiltig.')
    const value = input[key].trim()
    if (key === 'customer_email' && !value) throw new Error('Ange kundens e-postadress.')
    if ((key === 'customer_email' || key === 'invoice_email') && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Ange en giltig e-postadress.')
    if (key === 'price_amount') {
      const price = value ? Number(value.replace(',', '.')) : null
      if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('Ange ett giltigt pris.')
      patch[key] = price === null ? null : Math.round(price * 100) / 100
    } else patch[key] = value || null
  }
  if (!Object.keys(patch).length) throw new Error('Inga ändringar att spara.')
  return { patch, expectedUpdatedAt: input.expectedUpdatedAt }
}
