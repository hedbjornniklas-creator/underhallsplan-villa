import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { customerChoiceFile, customerChoiceFileResponse } from '@/lib/action-cases/customerChoiceFilesServer'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; fileId: string }> }) {
  try {
    const ctx = await customerOfferContext()
    return customerChoiceFileResponse(await customerChoiceFile({ ctx, ...await params }), new URL(request.url).searchParams.get('download') === '1')
  } catch (error) { return customerOfferError(error) }
}
