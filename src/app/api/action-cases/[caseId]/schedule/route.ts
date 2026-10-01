import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { getProjectSchedule, writeProjectSchedule } from '@/lib/action-cases/projectScheduleServer'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try {
    return NextResponse.json(await getProjectSchedule(await customerOfferContext(), (await params).caseId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await params
    await writeProjectSchedule(ctx, caseId, await offerRequestBody(request))
    return NextResponse.json(await getProjectSchedule(ctx, caseId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
