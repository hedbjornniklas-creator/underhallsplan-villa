import { NextResponse } from 'next/server'
import { supplierInvoiceContext, supplierInvoiceError } from '@/lib/supplier-invoices/http'
import { getSupplierInvoiceAttachmentUrl } from '@/lib/supplier-invoices/server'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, { params }: { params: Promise<{ invoiceId: string; attachmentId: string }> }) {
  try {
    const ctx = await supplierInvoiceContext(), { invoiceId, attachmentId } = await params
    return NextResponse.redirect(await getSupplierInvoiceAttachmentUrl(ctx, invoiceId, attachmentId, new URL(request.url).searchParams.get('inline') === '1'), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return supplierInvoiceError(error) }
}
