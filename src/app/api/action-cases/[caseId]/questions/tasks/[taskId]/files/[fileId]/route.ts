import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { projectQuestionTaskFile } from '@/lib/action-cases/projectQuestionsServer'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, route: { params: Promise<{ caseId: string; taskId: string; fileId: string }> }) {
  try {
    const ctx = await customerOfferContext(), p = await route.params
    return new NextResponse(null, { status: 303, headers: { Location: await projectQuestionTaskFile(ctx, p.caseId, p.taskId, p.fileId), 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
