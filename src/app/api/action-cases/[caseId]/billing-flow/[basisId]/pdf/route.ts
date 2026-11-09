import { NextResponse } from 'next/server'
import { customerOfferContext } from '@/lib/action-cases/customerOffersHttp'
import { getBillingFlow } from '@/lib/action-cases/billingFlowServer'
import { billingFlowError } from '@/lib/action-cases/billingFlowHttp'
import { renderInvoiceBasisPdf } from '@/lib/action-cases/invoiceBasisPdf'
import { administrationUuid } from '@/lib/action-cases/projectCompletion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Params = { params: Promise<{ caseId: string; basisId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await customerOfferContext(), { caseId, basisId } = await params
    if (!administrationUuid(basisId)) throw new Error('BILLING_INVALID')
    const data = await getBillingFlow(ctx, caseId), basis = data.flow.bases.find(b => b.id === basisId)
    if (!basis) throw new Error('BILLING_NOT_FOUND')
    if (basis.status !== 'exported' || basis.historical) throw new Error('BILLING_CANCELLED')
    const buffer = await renderInvoiceBasisPdf({ id: basis.id, revision: basis.version, updatedAt: basis.exportedAt!, body: { version: 1,
      title: basis.title, date: basis.date, period: '', issuer: basis.issuer, recipient: basis.recipient, note: basis.note,
      lines: basis.lines.map(l => ({ id: l.id, description: l.description, quantity: 1, unit: 'post', unitPriceOre: l.netOre, vatRate: l.vatRate })) } }, basis.projectTitle, true)
    const fresh = await getBillingFlow(ctx, caseId)
    if (fresh.flow.bases.find(b => b.id === basisId)?.status !== 'exported') throw new Error('BILLING_CANCELLED')
    return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Fakturaunderlag-${basis.date.replaceAll('-', '')}-${basisId.slice(0, 8)}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) { return billingFlowError(error) }
}
