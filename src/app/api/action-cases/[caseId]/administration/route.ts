import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { getProjectCompletion, writeProjectCompletion } from '@/lib/action-cases/projectCompletionServer'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try { return NextResponse.json(await getProjectCompletion(await customerOfferContext(), (await params).caseId), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, { params }: Params) {
  try { return NextResponse.json(await writeProjectCompletion(await customerOfferContext(), (await params).caseId, await offerRequestBody(request)), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return customerOfferError(error) }
}
