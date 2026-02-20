import { NextResponse } from 'next/server'
import { convertAssignmentToInspection, requireOrgContext } from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const result = await convertAssignmentToInspection({
      orgId: org.orgId,
      assignmentId: id,
      requestedByUserId: org.userId,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message.includes('hittades inte')) return jsonError(message, 404)
    if (message.includes('måste vara bokat')) return jsonError(message, 400)
    return jsonError(message || 'Kunde inte starta besiktning från uppdrag.', 500)
  }
}
