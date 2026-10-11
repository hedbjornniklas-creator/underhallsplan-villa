import { NextResponse } from 'next/server'
import { customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { downloadSharedSigningFile } from '@/lib/action-cases/contractSigningDeliveryServer'

export const runtime = 'nodejs'
type Params = { params: Promise<{ token: string; documentId: string; fileId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try {
    const { token, documentId, fileId } = await params, result = await downloadSharedSigningFile(token, documentId, fileId)
    return new NextResponse(new Uint8Array(result.bytes), { headers: { 'Content-Type': result.contentType, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${fileId === 'pdf' ? 'attachment' : 'inline'}; filename="Avtal"; filename*=UTF-8''${encodeURIComponent(result.fileName)}` } })
  } catch (error) { return customerOfferError(error) }
}
