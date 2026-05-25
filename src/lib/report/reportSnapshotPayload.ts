import type { ReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'
import type { ReportSection } from '@/lib/report/reportSpec'

export type ReportSnapshotPayloadV1 = {
  schemaVersion: 'v1'
  createdAt: string
  inspectionId: string
  propertyId: string
  inspectionSide: 'buyer' | 'seller' | 'apartment' | null
  reportData: ReportDataV2
  reportSpec: ReportSection[]
}

export function createReportSnapshotPayloadV1(input: {
  inspectionId: string
  propertyId: string
  inspectionSide: 'buyer' | 'seller' | 'apartment' | null
  reportData: ReportDataV2
  reportSpec: ReportSection[]
}): ReportSnapshotPayloadV1 {
  return {
    schemaVersion: 'v1',
    createdAt: new Date().toISOString(),
    inspectionId: input.inspectionId,
    propertyId: input.propertyId,
    inspectionSide: input.inspectionSide,
    reportData: input.reportData,
    reportSpec: input.reportSpec,
  }
}

export function isReportSnapshotPayloadV1(value: unknown): value is ReportSnapshotPayloadV1 {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (row.schemaVersion !== 'v1') return false
  if (typeof row.inspectionId !== 'string' || row.inspectionId.trim() === '') return false
  if (typeof row.propertyId !== 'string' || row.propertyId.trim() === '') return false
  if (typeof row.reportData !== 'object' || row.reportData === null) return false
  if (!Array.isArray(row.reportSpec)) return false
  return true
}
