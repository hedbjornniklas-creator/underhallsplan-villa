import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { administrationUuid, normalizeInvoiceBasis } from '@/lib/action-cases/projectCompletion'
import { getSupplierInvoiceWorkspace } from './server'
import type { ProjectInvoiceWorkspace, SupplierInvoiceBasisLink } from './contracts'

type Context = { orgId: string; userId: string }
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')) throw new Error('INVOICE_SCHEMA_REQUIRED')
  throw new Error(error.message?.match(/INVOICE_[A-Z_]+|PROJECT_ADMIN_[A-Z_]+/)?.[0] || 'INVOICE_FAILED')
}
async function context(ctx: Context, caseId: string) {
  if (!administrationUuid(caseId)) throw new Error('INVOICE_INVALID')
  const result = await createSupabaseAdminClient().rpc('project_supplier_invoice_context', { p_org: ctx.orgId, p_case: caseId, p_actor: ctx.userId })
  checked(result.error)
  return result.data as Pick<ProjectInvoiceWorkspace, 'userId' | 'status' | 'targets'>
}
export async function getProjectSupplierInvoices(ctx: Context, caseId: string): Promise<ProjectInvoiceWorkspace> {
  const project = await context(ctx, caseId), all = await getSupplierInvoiceWorkspace(ctx), db = createSupabaseAdminClient()
  const links: SupplierInvoiceBasisLink[] = []
  for (let offset = 0; ; offset += 500) {
    const result = await db.from('supplier_invoice_basis_sources').select('invoice_id,allocation_id,basis_id,line_id,customer_net_ore,agreement')
      .eq('org_id', ctx.orgId).eq('action_case_id', caseId).order('invoice_id').order('allocation_id').range(offset, offset + 499)
    checked(result.error)
    const page = result.data ?? []
    links.push(...page.map(r => ({ invoiceId: r.invoice_id, allocationId: r.allocation_id, basisId: r.basis_id, lineId: r.line_id, customerNetOre: Number(r.customer_net_ore), agreement: r.agreement })))
    if (page.length < 500) break
  }
  return { ...project, invoices: all.invoices.filter(i => i.allocations.some(a => a.caseId === caseId)), links }
}
export async function createProjectSupplierBasis(ctx: Context, caseId: string, value: Record<string, unknown>) {
  await context(ctx, caseId)
  if (!administrationUuid(value.id) || !administrationUuid(value.requestId) || value.confirmed !== true || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 100) throw new Error('INVOICE_INVALID')
  const sources = value.sources.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVOICE_INVALID')
    const s = raw as Record<string, unknown>
    for (const key of ['invoiceId', 'allocationId', 'lineId']) if (!administrationUuid(s[key])) throw new Error('INVOICE_INVALID')
    if (!Number.isSafeInteger(s.revision) || Number(s.revision) < 1 || typeof s.markupPercent !== 'number' || !Number.isFinite(s.markupPercent) || s.markupPercent < 0 || s.markupPercent > 1000 || Math.abs(s.markupPercent * 100 - Math.round(s.markupPercent * 100)) > .00001 || ![0, 6, 12, 25].includes(Number(s.vatRate)) || typeof s.vatRate !== 'number' || typeof s.description !== 'string' || !s.description.trim() || s.description.length > 1500 || typeof s.agreement !== 'string' || !s.agreement.trim() || s.agreement.length > 1000) throw new Error('INVOICE_INVALID')
    if (s.part !== undefined && !['combined', 'labour', 'material'].includes(String(s.part))) throw new Error('INVOICE_INVALID')
    return { invoiceId: s.invoiceId, allocationId: s.allocationId, lineId: s.lineId, revision: s.revision, part: s.part ?? 'combined', markupPercent: s.markupPercent, vatRate: s.vatRate, description: s.description.trim(), agreement: s.agreement.trim() }
  })
  const request = { id: value.id, requestId: value.requestId, confirmed: true, body: normalizeInvoiceBasis(value.body), sources }
  const result = await createSupabaseAdminClient().rpc('create_supplier_invoice_basis', { p_org: ctx.orgId, p_case: caseId, p_actor: ctx.userId, p_request: request })
  checked(result.error)
  return result.data as { id: string; revision: number }
}
