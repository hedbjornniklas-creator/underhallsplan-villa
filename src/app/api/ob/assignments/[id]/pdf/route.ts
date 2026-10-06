import { requireObAssignmentContext } from '@/lib/ob/organizationBindings'
import { obRequestOrgId, obOrganizationFailure } from '@/lib/ob/organizationHttp'
import { NextResponse } from 'next/server'
import { getAssignmentById } from '@/lib/assignments/server'
import { getArchivedAssignmentPdf, AssignmentPdfArchiveError } from '@/lib/assignments/acceptedPdfArchive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const org = await requireObAssignmentContext((await context.params).id, obRequestOrgId(request))
    const { id } = await context.params
    const assignment = await getAssignmentById(org.orgId, id)
    if (!assignment || !['OB', 'STATUS'].includes(assignment.assignment_type)) return failure('Uppdraget hittades inte.', 404)
    const original = await getArchivedAssignmentPdf(org.orgId, id)
    if (!original) return failure('Ingen original-PDF finns arkiverad för denna uppdragsbekräftelse. Använd originalbilagan i kundens bekräftelsemejl. Historiska dokument återskapas inte.', 404)
    return new NextResponse(new Uint8Array(original.pdf), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${original.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    const organizationFailure = obOrganizationFailure(error)
    if (organizationFailure) return organizationFailure

    if (error instanceof AssignmentPdfArchiveError) return failure(error.message, 409)
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return failure('Logga in igen för att hämta PDF-kopian.', 401)
    if (error instanceof Error && error.message === 'ORG_MEMBERSHIP_REQUIRED') return failure('Ingen organisationskoppling hittades.', 403)
    return failure('Originalfilen kunde inte hämtas. Försök igen.', 500)
  }
}
