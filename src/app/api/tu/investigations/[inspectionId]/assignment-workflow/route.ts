import { NextResponse } from 'next/server'
import { assertAssignmentCustomerSameOrigin } from '@/lib/assignment-customers/http'
import { getTuInvestigationById, requireTuRequestContext } from '@/lib/tu/server'
import { getTuAssignmentWorkflow, tuWorkflowRpc } from '@/lib/tu/assignmentWorkflowServer'
import { tuAssignmentWorkflowError } from '@/lib/tu/assignmentWorkflow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ inspectionId: string }> }
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })

function failure(error: unknown) {
  const known = tuAssignmentWorkflowError(error)
  if (known) return json({ error: known[1] }, known[0])
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return json({ error: 'Inte inloggad.' }, 401)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return json({ error: 'Utredningen hittades inte.' }, 404)
  if (['MODULE_ACCESS_REQUIRED', 'ORG_MEMBERSHIP_REQUIRED', 'ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN'].includes(message)) return json({ error: 'Du saknar behörighet för åtgärden.' }, 403)
  if (message === 'ORG_SELECTION_INVALID') return json({ error: 'Välj arbetsorganisation.' }, 400)
  console.error('[tu.assignment-workflow]', error)
  return json({ error: 'Uppdragsstatus kunde inte uppdateras. Försök igen.' }, 500)
}

export async function GET(request: Request, context: Context) {
  try {
    const { inspectionId } = await context.params
    const org = await requireTuRequestContext(request)
    await getTuInvestigationById({ orgId: org.orgId, inspectionId })
    return json({ workflow: await getTuAssignmentWorkflow(inspectionId, org.orgId) })
  } catch (error) { return failure(error) }
}

export async function POST(request: Request, context: Context) {
  try {
    assertAssignmentCustomerSameOrigin(request)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.confirmed !== true ||
      typeof body.reviewToken !== 'string' || !/^[a-f0-9]{32}$/.test(body.reviewToken) ||
      Object.keys(body).some(key => !['confirmed', 'reviewToken'].includes(key))) {
      return json({ error: 'Kontrollera uppgifterna och bekräfta avstämningen.' }, 400)
    }
    const { inspectionId } = await context.params
    const org = await requireTuRequestContext(request)
    await getTuInvestigationById({ orgId: org.orgId, inspectionId })
    return json({ workflow: await tuWorkflowRpc('tu_review_assignment_workflow', {
      p_inspection_id: inspectionId, p_org_id: org.orgId, p_actor: org.userId, p_review_token: body.reviewToken,
    }) })
  } catch (error) { return failure(error) }
}
