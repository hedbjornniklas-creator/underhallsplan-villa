import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { ObAssignmentWorkflow } from './assignmentWorkflow'

export async function obWorkflowRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc(name as never, args as never)
  if (error) throw new Error(error.message)
  return data as T
}

export async function getObAssignmentWorkflow(inspectionId: string, orgId?: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('ob_assignment_workflows' as never)
    .select('org_id').eq('inspection_id', inspectionId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  if (orgId && (data as { org_id: string }).org_id !== orgId) throw new Error('OB_ASSIGNMENT_FORBIDDEN')
  return obWorkflowRpc<ObAssignmentWorkflow | null>('ob_assignment_workflow_state', { p_inspection_id: inspectionId })
}

export function obWorkflowError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const known: Record<string, [number, string]> = {
    OB_ASSIGNMENT_FORBIDDEN: [403, 'Endast ansvarig besiktningsman eller organisationsadministratör kan utföra åtgärden.'],
    ASSIGNMENT_NOT_FOUND: [404, 'Uppdraget hittades inte.'],
    OB_START_NOT_ALLOWED: [409, 'Uppdraget måste vara skickat eller bokat och får inte vara arkiverat.'],
    OB_EARLY_REASON_REQUIRED: [400, 'Ange en anledning till tidig start (5–1000 tecken).'],
    OB_APPROVAL_LINK_REQUIRED: [409, 'En giltig godkännandelänk saknas. Skapa och skicka en ny version av uppdragsbekräftelsen.'],
    OB_APPROVAL_REQUIRED: [409, 'Kundens godkännande och besiktningsmannens accept måste vara registrerade.'],
    OB_WORKFLOW_CHANGED: [409, 'Uppdragsbekräftelsen har ändrats. Uppdatera sidan och stäm av den aktuella versionen.'],
    OB_INSPECTION_LOCKED: [409, 'Besiktningen är låst. Lås upp den innan uppdragsbekräftelsen ändras.'],
  }
  return known[message] ?? null
}
