import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizeQuotePackageAction } from './quotePackages'

export async function handleQuotePackageAction(context: { orgId: string; userId: string }, payload: Record<string, unknown>) {
  const input = normalizeQuotePackageAction(payload)
  const { data, error } = await createSupabaseAdminClient().rpc('write_action_case_quote_package', {
    p_org_id: context.orgId, p_case_id: input.caseId, p_request_id: input.requestId,
    p_user_id: context.userId, p_operation: input.operation, p_data: input,
  })
  if (error) {
    if (['PGRST202', '42883', '42P01'].includes(error.code)) throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
    throw new Error(error.message.match(/ACTION_CASE_(?:PACKAGE_[A-Z_]+|REQUEST_[A-Z_]+|QUOTE_[A-Z_]+|NOT_FOUND|FILE_NOT_FOUND|ITEM_LOCKED)/)?.[0] ?? 'ACTION_CASE_PACKAGE_WRITE_FAILED')
  }
  return data as { requestId: string; groupKey: string; quoteId: string; state: 'active' | 'removed'; updatedAt: string }
}
