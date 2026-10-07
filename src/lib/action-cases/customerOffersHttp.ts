import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { requireModuleAccess } from '@/lib/access/server'

export async function customerOfferContext() {
  const org = await requireOrgContext()
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'tasks',
    scopeType: 'organization',
    scopeId: org.orgId
  })
  return { orgId: org.orgId, userId: org.userId }
}
export async function offerRequestBody(request: Request) {
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    throw new Error('CUSTOMER_OFFER_CLOSED')
  const raw = await request.text()
  if (raw.length > 500000) throw new Error('CUSTOMER_OFFER_INVALID')
  try {
    const body = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new Error('CUSTOMER_OFFER_INVALID')
  }
}
export function customerOfferError(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const errors: Record<string, [number, string]> = {
    CUSTOMER_OFFER_STANDARD_TERMS: [503, 'Standardvillkoren kunde inte förberedas. Dina ändringar är kvar. Försök igen innan avtalet skickas.'],
    CUSTOMER_OFFER_TERMS_LIMIT: [400, 'Lämna plats för ABS 18:s standardvillkor. Avtalet kan innehålla högst 30 bilagor.'],
    PROPERTY_SCHEMA: [503, 'Fastighetskopplingen behöver aktiveras av administratören. Dina ändringar är kvar.'],
    PROPERTY_INVALID: [400, 'Kontrollera fastighetsuppgifterna. Ange kommun och fastighetsbeteckning.'],
    PROPERTY_FORBIDDEN: [403, 'Du saknar behörighet till fastigheten eller projektet.'],
    PROPERTY_NOT_FOUND: [404, 'Fastigheten kunde inte hittas. Hämta fastighetslistan igen.'],
    PROPERTY_AMBIGUOUS: [409, 'Flera fastigheter har samma beteckning och kommun. Välj rätt fastighet från HusHub.'],
    PROPERTY_EXISTS: [409, 'Fastigheten finns redan i HusHub. Välj den från fastighetslistan.'],
    PROPERTY_STALE: [409, 'Fastighetsuppgifterna har ändrats. Hämta listan igen innan du kopplar fastigheten.'],
    PROPERTY_FAILED: [500, 'Fastigheten kunde inte kopplas. Dina ändringar är kvar. Försök igen.'],
    PROJECT_BILLING_SCHEMA: [503, 'Fakturakopplingen behöver aktiveras av administratören.'],
    PROJECT_BILLING_FAILED: [500, 'Faktureringsuppgifterna kunde inte sparas. Dina ändringar är kvar. Försök igen.'],
    PROJECT_BILLING_STALE: [409, 'Fakturakopplingen har ändrats. Dina ändringar är kvar. Hämta den sparade versionen innan du fortsätter.'],
    PROJECT_BILLING_CUSTOMER: [409, 'Välj en aktiv kund i organisationens kundregister och kontrollera kundversionen.'],
    CUSTOMER_REGISTRY_SCHEMA: [503, 'Kundkopplingen behöver aktiveras av administratören. Dina ändringar är kvar.'],
    CUSTOMER_REGISTRY_FORBIDDEN: [403, 'Du saknar behörighet att skapa eller koppla denna kund.'],
    CUSTOMER_REGISTRY_NOT_FOUND: [404, 'Välj en aktiv privatkund i organisationens kundregister.'],
    CUSTOMER_REGISTRY_STALE: [409, 'Kunduppgifterna har ändrats. Hämta kundregistret igen innan du kopplar kunden.'],
    CUSTOMER_REGISTRY_WITHDRAW_FIRST: [409, 'Återkalla det öppna avtalet innan du byter beställare eller mottagare.'],
    CUSTOMER_REGISTRY_HISTORY_LOCKED: [409, 'Projektet har tidigare avtalsversioner. Ett byte av beställare eller mottagare behöver hanteras som ett nytt uppdrag.'],
    CUSTOMER_REGISTRY_CONTACT_INVALID: [400, 'Kontrollera beställarens namn, e-post och telefonnummer.'],
    CUSTOMER_REGISTRY_ADDRESS_INVALID: [400, 'Kundens postadress är för lång för avtalet. Kontrollera adressen i kundregistret.'],
    CUSTOMER_REGISTRY_FAILED: [500, 'Kunden kunde inte kopplas. Dina ändringar är kvar. Försök igen.'],
    CUSTOMER_IDENTITY_EXISTS: [409, 'En kund med detta personnummer finns redan. Välj kunden i kundregistret.'],
    CUSTOMER_IDENTITY_INVALID: [400, 'Kontrollera personnumret eller lämna det tomt.'],
    CUSTOMER_NAME_REQUIRED: [400, 'Ange beställarens namn, högst 200 tecken.'],
    CUSTOMER_EMAIL_INVALID: [400, 'Ange en giltig e-postadress.'],
    CUSTOMER_PHONE_INVALID: [400, 'Kontrollera telefonnumret, högst 50 tecken.'],
    CUSTOMER_ADDRESS_INVALID: [400, 'Kontrollera postadressen.'],
    CUSTOMER_POSTAL_CODE_INVALID: [400, 'Kontrollera postnumret.'],
    CUSTOMER_CITY_INVALID: [400, 'Kontrollera orten.'],
    PROJECT_SCHEDULE_SCHEMA: [503, 'Tidsplaneringen behöver aktiveras av administratören.'],
    PROJECT_SCHEDULE_INVALID: [400, 'Kontrollera momentens rubriker och datum. Slutdatum får inte ligga före startdatum.'],
    PROJECT_SCHEDULE_NOT_FOUND: [404, 'Projektet kunde inte hittas.'],
    PROJECT_SCHEDULE_STALE: [409, 'Tidsplanen har ändrats i en annan session. Dina ändringar är kvar. Hämta den sparade versionen innan du fortsätter.'],
    UNAUTHORIZED: [401, 'Logga in igen.'],
    MODULE_ACCESS_REQUIRED: [403, 'Du saknar behörighet till uppdraget.'],
    PRODUCT_ACCESS_REQUIRED: [403, 'Du saknar behörighet till uppdraget.'],
    ORG_MEMBERSHIP_REQUIRED: [403, 'Du saknar behörighet till organisationen.'],
    ORG_SELECTION_INVALID: [
      403,
      'Välj en organisation som du har tillgång till.'
    ],
    CUSTOMER_OFFER_SCHEMA: [
      503,
      'Kundofferter är inte aktiverade ännu. Administratören behöver uppdatera databasen.'
    ],
    CUSTOMER_OFFER_INVALID: [400, 'Kontrollera uppgifterna och försök igen.'],
    CUSTOMER_OFFER_SEPARATE_CHOICES: [409, 'Flytta valen till Val och tillval innan grundavtalet skickas.'],
    CUSTOMER_OFFER_WITHDRAW_FIRST: [409, 'Återkalla den öppna offertversionen innan valen flyttas. Ett godkänt avtal kan inte ändras.'],
    CUSTOMER_OFFER_INCOMPLETE: [
      400,
      'Komplettera offertens omfattning, priser, tider och villkor innan utskick.'
    ],
    CUSTOMER_OFFER_RECIPIENT: [
      409,
      'Beställarens e-post eller avsändaruppgifter behöver kontrolleras.'
    ],
    CUSTOMER_OFFER_CONFIRM: [
      400,
      'Granska kundvyn och bekräfta villkoren innan utskick.'
    ],
    CUSTOMER_OFFER_NOT_FOUND: [404, 'Offerten kunde inte hittas.'],
    CUSTOMER_OFFER_STALE: [
      409,
      'Offerten har ändrats. Uppdatera vyn innan du fortsätter.'
    ],
    CUSTOMER_OFFER_ACCEPTED: [
      409,
      'Avtalet är redan godkänt och kan inte skrivas över.'
    ],
    CUSTOMER_OFFER_IMMUTABLE: [409, 'Denna version kan inte ändras.'],
    CUSTOMER_OFFER_FILES: [
      409,
      'Bilagorna kunde inte förberedas. Kontrollera filvalet. UE-offerter får inte delas som kundbilagor.'
    ],
    CUSTOMER_OFFER_CLOSED: [
      410,
      'Offerten eller länken är inte längre tillgänglig för godkännande.'
    ],
    CUSTOMER_OFFER_BUSY: [409, 'Utskicket pågår redan. Vänta en stund.'],
    CUSTOMER_OFFER_SEND_UNKNOWN: [
      409,
      'Utskickets status behöver kontrolleras av administratören innan ett nytt försök.'
    ],
    CUSTOMER_OFFER_SEND_FAILED: [
      502,
      'Offertversionen är sparad, men utskicket kunde inte bekräftas. Försök skicka samma version igen.'
    ],
    CUSTOMER_OFFER_MAIL_CONFIG: [
      503,
      'Mejltjänsten är inte tillgänglig just nu. Kontakta administratören.'
    ],
    CUSTOMER_OFFER_RATE_LIMIT: [
      429,
      'Vänta en stund innan du begär en ny kod.'
    ],
    CUSTOMER_OFFER_CODE_SEND_FAILED: [
      502,
      'Koden kunde inte skickas. Vänta en minut och begär en ny kod.'
    ],
    CUSTOMER_OFFER_CODE_INVALID: [
      400,
      'Koden stämmer inte. Kontrollera mejlet och försök igen.'
    ],
    CUSTOMER_OFFER_CODE_EXPIRED: [
      410,
      'Koden har gått ut eller använts för många gånger. Begär en ny kod.'
    ]
  }
  const [status, message] = errors[code] ?? [
    500,
    'Uppgifterna kunde inte hanteras just nu. Försök igen.'
  ]
  return NextResponse.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )
}
