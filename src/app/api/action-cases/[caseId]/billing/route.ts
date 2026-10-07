import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { customerFailure } from '@/lib/customers/http'
import { getProjectBilling, writeProjectBilling } from '@/lib/action-cases/projectBillingServer'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseId: string }> }
const headers = { 'Cache-Control': 'no-store' }

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code.startsWith('CUSTOMERS_') || (code.startsWith('CUSTOMER_') && !code.startsWith('CUSTOMER_REGISTRY_') && !code.startsWith('CUSTOMER_OFFER_'))) {
    const result = customerFailure(error)
    return NextResponse.json({ error: result.message }, { status: result.status, headers })
  }
  return customerOfferError(error)
}

export async function GET(_request: Request, { params }: Params) {
  try { return NextResponse.json(await getProjectBilling(await customerOfferContext(), (await params).caseId), { headers }) }
  catch (error) { return failure(error) }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await params
    await writeProjectBilling(ctx, caseId, await offerRequestBody(request))
    return NextResponse.json(await getProjectBilling(ctx, caseId), { headers })
  } catch (error) { return failure(error) }
}
