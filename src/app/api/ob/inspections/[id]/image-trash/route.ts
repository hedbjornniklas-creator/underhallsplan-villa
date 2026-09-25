import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { obWorkflowRpc } from '@/lib/ob/assignmentWorkflowServer'
import { roundMutationError } from '@/lib/ob/roundMutationServer'

export const dynamic = 'force-dynamic'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Context = { params: Promise<{ id: string }> }
async function handle(request: Request, context: Context, restore: boolean) {
  try {
    const org = await requireOrgContext()
    const { id } = await context.params
    const query = new URL(request.url).searchParams
    const partId = query.get('partId')
    const beforeEventId = query.get('beforeEventId')
    if (!uuid.test(id) || (partId !== null && !uuid.test(partId)) || (beforeEventId !== null && !uuid.test(beforeEventId)))
      return NextResponse.json({ error: 'Ogiltigt val.' }, { status: 400 })
    let payload: Record<string, unknown> = beforeEventId ? { beforeEventId } : {}
    if (restore) {
      const text = await request.text()
      if (text.length > 2048) return NextResponse.json({ error: 'För stort anrop.' }, { status: 413 })
      const body = JSON.parse(text)
      if (!body || Array.isArray(body) || typeof body.eventId !== 'string' || !uuid.test(body.eventId) ||
        typeof body.requestId !== 'string' || !uuid.test(body.requestId))
        return NextResponse.json({ error: 'Ogiltigt val.' }, { status: 400 })
      payload = { eventId: body.eventId, requestId: body.requestId }
    }
    const data = await obWorkflowRpc('ob_round_image_trash', {
      p_inspection_id: id, p_org_id: org.orgId, p_actor: org.userId,
      p_part_id: partId, p_operation: restore ? 'restore' : 'list', p_payload: payload,
    })
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ogiltigt anrop.' }, { status: 400 })
    const message = error instanceof Error ? error.message : ''
    const known: Record<string, [number, string]> = {
      OB_TRASH_NOT_FOUND: [404, 'Bilden finns inte i papperskorgen. Uppdatera listan.'],
      OB_TRASH_EXPIRED: [409, 'Bildens återställningsperiod på 30 dagar har gått ut.'],
      OB_TRASH_FILE_MISSING: [409, 'Bildfilen saknas. Kontakta administratören för hjälp med återställning.'],
    }
    const missingMigration = /(?:could not find the function|function.*does not exist).*ob_round_image_trash|ob_round_image_trash.*does not exist/i.test(message)
    const [status, text] = known[message] ?? (missingMigration
      ? [503, 'Papperskorgen är inte aktiverad i databasen ännu.'] as const
      : roundMutationError(error))
    return NextResponse.json({ error: text }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, false)
export const POST = (request: Request, context: Context) => handle(request, context, true)
