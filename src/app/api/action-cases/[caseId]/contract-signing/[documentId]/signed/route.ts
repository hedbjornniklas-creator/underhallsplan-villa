import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { completeSignedContractUpload, prepareSignedContractUpload, registerSignedContract, signedContractDownloadUrl } from '@/lib/action-cases/contractSigningDeliveryServer'
import { getCustomerOfferWorkspace } from '@/lib/action-cases/customerOffersServer'

export const runtime = 'nodejs'
export const maxDuration = 120
type Params = { params: Promise<{ caseId: string; documentId: string }> }
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId, documentId } = await params
    if ((request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) || Number(request.headers.get('content-length')) > 20_100_000)
      throw new Error('CUSTOMER_OFFER_SIGNED_COPY')
    if (request.headers.get('content-type')?.includes('application/json')) {
      const data = await offerRequestBody(request), payload = { ...data, id: documentId }
      if (data.operation === 'prepare') return NextResponse.json({ upload: await prepareSignedContractUpload(ctx, caseId, payload) }, { headers: { 'Cache-Control': 'no-store' } })
      if (data.operation !== 'complete') throw new Error('CUSTOMER_OFFER_INVALID')
      await completeSignedContractUpload(ctx, caseId, payload)
      return NextResponse.json(await getCustomerOfferWorkspace(ctx, caseId), { headers: { 'Cache-Control': 'no-store' } })
    }
    const reader = request.body?.getReader(), chunks: Buffer[] = []
    if (!reader) throw new Error('CUSTOMER_OFFER_SIGNED_COPY')
    let size = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > 20_100_000) { await reader.cancel(); throw new Error('CUSTOMER_OFFER_SIGNED_COPY') }
      chunks.push(Buffer.from(next.value))
    }
    const form = await new Request(request.url, { method: 'POST', headers: request.headers, body: new Uint8Array(Buffer.concat(chunks)) }).formData(), file = form.get('file')
    if (!(file instanceof File)) throw new Error('CUSTOMER_OFFER_SIGNED_COPY')
    await registerSignedContract(ctx, caseId, { id: documentId, revision: Number(form.get('revision')), confirmed: form.get('confirmed') === 'true' }, file)
    return NextResponse.json(await getCustomerOfferWorkspace(ctx, caseId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId, documentId } = await params
    return new NextResponse(null, { status: 303, headers: { Location: await signedContractDownloadUrl(ctx, caseId, documentId), 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch (error) { return customerOfferError(error) }
}
