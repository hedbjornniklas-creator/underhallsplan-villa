import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { downloadContractSigningFile } from '@/lib/action-cases/contractSigningServer'
import { downloadCustomerSigningPdf } from '@/lib/action-cases/contractSigningDeliveryServer'

export const runtime = 'nodejs'
type Params = { params: Promise<{ caseId: string; documentId: string; fileId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId, documentId, fileId } = await params
    const file = fileId === 'customer-pdf' ? await downloadCustomerSigningPdf(ctx, caseId, documentId) : await downloadContractSigningFile(ctx, caseId, documentId, fileId)
    return new Response(new Uint8Array(file.bytes), { headers: {
      'Content-Type': file.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/'/g, '%27')}`,
    } })
  } catch (error) { return customerOfferError(error) }
}
