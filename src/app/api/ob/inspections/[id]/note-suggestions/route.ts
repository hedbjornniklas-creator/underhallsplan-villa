import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { parseObNoteSuggestion } from '@/lib/ob/noteSuggestion'
import { createNoteSuggestionLimit, NoteSuggestionError, sendObNoteSuggestion } from '@/lib/ob/noteSuggestionServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const permit = createNoteSuggestionLimit()

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const org = await requireOrgContext()
    const origin = request.headers.get('origin')
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new NoteSuggestionError('Utskicket måste göras från HusHub.', 403)
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new NoteSuggestionError('Ogiltigt anropsformat.', 415)
    }
    const { id } = await context.params
    const text = await request.text()
    if (text.length > 100000) throw new NoteSuggestionError('Förslaget är för långt.', 413)
    const suggestion = parseObNoteSuggestion(id, JSON.parse(text))
    if (!suggestion) throw new NoteSuggestionError('Skriv en notering och kontrollera förslaget.', 400)
    if (!permit(org.userId)) throw new NoteSuggestionError('För många förslag har skickats. Försök igen senare.', 429)
    if (!process.env.RESEND_API_KEY?.trim()) throw new NoteSuggestionError('Mejlutskick till admin är inte konfigurerat.', 503)
    await sendObNoteSuggestion({
      db: createSupabaseAdminClient(), actorId: org.userId, inspectionId: id, suggestion,
      from: process.env.ASSIGNMENTS_MAIL_FROM, recipient: process.env.OB_NOTE_SUGGESTIONS_EMAIL,
      send: sendAssignmentEmail,
    })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof NoteSuggestionError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ogiltigt anrop.' }, { status: 400 })
    const code = error instanceof Error ? error.message : ''
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Inte inloggad.' }, { status: 401 })
    if (code === 'ORG_MEMBERSHIP_REQUIRED') return NextResponse.json({ error: 'Ingen organisationskoppling.' }, { status: 403 })
    // Do not log the proposed inspection text or return provider details to the client.
    console.error('[ob.note-suggestion] submission failed')
    return NextResponse.json({ error: 'Förslaget kunde inte skickas just nu. Texten finns kvar, försök igen.' }, { status: 502 })
  }
}
