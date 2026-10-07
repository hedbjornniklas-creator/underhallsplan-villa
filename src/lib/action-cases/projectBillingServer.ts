import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getOrganizationCustomerWorkspace } from '@/lib/customers/server'
import { parseOrganizationCustomerInput } from '@/lib/customers/domain'
import { offerId } from './customerOffers'
import type { ProjectBillingWorkspace } from './projectBilling'

type Context = { orgId: string; userId: string }
const missing = (code?: string) => ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code ?? '')

async function registryForProject(ctx: Context, caseId: string) {
  const { data, error } = await createSupabaseAdminClient().from('action_cases').select('id')
    .eq('org_id', ctx.orgId).eq('id', offerId(caseId)).maybeSingle()
  if (error) throw new Error('PROJECT_BILLING_FAILED')
  if (!data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  const registry = await getOrganizationCustomerWorkspace(ctx.orgId)
  if (registry.organization.id !== ctx.orgId) throw new Error('CUSTOMER_REGISTRY_FORBIDDEN')
  return registry
}

export async function getProjectBilling(ctx: Context, caseId: string): Promise<ProjectBillingWorkspace> {
  const registry = await registryForProject(ctx, caseId)
  const { data, error } = await createSupabaseAdminClient().from('action_case_billing').select('customer_id,revision')
    .eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  if (error && !missing(error.code)) throw new Error('PROJECT_BILLING_FAILED')
  return { registry, available: !error, customerId: data?.customer_id ?? null, revision: data?.revision ?? 0 }
}

export async function writeProjectBilling(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  if (!['existing', 'create', 'update'].includes(String(payload.mode)) ||
    !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0) throw new Error('CUSTOMER_OFFER_INVALID')
  const registry = await registryForProject(ctx, caseId)
  const mode = String(payload.mode)
  if (mode !== 'existing' && !registry.organization.canManage) throw new Error('CUSTOMER_REGISTRY_FORBIDDEN')
  const customerId = mode === 'create' ? null : offerId(payload.customerId)
  if (customerId && (!Number.isSafeInteger(payload.customerVersion) || Number(payload.customerVersion) < 1))
    throw new Error('CUSTOMER_OFFER_INVALID')
  const data = { revision: payload.revision, requestId: offerId(payload.requestId),
    ...(customerId ? { customerId, customerVersion: payload.customerVersion } : {}),
    ...(mode === 'existing' ? {} : { customer: parseOrganizationCustomerInput(payload.customer) }) }
  const result = await createSupabaseAdminClient().rpc('write_action_case_billing', {
    p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId, p_mode: mode, p_data: data
  })
  if (result.error) {
    if (missing(result.error.code)) throw new Error('PROJECT_BILLING_SCHEMA')
    if (result.error.code === '23505') throw new Error('CUSTOMER_IDENTITY_EXISTS')
    throw new Error(result.error.message?.match(/(?:PROJECT_BILLING|CUSTOMER_REGISTRY|CUSTOMER_OFFER)_[A-Z_]+/)?.[0] ?? 'PROJECT_BILLING_FAILED')
  }
}
