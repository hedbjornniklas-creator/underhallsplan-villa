import { NextResponse } from 'next/server'
import {
  customerOfferContext,
  customerOfferError,
  offerRequestBody
} from '@/lib/action-cases/customerOffersHttp'
import {
  getCustomerPlanning,
  writeCustomerPlanning
} from '@/lib/action-cases/customerOffersServer'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try {
    return NextResponse.json(
      await getCustomerPlanning(
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
      { caseId } = await params
    await writeCustomerPlanning(ctx, caseId, await offerRequestBody(request))
    return NextResponse.json(await getCustomerPlanning(ctx, caseId), {
      headers: { 'Cache-Control': 'no-store' }
    })
  } catch (error) {
    return customerOfferError(error)
  }
}
