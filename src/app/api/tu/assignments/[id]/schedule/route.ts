import { NextResponse } from 'next/server'
import { requireTuContext } from '@/lib/tu/server'
import { notifyTuAssignmentSchedule, updateTuAssignmentSchedule } from '@/lib/tu/assignmentScheduleServer'
import { TU_SCHEDULE_ERRORS } from '@/lib/tu/assignmentSchedule'
import { assertAssignmentCustomerSameOrigin } from '@/lib/assignment-customers/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

async function handle(request: Request, context: { params: Promise<{ id: string }> }, notify: boolean) {
  try {
    assertAssignmentCustomerSameOrigin(request)
    const params = new URL(request.url).searchParams
    if (params.getAll('orgId').length !== 1 || [...params.keys()].some(key => key !== 'orgId')) {
      return json({ error: 'Välj arbetsorganisation innan du fortsätter.' }, 400)
    }
    const org = await requireTuContext(params.get('orgId'))
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const allowed = notify ? ['expectedUpdatedAt'] : ['preferredDate', 'preferredTime', 'expectedUpdatedAt']
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key)) ||
      typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
      return json({ error: 'Hämta aktuella uppgifter och försök igen.' }, 400)
    }
    const input = { orgId: org.orgId, assignmentId: id, userId: org.userId, expectedUpdatedAt: body.expectedUpdatedAt }
    if (notify) return json(await notifyTuAssignmentSchedule(input))
    if (typeof body.preferredDate !== 'string' || typeof body.preferredTime !== 'string') {
      return json({ error: TU_SCHEDULE_ERRORS.TU_SCHEDULE_INVALID.message }, 400)
    }
    return json({ assignment: await updateTuAssignmentSchedule({ ...input, preferredDate: body.preferredDate, preferredTime: body.preferredTime }) })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const known = TU_SCHEDULE_ERRORS[code]
    if (known) return json({ error: known.message, code }, known.status)
    if (code === 'TU_ASSIGNMENT_NOT_FOUND') return json({ error: 'Uppdragsbekräftelsen hittades inte.' }, 404)
    if (code === 'UNAUTHORIZED') return json({ error: 'Logga in igen för att fortsätta.' }, 401)
    if (code === 'ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN') return json({ error: 'Otillåten begäran.' }, 403)
    if (['ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED'].includes(code)) return json({ error: 'Du saknar behörighet till uppdraget i den valda organisationen.' }, 403)
    if (code === 'ORG_SELECTION_INVALID') return json({ error: 'Välj en giltig arbetsorganisation.' }, 400)
    if (code === 'ORG_PROFILE_CARD_REQUIRED') return json({ error: 'Fyll i företagets visitkort innan du skickar meddelandet.' }, 409)
    console.error('[tu.schedule] operation failed', { notify, error })
    return json({ error: notify ? 'Kunde inte skicka meddelandet. Datum och tid är fortfarande sparade. Försök igen.' : 'Kunde inte spara datum och tid. Dina ändringar finns kvar här. Försök igen.' }, 500)
  }
}

export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) => handle(request, context, false)
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => handle(request, context, true)
