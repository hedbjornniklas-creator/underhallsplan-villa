import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function notFoundResponse() {
  return new NextResponse('Not found', { status: 404 })
}

export async function GET(
  _request: Request,
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
      .select('id,pdf_base64,revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (error) {
      console.error('[reports.public] lookup failed', { error: error.message ?? error })
      return new NextResponse('Could not load report.', { status: 500 })
    }

    if (!data || data.revoked_at) {
      return notFoundResponse()
    }

    const pdfBase64 = String(data.pdf_base64 ?? '').trim()
    if (pdfBase64 === '') {
      console.error('[reports.public] empty pdf snapshot', { linkId: data.id })
      return new NextResponse('Report snapshot is empty.', { status: 500 })
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = Buffer.from(pdfBase64, 'base64')
    } catch (decodeError) {
      console.error('[reports.public] base64 decode failed', {
        linkId: data.id,
        error: decodeError instanceof Error ? decodeError.message : String(decodeError),
      })
      return new NextResponse('Could not decode report.', { status: 500 })
    }

    if (pdfBuffer.length === 0) {
      console.error('[reports.public] decoded pdf is empty', { linkId: data.id })
      return new NextResponse('Report snapshot is empty.', { status: 500 })
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="besiktningsutlatande.pdf"',
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
