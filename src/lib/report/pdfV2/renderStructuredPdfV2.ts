import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import type * as ReactPdf from '@react-pdf/renderer'
import ReportPdfDocumentV2 from '@/lib/report/pdfV2/ReportPdfDocumentV2'
import { buildReportDataV2, type ReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'
import { buildReportSpec } from '@/lib/report/reportSpec'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type RenderStructuredPdfV2Params = {
  inspectionId: string
  propertyId?: string | null
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

async function resolveInspectionSide(inspectionId: string): Promise<'buyer' | 'seller' | null> {
  const supabase = createSupabaseServerClient()
  const { data } = await supabase
    .from('inspections')
    .select('inspection_side')
    .eq('id', inspectionId)
    .maybeSingle()

  const value = String((data as { inspection_side?: string | null } | null)?.inspection_side ?? '')
    .trim()
    .toLowerCase()
  if (value === 'buyer' || value === 'seller') return value
  return null
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
  const spec = buildReportSpec({ inspectionSide })

  const document = React.createElement(ReportPdfDocumentV2, {
    spec,
    data: compactData,
    imageMap: {},
  }) as unknown as React.ReactElement<ReactPdf.DocumentProps>

  const rendered = await renderToBuffer(document)
  if (Buffer.isBuffer(rendered)) return rendered
  return Buffer.from(rendered)
}
