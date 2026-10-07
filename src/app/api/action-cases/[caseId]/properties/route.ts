import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { getProjectProperties } from '@/lib/action-cases/propertyRegistryServer'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try {
    const properties = await getProjectProperties(await customerOfferContext(), (await params).caseId)
    return NextResponse.json({ properties }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
