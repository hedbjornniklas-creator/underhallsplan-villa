import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { downloadCurrentContractPdf } from '@/lib/action-cases/contractSigningServer'

export const runtime = 'nodejs'
export const maxDuration = 120
type Params = { params: Promise<{ caseId: string }> }
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await params
    const file = await downloadCurrentContractPdf(ctx, caseId, Number(new URL(request.url).searchParams.get('revision')))
    return new Response(new Uint8Array(file.bytes), { headers: {
      'Content-Type': file.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
    } })
  } catch (error) { return customerOfferError(error) }
}
