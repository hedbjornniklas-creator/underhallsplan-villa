import { NextResponse } from 'next/server'
import { customerOfferContext } from '@/lib/action-cases/customerOffersHttp'
import { diaryPhotoUrl } from '@/lib/action-cases/projectDiaryServer'
import { diaryError, diaryHeaders } from '@/lib/action-cases/projectDiaryHttp'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, route: { params: Promise<{ caseId: string; photoId: string }> }) {
  try { const ctx = await customerOfferContext(), { caseId, photoId } = await route.params; return NextResponse.redirect(await diaryPhotoUrl(ctx, caseId, photoId), { status: 302, headers: diaryHeaders }) }
  catch (error) { return diaryError(error) }
}
