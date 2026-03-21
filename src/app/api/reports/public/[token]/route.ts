import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const REPORT_PDF_SIGNED_URL_TTL_SECONDS = Math.max(
  30,
  Number(process.env.REPORT_PDF_SIGNED_URL_TTL_SECONDS ?? 120)
)

function notFoundResponse() {
  return new NextResponse('Not found', { status: 404 })
}

function normalizePdfStatus(value: unknown): 'pending' | 'processing' | 'ready' | 'failed' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

function decodeBase64(base64: string, linkId: string): Buffer {
  let pdfBuffer: Buffer
  try {
    pdfBuffer = Buffer.from(base64, 'base64')
  } catch (decodeError) {
    console.error('[reports.public] base64 decode failed', {
      linkId,
      error: decodeError instanceof Error ? decodeError.message : String(decodeError),
    })
    throw new Error('Could not decode report.')
  }

  if (pdfBuffer.length === 0) {
    throw new Error('Report snapshot is empty.')
  }

  return pdfBuffer
}

async function createSignedPdfUrl(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bucket: string,
  path: string,
  asAttachment: boolean,
  fileName: string,
  linkId: string
) {
  try {
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, REPORT_PDF_SIGNED_URL_TTL_SECONDS, {
        download: asAttachment ? fileName : false,
      })

    if (error || !data?.signedUrl) {
      console.error('[reports.public] signed url failed', {
        linkId,
        bucket,
        path,
        error: error?.message ?? error ?? null,
      })
      return null
    }

    return data.signedUrl
  } catch (signedUrlError) {
    console.error('[reports.public] signed url exception', {
      linkId,
      bucket,
      path,
      error: signedUrlError instanceof Error ? signedUrlError.message : String(signedUrlError),
    })
    return null
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const normalizedToken = token?.trim() ?? ''

    if (normalizedToken.length < 20) {
      return notFoundResponse()
    }

    const tokenHash = hashAssignmentToken(normalizedToken)
    const admin = createSupabaseAdminClient()

    const { data, error } = await admin
      .from('inspection_report_links')
      .select('id,pdf_base64,pdf_storage_bucket,pdf_storage_path,pdf_status,pdf_error,revoked_at,delivery_mode')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (error) {
      console.error('[reports.public] lookup failed', { error: error.message ?? error })
      return new NextResponse('Could not load report.', { status: 500 })
    }

    if (!data || data.revoked_at) {
      return notFoundResponse()
    }

    const asAttachment = new URL(request.url).searchParams.get('download') === '1'
    const fileName = 'besiktningsutlatande.pdf'
    const pdfBase64 = String(data.pdf_base64 ?? '').trim()
    const pdfStorageBucket = String((data as Record<string, unknown>).pdf_storage_bucket ?? '').trim()
    const pdfStoragePath = String((data as Record<string, unknown>).pdf_storage_path ?? '').trim()
    const hasStorageRef = pdfStorageBucket.length > 0 && pdfStoragePath.length > 0
    const hasLegacyPdf = pdfBase64.length > 0
    const pdfStatus = normalizePdfStatus((data as Record<string, unknown>).pdf_status)
    const pdfError = String((data as Record<string, unknown>).pdf_error ?? '').trim()

    if (hasStorageRef && pdfStatus === 'ready') {
      const signedUrl = await createSignedPdfUrl(
        admin,
        pdfStorageBucket,
        pdfStoragePath,
        asAttachment,
        fileName,
        String(data.id)
      )
      if (signedUrl) {
        return NextResponse.redirect(signedUrl, 302)
      }
    }

    let pdfBuffer: Buffer | null = null
    if (!hasStorageRef && hasLegacyPdf) {
      try {
        pdfBuffer = decodeBase64(pdfBase64, String(data.id))
      } catch (decodeError) {
        console.error('[reports.public] stored pdf decode failed', {
          linkId: data.id,
          error: decodeError instanceof Error ? decodeError.message : String(decodeError),
        })
      }
    }

    if (!pdfBuffer) {
      console.error('[reports.public] stored pdf missing', {
        linkId: data.id,
        deliveryMode: data.delivery_mode ?? null,
        pdfStatus,
      })
      if (pdfStatus === 'pending' || pdfStatus === 'processing') {
        return new NextResponse('PDF genereras fortfarande i bakgrunden. Försök igen om en stund.', {
          status: 409,
        })
      }
      if (pdfStatus === 'failed') {
        const suffix = pdfError ? ` (${pdfError})` : ''
        return new NextResponse(`PDF-generering misslyckades${suffix}.`, { status: 500 })
      }
      if (hasStorageRef && !hasLegacyPdf) {
        return new NextResponse('Kunde inte skapa säker nedladdningslänk för PDF.', { status: 500 })
      }
      return new NextResponse('Stored report PDF is missing.', { status: 500 })
    }

    const encodedFileName = encodeURIComponent(fileName)
    const disposition = asAttachment
      ? `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`
      : `inline; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition,
        'Content-Length': String(pdfBuffer.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[reports.public] unhandled error', { error: message })
    return new NextResponse('Could not load report.', { status: 500 })
  }
}
