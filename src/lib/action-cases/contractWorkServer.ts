import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { offerId } from './customerOffers'
import { contractWorkPriceInput, type ContractWorkLink } from './contractWork'

type Context = { orgId: string; userId: string }
export function contractWorkError(error: { code?: string; message?: string } | null) {
  if (!error) return
  const code = error.message?.match(/(?:ACTION_CASE_CONTRACT_[A-Z_]+|CUSTOMER_OFFER_[A-Z_]+)/)?.[0]
  if (code) throw new Error(code)
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')) throw new Error('ACTION_CASE_CONTRACT_SCHEMA')
  if (['40001', '40P01'].includes(error.code || '')) throw new Error('CUSTOMER_OFFER_STALE')
  throw new Error('ACTION_CASE_CONTRACT_READ_FAILED')
}

export async function getContractWorkLinks(ctx: Context, caseId?: string): Promise<Record<string, ContractWorkLink>> {
  const { data, error } = await createSupabaseAdminClient().rpc('get_contract_work_links', {
    p_org_id: ctx.orgId, p_user_id: ctx.userId, p_case_id: caseId ?? null,
  })
  // Do not present an apparently editable workspace if its locks cannot be read.
  contractWorkError(error)
  if (data?.available !== true || !data.links || typeof data.links !== 'object' || Array.isArray(data.links)) throw new Error('ACTION_CASE_CONTRACT_READ_FAILED')
  return data.links as Record<string, ContractWorkLink>
}

export async function writeContractWorkPrice(ctx: Context, payload: Record<string, unknown>) {
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) throw new Error('CUSTOMER_OFFER_INVALID')
  const { error } = await createSupabaseAdminClient().rpc('write_contract_work_price', {
    p_org_id: ctx.orgId, p_case_id: offerId(payload.caseId), p_user_id: ctx.userId,
    p_item_id: offerId(payload.itemId), p_revision: payload.revision, p_price: contractWorkPriceInput(payload.price),
  })
  contractWorkError(error)
}

const mutations = new Set(['save_item_scope', 'update_item', 'delete_item', 'create_cost_line', 'delete_cost_line', 'update_cost_line',
  'set_cost_line_complete', 'generate_cost_suggestions', 'apply_cost_suggestions', 'work_quote', 'send_quote_request', 'quote_request',
  'work_part', 'quote_package', 'send_grouped_quote_request'])

export async function assertContractWorkMutation(ctx: Context, action: string, payload: Record<string, unknown>) {
  if (!mutations.has(action)) return
  const links = await getContractWorkLinks(ctx, typeof payload.caseId === 'string' ? offerId(payload.caseId) : undefined)
  const ids = new Set<string>(typeof payload.itemId === 'string' ? [payload.itemId] : [])
  const addLines = (lines: unknown) => {
    if (Array.isArray(lines)) for (const line of lines) if (typeof line?.itemId === 'string') ids.add(line.itemId)
  }
  addLines(payload.lines)
  if (typeof payload.requestId === 'string') {
    const { data, error } = await createSupabaseAdminClient().from('action_case_quote_requests').select('lines').eq('org_id', ctx.orgId).eq('id', offerId(payload.requestId)).maybeSingle()
    contractWorkError(error); addLines(data?.lines)
  }
  if (typeof payload.costLineId === 'string') {
    const { data, error } = await createSupabaseAdminClient().from('action_case_cost_lines').select('action_case_item_id').eq('org_id', ctx.orgId).eq('id', offerId(payload.costLineId)).maybeSingle()
    contractWorkError(error); if (data) ids.add(data.action_case_item_id)
  }
  if ([...ids].some(id => links[id.toLowerCase()]?.locked)) throw new Error('ACTION_CASE_CONTRACT_LOCKED')
}
