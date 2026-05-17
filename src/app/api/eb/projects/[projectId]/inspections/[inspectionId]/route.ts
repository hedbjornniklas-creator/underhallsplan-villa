import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  updateEbInspection,
  type EbApprovalStatus,
  type EbInspectorAppointedBy,
} from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toOptionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function toOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
  return jsonError(message || fallback, 500)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const project = await updateEbInspection({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
      inspectionDate: toText(body.inspectionDate) || null,
      inspectionTime: toText(body.inspectionTime) || null,
      meetingPlace: toText(body.meetingPlace) || null,
      startMeetingTime: toText(body.startMeetingTime) || null,
      finalMeetingTime: toText(body.finalMeetingTime) || null,
      inspectorAppointedBy: (toText(body.inspectorAppointedBy) || null) as EbInspectorAppointedBy | null,
      invitationMethod: toText(body.invitationMethod) || null,
      invitationDate: toText(body.invitationDate) || null,
      approvalStatus: (toText(body.approvalStatus) || null) as EbApprovalStatus | null,
      approvalNote: toText(body.approvalNote) || null,
      requiresContinuedFinalInspection: toOptionalBoolean(body.requiresContinuedFinalInspection),
      warrantyPeriodYears: toOptionalNumber(body.warrantyPeriodYears),
      warrantyEndDate: toText(body.warrantyEndDate) || null,
      defaultRemedyDeadline: toText(body.defaultRemedyDeadline) || null,
      afterInspectionRequested: toOptionalBoolean(body.afterInspectionRequested),
      afterInspectionDueDate: toText(body.afterInspectionDueDate) || null,
      afterInspectionNoticeInReport: body.afterInspectionNoticeInReport === true,
      reportDistributionDate: toText(body.reportDistributionDate) || null,
    })

    return NextResponse.json({ project })
  } catch (error) {
    return mapError(error, 'Kunde inte uppdatera besiktningen.')
  }
}
