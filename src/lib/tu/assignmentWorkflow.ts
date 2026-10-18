import type { ObAssignmentWorkflow } from '@/lib/ob/assignmentWorkflow'

export type TuAssignmentWorkflow = ObAssignmentWorkflow

export function validateTuEarlyStart(value: unknown, confirmed: unknown): string | null {
  if (value === undefined && confirmed === undefined) return null
  if (typeof value !== 'string' || confirmed !== true) throw new Error('TU_EARLY_REASON_REQUIRED')
  const reason = value.trim()
  if (reason.length < 5 || reason.length > 1000) throw new Error('TU_EARLY_REASON_REQUIRED')
  return reason
}

export function tuAssignmentWorkflowError(error: unknown): [number, string] | null {
  const message = error instanceof Error ? error.message : ''
  const errors: Record<string, [number, string]> = {
    TU_ASSIGNMENT_FORBIDDEN: [403, 'Endast ansvarig besiktningsman eller organisationsadministratör kan utföra åtgärden.'],
    TU_START_NOT_ALLOWED: [409, 'Uppdraget måste vara aktuellt och skickat innan det kan startas.'],
    TU_EARLY_REASON_REQUIRED: [400, 'Ange en anledning (5–1000 tecken) och bekräfta start utan kundens godkännande.'],
    TU_APPROVAL_LINK_REQUIRED: [409, 'Kundens godkännandelänk behöver förnyas. Skicka om bekräftelsen först.'],
    TU_APPROVAL_REQUIRED: [409, 'Kundens godkännande och besiktningsmannens accept behöver registreras först.'],
    TU_WORKFLOW_CHANGED: [409, 'Uppgifterna har ändrats. Öppna avstämningen igen och kontrollera den aktuella versionen.'],
    TU_DELIVERY_BLOCKED: [409, 'Uppdragets godkännande och avstämning måste vara klara före slutleverans.'],
    TU_WORK_PAUSED: [409, 'Arbetet är pausat. Kontrollera uppdragsbekräftelsen.'],
    TU_WORKFLOW_UNAVAILABLE: [503, 'Uppdragsstatus kunde inte hämtas. Försök uppdatera sidan eller kontakta administratören.'],
    TU_REPORT_LOCKED: [409, 'Lås upp utlåtandet innan uppdragsbekräftelsen ändras.'],
    TU_WORKFLOW_LINK_IMMUTABLE: [409, 'Uppdragets koppling har ändrats. Uppdatera sidan och kontrollera uppdragsbekräftelsen.'],
    TU_WORKFLOW_SERVER_WRITE_REQUIRED: [403, 'Ändringen behöver göras via uppdragsbekräftelsens åtgärder.'],
    TU_ASSIGNMENT_NOT_FOUND: [404, 'Uppdraget hittades inte i den valda organisationen.'],
  }
  return errors[message] ?? null
}
