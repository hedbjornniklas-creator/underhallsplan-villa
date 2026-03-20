import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function notFoundResponse() {
  return new NextResponse('Not found', { status: 404 })
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

async function tryDownloadStoredPdfFromStorage(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bucket: string,
  path: string,
  linkId: string
) {
  try {
    const { data, error } = await admin.storage.from(bucket).download(path)
    if (error || !data) {
      console.error('[reports.public] storage download failed', {
        linkId,
        bucket,
        path,
        error: error?.message ?? error ?? null,
      })
      return null
    }

    const arrayBuffer = await data.arrayBuffer()
    const pdfBuffer = Buffer.from(arrayBuffer)
    return pdfBuffer.length > 0 ? pdfBuffer : null
  } catch (downloadError) {
    console.error('[reports.public] storage download exception', {
      linkId,
      bucket,
      path,
      error: downloadError instanceof Error ? downloadError.message : String(downloadError),
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
      .select('id,pdf_base64,pdf_storage_bucket,pdf_storage_path,revoked_at,delivery_mode')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (error) {
      console.error('[reports.public] lookup failed', { error: error.message ?? error })
      return new NextResponse('Could not load report.', { status: 500 })
    }

    if (!data || data.revoked_at) {
      return notFoundResponse()
    }

    let pdfBuffer: Buffer | null = null
    const pdfBase64 = String(data.pdf_base64 ?? '').trim()
    const pdfStorageBucket = String((data as Record<string, unknown>).pdf_storage_bucket ?? '').trim()
    const pdfStoragePath = String((data as Record<string, unknown>).pdf_storage_path ?? '').trim()

    const tryDecodeStoredPdf = () => {
      if (pdfBase64 === '') return null
      try {
        return decodeBase64(pdfBase64, String(data.id))
      } catch (decodeError) {
        console.error('[reports.public] stored pdf decode failed', {
          linkId: data.id,
          error: decodeError instanceof Error ? decodeError.message : String(decodeError),
        })
        return null
      }
    }

    if (pdfStorageBucket && pdfStoragePath) {
      pdfBuffer = await tryDownloadStoredPdfFromStorage(
        admin,
        pdfStorageBucket,
        pdfStoragePath,
        String(data.id)
      )
    }

    if (!pdfBuffer) {
      pdfBuffer = tryDecodeStoredPdf()
    }

    if (!pdfBuffer) {
      console.error('[reports.public] stored pdf missing', {
        linkId: data.id,
        deliveryMode: data.delivery_mode ?? null,
      })
      return new NextResponse('Stored report PDF is missing.', { status: 500 })
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error('[reports.public] rendered pdf is empty', { linkId: data.id })
      return new NextResponse('Report snapshot is empty.', { status: 500 })
    }

    const asAttachment = new URL(request.url).searchParams.get('download') === '1'
    const fileName = 'besiktningsutlatande.pdf'
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
