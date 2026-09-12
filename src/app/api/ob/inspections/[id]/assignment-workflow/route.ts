import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getObAssignmentWorkflow, obWorkflowRpc, obWorkflowError } from '@/lib/ob/assignmentWorkflowServer'
import { isObAssignmentTransferFields, type ObAssignmentWorkflow } from '@/lib/ob/assignmentWorkflow'

export const dynamic = 'force-dynamic'

function failure(error: unknown) {
  const known = obWorkflowError(error)
  const message = error instanceof Error ? error.message : ''
  const [status, text] = known ?? (message === 'UNAUTHORIZED' ? [401, 'Inte inloggad.'] :
    message === 'ORG_MEMBERSHIP_REQUIRED' ? [403, 'Ingen organisationskoppling.'] : [500, 'Kunde inte läsa uppdragets godkännandestatus.'])
  return NextResponse.json({ error: text }, { status })
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const org = await requireOrgContext()
    const { id } = await context.params
    return NextResponse.json({ workflow: await getObAssignmentWorkflow(id, org.orgId) })
  } catch (error) { return failure(error) }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const org = await requireOrgContext()
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (body?.confirmed !== true || typeof body?.reviewToken !== 'string' || !body.reviewToken.trim() ||
      typeof body?.reconciliationToken !== 'string' || !body.reconciliationToken.trim() ||
      !isObAssignmentTransferFields(body?.fields)) {
      return NextResponse.json({ error: 'Bekräfta avstämningen av kundens uppgifter och tillägg.' }, { status: 400 })
    }
    const workflow = await obWorkflowRpc<ObAssignmentWorkflow>('ob_reconcile_assignment_workflow', {
      p_inspection_id: id, p_org_id: org.orgId, p_actor: org.userId, p_review_token: body.reviewToken,
      p_reconciliation_token: body.reconciliationToken, p_fields: body.fields,
    })
    return NextResponse.json({ workflow })
  } catch (error) { return failure(error) }
}
