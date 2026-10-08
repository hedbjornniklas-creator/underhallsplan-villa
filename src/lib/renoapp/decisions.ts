export const FINAL_CASE_STATUSES = ['approved', 'conditional', 'approved_with_conditions', 'rejected']

export function isFinalCaseStatus(status: string) {
  return FINAL_CASE_STATUSES.includes(status)
}

export function decisionLabel(status: string) {
  if (status === 'approved') return 'Godkänd'
  if (status === 'conditional' || status === 'approved_with_conditions') return 'Godkänd med villkor'
  if (status === 'rejected') return 'Avslagen'
  return status
}

export type DecisionDeliveryStatus = 'unknown' | 'pending' | 'sent' | 'failed'

export type CaseDecision = {
  id: string
  decision: string
  reason: string | null
  conditions: string | null
  decidedAt: string
  deliveryStatus?: DecisionDeliveryStatus
  deliveryError?: string | null
}
