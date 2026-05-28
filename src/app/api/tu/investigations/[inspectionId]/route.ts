import { NextResponse } from 'next/server'
import {
  deleteTuInvestigation,
  getTuInvestigationById,
  normalizeTuReportDraft,
  requireTuContext,
  updateTuInvestigationDraft,
} from '@/lib/tu/server'

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
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  return null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const investigation = await getTuInvestigationById({
      orgId: orgContext.orgId,
      inspectionId,
      inspectorProfileId: orgContext.userId,
    })
    if (!investigation) return jsonError('TU-utredningen hittades inte.', 404)
    return NextResponse.json({ investigation })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte hämta TU-utredning.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Parameters<typeof updateTuInvestigationDraft>[0]['patch'] = {}

    if ('title' in body) patch.title = typeof body.title === 'string' ? body.title : null
    if ('scopeDescription' in body) {
      patch.scopeDescription = typeof body.scopeDescription === 'string' ? body.scopeDescription : null
    }
    if ('background' in body) patch.background = typeof body.background === 'string' ? body.background : null
    if ('basis' in body) patch.basis = typeof body.basis === 'string' ? body.basis : null
    if ('accessibility' in body) {
      patch.accessibility = typeof body.accessibility === 'string' ? body.accessibility : null
    }
    if ('reportDraft' in body) patch.reportDraft = normalizeTuReportDraft(body.reportDraft)

    const investigation = await updateTuInvestigationDraft({
      orgId: orgContext.orgId,
      inspectionId,
      updatedBy: orgContext.userId,
      patch,
    })

    return NextResponse.json({ investigation })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte spara TU-utredning.', 500)
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const result = await deleteTuInvestigation({
      orgId: orgContext.orgId,
      inspectionId,
    })

    return NextResponse.json(result)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte radera TU-utredning.', 500)
  }
}
