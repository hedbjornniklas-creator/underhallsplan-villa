import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { freezeContractForSigning, createNewContractDraft } from '@/lib/action-cases/contractSigningServer'
import { getCustomerOfferWorkspace } from '@/lib/action-cases/customerOffersServer'
import { shareSigningContract, withdrawSigningContract } from '@/lib/action-cases/contractSigningDeliveryServer'

export const runtime = 'nodejs'
export const maxDuration = 120
type Params = { params: Promise<{ caseId: string }> }
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await params, body = await offerRequestBody(request)
    let customerUrl: string | undefined
    if (body.operation === 'freeze') await freezeContractForSigning(ctx, caseId, body)
    else if (body.operation === 'new_draft') await createNewContractDraft(ctx, caseId, body)
    else if (body.operation === 'share') customerUrl = await shareSigningContract(ctx, caseId, body, new URL(request.url).origin)
    else if (body.operation === 'withdraw_share') await withdrawSigningContract(ctx, caseId, body)
    else throw new Error('CUSTOMER_OFFER_INVALID')
    return NextResponse.json({ ...await getCustomerOfferWorkspace(ctx, caseId), ...(customerUrl ? { customerUrl } : {}) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
