import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getEbInspectionReport, saveEbReportDraft, type EbReportDraftSection } from '@/lib/eb/server'

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
  if (message === 'EB_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'EB_REPORT_DRAFT_EMPTY') return jsonError('Inga giltiga utlåtandesektioner skickades.', 400)
  return jsonError(fallback, 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const report = await getEbInspectionReport({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
    })

    return NextResponse.json({ report })
  } catch (error) {
    return mapError(error, 'Kunde inte hämta utlåtandeutkast.')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as { sections?: unknown }
    const sections = Array.isArray(body.sections) ? (body.sections as EbReportDraftSection[]) : []
    const reportDraft = await saveEbReportDraft({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
      sections,
    })

    return NextResponse.json({ reportDraft })
  } catch (error) {
    return mapError(error, 'Kunde inte spara utlåtandeutkast.')
  }
}
