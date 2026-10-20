import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { getCustomerSharing, writeCustomerSharing } from '@/lib/action-cases/customerSharingServer'

export const dynamic = 'force-dynamic'
type Route = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, route: Route) {
  try { return NextResponse.json(await getCustomerSharing(await customerOfferContext(), (await route.params).caseId), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, route: Route) {
  try { return NextResponse.json(await writeCustomerSharing(await customerOfferContext(), (await route.params).caseId, await offerRequestBody(request)), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return customerOfferError(error) }
}
