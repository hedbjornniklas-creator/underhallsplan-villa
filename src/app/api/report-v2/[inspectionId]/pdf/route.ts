import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const REPORT_PDF_SIGNED_URL_TTL_SECONDS = Math.max(
  30,
  Number(process.env.REPORT_PDF_SIGNED_URL_TTL_SECONDS ?? 120)
)

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

const normalizePdfStatus = (value: unknown): 'pending' | 'processing' | 'ready' | 'failed' => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

type LinkPdfRow = {
  id: string
  pdf_base64: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
  pdf_status: string | null
  pdf_error: string | null
  created_at: string
}

const sanitizeFilenamePart = (value: string | null | undefined) => {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

const buildReportFileName = (assignmentNumber: string | null | undefined) => {
  const safeAssignment = sanitizeFilenamePart(assignmentNumber)
  return safeAssignment ? `Utlåtande (${safeAssignment}).pdf` : 'Utlåtande.pdf'
}

async function createSignedPdfUrl(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bucket: string,
  path: string,
  fileName: string
) {
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, REPORT_PDF_SIGNED_URL_TTL_SECONDS, {
      download: fileName,
    })
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function GET(
  request: Request,
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
      .select('id,status,assignment_number')
      .eq('id', inspectionId)
      .maybeSingle()

    if (inspectionError) {
      return new NextResponse(inspectionError.message ?? 'Could not read inspection.', { status: 500 })
    }

    if (!inspection) {
      return new NextResponse('Inspection not found.', { status: 404 })
    }

    const inspectionStatus = normalizeInspectionStatus(inspection.status)
    const fileName = buildReportFileName((inspection as { assignment_number?: string | null }).assignment_number)
    if (inspectionStatus !== 'completed') {
      return new NextResponse('PDF kan laddas ner först efter att utlåtandet har skickats.', {
        status: 409,
      })
    }

    const { data: linkRows, error: linkError } = await admin
      .from('inspection_report_links')
      .select('id,pdf_base64,pdf_storage_bucket,pdf_storage_path,pdf_status,pdf_error,created_at')
      .eq('inspection_id', inspectionId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(25)

    if (linkError) {
      console.error('[report-v2.pdf] failed to read stored report pdf', {
        inspectionId,
        error: linkError.message ?? linkError,
      })
      return new NextResponse('Could not load stored report PDF.', { status: 500 })
    }

    const rows = (Array.isArray(linkRows) ? linkRows : []) as LinkPdfRow[]
    const storageReadyRow = rows.find((row) => {
      const bucket = String(row.pdf_storage_bucket ?? '').trim()
      const path = String(row.pdf_storage_path ?? '').trim()
      return bucket.length > 0 && path.length > 0 && normalizePdfStatus(row.pdf_status) === 'ready'
    })

    if (storageReadyRow) {
      const bucket = String(storageReadyRow.pdf_storage_bucket ?? '').trim()
      const path = String(storageReadyRow.pdf_storage_path ?? '').trim()
      const signedUrl = await createSignedPdfUrl(admin, bucket, path, fileName)
      if (signedUrl) {
        return NextResponse.redirect(signedUrl, 302)
      }
      return new NextResponse('Kunde inte skapa säker nedladdningslänk för PDF.', { status: 500 })
    }

    const legacyReadyRow = rows.find((row) => String(row.pdf_base64 ?? '').trim().length > 0)
    if (legacyReadyRow) {
      const storedPdfBase64 = String(legacyReadyRow.pdf_base64 ?? '').trim()
      const storedPdfBuffer = decodeStoredPdf(storedPdfBase64)
      if (storedPdfBuffer) {
        const encodedFileName = encodeURIComponent(fileName)
        return new NextResponse(new Uint8Array(storedPdfBuffer), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`,
            'Cache-Control': 'private, no-store',
          },
        })
      }
    }

    const latestRow = rows[0] ?? null
    const pdfStatus = normalizePdfStatus(latestRow?.pdf_status)
    const pdfError = String(latestRow?.pdf_error ?? '').trim()
    if (pdfStatus === 'pending' || pdfStatus === 'processing') {
      return new NextResponse('PDF genereras fortfarande i bakgrunden. Försök igen om en stund.', {
        status: 409,
      })
    }
    if (pdfStatus === 'failed') {
      const suffix = pdfError ? ` (${pdfError})` : ''
      return new NextResponse(`PDF-generering misslyckades${suffix}.`, { status: 500 })
    }
    return new NextResponse('Ingen lagrad PDF hittades för denna besiktning.', { status: 404 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new NextResponse(message, { status: 500 })
  }
}
