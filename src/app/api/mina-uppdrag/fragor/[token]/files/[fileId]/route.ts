import { NextResponse } from 'next/server'
import { customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { publicQuestionFile } from '@/lib/action-cases/questionDialogueServer'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, route: { params: Promise<{ token: string; fileId: string }> }) {
  try {
    const { token, fileId } = await route.params
    return NextResponse.redirect(await publicQuestionFile(token, fileId), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch (error) { return customerOfferError(error) }
}
