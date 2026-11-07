import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { administrationUuid, normalizeInvoiceBasis, type ProjectCompletionWorkspace } from './projectCompletion'

type Context = { orgId: string; userId: string }
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')) throw new Error('PROJECT_ADMIN_SCHEMA')
  throw new Error(error.message?.match(/PROJECT_ADMIN_[A-Z_]+/)?.[0] || 'PROJECT_ADMIN_FAILED')
}
async function access(ctx: Context, caseId: string) {
  if (!administrationUuid(caseId)) throw new Error('PROJECT_ADMIN_INVALID')
  const db = createSupabaseAdminClient()
  const member = await db.from('org_members').select('profile_id').eq('org_id', ctx.orgId).eq('profile_id', ctx.userId).eq('is_active', true).maybeSingle()
  checked(member.error)
  if (!member.data) throw new Error('PROJECT_ADMIN_FORBIDDEN')
  const project = await db.from('action_cases').select('id,title,status,manager_profile_id,customer_name').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle()
  checked(project.error)
  if (!project.data) throw new Error('PROJECT_ADMIN_NOT_FOUND')
  return { db, project: project.data }
}
export async function getProjectCompletion(ctx: Context, caseId: string): Promise<ProjectCompletionWorkspace> {
  const { db, project } = await access(ctx, caseId)
  const canManage = project.manager_profile_id === ctx.userId
  const completion = await db.from('action_case_completion').select('*').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  checked(completion.error)
  const bases = await db.from('action_case_invoice_basis').select('id,revision,body,updated_at').eq('org_id', ctx.orgId).eq('action_case_id', caseId).order('created_at', { ascending: false })
  checked(bases.error)
  const sourceLines = new Map<string, string[]>()
  if (bases.data?.length) for (let offset = 0; ; offset += 500) {
    const sources = await db.from('supplier_invoice_basis_sources').select('basis_id,line_id').eq('org_id', ctx.orgId).eq('action_case_id', caseId)
      .order('basis_id').order('line_id').range(offset, offset + 499)
    // Standalone manual bases remain usable before the additive supplier migration is deployed.
    if (sources.error && ['42P01', 'PGRST205'].includes(sources.error.code || '')) break
    checked(sources.error)
    for (const row of sources.data ?? []) sourceLines.set(row.basis_id, [...sourceLines.get(row.basis_id) ?? [], row.line_id])
    if ((sources.data?.length ?? 0) < 500) break
  }
  let openQuestions: number | null = null
  if (canManage) {
    const questions = await db.from('action_case_questions').select('body').eq('org_id', ctx.orgId).eq('action_case_id', caseId)
    checked(questions.error)
    openQuestions = (questions.data ?? []).filter(row => row.body?.status !== 'closed').length
  }
  const events = await db.from('action_case_administration_events').select('id,operation,actor_name,created_at').eq('org_id', ctx.orgId).eq('action_case_id', caseId).order('created_at', { ascending: false }).limit(30)
  checked(events.error)
  const sender = await db.from('action_case_contract_senders').select('snapshot').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  checked(sender.error)
  const billing = await db.from('action_case_billing').select('customer_id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  checked(billing.error)
  let recipient = project.customer_name || ''
  if (billing.data?.customer_id) {
    const customer = await db.from('organization_customers').select('name,address,postal_code,city,invoice_same_as_customer,invoice_name,invoice_address,invoice_postal_code,invoice_city').eq('org_id', ctx.orgId).eq('id', billing.data.customer_id).maybeSingle()
    checked(customer.error)
    if (customer.data) {
      const c = customer.data, same = c.invoice_same_as_customer
      recipient = [same ? c.name : c.invoice_name || c.name, same ? c.address : c.invoice_address, [same ? c.postal_code : c.invoice_postal_code, same ? c.city : c.invoice_city].filter(Boolean).join(' ')].filter(Boolean).join('\n')
    }
  }
  const s = sender.data?.snapshot
  let issuer = s ? [s.legalName || s.name, s.organizationNumber, s.address, [s.postalCode, s.city].filter(Boolean).join(' ')].filter(Boolean).join('\n') : ''
  if (!issuer) {
    const organization = await db.from('organizations').select('name').eq('id', ctx.orgId).maybeSingle()
    checked(organization.error); issuer = organization.data?.name || ''
  }
  const c = completion.data
  return { available: true, userId: ctx.userId, canManage, status: project.status, revision: c?.revision ?? 0,
    workComplete: c?.work_complete ?? false, invoiced: c?.invoiced ?? false, completedAt: c?.completed_at ?? null, openQuestions,
    bases: (bases.data ?? []).map(row => ({ id: row.id, revision: row.revision, body: normalizeInvoiceBasis(row.body), updatedAt: row.updated_at, sourceLineIds: sourceLines.get(row.id) ?? [] })),
    events: (events.data ?? []).map(e => ({ id: e.id, operation: e.operation, actor: e.actor_name, at: e.created_at })), defaults: { issuer, recipient } }
}
export async function writeProjectCompletion(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  await access(ctx, caseId)
  if (!administrationUuid(payload.requestId) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0) throw new Error('PROJECT_ADMIN_INVALID')
  const operation = payload.operation
  let request: Record<string, unknown> = { operation, revision: payload.revision, requestId: payload.requestId }
  if (operation === 'save_basis') {
    if (!administrationUuid(payload.id)) throw new Error('PROJECT_ADMIN_INVALID')
    request = { ...request, id: payload.id, body: normalizeInvoiceBasis(payload.body) }
  } else if (operation === 'flags') {
    if (typeof payload.workComplete !== 'boolean' || typeof payload.invoiced !== 'boolean') throw new Error('PROJECT_ADMIN_INVALID')
    request = { ...request, workComplete: payload.workComplete, invoiced: payload.invoiced }
  } else if ((operation === 'complete' || operation === 'reopen') && payload.confirmed === true) request.confirmed = true
  else throw new Error('PROJECT_ADMIN_INVALID')
  const result = await createSupabaseAdminClient().rpc('write_project_administration', { p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_request: request })
  checked(result.error)
  return result.data as { id?: string; revision: number; status: ProjectCompletionWorkspace['status'] }
}
