import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { requireModuleAccess } from '@/lib/access/server'

export async function supplierInvoiceContext() {
  const org = await requireOrgContext()
  await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'organization', scopeId: org.orgId })
  return { orgId: org.orgId, userId: org.userId }
}
export function requireSupplierInvoiceOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) throw new Error('INVOICE_ORIGIN_INVALID')
}
export async function supplierInvoiceRequestBody(request: Request) {
  requireSupplierInvoiceOrigin(request)
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > 150000) throw new Error('INVOICE_INVALID')
  const raw = await request.text()
  if (raw.length > 150000) throw new Error('INVOICE_INVALID')
  try {
    const body: unknown = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch { throw new Error('INVOICE_INVALID') }
}
export function supplierInvoiceError(error: unknown) {
  const code = error instanceof Error ? error.message : 'INVOICE_FAILED'
  const messages: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Logga in igen.'],
    MODULE_ACCESS_REQUIRED: [403, 'Du saknar behörighet till Uppgifter.'],
    PRODUCT_ACCESS_REQUIRED: [403, 'Du saknar behörighet till Uppgifter.'],
    ORG_MEMBERSHIP_REQUIRED: [403, 'Du saknar behörighet till organisationen.'],
    ORG_SELECTION_INVALID: [403, 'Välj en organisation som du har tillgång till.'],
    INVOICE_ORIGIN_INVALID: [403, 'Begäran kunde inte godkännas. Ladda om sidan och försök igen.'],
    INVOICE_INVALID: [400, 'Kontrollera fakturans leverantör, nummer, datum och belopp. Beloppen anges i svenska kronor.'],
    INVOICE_FORBIDDEN: [403, 'Du saknar behörighet till projektets leverantörsfakturor.'],
    INVOICE_SOURCE_IN_USE: [409, 'Kostnaden ingår redan i ett fakturaunderlag. Belopp och kopplade rader kan inte ändras. Registrera en kredit för en rättning.'],
    BILLING_USE_FLOW: [409, 'Använd projektets nya Fakturering för kunddebitering och fakturaunderlag.'],
    INVOICE_ALREADY_IN_BASIS: [409, 'En vald kostnadsrad ingår redan i ett fakturaunderlag. Uppdatera listan.'],
    INVOICE_FIXED_COST: [409, 'Fastprisdelens leverantörskostnad är intern och kan inte läggas till som extra kunddebitering.'],
    INVOICE_AGREEMENT_REQUIRED: [400, 'Ange hänvisning till överenskommelsen om kunddebitering, och för ÄTA även kundens godkännande.'],
    INVOICE_TERMS_CHANGED: [409, 'Påslaget stämmer inte med momentets prisvillkor. Uppdatera listan och granska igen.'],
    INVOICE_PROJECT_CLOSED: [409, 'Projektet är avslutat eller avbrutet. Återöppna det innan du skapar nytt fakturaunderlag.'],
    INVOICE_ALLOCATION_INVALID: [400, 'Kontrollera projekt, åtgärder och fördelade belopp. Fördelningen får inte överstiga beloppet exklusive moms.'],
    INVOICE_REFERENCE_INVALID: [400, 'Välj en vanlig faktura i samma organisation som kreditfakturans referens.'],
    INVOICE_REFERENCE_IN_USE: [409, 'Fakturan har aktiva kreditfakturor. Makulera kreditfakturorna först innan originalet makuleras eller ändras till kreditfaktura.'],
    INVOICE_DUPLICATE: [409, 'En faktura med samma leverantör och fakturanummer finns redan. Öppna den befintliga fakturan.'],
    INVOICE_STALE: [409, 'Fakturan har ändrats sedan du öppnade den. Uppdatera listan och öppna fakturan igen.'],
    INVOICE_EXTERNAL_READ_ONLY: [409, 'Den importerade fakturan hanteras av sitt källsystem.'],
    INVOICE_NOT_FOUND: [404, 'Fakturan kunde inte hittas.'],
    INVOICE_SCHEMA_REQUIRED: [503, 'Leverantörsfakturor är inte aktiverade ännu. Administratören behöver uppdatera databasen.'],
    INVOICE_FILE_INVALID: [400, 'Välj en PDF eller en bild i JPG, PNG eller WebP.'],
    INVOICE_FILE_TOO_LARGE: [400, 'Filen är för stor. Maximal storlek är 4 MB.'],
    INVOICE_FILE_LIMIT: [400, 'En faktura kan ha högst 20 bilagor.'],
    INVOICE_FILE_NOT_FOUND: [404, 'Bilagan kunde inte hittas.'],
    INVOICE_FILE_UPLOAD_FAILED: [502, 'Bilagan kunde inte laddas upp. Försök igen.'],
    INVOICE_FILE_DOWNLOAD_FAILED: [502, 'Bilagan kunde inte öppnas just nu. Försök igen.'],
  }
  const [status, message] = messages[code] ?? [500, 'Fakturan kunde inte hanteras just nu. Försök igen.']
  return NextResponse.json({ code: messages[code] ? code : 'INVOICE_FAILED', error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}
