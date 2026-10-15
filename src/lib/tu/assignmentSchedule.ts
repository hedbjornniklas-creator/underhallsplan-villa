import type { AssignmentStatus } from '@/lib/assignments/server'

export type TuAssignmentSchedule = {
  id: string
  org_id: string
  status: AssignmentStatus
  accepted_at: string | null
  archived_at: string | null
  updated_at: string
  preferred_date: string | null
  preferred_time: string | null
  customer_email: string
}

export type TuScheduleValues = { preferredDate: string; preferredTime: string }

export function canEditTuSchedule(assignment: TuAssignmentSchedule) {
  return ['draft', 'sent'].includes(assignment.status) && !assignment.accepted_at && !assignment.archived_at
}

export function tuScheduleValues(assignment: TuAssignmentSchedule): TuScheduleValues {
  return { preferredDate: assignment.preferred_date ?? '', preferredTime: assignment.preferred_time?.slice(0, 5) ?? '' }
}

export function validTuSchedule(values: TuScheduleValues) {
  const date = values.preferredDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 1000) return false
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date &&
    (!values.preferredTime || /^([01]\d|2[0-3]):[0-5]\d$/.test(values.preferredTime))
}

export function tuScheduleKey(values: TuScheduleValues) {
  return `${values.preferredDate}|${values.preferredTime}`
}

export function formatTuSchedule(values: TuScheduleValues) {
  if (!validTuSchedule(values)) return 'Datum saknas'
  const date = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' })
    .format(new Date(`${values.preferredDate}T12:00:00Z`))
  return values.preferredTime ? `${date} kl. ${values.preferredTime}` : date
}

export const TU_SCHEDULE_ERRORS: Record<string, { status: number; message: string }> = {
  TU_SCHEDULE_INVALID: { status: 400, message: 'Ange ett giltigt datum och en giltig tid, eller lämna tiden tom.' },
  TU_SCHEDULE_NOT_FOUND: { status: 404, message: 'Uppdragsbekräftelsen hittades inte.' },
  TU_SCHEDULE_LOCKED: { status: 409, message: 'Datum och tid kan bara ändras innan kunden har godkänt uppdragsbekräftelsen.' },
  TU_SCHEDULE_CONFLICT: { status: 409, message: 'Uppdragsbekräftelsen har ändrats. Hämta aktuella uppgifter innan du fortsätter.' },
  TU_SCHEDULE_NOT_SENT: { status: 409, message: 'Skicka uppdragsbekräftelsen innan du meddelar kunden om en ändrad tid.' },
  TU_SCHEDULE_EMAIL_REQUIRED: { status: 400, message: 'Uppdragsbekräftelsen saknar en giltig e-postadress till kunden.' },
}
