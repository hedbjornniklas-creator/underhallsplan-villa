import { NextResponse } from 'next/server'
import { completeEbFollowUpOrder, getEbFollowUpCustomerState, requestEbFollowUpCustomerLink } from '@/lib/eb/followUpServer'
import { assertEbCustomerRequestOrigin } from '@/lib/eb/customerSession'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Context = { params: Promise<{ token: string }> }
const noStore = { 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Cookie' }

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const messages: Record<string, [number, string]> = {
    EB_FOLLOW_UP_EMAIL_INVALID: [400, 'Ange en giltig e-postadress.'],
    EB_FOLLOW_UP_RATE_LIMITED: [429, 'För många förfrågningar. Vänta en stund innan du försöker igen.'],
    EB_FOLLOW_UP_VERIFICATION_REQUIRED: [401, 'Din beställarsession har gått ut. Öppna din personliga beställarlänk igen.'],
    EB_CUSTOMER_ORIGIN_FORBIDDEN: [403, 'Öppna utlåtandet på nytt innan du fortsätter.'],
    EB_FOLLOW_UP_CONSENT_REQUIRED: [400, 'Bekräfta samtliga obligatoriska godkännanden för villkor, start, betalning och eventuell ångerinformation.'],
    EB_FOLLOW_UP_OFFER_CHANGED: [409, 'Pris eller villkor har ändrats. Ladda om sidan innan du beställer.'],
    EB_FOLLOW_UP_BUYER_INVALID: [400, 'Välj kundtyp och kontrollera namn och fakturaadress. Alla obligatoriska fält behöver fyllas i.'],
    EB_FOLLOW_UP_ORDER_REQUIRED: [409, 'Ingen tidigare beställning finns. Beställ tjänsten först.'],
    EB_FOLLOW_UP_REPORT_UNAVAILABLE: [404, 'Utlåtandet är inte tillgängligt.'],
    EB_FOLLOW_UP_REPORT_NOT_FINALIZED: [409, 'Den här rapportversionens fastställande kunde inte bekräftas. Kontakta besiktningsmannen för att få den senast fastställda versionen.'],
    EB_FOLLOW_UP_ORIGINAL_IMAGE_FAILED: [503, 'Originalbilderna kunde inte säkras. Ingen ny beställning har aktiverats. Försök igen.'],
  }
  const [status, message] = messages[code] ?? [503, 'Tjänsten kunde inte slutföra begäran just nu. Försök igen. En tidigare mottagen beställning debiteras inte på nytt.']
  return NextResponse.json({ error: message }, { status, headers: noStore })
}

export async function GET(_request: Request, context: Context) {
  const { token } = await context.params
  return NextResponse.json(await getEbFollowUpCustomerState(token), { headers: noStore })
}

export async function POST(request: Request, context: Context) {
  const { token } = await context.params
  try {
    assertEbCustomerRequestOrigin(request)
    const raw = await request.text()
    if (raw.length > 12_000) return NextResponse.json({ error: 'Begäran är för stor.' }, { status: 413, headers: noStore })
    const body: unknown = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Ogiltig begäran.' }, { status: 400, headers: noStore })
    const payload = body as Record<string, unknown>
    const baseUrl = new URL(request.url).origin
    if (payload.action === 'request_link') {
      return NextResponse.json(await requestEbFollowUpCustomerLink({ token, email: payload.email, baseUrl }), { headers: noStore })
    }
    if (payload.action === 'order' || payload.action === 'access') {
      return NextResponse.json(await completeEbFollowUpOrder({ token, input: payload, baseUrl }), { headers: noStore })
    }
    return NextResponse.json({ error: 'Okänd åtgärd.' }, { status: 400, headers: noStore })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ogiltig begäran.' }, { status: 400, headers: noStore })
    return failure(error)
  }
}
