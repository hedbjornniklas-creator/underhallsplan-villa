export const BRF_ADMIN_FIELDS = [
  ['name', 'Föreningens namn'], ['org_number', 'Organisationsnummer'],
  ['property_designation', 'Fastighetsbeteckning'], ['address', 'Gatuadress'],
  ['address_line_2', 'Adressrad 2'], ['postal_code', 'Postnummer'], ['city', 'Ort'],
  ['email', 'Föreningens e-post'], ['phone', 'Föreningens telefon'],
  ['primary_contact_name', 'Kontaktperson'], ['primary_contact_email', 'Kontaktpersonens e-post'],
  ['primary_contact_phone', 'Kontaktpersonens telefon'], ['invoice_address', 'Fakturaadress'],
  ['invoice_email', 'Faktura-e-post'], ['invoice_reference', 'Fakturareferens'],
  ['unit_count', 'Antal lägenheter'], ['technical_contact', 'Teknisk kontakt'],
] as const
export type BrfAdminField = typeof BRF_ADMIN_FIELDS[number][0]
export type BrfAdminRecord = Record<Exclude<BrfAdminField, 'unit_count'>, string | null> & {
  id: string; slug: string; unit_count: number | null; internal_note: string | null;
  is_public_apply_enabled: boolean; is_public_apply_listed: boolean;
  onboarding_completed_at: string | null; onboarding_source: string | null; created_at: string;
  onboarding_terms_version: string | null; onboarding_terms_accepted_at: string | null;
}
export type BrfAdminDetail = {
  brf: BrfAdminRecord
  viewerId: string
  caseCount: number
  members: Array<{ profileId: string; name: string | null; email: string | null; role: string; hasAccess: boolean }>
  invites: Array<{ id: string; email: string; fullName: string | null; expiresAt: string;
    state: 'open' | 'accepted' | 'expired' | 'revoked'; deliveryStatus: string; deliveryError: string | null; sentAt: string | null }>
  events: Array<{ id: string; kind: string; createdAt: string; actor: string | null; details: Record<string, unknown> }>
  requests: Array<{ id: string; status: string; created_at: string; reviewed_at: string | null }>
}
