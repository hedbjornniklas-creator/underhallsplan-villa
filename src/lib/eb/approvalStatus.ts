export const EB_APPROVAL_STATUS_VALUES = ['approved', 'not_approved', 'interrupted'] as const

export type EbApprovalStatus = (typeof EB_APPROVAL_STATUS_VALUES)[number]

const EB_LEGACY_PARTLY_APPROVED_STATUS = 'partly_approved'

export function isEbLegacyPartlyApprovedStatus(
  value: unknown
): value is typeof EB_LEGACY_PARTLY_APPROVED_STATUS {
  return value === EB_LEGACY_PARTLY_APPROVED_STATUS
}

export function normalizeEbApprovalStatus(
  value: string | null | undefined
): EbApprovalStatus | null {
  const normalized = value?.trim() || null
  return EB_APPROVAL_STATUS_VALUES.includes(normalized as EbApprovalStatus)
    ? (normalized as EbApprovalStatus)
    : null
}

export function toEbApprovalStatusStorageValue(
  value: string | null | undefined
): EbApprovalStatus | null {
  return normalizeEbApprovalStatus(value)
}

export function ebApprovalStatusLabel(value: EbApprovalStatus | null) {
  if (value === 'approved') return 'Godkänd'
  if (value === 'not_approved') return 'Ej godkänd'
  if (value === 'interrupted') return 'Avbruten'
  return null
}

export function ebApprovalDecisionHeading(value: unknown) {
  if (value === 'approved') return 'Arbetena godkänns'
  if (value === 'not_approved') return 'Arbetena godkänns inte'
  if (value === 'interrupted') return 'Besiktningen avbryts'
  if (isEbLegacyPartlyApprovedStatus(value)) return 'Arbetena godkänns delvis'
  return null
}

export function ebApprovalStatusUsesObstacleExplanation(value: unknown) {
  return value === 'not_approved' || isEbLegacyPartlyApprovedStatus(value)
}
