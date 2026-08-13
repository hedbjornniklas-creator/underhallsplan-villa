import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getEbInspectionRound } from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

function mapError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') {
    return jsonError('Ingen organisationskoppling hittades.', 403)
  }
  if (message === 'MODULE_ACCESS_REQUIRED') {
    return jsonError('EB kräver egen modulbehörighet.', 403)
  }
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  if (message === 'EB_INSPECTION_NOT_FOUND') return jsonError('Besiktningen hittades inte.', 404)
  return jsonError(fallback, 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const round = await getEbInspectionRound({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
    })

    return NextResponse.json({ round })
  } catch (error) {
    return mapError(error, 'Kunde inte hämta SLB-rundan.')
  }
}
