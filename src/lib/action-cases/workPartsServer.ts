import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizeWorkPartAction } from './workParts'
import type { WorkPartAction } from './workParts'

type Context = { orgId: string; userId: string }
type Payload = Record<string, unknown>

// The API supplies its existing requireOrgContext + requireModuleAccess context.
async function writeWorkPart(context: Context, action: WorkPartAction): Promise<string | void> {
  const { caseId, itemId, operation, ...data } = action
  const { data: result, error } = await createSupabaseAdminClient().rpc('write_action_case_work_part', {
    p_org_id: context.orgId, p_case_id: caseId, p_item_id: itemId, p_user_id: context.userId,
    p_operation: operation, p_data: data,
  })
  if (error) {
    if (['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'].includes(error.code)) throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
    const match = error.message.match(/ACTION_CASE_(?:WORK_PART_[A-Z_]+|ITEM_STALE|ITEM_LOCKED|COST_LINE_[A-Z_]+|QUOTE_COVERAGE|QUOTE_SENT_IMMUTABLE|PACKAGE_[A-Z_]+|NOT_FOUND)/)
    throw new Error(match?.[0] ?? 'ACTION_CASE_WORK_PART_WRITE_FAILED')
  }
  if (operation === 'save') {
    if (!result || typeof result.id !== 'string') throw new Error('ACTION_CASE_WORK_PART_WRITE_FAILED')
    return result.id
  }
}

/** save returns the part ID; delete/move_lines/bulk_update resolve without a value.
 * Every operation requires expectedUpdatedAt = item.updatedAt, not the part version.
 * Bulk fields are a common patch for all costLineIds; omitted fields stay unchanged.
 */
export async function handleWorkPartAction(context: Context, payload: Payload): Promise<string | void> {
  return writeWorkPart(context, normalizeWorkPartAction(payload))
}
