import { NextResponse } from 'next/server'
import {
  customerOfferError,
  offerRequestBody
} from '@/lib/action-cases/customerOffersHttp'
import { respondCustomerOffer } from '@/lib/action-cases/customerOffersServer'
export const dynamic = 'force-dynamic'
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; offerId: string }> }
) {
  try {
    const { token, offerId } = await params
    return NextResponse.json(
      await respondCustomerOffer(
        token,
        offerId,
        await offerRequestBody(request),
        new URL(request.url).origin
      ),
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    return customerOfferError(error)
  }
}
