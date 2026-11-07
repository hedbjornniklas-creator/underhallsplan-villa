import { NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { getProjectCompletion } from '@/lib/action-cases/projectCompletionServer'
import { administrationUuid } from '@/lib/action-cases/projectCompletion'
import { renderInvoiceBasisPdf } from '@/lib/action-cases/invoiceBasisPdf'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Params = { params: Promise<{ caseId: string; basisId: string }> }
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId, basisId } = await params
    if (!administrationUuid(basisId)) throw new Error('PROJECT_ADMIN_INVALID')
    const data = await getProjectCompletion(ctx, caseId), record = data.bases.find(b => b.id === basisId)
    if (!record) throw new Error('PROJECT_ADMIN_NOT_FOUND')
    if (String(record.revision) !== new URL(request.url).searchParams.get('revision')) throw new Error('PROJECT_ADMIN_STALE')
    const db = createSupabaseAdminClient()
    const project = await db.from('action_cases').select('title').eq('org_id', ctx.orgId).eq('id', caseId).single()
    if (project.error) throw new Error('PROJECT_ADMIN_FAILED')
    const buffer = await renderInvoiceBasisPdf(record, project.data.title)
    const fresh = await db.from('action_case_invoice_basis').select('revision').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('id', basisId).single()
    if (fresh.error || fresh.data.revision !== record.revision) throw new Error('PROJECT_ADMIN_STALE')
    return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Fakturaunderlag-${record.body.date.replaceAll('-', '')}-${basisId.slice(0, 8)}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) { return customerOfferError(error) }
}
