import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { costCompletionPayload } from './costCompletion'

export async function setCostLineComplete(context: { orgId: string; userId: string }, input: Record<string, unknown>) {
  const body = costCompletionPayload(input)
  const { error } = await createSupabaseAdminClient().rpc('set_action_case_cost_complete', {
    p_org_id: context.orgId, p_user_id: context.userId, p_case_id: body.caseId, p_item_id: body.itemId,
    p_line_id: body.costLineId, p_expected_updated_at: body.expectedUpdatedAt, p_complete: body.complete,
  })
  if (error) {
    if (['PGRST202', '42883', '42P01', '42703'].includes(error.code)) throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
    throw new Error(error.message.match(/ACTION_CASE_(?:NOT_FOUND|ITEM_STALE|ITEM_LOCKED|COST_LINE_[A-Z_]+|QUOTE_COVERAGE)/)?.[0] ?? 'ACTION_CASE_COST_LINE_WRITE_FAILED')
  }
}
