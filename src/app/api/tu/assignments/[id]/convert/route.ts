import { NextResponse } from 'next/server'
import { convertTuAssignmentToInvestigation, requireTuContext } from '@/lib/tu/server'
import { assertAssignmentCustomerSameOrigin } from '@/lib/assignment-customers/http'
import { tuAssignmentWorkflowError, validateTuEarlyStart } from '@/lib/tu/assignmentWorkflow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function mapError(error: unknown) {
  const workflowError = tuAssignmentWorkflowError(error)
  if (workflowError) return jsonError(workflowError[1], workflowError[0])
  const message = error instanceof Error ? error.message : ''
  if (message === 'ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN') return jsonError('Otillåten begäran.', 403)
  if (message === 'ASSIGNMENT_VERSION_CONFLICT') return jsonError('Uppdraget har ändrats. Uppdatera status innan du startar igen.', 409)
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_SELECTION_INVALID') return jsonError('Den valda organisationen är ogiltig.', 400)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_ASSIGNMENT_NOT_FOUND') return jsonError('TU-uppdraget hittades inte.', 404)
  if (message === 'TU_ASSIGNMENT_NOT_ACCEPTED') {
    return jsonError('Uppdraget måste vara godkänt innan utredningen kan startas.', 409)
  }
  if (message === 'TU_REPORT_TEMPLATE_REQUIRED') return jsonError('Välj en mall innan utredningen startas.', 400)
  if (message === 'TU_REPORT_TEMPLATE_NOT_FOUND') return jsonError('Den valda TU-mallen är inte aktiv eller saknas.', 404)
  if (message === 'TU_REPORT_TEMPLATE_EMPTY') return jsonError('Den valda TU-mallen saknar sektioner.', 409)
  return null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertAssignmentCustomerSameOrigin(request)
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['orgId','reportTemplateKey','earlyStartReason','confirmEarlyStart'].includes(key))) return jsonError('Kontrollera uppgifterna och försök igen.', 400)
    if (!Object.prototype.hasOwnProperty.call(body, 'orgId')) {
      return jsonError('Välj arbetsorganisation innan utredningen startas.', 400)
    }
    const orgContext = await requireTuContext(body.orgId)
    const reportTemplateKey = typeof body.reportTemplateKey === 'string' ? body.reportTemplateKey.trim() : ''
    const earlyStartReason = validateTuEarlyStart(body.earlyStartReason, body.confirmEarlyStart)
    const result = await convertTuAssignmentToInvestigation({
      orgId: orgContext.orgId,
      assignmentId: id,
      reportTemplateKey,
      requestedByUserId: orgContext.userId,
      earlyStartReason,
    })

    return NextResponse.json(result)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte starta TU-utredningen.', 500)
  }
}
