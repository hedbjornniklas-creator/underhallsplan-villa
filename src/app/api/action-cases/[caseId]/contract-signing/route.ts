import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { freezeContractForSigning, createNewContractDraft } from '@/lib/action-cases/contractSigningServer'
import { getCustomerOfferWorkspace } from '@/lib/action-cases/customerOffersServer'

export const runtime = 'nodejs'
export const maxDuration = 120
type Params = { params: Promise<{ caseId: string }> }
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await params, body = await offerRequestBody(request)
    if (body.operation === 'freeze') await freezeContractForSigning(ctx, caseId, body)
    else if (body.operation === 'new_draft') await createNewContractDraft(ctx, caseId, body)
    else throw new Error('CUSTOMER_OFFER_INVALID')
    return NextResponse.json(await getCustomerOfferWorkspace(ctx, caseId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
