import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getOrganizationCustomerWorkspace } from '@/lib/customers/server'
import { parseOrganizationCustomerInput } from '@/lib/customers/domain'
import { normalizeCustomerOffer, offerId } from './customerOffers'
import { normalizeCustomerOfferCosting } from './customerOfferCosting'
import { contractCustomerInput, parseContractCustomerBinding, copyRegistryCustomer } from './customerRegistry'

type Context = { orgId: string; userId: string }

export async function writeContractCustomer(ctx: Context, caseId: string, payload: Record<string, unknown>, bind = false) {
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0) throw new Error('CUSTOMER_OFFER_INVALID')
  let draft = normalizeCustomerOffer(payload.draft)
  if (!draft.contractParties) throw new Error('CUSTOMER_OFFER_INVALID')
  const binding = bind ? parseContractCustomerBinding(payload.binding) : null
  let customerInput
  let includeIdentity = false
  if (binding) {
    // Use the same organization and customer-register permissions as Settings and TU.
    const registry = await getOrganizationCustomerWorkspace(ctx.orgId)
    if (registry.organization.id !== ctx.orgId) throw new Error('CUSTOMER_REGISTRY_FORBIDDEN')
    includeIdentity = registry.organization.canManage
    if (binding.mode === 'create') {
      if (!includeIdentity) throw new Error('CUSTOMER_REGISTRY_FORBIDDEN')
      customerInput = parseOrganizationCustomerInput(contractCustomerInput(draft.contractParties))
      if (!customerInput.email) throw new Error('CUSTOMER_REGISTRY_CONTACT_INVALID')
    } else {
      const customer = registry.customers.find((row) => row.id === binding.customerId && row.isActive && row.customerType === 'private')
      if (!customer) throw new Error('CUSTOMER_REGISTRY_NOT_FOUND')
      if (customer.version !== binding.customerVersion) throw new Error('CUSTOMER_REGISTRY_STALE')
      draft = normalizeCustomerOffer({ ...draft, contractParties: copyRegistryCustomer(draft.contractParties, customer) })
    }
  }
  const costing = payload.costing === undefined ? undefined : normalizeCustomerOfferCosting(payload.costing, draft.items)
  const result = await createSupabaseAdminClient().rpc('write_action_case_contract_customer', {
    p_org_id: ctx.orgId, p_case_id: offerId(caseId), p_user_id: ctx.userId,
    p_mode: binding?.mode ?? 'save',
    p_data: { revision: payload.revision, body: draft, ...(costing === undefined ? {} : { costing }),
      ...(binding ? { requestId: offerId(payload.requestId), binding, customerInput, includeIdentity } : {}) }
  })
  if (result.error) {
    if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(result.error.code)) throw new Error('CUSTOMER_REGISTRY_SCHEMA')
    if (result.error.code === '23505') throw new Error('CUSTOMER_IDENTITY_EXISTS')
    const code = result.error.message?.match(/(?:CUSTOMER_REGISTRY|CUSTOMER_OFFER)_[A-Z_]+/)?.[0]
    throw new Error(code ?? 'CUSTOMER_REGISTRY_FAILED')
  }
}
