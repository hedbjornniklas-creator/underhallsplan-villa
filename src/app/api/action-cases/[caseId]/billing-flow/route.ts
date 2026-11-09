import { NextResponse } from 'next/server'
import { customerOfferContext, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { getBillingFlow, writeBillingFlow } from '@/lib/action-cases/billingFlowServer'
import { billingFlowError } from '@/lib/action-cases/billingFlowHttp'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try { return NextResponse.json(await getBillingFlow(await customerOfferContext(), (await params).caseId), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return billingFlowError(error) }
}
export async function POST(request: Request, { params }: Params) {
  try { return NextResponse.json(await writeBillingFlow(await customerOfferContext(), (await params).caseId, await offerRequestBody(request)), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return billingFlowError(error) }
}
