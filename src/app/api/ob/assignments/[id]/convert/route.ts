import { NextResponse } from 'next/server'
import { convertAssignmentToInspection, requireOrgContext } from '@/lib/assignments/server'
import { obWorkflowError } from '@/lib/ob/assignmentWorkflowServer'
import { validateObEarlyStartReason } from '@/lib/ob/assignmentWorkflow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const body = await request.json().catch(() => null)
    const earlyStartReason = validateObEarlyStartReason(body?.earlyStartReason)
    if (body?.earlyStartReason !== undefined && (!earlyStartReason || body?.confirmEarlyStart !== true)) {
      return jsonError('Bekräfta tidig start och ange en anledning (5–1000 tecken).', 400)
    }
    const result = await convertAssignmentToInspection({
      orgId: org.orgId,
      assignmentId: id,
      requestedByUserId: org.userId,
      earlyStartReason,
    })

    return NextResponse.json(result)
  } catch (error) {
    const known = obWorkflowError(error)
    if (known) return jsonError(known[1], known[0])
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message.includes('hittades inte')) return jsonError(message, 404)
    if (message.includes('måste vara bokat')) return jsonError(message, 400)
    console.error('[ob.assignments.convert]', message)
    return jsonError('Kunde inte starta besiktning från uppdrag.', 500)
  }
}
