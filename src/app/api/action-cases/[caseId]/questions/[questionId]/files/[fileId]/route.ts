import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { questionDialogueFile } from '@/lib/action-cases/questionDialogueServer'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, route: { params: Promise<{ caseId: string; questionId: string; fileId: string }> }) {
  try {
    const ctx = await customerOfferContext(), { caseId, questionId, fileId } = await route.params
    return NextResponse.redirect(await questionDialogueFile(caseId, questionId, fileId, ctx), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch (error) { return customerOfferError(error) }
}
