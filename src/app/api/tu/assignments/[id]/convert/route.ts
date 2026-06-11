import { NextResponse } from 'next/server'
import { convertTuAssignmentToInvestigation, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
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
    const { id } = await context.params
    const orgContext = await requireTuContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const reportTemplateKey = typeof body.reportTemplateKey === 'string' ? body.reportTemplateKey.trim() : ''
    const result = await convertTuAssignmentToInvestigation({
      orgId: orgContext.orgId,
      assignmentId: id,
      reportTemplateKey,
      requestedByUserId: orgContext.userId,
    })

    return NextResponse.json(result)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte starta TU-utredningen.', 500)
  }
}
