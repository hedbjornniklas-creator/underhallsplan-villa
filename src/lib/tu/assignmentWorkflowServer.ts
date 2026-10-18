import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { TuAssignmentWorkflow } from './assignmentWorkflow'

export async function tuWorkflowRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createSupabaseAdminClient().rpc(name as never, args as never)
  if (error) {
    console.error('[tu.assignment-workflow]', { name, error })
    if (error.code === 'PGRST202' || error.code === '42P01' || error.code === '42883') throw new Error('TU_WORKFLOW_UNAVAILABLE')
    if (/^(TU_[A-Z_]+|ASSIGNMENT_VERSION_CONFLICT)$/.test(error.message)) throw new Error(error.message)
    throw new Error('TU_WORKFLOW_UNAVAILABLE')
  }
  return data as T
}

export function getTuAssignmentWorkflow(inspectionId: string, orgId: string) {
  return tuWorkflowRpc<TuAssignmentWorkflow | null>('tu_assignment_workflow_state', { p_inspection_id: inspectionId, p_org_id: orgId })
}

export async function assertTuAssignmentDelivery(inspectionId: string, orgId: string) {
  const workflow = await getTuAssignmentWorkflow(inspectionId, orgId)
  if (workflow && !workflow.canDeliver) throw new Error('TU_DELIVERY_BLOCKED')
}
