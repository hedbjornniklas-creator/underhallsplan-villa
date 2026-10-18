import { NextResponse } from 'next/server'
import { customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { readCustomerChoices, recordCustomerChoice } from '@/lib/action-cases/customerOffersServer'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return NextResponse.json(await readCustomerChoices((await params).token), { headers })
  } catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return NextResponse.json(await recordCustomerChoice((await params).token, await offerRequestBody(request)), { headers })
  } catch (error) { return customerOfferError(error) }
}
