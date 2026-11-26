import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizeCustomerPresentation, type ProjectCustomerPresentation } from './customerPresentation'
import { offerId } from './customerOffers'

type Context = { orgId: string; userId: string }
export async function getProjectCustomerPresentation(ctx: Context, caseId: string): Promise<ProjectCustomerPresentation> {
  const result = await createSupabaseAdminClient().from('action_case_customer_presentations').select('revision,value')
    .eq('org_id', ctx.orgId).eq('action_case_id', offerId(caseId)).maybeSingle()
  if (result.error) {
    if (['42P01', 'PGRST205'].includes(result.error.code)) return { available: false, revision: 0, value: null }
    throw new Error('CUSTOMER_PRESENTATION_FAILED')
  }
  return { available: true, revision: result.data?.revision ?? 0, value: result.data ? normalizeCustomerPresentation(result.data.value) : null }
}
export function parseCustomerPresentationRequest(value: Record<string, unknown>) {
  if (Object.keys(value).length !== 7 || !['revision', 'contractRevision', 'offerRevision'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0 && Number(value[key]) < 2147483647)) throw new Error('CUSTOMER_PRESENTATION_INVALID')
  const customerId = value.customerId === null ? null : offerId(value.customerId)
  if (customerId ? !Number.isSafeInteger(value.customerVersion) || Number(value.customerVersion) < 1 : value.customerVersion !== null) throw new Error('CUSTOMER_PRESENTATION_INVALID')
  return { requestId: offerId(value.requestId), revision: Number(value.revision), contractRevision: Number(value.contractRevision), offerRevision: Number(value.offerRevision),
    value: normalizeCustomerPresentation(value.value), customerId, customerVersion: value.customerVersion as number | null }
}
export async function selectProjectCustomerPresentation(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  const result = await createSupabaseAdminClient().rpc('select_project_customer_presentation', {
    p_org_id: ctx.orgId, p_case_id: offerId(caseId), p_user_id: ctx.userId, p_data: parseCustomerPresentationRequest(payload) })
  if (result.error) {
    if (['42883', 'PGRST202'].includes(result.error.code)) throw new Error('CUSTOMER_PRESENTATION_SCHEMA')
    throw new Error(result.error.message?.match(/(?:CUSTOMER_(?:PRESENTATION|OFFER|REGISTRY)_[A-Z_]+)/)?.[0] ?? 'CUSTOMER_PRESENTATION_FAILED')
  }
}
