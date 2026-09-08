import { requireModuleAccess } from '@/lib/access/server'
import { listInvitations, createInvitation, changeInvitation } from '@/lib/besiktapp/invitations'
import { inviteMessage, isUuid, validateInvitationDraft } from '@/lib/besiktapp/invitationContracts'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'UNAUTHORIZED') return json({ error: 'Logga in.' }, 401)
  if (code === 'MODULE_ACCESS_REQUIRED') return json({ error: 'Åtkomst nekad.' }, 403)
  return json({ error: inviteMessage(code) }, code === 'INVITE_CONFLICT' ? 409 : 503)
}
export async function GET(request: Request) {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
    const page = new URL(request.url).searchParams.get('page') ?? '0'
    if (!/^\d{1,5}$/.test(page)) return json({ error: 'Ogiltig sida.' }, 400)
    return json(await listInvitations(Number(page)))
  } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    const access = await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
    if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Otillåten begäran.' }, 403)
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Ogiltigt format.' }, 415)
    const text = await request.text()
    if (text.length > 4096) return json({ error: 'För stor begäran.' }, 400)
    const body = JSON.parse(text || 'null')
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Ogiltig begäran.' }, 400)
    if (body.action === 'create') {
      const draft = validateInvitationDraft(body)
      if (!draft) return json({ error: 'Kontrollera namn, e-post, företag och arbetsområden.' }, 400)
      return json(await createInvitation(draft, access.identity.profileId))
    }
    if (!['resend', 'revoke'].includes(body.action) || !isUuid(body.id) || !Number.isInteger(body.revision) || body.revision < 0 || body.revision >= 2147483647) return json({ error: 'Ogiltig ändring.' }, 400)
    return json(await changeInvitation(body.id, body.revision, body.action))
  } catch (error) { return failure(error) }
}
