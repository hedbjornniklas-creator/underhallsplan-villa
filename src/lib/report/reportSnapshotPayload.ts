import type { ReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'
import type { ReportSection } from '@/lib/report/reportSpec'
import { resolveObObjectType, type ObObjectType } from '@/lib/ob/objectType'

export type ReportSnapshotPayloadV1 = {
  schemaVersion: 'v1'
  createdAt: string
  inspectionId: string
  propertyId: string
  inspectionSide: 'buyer' | 'seller' | 'apartment' | 'status' | null
  /** Optional for older published reports; never filled from current assignment data. */
  objectType?: ObObjectType
  reportData: ReportDataV2
  reportSpec: ReportSection[]
}

export function createReportSnapshotPayloadV1(input: {
  inspectionId: string
  propertyId: string
  inspectionSide: 'buyer' | 'seller' | 'apartment' | 'status' | null
  objectType?: ObObjectType
  reportData: ReportDataV2
  reportSpec: ReportSection[]
}): ReportSnapshotPayloadV1 {
  return {
    schemaVersion: 'v1',
    createdAt: new Date().toISOString(),
    inspectionId: input.inspectionId,
    propertyId: input.propertyId,
    inspectionSide: input.inspectionSide,
    objectType: resolveObObjectType(input.inspectionSide, input.objectType ?? input.reportData.mock?.properties?.object_type),
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
