import { requireModuleAccess } from '@/lib/access/server'
import { listInterests, updateInterest } from '@/lib/besiktapp/interestTracking'
import { isInterestStatus, validateInterestUpdate } from '@/lib/besiktapp/interestTrackingContracts'

export const dynamic = 'force-dynamic'
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }) }
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'UNAUTHORIZED') return json({ error: 'Logga in för att fortsätta.' }, 401)
  if (code === 'MODULE_ACCESS_REQUIRED') return json({ error: 'Åtkomst nekad.' }, 403)
  if (code === 'TRACKING_DISABLED') return json({ error: 'Intresselistan är inte aktiverad ännu. Förfrågningar hanteras via mejl tills vidare.' }, 503)
  if (code === 'TRACKING_SCHEMA_REQUIRED') return json({ error: 'Databastabellen för intresselistan behöver installeras innan funktionen kan användas.' }, 503)
  if (code === 'TRACKING_CONFLICT') return json({ error: 'Förfrågan har ändrats av någon annan eller finns inte längre. Hämta listan igen innan du sparar.' }, 409)
  return json({ error: 'Kunde inte hantera intresselistan. Försök igen.' }, 500)
}
async function authorize() { await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' }) }
export async function GET(request: Request) {
  try {
    await authorize()
    const query = new URL(request.url).searchParams
    const status = query.get('status')
    const pageText = query.get('page') ?? '0'
    if ((status && status !== 'all' && !isInterestStatus(status)) || !/^\d{1,5}$/.test(pageText)) return json({ error: 'Ogiltigt filter.' }, 400)
    return json(await listInterests(isInterestStatus(status) ? status : null, Number(pageText)))
  } catch (error) { return failure(error) }
}
export async function PATCH(request: Request) {
  try {
    await authorize()
    if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Otillåten begäran.' }, 403)
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'Ogiltigt format.' }, 415)
    const value = validateInterestUpdate(await request.json().catch(() => null))
    if (!value) return json({ error: 'Kontrollera status, ansvarig och uppföljningsdatum.' }, 400)
    return json({ item: await updateInterest(value) })
  } catch (error) { return failure(error) }
}
