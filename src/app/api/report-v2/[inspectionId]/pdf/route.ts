import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const decodeStoredPdf = (base64: string) => {
  try {
    const pdfBuffer = Buffer.from(base64, 'base64')
    return pdfBuffer.length > 0 ? pdfBuffer : null
  } catch {
    return null
  }
}

const normalizeInspectionStatus = (value: string | null | undefined) => {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'klar' || normalized === 'done') return 'completed'
  if (normalized === 'archived' || normalized === 'arkiverad') return 'archived'
  if (normalized === 'draft' || normalized === 'utkast' || normalized === '') return 'draft'
  return 'ongoing'
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await context.params

  if (!inspectionId) {
    return new NextResponse('Missing inspectionId', { status: 400 })
  }

  try {
    const admin = createSupabaseAdminClient()

    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .select('id,status')
      .eq('id', inspectionId)
      .maybeSingle()

    if (inspectionError) {
      return new NextResponse(inspectionError.message ?? 'Could not read inspection.', { status: 500 })
    }

    if (!inspection) {
      return new NextResponse('Inspection not found.', { status: 404 })
    }

    const inspectionStatus = normalizeInspectionStatus(inspection.status)
    if (inspectionStatus !== 'completed') {
      return new NextResponse('PDF kan laddas ner först efter att utlåtandet har skickats.', {
        status: 409,
      })
    }

    const { data: linkData, error: linkError } = await admin
      .from('inspection_report_links')
      .select('id,pdf_base64,revoked_at')
      .eq('inspection_id', inspectionId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (linkError) {
      console.error('[report-v2.pdf] failed to read stored report pdf', {
        inspectionId,
        error: linkError.message ?? linkError,
      })
      return new NextResponse('Could not load stored report PDF.', { status: 500 })
    }

    const storedPdfBase64 = String(linkData?.pdf_base64 ?? '').trim()
    if (!storedPdfBase64) {
      return new NextResponse('Ingen lagrad PDF hittades för denna besiktning.', { status: 404 })
    }

    const storedPdfBuffer = decodeStoredPdf(storedPdfBase64)
    if (!storedPdfBuffer) {
      return new NextResponse('Lagrad PDF kunde inte tolkas.', { status: 500 })
    }

    return new NextResponse(new Uint8Array(storedPdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new NextResponse(message, { status: 500 })
  }
}
