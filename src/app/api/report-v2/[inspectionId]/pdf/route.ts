import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { renderPreviewPdf } from '@/lib/report/pdfV2/renderPreviewPdf'

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

const buildOrigin = (request: Request) => {
  const url = new URL(request.url)
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = forwardedHost ?? request.headers.get('host') ?? url.host
  const proto = forwardedProto ?? url.protocol.replace(':', '')
  return `${proto}://${host}`
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
    const { data, error } = await admin
      .from('inspection_report_links')
      .select('id,pdf_base64,revoked_at')
      .eq('inspection_id', inspectionId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[report-v2.pdf] failed to read stored report pdf', {
        inspectionId,
        error: error.message ?? error,
      })
    }

    const storedPdfBase64 = String(data?.pdf_base64 ?? '').trim()
    if (storedPdfBase64) {
      const storedPdfBuffer = decodeStoredPdf(storedPdfBase64)
      if (storedPdfBuffer) {
        return new NextResponse(new Uint8Array(storedPdfBuffer), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Cache-Control': 'private, no-store',
          },
        })
      }
    }
  } catch (storedPdfError) {
    console.error('[report-v2.pdf] unexpected stored-pdf lookup error', {
      inspectionId,
      error:
        storedPdfError instanceof Error ? storedPdfError.message : String(storedPdfError),
    })
  }

  const search = new URL(request.url).searchParams
  const propertyId = search.get('propertyId')
  if (!propertyId) {
    return new NextResponse('Missing propertyId', { status: 400 })
  }
  const origin = buildOrigin(request)
  const reportUrl = `${origin}/utlatande/${propertyId}/${inspectionId}?embed=1&pdf=1`

  try {
    const previewPdf = await renderPreviewPdf({
      url: reportUrl,
      cookieHeader: request.headers.get('cookie'),
      timeoutMs: 45000,
    })
    const pdfBuffer = Buffer.isBuffer(previewPdf) ? previewPdf : Buffer.from(previewPdf)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF V.2 failed.'
    return new NextResponse(message, { status: 500 })
  }
}
