import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { offerId } from './customerOffers'
import { normalizeProjectCustomerPricing } from './projectCustomerPricing'
import { contractWorkError } from './contractWorkServer'

export async function saveProjectCustomerPricing(ctx: { orgId: string; userId: string }, payload: Record<string, unknown>) {
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0 || typeof payload.adopt !== 'boolean' ||
    !payload.documentRevisions || typeof payload.documentRevisions !== 'object' || Array.isArray(payload.documentRevisions)) throw new Error('CUSTOMER_OFFER_INVALID')
  const documents = payload.documentRevisions as Record<string, unknown>
  for (const key of ['offer', 'contract']) if (documents[key] !== null && (!Number.isSafeInteger(documents[key]) || Number(documents[key]) < 1)) throw new Error('CUSTOMER_OFFER_INVALID')
  const { data, error } = await createSupabaseAdminClient().rpc('write_project_customer_price', {
    p_org_id: ctx.orgId, p_case_id: offerId(payload.caseId), p_user_id: ctx.userId, p_item_id: offerId(payload.itemId),
    p_revision: payload.revision, p_terms: normalizeProjectCustomerPricing(payload.terms), p_documents: documents,
    p_adopt: payload.adopt, p_request_id: offerId(payload.requestId),
  })
  if (error?.message?.match(/PROJECT_PRICE_[A-Z_]+/)) throw new Error(error.message.match(/PROJECT_PRICE_[A-Z_]+/)![0])
  contractWorkError(error)
  if (!data || data.itemId !== payload.itemId || data.requestId !== payload.requestId || data.revision !== Number(payload.revision) + 1) throw new Error('PROJECT_PRICE_UNCONFIRMED')
  return data
}
