import { NextResponse } from 'next/server'
import { supplierInvoiceContext, supplierInvoiceError, supplierInvoiceRequestBody } from '@/lib/supplier-invoices/http'
import { createProjectSupplierBasis, getProjectSupplierInvoices } from '@/lib/supplier-invoices/projectServer'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, { params }: Params) {
  try { return NextResponse.json(await getProjectSupplierInvoices(await supplierInvoiceContext(), (await params).caseId), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (e) { return supplierInvoiceError(e) }
}
export async function POST(request: Request, { params }: Params) {
  try { return NextResponse.json(await createProjectSupplierBasis(await supplierInvoiceContext(), (await params).caseId, await supplierInvoiceRequestBody(request)), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (e) { return supplierInvoiceError(e) }
}
