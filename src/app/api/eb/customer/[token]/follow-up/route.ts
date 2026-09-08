import { NextResponse } from 'next/server'
import { resolveEbCustomerReportLink, ensureEbCustomerReportSession } from '@/lib/eb/customerLinks'
import { assertEbCustomerRequestOrigin } from '@/lib/eb/customerSession'
import { getEbFollowUpCustomerState, completeEbFollowUpOrder } from '@/lib/eb/followUpServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
type Context = { params: Promise<{ token: string }> }
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Cookie' }
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }) }
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const messages: Record<string, [number, string]> = {
    EB_FOLLOW_UP_VERIFICATION_REQUIRED: [401, 'Beställaråtkomsten gäller inte längre. Öppna din personliga rapportlänk på nytt.'],
    EB_CUSTOMER_ORIGIN_FORBIDDEN: [403, 'Öppna utlåtandet på nytt innan du fortsätter.'],
    EB_FOLLOW_UP_CONSENT_REQUIRED: [400, 'Bekräfta samtliga obligatoriska godkännanden för villkor, start, betalning och eventuell ångerinformation.'],
    EB_FOLLOW_UP_OFFER_CHANGED: [409, 'Pris eller villkor har ändrats. Ladda om sidan innan du beställer.'],
    EB_FOLLOW_UP_BUYER_INVALID: [400, 'Välj kundtyp och kontrollera namn och fakturaadress. Alla obligatoriska fält behöver fyllas i.'],
    EB_FOLLOW_UP_ORDER_REQUIRED: [409, 'Ingen tidigare beställning finns. Beställ tjänsten först.'],
    EB_FOLLOW_UP_REPORT_UNAVAILABLE: [404, 'Utlåtandet är inte tillgängligt.'],
    EB_FOLLOW_UP_REPORT_NOT_FINALIZED: [409, 'Rapportversionens fastställande kunde inte bekräftas. Kontakta besiktningsmannen.'],
    EB_FOLLOW_UP_ORIGINAL_IMAGE_FAILED: [503, 'Originalbilderna kunde inte säkras. Ingen ny beställning har aktiverats. Försök igen.'],
  }
  const [status, message] = messages[code] ?? [503, 'Tjänsten kunde inte slutföra begäran just nu. Försök igen. En tidigare mottagen beställning debiteras inte på nytt.']
  return json({ error: message }, status)
}

export async function GET(_request: Request, context: Context) {
  try {
    const { token } = await context.params
    const buyer = await resolveEbCustomerReportLink(token)
    if (!buyer || buyer.expired) return json({ verified: false, offer: null, accessAvailable: false }, 401)
    const session = await ensureEbCustomerReportSession(token, buyer)
    return json(await getEbFollowUpCustomerState(buyer.publicToken, session))
  } catch (error) { return failure(error) }
}

export async function POST(request: Request, context: Context) {
  try {
    assertEbCustomerRequestOrigin(request)
    const raw = await request.text()
    if (raw.length > 12_000) return json({ error: 'Begäran är för stor.' }, 413)
    const body: unknown = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Ogiltig begäran.' }, 400)
    const payload = body as Record<string, unknown>
    if (payload.action !== 'order' && payload.action !== 'access') return json({ error: 'Okänd åtgärd.' }, 400)
    const { token } = await context.params
    const buyer = await resolveEbCustomerReportLink(token)
    if (!buyer || buyer.expired) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
    const session = await ensureEbCustomerReportSession(token, buyer)
    return json(await completeEbFollowUpOrder({ token: buyer.publicToken, input: payload,
      baseUrl: new URL(request.url).origin, customerSession: session }))
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Ogiltig begäran.' }, 400)
    return failure(error)
  }
}
