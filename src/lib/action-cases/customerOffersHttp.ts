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
    PROJECT_QUESTION_INVALID: [400, 'Kontrollera frågans rubrik, text och valda filer.'],
    PROJECT_QUESTION_DATES: [400, 'Ange svarsdatum och uppföljning. Uppföljningen får inte ligga efter svarsdatumet. Bekräfta utskicket.'],
    PROJECT_QUESTION_ASSIGNEE: [400, 'Välj en aktiv ansvarig i Uppdrag. En extern mottagare behöver en e-postadress.'],
    PROJECT_QUESTION_RECIPIENT_CHANGED: [409, 'Den ansvariges kontaktuppgifter har ändrats. Hämta frågorna, välj den ansvarige igen och spara före utskick.'],
    PROJECT_QUESTION_FILES: [409, 'En vald bilaga är inte längre tillgänglig i projektet.'],
    PROJECT_QUESTION_STALE: [409, 'Frågan har ändrats i en annan session. Din text finns kvar. Hämta den sparade versionen innan du fortsätter.'],
    PROJECT_QUESTION_CLOSED: [409, 'Frågan är avslutad. Återöppna den innan du lägger till något.'],
    PROJECT_QUESTION_TASK_OPEN: [409, 'Frågan har en aktiv uppgift. Hantera eller avsluta den i Uppdrag innan frågan avslutas eller skickas på nytt.'],
    PROJECT_QUESTION_NOT_FOUND: [404, 'Frågan eller projektet kunde inte hittas.'],
    PROJECT_QUESTION_FORBIDDEN: [403, 'Du saknar behörighet till projektfrågan.'],
    PROJECT_QUESTION_SCHEMA: [503, 'Frågor och beslut behöver aktiveras i databasen. Övriga projektet påverkas inte.'],
    PROJECT_QUESTION_FAILED: [500, 'Åtgärden kunde inte bekräftas. Din text är kvar. Försök igen med samma uppgifter.'],
    PROJECT_NAME_INVALID: [400, 'Ange ett projektnamn med 1–250 tecken på en rad.'],
    PROJECT_NAME_NOT_FOUND: [404, 'Projektet kunde inte hittas.'],
    PROJECT_NAME_STALE: [409, 'Projektnamnet har ändrats i en annan flik. Ladda om sidan innan du försöker igen.'],
    PROJECT_NAME_FAILED: [500, 'Projektnamnet kunde inte sparas. Din text är kvar. Försök igen.'],
    CUSTOMER_SENDER_SCHEMA: [503, 'Avsändarval för avtal behöver aktiveras i databasen. Befintliga avtal är oförändrade.'],
    CUSTOMER_SENDER_INVALID: [400, 'Spara avtalsutkastet och kontrollera valet av avsändarprofil.'],
    CUSTOMER_SENDER_FORBIDDEN: [403, 'Du saknar behörighet till uppdraget eller organisationen.'],
    CUSTOMER_SENDER_PROFILE: [409, 'Välj en aktiv avsändarprofil som tillhör uppdragets organisation.'],
    CUSTOMER_SENDER_STALE: [409, 'Avsändaruppgifterna har ändrats. Hämta profilerna igen innan du väljer.'],
    CUSTOMER_SENDER_IDENTITY_REQUIRED: [409, 'Organisationens juridiska namn och organisationsnummer behöver kompletteras först.'],
    CUSTOMER_SENDER_MEDIA: [409, 'Avsändarprofilens logotyp kunde inte sparas med avtalet. Kontrollera eller ladda upp logotypen igen.'],
    CUSTOMER_SENDER_IMMUTABLE: [409, 'Avtalets avsändaruppgifter kommer från vald profil. Välj profilen igen för att hämta uppdaterade uppgifter.'],
    CUSTOMER_SENDER_WITHDRAW_FIRST: [409, 'Återkalla det öppna avtalet innan du byter avsändarprofil.'],
    CUSTOMER_SENDER_FAILED: [500, 'Avsändarvalet kunde inte bekräftas. Kontrollera den sparade avtalsversionen innan du fortsätter.'],
    CUSTOMER_OFFER_DELIVERY_SCHEMA: [503, 'Delning och registrering av underskriven kopia behöver aktiveras av administratören.'],
    CUSTOMER_OFFER_SIGNING_METHOD: [409, 'Kontrollera valt signeringssätt. Digitalt godkännande och papperssignering är separata flöden.'],
    CUSTOMER_OFFER_SIGNED_COPY: [400, 'Välj en PDF, högst 20 MB, och bekräfta att samtliga parter har skrivit under rätt avtalsversion.'],
    CUSTOMER_OFFER_SIGNING_FILES_MISSING: [409, 'En vald bilaga saknas i projektet. Kontrollera handlingsförteckningen och ta bort eller ersätt hänvisningen före låsning.'],
    CUSTOMER_OFFER_LOCKED: [409, 'Avtalsversionen är låst för signering. Skapa ett nytt utkast om du behöver ändra den.'],
    CUSTOMER_OFFER_SIGNING_SCHEMA: [503, 'Låsning och PDF behöver aktiveras av administratören. Avtalsutkastet är kvar.'],
    CUSTOMER_OFFER_PDF_FAILED: [503, 'Avtals-PDF:en kunde inte skapas. Kontrollera avtalsstatus innan du försöker igen.'],
    CUSTOMER_OFFER_PDF_LIMIT: [400, 'Avtalet eller bilagorna är för stora för PDF-hanteringen. Kontakta administratören.'],
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
    CUSTOMER_CHOICE_INVALID: [400, 'Kontrollera kategorierna och deras alternativ. Varje alternativ ska tillhöra en kategori.'],
    CUSTOMER_CHOICE_SCHEMA: [503, 'Kategorier och kundval behöver aktiveras av administratören.'],
    CUSTOMER_CHOICE_COSTING_STALE: [409, 'Kalkylen har uppdaterats till kalkylrader. Ladda om sidan innan du ändrar priset. Dina ändringar är kvar.'],
    CUSTOMER_CHOICE_COSTING_INVALID: [400, 'Kontrollera kalkylradernas namn, kostnader och påslag.'],
    CUSTOMER_CHOICE_FILE_SCHEMA: [503, 'PDF-bilagor för val och tillval behöver aktiveras av administratören.'],
    CUSTOMER_CHOICE_FILES: [400, 'Kontrollera PDF-bilagorna. Välj kundgranskade PDF-filer, högst 20 MB per fil och 50 MB sammanlagt. Interna leverantörsofferter kan inte delas här.'],
    CUSTOMER_CHOICE_NOT_SHARED: [404, 'Dessa val visas inte längre för beställaren.'],
    CUSTOMER_CHOICE_STALE: [409, 'Alternativen eller det sparade valet har ändrats. Uppdatera vyn innan du sparar igen.'],
    CUSTOMER_CHOICE_CLOSED: [410, 'Länken till projektet är inte längre tillgänglig.'],
    CUSTOMER_CHOICE_RATE_LIMIT: [429, 'För många ändringar på kort tid. Vänta en minut innan du försöker igen.'],
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
