import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import type * as ReactPdf from '@react-pdf/renderer'
import ReportPdfDocumentV2 from '@/lib/report/pdfV2/ReportPdfDocumentV2'
import { buildReportDataV2, type ReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'
import { buildReportSpec, type ReportSection } from '@/lib/report/reportSpec'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type RenderStructuredPdfV2Params = {
  inspectionId: string
  propertyId?: string | null
}

export type ReportSnapshotPayloadV1 = {
  schemaVersion: 'v1'
  createdAt: string
  inspectionId: string
  propertyId: string
  inspectionSide: 'buyer' | 'seller' | 'apartment' | null
  reportData: ReportDataV2
  reportSpec: ReportSection[]
}

function stripPhotoUrls(data: ReportDataV2): ReportDataV2 {
  const cloned = structuredClone(data)
  const mock = (cloned.mock ?? {}) as Record<string, unknown>
  const stripBlocks = (key: 'exterior' | 'interior') => {
    const section = (mock[key] ?? {}) as { blocks?: Array<Record<string, unknown>> }
    if (!Array.isArray(section.blocks)) return
    section.blocks = section.blocks.map((block) => ({
      ...block,
      photoUrls: [],
    }))
    mock[key] = section
  }

  stripBlocks('exterior')
  stripBlocks('interior')
  cloned.mock = mock
  return cloned
}

async function resolveInspectionSide(
  inspectionId: string
): Promise<'buyer' | 'seller' | 'apartment' | null> {
  const supabase = createSupabaseServerClient()
  const { data } = await supabase
    .from('inspections')
    .select('inspection_side')
    .eq('id', inspectionId)
    .maybeSingle()

  const value = String((data as { inspection_side?: string | null } | null)?.inspection_side ?? '')
    .trim()
    .toLowerCase()
  if (value === 'buyer' || value === 'seller' || value === 'apartment') return value
  return null
}

function createDocument(
  spec: ReportSection[],
  data: ReportDataV2
): React.ReactElement<ReactPdf.DocumentProps> {
  return React.createElement(ReportPdfDocumentV2, {
    spec,
    data,
    imageMap: {},
  }) as unknown as React.ReactElement<ReactPdf.DocumentProps>
}

async function renderDocumentToBuffer(document: React.ReactElement<ReactPdf.DocumentProps>) {
  const rendered = await renderToBuffer(document)
  if (Buffer.isBuffer(rendered)) return rendered
  return Buffer.from(rendered)
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

export async function renderStructuredPdfFromSnapshot(
  snapshot: ReportSnapshotPayloadV1
): Promise<Buffer> {
  const specInspectionSide = snapshot.inspectionSide === 'seller' ? 'seller' : snapshot.inspectionSide === 'apartment' ? 'apartment' : 'buyer'
  const snapshotAppendices =
    (snapshot.reportData?.mock?.appendices as Record<string, unknown> | undefined) ?? {}
  const spec =
    Array.isArray(snapshot.reportSpec) && snapshot.reportSpec.length > 0
      ? snapshot.reportSpec
      : buildReportSpec({
          inspectionSide: specInspectionSide,
          dynamicAppendices: {
            includeAreaMeasurement:
              (snapshotAppendices.area_measurement as Record<string, unknown> | undefined)
                ?.enabled === true,
            includeMoistureControl:
              (snapshotAppendices.moisture_control as Record<string, unknown> | undefined)
                ?.enabled === true,
          },
        })
  const document = createDocument(spec, snapshot.reportData)
  return await renderDocumentToBuffer(document)
}

export async function renderStructuredPdfV2(
  params: RenderStructuredPdfV2Params
): Promise<Buffer> {
  const data = await buildReportDataV2({
    inspectionId: params.inspectionId,
    propertyId: params.propertyId ?? null,
  })
  const compactData = stripPhotoUrls(data)
  const inspectionSide = await resolveInspectionSide(params.inspectionId)
  const specInspectionSide = inspectionSide === 'seller' ? 'seller' : inspectionSide === 'apartment' ? 'apartment' : 'buyer'
  const appendices = (compactData.mock?.appendices as Record<string, any> | undefined) ?? {}
  const spec = buildReportSpec({
    inspectionSide: specInspectionSide,
    dynamicAppendices: {
      includeAreaMeasurement: appendices.area_measurement?.enabled === true,
      includeMoistureControl: appendices.moisture_control?.enabled === true,
    },
  })
  const document = createDocument(spec, compactData)
  return await renderDocumentToBuffer(document)
}

