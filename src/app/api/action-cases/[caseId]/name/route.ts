import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { renameActionCase } from '@/lib/action-cases/projectNameServer'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const ctx = await customerOfferContext()
    return NextResponse.json({ project: await renameActionCase(ctx, (await params).caseId, await offerRequestBody(request)) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
