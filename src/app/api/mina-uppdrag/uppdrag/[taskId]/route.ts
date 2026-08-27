import { after, NextResponse } from 'next/server'
import { runTaskFollowupBatch } from '@/lib/tasks/automation'
import { recipientPortalErrorResponse } from '@/lib/tasks/recipientPortalHttp'
import {
  getRecipientPortalTaskWorkspace,
  performRecipientPortalTaskAction,
  requireRecipientPortalSession,
} from '@/lib/tasks/recipientPortal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStoreHeaders = { 'Cache-Control': 'private, no-store' }

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await context.params
    const session = await requireRecipientPortalSession()
    const workspace = await getRecipientPortalTaskWorkspace(session, taskId)
    if (!workspace) throw new Error('TASK_NOT_FOUND')
    return NextResponse.json({ workspace }, { headers: noStoreHeaders })
  } catch (error) {
    return recipientPortalErrorResponse(error, 'Kunde inte läsa uppgiften just nu.')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
      return NextResponse.json(
        { error: 'Begäran är för stor.', code: 'TASK_REQUEST_TOO_LARGE' },
        { status: 413, headers: noStoreHeaders }
      )
    }
    const { taskId } = await context.params
    const session = await requireRecipientPortalSession()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''
    const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {}
    const result = await performRecipientPortalTaskAction({ session, taskId, action, payload })
    if (action !== 'mark_messages_read') {
      after(async () => {
        try {
          await runTaskFollowupBatch({ limit: 5 })
        } catch {
          console.error('[tasks.recipient-portal] opportunistic follow-up failed', {
            code: 'TASK_AUTOMATION_BATCH_FAILED',
          })
        }
      })
    }
    return NextResponse.json(result, { headers: noStoreHeaders })
  } catch (error) {
    return recipientPortalErrorResponse(error)
  }
}
