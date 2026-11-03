import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { downloadCurrentOfferPdf } from '@/lib/action-cases/offerPdfServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
type Params = { params: Promise<{ caseId: string }> }

export async function GET(request: Request, { params }: Params) {
  try {
    const file = await downloadCurrentOfferPdf(await customerOfferContext(), (await params).caseId, Number(new URL(request.url).searchParams.get('revision')))
    return new Response(new Uint8Array(file.bytes), { headers: {
      'Content-Type': file.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'attachment; filename="Offert.pdf"',
    } })
  } catch (error) { return customerOfferError(error) }
}
