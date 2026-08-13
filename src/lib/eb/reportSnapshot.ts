import type { EbInspectionReport } from '@/lib/eb/server'

export type EbReportSnapshotPayloadV1 = {
  schema: 'eb_report_snapshot_v1'
  module: 'EB'
  inspectionId: string
  createdAt: string
  report: EbInspectionReport
  meta: {
    projectId: string
    reportDate: string | null
    inspectionDate: string | null
    assignmentNumber: string | null
    propertyAddress: string | null
  }
}

type LegacyEbReportSnapshotPayload = {
  schemaVersion: 'eb_v1'
  createdAt?: string
  project: EbInspectionReport['project']
  inspection: EbInspectionReport['inspection']
  participants?: EbInspectionReport['participants']
  inspectionDocuments?: EbInspectionReport['inspectionDocuments']
  reportDraft: EbInspectionReport['reportDraft']
  disciplines?: EbInspectionReport['disciplines']
  markers?: EbInspectionReport['markers']
  statuses?: EbInspectionReport['statuses']
  notes?: EbInspectionReport['notes']
  images?: EbInspectionReport['images']
  branding: EbInspectionReport['branding']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function createEbReportSnapshotPayloadV1(
  report: EbInspectionReport
): EbReportSnapshotPayloadV1 {
  const snapshotReport: EbInspectionReport = {
    ...report,
    project: {
      ...report.project,
      clientEmail: null,
      contractorEmail: null,
      agreementItems: [],
      inspections: [report.inspection],
    },
    projectAttachments: [],
    suggestions: [],
  }
  const payload: EbReportSnapshotPayloadV1 = {
    schema: 'eb_report_snapshot_v1',
    module: 'EB',
    inspectionId: report.inspection.inspectionId,
    createdAt: new Date().toISOString(),
    report: snapshotReport,
    meta: {
      projectId: report.project.id,
      reportDate: report.inspection.reportDistributionDate,
      inspectionDate: report.inspection.date,
      assignmentNumber: report.inspection.assignmentNumber,
      propertyAddress: report.project.address,
    },
  }

  return JSON.parse(JSON.stringify(payload)) as EbReportSnapshotPayloadV1
}

export function isEbReportSnapshotPayloadV1(value: unknown): value is EbReportSnapshotPayloadV1 {
  if (!isRecord(value)) return false
  if (value.schema !== 'eb_report_snapshot_v1' || value.module !== 'EB') return false
  if (typeof value.inspectionId !== 'string' || !isRecord(value.report)) return false
  const report = value.report
  return isRecord(report.project) && isRecord(report.inspection) && isRecord(report.reportDraft)
}

export function getEbInspectionReportFromSnapshot(value: unknown): EbInspectionReport | null {
  if (isEbReportSnapshotPayloadV1(value)) return value.report
  if (!isRecord(value) || value.schemaVersion !== 'eb_v1') return null
  if (
    !isRecord(value.project) ||
    !isRecord(value.inspection) ||
    !isRecord(value.reportDraft) ||
    !isRecord(value.branding)
  ) {
    return null
  }

  const legacy = value as unknown as LegacyEbReportSnapshotPayload
  return {
    project: legacy.project,
    inspection: legacy.inspection,
    participants: legacy.participants ?? [],
    inspectionDocuments: legacy.inspectionDocuments ?? [],
    reportDraft: legacy.reportDraft,
    disciplines: legacy.disciplines ?? [],
    markers: legacy.markers ?? [],
    statuses: legacy.statuses ?? [],
    notes: legacy.notes ?? [],
    images: legacy.images ?? [],
    branding: legacy.branding,
    projectAttachments: [],
    suggestions: [],
    checkpoints: [],
  }
}
