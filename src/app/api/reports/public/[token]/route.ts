import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import {
  isReportSnapshotPayloadV1,
  renderStructuredPdfFromSnapshot,
} from '@/lib/report/pdfV2/renderStructuredPdfV2'

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
      .select('id,pdf_base64,snapshot_payload,revoked_at')
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
    if (pdfBase64 !== '') {
      pdfBuffer = decodeBase64(pdfBase64, String(data.id))
    } else if (isReportSnapshotPayloadV1(data.snapshot_payload)) {
      try {
        pdfBuffer = await renderStructuredPdfFromSnapshot(data.snapshot_payload)
      } catch (renderError) {
        console.error('[reports.public] snapshot render failed', {
          linkId: data.id,
          error: renderError instanceof Error ? renderError.message : String(renderError),
        })
        return new NextResponse('Could not render report.', { status: 500 })
      }
    } else {
      console.error('[reports.public] missing report payload', { linkId: data.id })
      return new NextResponse('Report snapshot is empty.', { status: 500 })
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error('[reports.public] rendered pdf is empty', { linkId: data.id })
      return new NextResponse('Report snapshot is empty.', { status: 500 })
    }

    const asAttachment = new URL(request.url).searchParams.get('download') === '1'
    const disposition = asAttachment
      ? 'attachment; filename="besiktningsutlatande.pdf"'
      : 'inline; filename="besiktningsutlatande.pdf"'

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition,
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

