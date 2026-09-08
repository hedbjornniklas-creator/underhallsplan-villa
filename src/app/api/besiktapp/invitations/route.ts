import { previewInvitation, acceptInvitation } from '@/lib/besiktapp/invitations'
import { inviteMessage, isInviteToken } from '@/lib/besiktapp/invitationContracts'
import { createInvitationRateLimit } from '@/lib/besiktapp/invitationRateLimit'
const permit = createInvitationRateLimit()
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Otillåten begäran.' }, 403)
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Ogiltigt format.' }, 415)
  const reader = request.body?.getReader()
  if (!reader) return json({ error: 'Begäran saknas.' }, 400)
  let bytes = 0; let text = ''; const decoder = new TextDecoder()
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 4096) { await reader.cancel(); return json({ error: 'För stor begäran.' }, 413) }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const body = JSON.parse(text)
    if (!body || !isInviteToken(body.token) || !['preview', 'accept'].includes(body.action) || (body.password !== undefined && typeof body.password !== 'string')) return json({ error: 'Ogiltig inbjudan.' }, 400)
    if (!permit(body.token)) return json({ error: 'För många försök. Vänta tio minuter och försök igen.' }, 429)
    if (body.action === 'preview') return json(await previewInvitation(body.token))
    return json(await acceptInvitation(body.token, body.password))
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return json({ code: code.startsWith('INVITE_') || code === 'EXISTING_USER_LOGIN_REQUIRED' ? code : 'INVITE_FAILED', error: inviteMessage(code) }, 400)
  } finally { reader.releaseLock() }
}
