import { NextResponse } from 'next/server'
import { bindProjectProperty } from '@/lib/action-cases/propertyRegistryServer'
import {
  customerOfferContext,
  customerOfferError,
  offerRequestBody
} from '@/lib/action-cases/customerOffersHttp'
import {
  getCustomerOfferWorkspace,
  bindContractCustomer,
  publishCustomerOffer,
  prepareStandardContractTerms,
  saveCustomerOffer,
  separateCustomerChoices,
  sendCustomerOffer,
  withdrawCustomerOffer
} from '@/lib/action-cases/customerOffersServer'
export const dynamic = 'force-dynamic'
export const maxDuration = 90
type Params = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try {
    return NextResponse.json(
      await getCustomerOfferWorkspace(
        await customerOfferContext(),
        (await params).caseId
      ),
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    return customerOfferError(error)
  }
}
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(),
      { caseId } = await params,
      body = await offerRequestBody(request)
    if (body.operation === 'prepare_standard_terms') return NextResponse.json(
      { file: await prepareStandardContractTerms(ctx, caseId) }, { headers: { 'Cache-Control': 'no-store' } }
    )
    if (body.operation === 'save') await saveCustomerOffer(ctx, caseId, body)
    else if (body.operation === 'autosave') await saveCustomerOffer(ctx, caseId, body, 'autosave')
    else if (body.operation === 'bind_customer') await bindContractCustomer(ctx, caseId, body)
    else if (body.operation === 'bind_property') await bindProjectProperty(ctx, caseId, body)
    else if (body.operation === 'separate_choices') await separateCustomerChoices(ctx, caseId, body)
    else if (body.operation === 'publish')
      await publishCustomerOffer(ctx, caseId, body, new URL(request.url).origin)
    else if (body.operation === 'send')
      await sendCustomerOffer(ctx, caseId, String(body.id))
    else if (body.operation === 'withdraw')
      await withdrawCustomerOffer(ctx, caseId, String(body.id))
    else throw new Error('CUSTOMER_OFFER_INVALID')
    return NextResponse.json(await getCustomerOfferWorkspace(ctx, caseId), {
      headers: { 'Cache-Control': 'no-store' }
    })
  } catch (error) {
    return customerOfferError(error)
  }
}
