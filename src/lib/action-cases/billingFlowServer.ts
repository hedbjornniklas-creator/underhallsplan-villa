import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { administrationUuid } from './projectCompletion'
import { applyBillingCommand, billingFail, billingValidateFlow, emptyBillingFlow, type BillingFlow, type BillingWorkspace } from './billingFlow'
import { billingSourceContext } from './billingFlowSources'

type Context = { orgId: string; userId: string }
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')) billingFail('SCHEMA_REQUIRED')
  throw new Error(error.message?.match(/BILLING_[A-Z_]+/)?.[0] || 'BILLING_FAILED')
}
export async function getBillingFlow(ctx: Context, caseId: string): Promise<BillingWorkspace> {
  if (!administrationUuid(caseId)) billingFail()
  const result = await createSupabaseAdminClient().rpc('read_project_billing_flow', { p_org: ctx.orgId, p_case: caseId, p_actor: ctx.userId })
  checked(result.error)
  const raw = result.data, flow: BillingFlow = raw.body ?? emptyBillingFlow()
  billingValidateFlow(flow)
  return { ...billingSourceContext(raw.source, ctx.userId), available: true, revision: raw.revision, contextHash: raw.contextHash, userId: ctx.userId, title: raw.source.title,
    flow, history: raw.history }
}
export async function writeBillingFlow(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  if (!administrationUuid(caseId) || !administrationUuid(payload.requestId) || !Number.isInteger(payload.revision) || Number(payload.revision) < 0 || typeof payload.contextHash !== 'string' || payload.contextHash.length !== 32) billingFail()
  const db = createSupabaseAdminClient(), data = await getBillingFlow(ctx, caseId)
  if (!data.canManage) billingFail('FORBIDDEN')
  // Retry identity is checked before applying a command against a newer revision.
  const previous = await db.from('action_case_billing_events').select('revision,request,actor_id').eq('id', payload.requestId).eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  checked(previous.error)
  if (previous.data) {
    const stable = (v: unknown): string => JSON.stringify(v, (_k, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
    if (previous.data.actor_id !== ctx.userId || stable(previous.data.request) !== stable(payload.command)) billingFail('STALE')
    return { revision: previous.data.revision }
  }
  if (data.revision !== payload.revision) billingFail('STALE')
  if (data.contextHash !== payload.contextHash) billingFail('SOURCE_CHANGED')
  const body = applyBillingCommand(data.flow, payload.command, data, new Date().toISOString())
  const result = await db.rpc('write_project_billing_flow', { p_org: ctx.orgId, p_case: caseId, p_actor: ctx.userId, p_revision: data.revision,
    p_request_id: payload.requestId, p_context_hash: data.contextHash, p_request: payload.command, p_body: body })
  checked(result.error)
  return result.data as { revision: number }
}
