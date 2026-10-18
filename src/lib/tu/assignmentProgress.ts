import type { AssignmentListItem } from '@/lib/assignments/server'

export type TuAssignmentProgress = {
  available: boolean
  approvalVerified: boolean
  approvalRecorded?: boolean
  earlyStarted?: boolean
  linkState: 'active' | 'expired' | 'used' | 'revoked' | 'missing'
  linkExpiresAt: string | null
}

export type TuProgressAssignment = Pick<AssignmentListItem,
  'id' | 'status' | 'accepted_at' | 'booked_at' | 'inspection_id' | 'archived_at'> & {
  last_sent_at?: string | null
  progress?: TuAssignmentProgress
}

export type TuAssignmentAction = 'send' | 'book' | 'receipt' | 'bookingReceipt' | 'reissue' | 'cancel' | 'archive' | 'restore'

export function tuAssignmentState(assignment: TuProgressAssignment) {
  const { progress, status, archived_at: archived } = assignment
  const verified = Boolean(assignment.accepted_at && progress?.available && progress.approvalVerified)
  let label = 'Godkännande behöver kontrolleras'
  let attention: string | null = 'Kontrollera uppdragsbekräftelsen'
  if (status === 'cancelled') { label = 'Avbokad'; attention = null }
  else if (status === 'draft' && !assignment.accepted_at && !progress?.approvalRecorded) { label = 'Utkast'; attention = 'Färdigställ uppdragsbekräftelsen' }
  else if (!progress?.available) { label = 'Status behöver hämtas'; attention = 'Uppdatera status' }
  else if (verified) {
    label = assignment.booked_at ? 'Godkänd och accepterad' : 'Godkänd av kund'
    attention = assignment.inspection_id ? null : assignment.booked_at ? 'Starta utredningen' : 'Acceptera uppdraget'
    if (progress.earlyStarted && !assignment.booked_at) attention = 'Acceptera uppdraget'
  } else if (!assignment.accepted_at && !progress.approvalRecorded && ['sent', 'expired'].includes(status)) {
    label = progress.linkState === 'active' ? 'Inväntar kund' : progress.linkState === 'expired' ? 'Länken har gått ut' : 'Länk behöver förnyas'
    attention = progress.linkState === 'active' ? null : 'Förnya godkännandelänken'
    if (progress.earlyStarted && progress.linkState === 'active') { label = 'Startad · inväntar kund'; attention = 'Kundgodkännande saknas' }
  }
  return { label: archived ? `Arkiverad · ${label}` : label, attention: archived ? null : attention, verified }
}

export function canTuAssignmentAction(assignment: TuProgressAssignment, action: TuAssignmentAction) {
  if (action === 'restore') return Boolean(assignment.archived_at)
  if (assignment.archived_at) return false
  if (action === 'archive') return !['sent', 'ordered', 'booked'].includes(assignment.status)
  if (action === 'cancel') return assignment.status !== 'cancelled'
  const verified = tuAssignmentState(assignment).verified
  if (action === 'send') return Boolean(assignment.progress?.available) && !assignment.accepted_at && !assignment.progress?.approvalRecorded && ['draft', 'sent', 'expired'].includes(assignment.status)
  if (action === 'book') return verified && assignment.status === 'ordered' && !assignment.booked_at && (!assignment.inspection_id || assignment.progress?.earlyStarted === true)
  if (action === 'receipt') return verified && ['ordered', 'booked', 'completed'].includes(assignment.status)
  if (action === 'bookingReceipt') return verified && Boolean(assignment.booked_at) && ['booked', 'completed'].includes(assignment.status)
  return (!assignment.inspection_id || assignment.progress?.earlyStarted === true) && ['sent', 'expired', 'ordered', 'booked'].includes(assignment.status)
}

export function canStartTuBeforeApproval(assignment: TuProgressAssignment) {
  return assignment.status === 'sent' && !assignment.inspection_id && !assignment.archived_at && !assignment.accepted_at
    && assignment.progress?.available === true && !assignment.progress.approvalRecorded && assignment.progress.linkState === 'active'
}

export function canEditTuAssignmentDetails(assignment: TuProgressAssignment) {
  return !assignment.archived_at && !assignment.accepted_at && !assignment.progress?.approvalRecorded && !assignment.last_sent_at && assignment.status === 'draft'
}

export const TU_ACTION_LABELS: Record<TuAssignmentAction, string> = {
  send: 'Skicka uppdragsbekräftelse', book: 'Acceptera uppdrag', receipt: 'Skicka godkännandebekräftelse igen',
  bookingReceipt: 'Skicka uppdragsaccept igen',
  reissue: 'Skapa ny version', cancel: 'Avboka uppdrag', archive: 'Arkivera', restore: 'Återför från arkiv',
}

export function tuSendLabel(assignment: TuProgressAssignment) {
  if (assignment.status === 'draft') return TU_ACTION_LABELS.send
  return assignment.progress?.linkState === 'active' ? 'Skicka om uppdragsbekräftelse' : 'Förnya och skicka bekräftelse'
}

export type TuAssignmentMessage = {
  id: string; created_at: string; sent_at: string | null; recipient_email: string
  template_key: string; status: string
}

export function tuMessageLabel(template: string) {
  const labels: Record<string, string> = {
    assignment_confirmation: 'Uppdragsbekräftelse', assignment_accept_notice: 'Godkänd bekräftelse',
    assignment_order_receipt: 'Accepterat uppdrag', assignment_cancelled_notice: 'Avbokning',
    tu_assignment_schedule_notice: 'Ändrad tid',
  }
  return labels[template] ?? 'Meddelande'
}
