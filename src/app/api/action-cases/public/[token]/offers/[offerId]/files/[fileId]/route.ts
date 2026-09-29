import { NextResponse } from 'next/server'
import { customerOfferFileUrl } from '@/lib/action-cases/customerOffersServer'
import { customerOfferError } from '@/lib/action-cases/customerOffersHttp'
export const dynamic = 'force-dynamic'
export async function GET(
  _request: Request,
  {
    params
  }: { params: Promise<{ token: string; offerId: string; fileId: string }> }
) {
  try {
    return NextResponse.redirect(await customerOfferFileUrl(await params), {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
    })
  } catch (error) {
    return customerOfferError(error)
  }
}
