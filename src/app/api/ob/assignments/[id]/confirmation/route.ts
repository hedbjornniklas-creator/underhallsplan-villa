import { NextResponse } from 'next/server'
import { getAssignmentById, requireOrgContext, sendAssignmentAcceptedNotice } from '@/lib/assignments/server'
import { getObConfirmationSnapshot } from '@/lib/assignments/obConfirmationSnapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'Ogiltigt ursprung.' }, 403)
    const org = await requireOrgContext()
    const { id } = await context.params
    const assignment = await getAssignmentById(org.orgId, id)
    if (!assignment || assignment.assignment_type !== 'OB') return json({ error: 'Uppdraget hittades inte.' }, 404)
    if (process.env.OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED !== 'true') {
      return json({ error: 'Arkiverade bekräftelseutskick är inte aktiverade.' }, 409)
    }
    const snapshot = await getObConfirmationSnapshot(org.orgId, id)
    if (!snapshot) return json({ error: 'En historisk bekräftelse utan ögonblicksbild kan inte återskapas.' }, 409)
    await sendAssignmentAcceptedNotice({
      assignment: snapshot.assignment, orgName: snapshot.issuerName, requestedByUserId: org.userId,
      responsibleEmail: snapshot.inspector?.email ?? null, acceptancePayload: snapshot.acceptancePayload ?? {},
    })
    return json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') return json({ error: 'Logga in igen.' }, 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return json({ error: 'Ingen organisationskoppling hittades.' }, 403)
    return json({ error: 'Bekräftelsemejlet kunde inte skickas. Godkännandet och den låsta kopian finns kvar.' }, 502)
  }
}
