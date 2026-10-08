import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizePropertyDetails, type ProjectPropertyLink, type RegisteredProperty } from '@/lib/properties/identity'
import { normalizeCustomerOffer, offerId } from './customerOffers'
import { normalizeCustomerOfferCosting } from './customerOfferCosting'

type Context = { orgId: string; userId: string }
const missing = (code?: string) => ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code ?? '')
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (missing(error.code)) throw new Error('PROPERTY_SCHEMA')
  throw new Error(error.message?.match(/(?:PROPERTY|CUSTOMER_OFFER)_[A-Z_]+/)?.[0] ?? 'PROPERTY_FAILED')
}

export async function getProjectPropertyLink(propertyId: string | null, available: boolean): Promise<ProjectPropertyLink> {
  if (!available || !propertyId) return { available, property: null }
  const { data, error } = await createSupabaseAdminClient().from('properties')
    .select('id,name,municipality,cadastral_id,address,postal_code,city').eq('id', propertyId).maybeSingle()
  checked(error)
  if (!data) throw new Error('PROPERTY_NOT_FOUND')
  return { available, property: { id: data.id, name: data.name ?? '', municipality: data.municipality ?? '',
    cadastralDesignation: data.cadastral_id ?? '', street: data.address ?? '', postalCode: data.postal_code ?? '', city: data.city ?? '' } }
}

export async function getProjectProperties(ctx: Context, caseId: string): Promise<RegisteredProperty[]> {
  const { data, error } = await createSupabaseAdminClient().rpc('action_case_property_options', {
    p_org_id: ctx.orgId, p_case_id: offerId(caseId), p_user_id: ctx.userId
  })
  checked(error)
  return (data ?? []) as RegisteredProperty[]
}

export async function bindProjectProperty(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0 ||
    !payload.binding || typeof payload.binding !== 'object' || Array.isArray(payload.binding)) throw new Error('CUSTOMER_OFFER_INVALID')
  const binding = payload.binding as Record<string, unknown>
  if (!['existing', 'create'].includes(String(binding.mode))) throw new Error('PROPERTY_INVALID')
  const draft = normalizeCustomerOffer(payload.draft)
  if (!draft.contractDetails) throw new Error('PROPERTY_INVALID')
  if (!draft.contractDetails.property && draft.contractDetails.fields.property.text) {
    draft.contractDetails.propertyReference = draft.contractDetails.fields.property.text
  }
  const property = normalizePropertyDetails(binding.property)
  const { error } = await createSupabaseAdminClient().rpc('write_action_case_contract_property', {
    p_org_id: ctx.orgId, p_case_id: offerId(caseId), p_user_id: ctx.userId, p_mode: binding.mode,
    p_data: { revision: payload.revision, body: draft, requestId: offerId(binding.requestId), property,
      ...(binding.mode === 'existing' ? { propertyId: offerId(binding.propertyId) } : {}),
      ...(payload.costing === undefined ? {} : { costing: normalizeCustomerOfferCosting(payload.costing, draft.items) }) }
  })
  checked(error)
}
