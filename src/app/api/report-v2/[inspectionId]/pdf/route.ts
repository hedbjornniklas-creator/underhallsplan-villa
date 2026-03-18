import { NextResponse } from 'next/server'
import { renderPreviewPdf } from '@/lib/report/pdfV2/renderPreviewPdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

  const search = new URL(request.url).searchParams
  const propertyId = search.get('propertyId')
  if (!propertyId) {
    return new NextResponse('Missing propertyId', { status: 400 })
  }
  const origin = buildOrigin(request)
  const reportUrl = `${origin}/utlatande/${propertyId}/${inspectionId}?embed=1&pdf=1`

  try {
    const pdfBuffer = await renderPreviewPdf({
      url: reportUrl,
      cookieHeader: request.headers.get('cookie'),
    })

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
