import { NextResponse } from 'next/server'
import { requireTuContext } from '@/lib/tu/server'
import { assertAssignmentCustomerSameOrigin } from '@/lib/assignment-customers/http'
import { runTuAssignmentAction } from '@/lib/tu/assignmentActionsServer'
import { tuAssignmentWorkflowError } from '@/lib/tu/assignmentWorkflow'
import { TU_ACTION_LABELS, type TuAssignmentAction } from '@/lib/tu/assignmentProgress'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertAssignmentCustomerSameOrigin(request)
    const params = new URL(request.url).searchParams
    if (params.getAll('orgId').length !== 1 || [...params.keys()].some(key => key !== 'orgId')) return json({ error: 'Välj arbetsorganisation.' }, 400)
    const org = await requireTuContext(params.get('orgId'))
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action', 'expectedUpdatedAt'].includes(key)) ||
      typeof body.action !== 'string' || !Object.hasOwn(TU_ACTION_LABELS, body.action) || typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
      return json({ error: 'Hämta aktuella uppgifter och försök igen.' }, 400)
    }
    return json(await runTuAssignmentAction({ orgId: org.orgId, userId: org.userId, assignmentId: (await context.params).id,
      expectedUpdatedAt: body.expectedUpdatedAt, action: body.action as TuAssignmentAction }))
  } catch (error) {
    const workflowError = tuAssignmentWorkflowError(error)
    if (workflowError) return NextResponse.json({ error: workflowError[1] }, { status: workflowError[0], headers: { 'Cache-Control': 'private, no-store' } })
    const code = error instanceof Error ? error.message : ''
    const known: Record<string, [number, string]> = {
      UNAUTHORIZED: [401, 'Logga in igen.'], ORG_SELECTION_INVALID: [400, 'Välj arbetsorganisation.'],
      ORG_MEMBERSHIP_REQUIRED: [403, 'Du saknar åtkomst till organisationen.'], MODULE_ACCESS_REQUIRED: [403, 'Du saknar behörighet till TU.'],
      ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN: [403, 'Otillåten begäran.'], TU_ASSIGNMENT_NOT_FOUND: [404, 'Uppdraget hittades inte.'],
      ASSIGNMENT_VERSION_CONFLICT: [409, 'Uppdraget har ändrats. Uppdatera sidan och kontrollera uppgifterna innan du försöker igen.'],
      TU_ACTION_NOT_ALLOWED: [409, 'Åtgärden är inte tillgänglig i uppdragets nuvarande status. Uppdatera sidan.'],
      TU_SEND_INCOMPLETE: [400, 'Fyll i kundens e-post, omfattning och pris innan du skickar.'],
      TU_ACCEPTED_COPY_UNAVAILABLE: [409, 'Den godkända versionen kan inte återskapas säkert. Använd den tidigare skickade bekräftelsen. Kundens godkännande finns kvar.'],
      ORG_PROFILE_CARD_REQUIRED: [409, 'Fyll i företagets visitkort innan du skickar.'],
      ASSIGNMENT_ISSUER_IDENTITY_INVALID: [409, 'Bekräftelsen kunde inte skickas eftersom avsändaruppgifterna inte kunde användas. Kontrollera företagets visitkort.'],
      ORG_PROFILE_CARD_MIGRATION_REQUIRED: [503, 'Bekräftelsen kunde inte skickas eftersom företagets avsändaruppgifter behöver uppdateras i systemet. Kontakta supporten.'],
    }
    if (code === 'ASSIGNMENT_ISSUER_IDENTITY_INVALID' || code === 'ORG_PROFILE_CARD_MIGRATION_REQUIRED') {
      console.error('[tu.assignments.actions] sender validation failed', error)
    }
    if (known[code]) return json({ error: known[code][1] }, known[code][0])
    console.error('[tu.assignments.actions] failed', error)
    return json({ error: 'Åtgärden kunde inte slutföras. Uppdatera status innan du försöker igen.' }, 500)
  }
}
