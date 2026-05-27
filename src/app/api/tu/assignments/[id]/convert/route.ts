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
  return null
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const orgContext = await requireTuContext()
    const result = await convertTuAssignmentToInvestigation({
      orgId: orgContext.orgId,
      assignmentId: id,
      requestedByUserId: orgContext.userId,
    })

    return NextResponse.json(result)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte starta TU-utredningen.', 500)
  }
}
