import { NextResponse } from 'next/server'
import { requireSupplierInvoiceOrigin, supplierInvoiceContext, supplierInvoiceError } from '@/lib/supplier-invoices/http'
import { getSupplierInvoiceWorkspace, uploadSupplierInvoiceAttachment } from '@/lib/supplier-invoices/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  try {
    const ctx = await supplierInvoiceContext()
    requireSupplierInvoiceOrigin(request)
    if (Number(request.headers.get('content-length') ?? 0) > 4 * 1024 * 1024 + 65536) throw new Error('INVOICE_FILE_TOO_LARGE')
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new Error('INVOICE_FILE_INVALID')
    let form: FormData
    try { form = await request.formData() } catch { throw new Error('INVOICE_FILE_INVALID') }
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('INVOICE_FILE_INVALID')
    await uploadSupplierInvoiceAttachment(ctx, (await params).invoiceId, file)
    return NextResponse.json(await getSupplierInvoiceWorkspace(ctx), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return supplierInvoiceError(error) }
}
