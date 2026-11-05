import { NextResponse } from 'next/server'
import { supplierInvoiceContext, supplierInvoiceError, supplierInvoiceRequestBody } from '@/lib/supplier-invoices/http'
import { getSupplierInvoiceWorkspace, saveSupplierInvoice } from '@/lib/supplier-invoices/server'

export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json(await getSupplierInvoiceWorkspace(await supplierInvoiceContext()), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return supplierInvoiceError(error) }
}
export async function POST(request: Request) {
  try {
    const ctx = await supplierInvoiceContext(), body = await supplierInvoiceRequestBody(request)
    const saved = await saveSupplierInvoice(ctx, body)
    return NextResponse.json({ ...await getSupplierInvoiceWorkspace(ctx), saved }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return supplierInvoiceError(error) }
}
