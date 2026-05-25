import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  updateEbInspection,
  type EbApprovalStatus,
  type EbDefectNoErrorPartsPolicy,
  type EbInspectorAppointedBy,
  type EbPreviousInspectionItem,
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

function toPreviousInspections(value: unknown): EbPreviousInspectionItem[] | null {
  if (!Array.isArray(value)) return null

  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const record = row as Record<string, unknown>
      const key = toText(record.key)
      const label = toText(record.label)
      if (!key || !label) return null

      return {
        key,
        label,
        status: (toText(record.status) || null) as EbPreviousInspectionItem['status'],
        date: toText(record.date) || null,
      }
    })
    .filter((row): row is EbPreviousInspectionItem => Boolean(row))
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
      continuedFinalInspectionDate: toText(body.continuedFinalInspectionDate) || null,
      continuedFinalInspectionTime: toText(body.continuedFinalInspectionTime) || null,
      warrantyPeriodYears: toOptionalNumber(body.warrantyPeriodYears),
      warrantyEndDate: toText(body.warrantyEndDate) || null,
      warrantyScope: toText(body.warrantyScope) || null,
      defaultRemedyDeadline: toText(body.defaultRemedyDeadline) || null,
      afterInspectionRequested: toOptionalBoolean(body.afterInspectionRequested),
      afterInspectionDueDate: toText(body.afterInspectionDueDate) || null,
      afterInspectionNoticeInReport: body.afterInspectionNoticeInReport === true,
      reportDistributionDate: toText(body.reportDistributionDate) || null,
      previousInspections: toPreviousInspections(body.previousInspections),
      defectNumberingExplanation: toText(body.defectNumberingExplanation) || null,
      defectNoErrorPartsPolicy: (toText(body.defectNoErrorPartsPolicy) || null) as
        | EbDefectNoErrorPartsPolicy
        | null,
    })

    return NextResponse.json({ project })
  } catch (error) {
    return mapError(error, 'Kunde inte uppdatera besiktningen.')
  }
}
