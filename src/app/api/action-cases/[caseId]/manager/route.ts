import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { getProjectManager, setProjectManager } from '@/lib/action-cases/projectManagerServer'

export const dynamic = 'force-dynamic'
type Route = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, route: Route) {
  try { return NextResponse.json(await getProjectManager(await customerOfferContext(), (await route.params).caseId), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, route: Route) {
  try { return NextResponse.json(await setProjectManager(await customerOfferContext(), (await route.params).caseId, await offerRequestBody(request)), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return customerOfferError(error) }
}
