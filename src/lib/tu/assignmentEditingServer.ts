import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { AssignmentDetails } from '@/lib/assignments/server'

export async function editTuPendingAssignment(input: {
  orgId: string; assignmentId: string; actor: string; expectedUpdatedAt: string; patch: Record<string, unknown>
}): Promise<AssignmentDetails> {
  const { data, error } = await createSupabaseAdminClient().rpc('tu_edit_pending_assignment', {
    p_org_id: input.orgId, p_assignment_id: input.assignmentId, p_actor: input.actor,
    p_expected_updated_at: input.expectedUpdatedAt, p_patch: input.patch,
  })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) throw new Error('TU_ASSIGNMENT_EDIT_MIGRATION_REQUIRED')
    throw new Error(error.message)
  }
  if (!data || typeof data !== 'object' || data.id !== input.assignmentId || data.org_id !== input.orgId) {
    throw new Error('TU_ASSIGNMENT_EDIT_RESULT_INVALID')
  }
  return data as AssignmentDetails
}
