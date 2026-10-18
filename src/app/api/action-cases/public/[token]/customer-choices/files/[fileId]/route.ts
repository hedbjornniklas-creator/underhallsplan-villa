import { customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { customerChoiceFile, customerChoiceFileResponse } from '@/lib/action-cases/customerChoiceFilesServer'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  try {
    return customerChoiceFileResponse(await customerChoiceFile(await params), new URL(request.url).searchParams.get('download') === '1')
  } catch (error) { return customerOfferError(error) }
}
