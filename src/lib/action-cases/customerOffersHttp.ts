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
