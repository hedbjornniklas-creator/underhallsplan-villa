import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { downloadChoiceOfferPdf } from '@/lib/action-cases/choiceOfferPdfServer'

export const runtime = 'nodejs'
export const maxDuration = 120
type Params = { params: Promise<{ caseId: string; optionId: string }> }
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId, optionId } = await params
    const raw = new URL(request.url).searchParams.get('revision')
    if (!raw || !/^\d+$/.test(raw)) throw new Error('CUSTOMER_CHOICE_OFFER_INVALID')
    const file = await downloadChoiceOfferPdf(ctx, caseId, optionId, Number(raw))
    return new Response(new Uint8Array(file.bytes), { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) { return customerOfferError(error) }
}
