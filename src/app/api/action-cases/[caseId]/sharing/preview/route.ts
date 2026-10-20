import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { getActionCaseCustomerPreview } from '@/lib/action-cases/server'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, route: { params: Promise<{ caseId: string }> }) {
  try { return NextResponse.json(await getActionCaseCustomerPreview(await customerOfferContext(), (await route.params).caseId, new URL(request.url).searchParams.get('participantId') || ''), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }) }
  catch (error) { return customerOfferError(error) }
}
