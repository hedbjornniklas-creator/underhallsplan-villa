export type AssignmentCustomerType = 'consumer' | 'business'

export const CONSUMER_WITHDRAWAL_INFORMATION_URL =
  'https://www.konsumentverket.se/lagar/lagen-om-distansavtal-och-avtal-utanfor-affarslokaler/'

export const CONSUMER_WITHDRAWAL_FORM_URL =
  'https://publikationer.konsumentverket.se/mallar-och-blanketter/angerblankett'

export const CONSUMER_WITHDRAWAL_ACKNOWLEDGEMENT_TEXT =
  'Jag har tagit del av informationen om ångerrätt.'

export const CONSUMER_EARLY_START_CONSENT_TEXT =
  'Jag begär uttryckligen att uppdraget får påbörjas under ångerfristen och förstår att jag kan behöva betala för arbete som redan har utförts om jag därefter ångrar avtalet. Jag är införstådd med att ångerrätten upphör när tjänsten har fullgjorts.'

function easterSunday(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return new Date(Date.UTC(year, Math.floor(n / 31) - 1, (n % 31) + 1))
}

function isSwedishNonBusinessDay(date: Date) {
  const day = date.getUTCDay()
  const month = date.getUTCMonth() + 1
  const dateOfMonth = date.getUTCDate()
  if (day === 0 || day === 6) return true
  if (
    ['1-1', '1-6', '5-1', '6-6', '12-24', '12-25', '12-26', '12-31'].includes(
      `${month}-${dateOfMonth}`
    )
  ) {
    return true
  }
  if (month === 6 && day === 5 && dateOfMonth >= 19 && dateOfMonth <= 25) return true

  const daysSinceEaster = Math.round(
    (date.getTime() - easterSunday(date.getUTCFullYear()).getTime()) / 86_400_000
  )
  return [-2, 1, 39].includes(daysSinceEaster)
}

export function resolveAssignmentCustomerType(
  assignmentType: string | null | undefined,
  assignmentDetails: Record<string, unknown> | null | undefined
): AssignmentCustomerType | null {
  const value = assignmentDetails?.customerType
  if (value === 'consumer' || value === 'business') return value

  // Older TU confirmations were created before customer type was stored. Treat
  // them conservatively as consumer agreements until explicitly classified.
  return assignmentType === 'TU' ? 'consumer' : null
}

export function getConsumerWithdrawalDeadline(
  acceptedAt: string | Date,
  fallback: Date | null = null
) {
  const instant = acceptedAt instanceof Date ? new Date(acceptedAt) : new Date(acceptedAt)
  if (Number.isNaN(instant.getTime())) return fallback

  const localDay = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
  const deadline = new Date(`${localDay}T12:00:00.000Z`)
  deadline.setUTCDate(deadline.getUTCDate() + 14)
  while (isSwedishNonBusinessDay(deadline)) deadline.setUTCDate(deadline.getUTCDate() + 1)
  return deadline
}

export function requiresConsumerEarlyStartConsent(
  preferredDate: string,
  acceptedAt: Date = new Date()
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return false

  const serviceDate = new Date(`${preferredDate}T12:00:00.000Z`)
  const deadline = getConsumerWithdrawalDeadline(acceptedAt)
  if (Number.isNaN(serviceDate.getTime()) || !deadline) return false

  return serviceDate.getTime() <= deadline.getTime()
}
