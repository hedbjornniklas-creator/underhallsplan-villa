import type { EbProjectListItem, EbInspectionSummary } from './server'
import type { EbAssignmentConfirmationSummary } from './assignmentConfirmationTypes'
// @ts-expect-error Node's strip-types runner requires the explicit extension.
import { getEbInspectionLifecycle } from './inspectionLifecycle.ts'

export type EbDashboardConfirmationBookingSource = {
  status: string
  preferred_date: string | null
  preferred_time: string | null
  accepted_at: string | null
  booked_at: string | null
  last_sent_at: string | null
  archived_at: string | null
}
export type EbDashboardAction = {
  id: string
  moduleId: 'eb'
  title: string
  subtitle?: string
  nextStep: string
  category: 'inspection' | 'confirmation' | 'other'
  href: string
  actionLabel: string
  dueDate?: string
  priority: 'overdue' | 'today' | 'normal'
}
export type EbDashboardBooking = {
  id: string
  moduleId: 'eb'
  title: string
  href: string
  startsAt: string
  address?: string
  status?: 'confirmed' | 'tentative'
  confirmationStatus?: string
}
export type EbDashboardSummary = {
  activeCount: number
  actions: EbDashboardAction[]
  bookings: EbDashboardBooking[]
}
export type EbDashboardInspection = Pick<EbInspectionSummary,
  'inspectionId' | 'variantLabel' | 'status' | 'date' | 'clientName' | 'inspectionTime' | 'startMeetingTime'
  | 'reportLockedAt' | 'reportReopenedAt' | 'reportDeliveryStatus' | 'reportPdfStatus' | 'reportLastSentAt'>
  & Partial<Pick<EbInspectionSummary, 'invitationSentAt' | 'invitationDate'>>
export type EbDashboardProject = Pick<EbProjectListItem,
  'id' | 'orgId' | 'status' | 'title' | 'clientName' | 'address' | 'postalCode' | 'city'> & {
  inspections: EbDashboardInspection[]
}

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
})
const wallTimeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const joined = (...values: Array<string | null | undefined>) => values.filter(value => value?.trim()).join(' · ')
const knownOpenStatus = (status: string | null | undefined) => ['draft', 'utkast', 'ongoing', 'in_progress', 'pågående', 'pågår'].includes(status?.trim().toLowerCase() || '')

function stockholmDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : ''
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !stockholmDate(value.slice(0, 10))) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = dateFormat.formatToParts(date)
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-')
}

/** Keep a date-only visit date-only; never invent a midnight appointment. */
function bookingStart(value: string | null | undefined, timeValue?: string | null): string | undefined {
  const date = value ? stockholmDate(value) : ''
  if (!date) return undefined
  const time = timeValue?.trim()
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) return date
  const normalized = time.length === 5 ? `${time}:00` : time
  for (const offset of ['+02:00', '+01:00']) {
    const candidate = `${date}T${normalized}${offset}`
    const parts = wallTimeFormat.formatToParts(new Date(candidate))
    const part = (key: string) => parts.find(item => item.type === key)?.value
    if (`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}` === `${date}T${normalized}`) return candidate
  }
  return date
}

function action(input: Omit<EbDashboardAction, 'priority' | 'dueDate'>, value: string | null | undefined, today: string): EbDashboardAction {
  const dueDate = value ? stockholmDate(value) : ''
  return { ...input, ...(dueDate ? { dueDate } : {}), priority: !dueDate ? 'normal' : dueDate < today ? 'overdue' : dueDate === today ? 'today' : 'normal' }
}

function confirmationNextStep(status: string, accepted: boolean) {
  if (status === 'draft' || status === 'not_created') return { nextStep: status === 'draft' ? 'Färdigställ och skicka uppdragsbekräftelsen' : 'Skapa uppdragsbekräftelsen', actionLabel: 'Hantera bekräftelse' }
  if (status === 'expired') return { nextStep: 'Förnya uppdragsbekräftelsen', actionLabel: 'Förnya bekräftelse' }
  if (status === 'sent' && !accepted) return { nextStep: 'Följ upp kundens godkännande', actionLabel: 'Följ upp' }
  return null
}

function tentativeConfirmation(source: EbDashboardConfirmationBookingSource | undefined): string | undefined {
  if (!source || source.archived_at || ['draft', 'cancelled', 'completed'].includes(source.status)) return undefined
  if (source.status === 'expired' && source.last_sent_at) return 'Bekräftelselänken har gått ut'
  if (source.status === 'sent' && !source.accepted_at) return 'Inväntar kund'
  return undefined
}

/** Pure EB adapter, shared with the common dashboard without depending on its UI. */
export function buildEbDashboard(orgId: string, projects: EbDashboardProject[], confirmations: EbAssignmentConfirmationSummary[], today: string,
  confirmationBookings?: Map<string, EbDashboardConfirmationBookingSource>): EbDashboardSummary {
  const byInspection = new Map(confirmations.map(item => [item.inspectionId, item]))
  const actions: EbDashboardAction[] = [], bookings: EbDashboardBooking[] = []
  let activeCount = 0
  for (const project of projects) {
    if (project.orgId !== orgId) continue
    const projectLifecycle = getEbInspectionLifecycle({}, project.status)
    if (['archived', 'cancelled'].includes(projectLifecycle.workStatus)) continue
    const href = `/eb/projects/${encodeURIComponent(project.id)}`
    if (!project.inspections.length && !['completed', 'done', 'klar'].includes(project.status?.trim().toLowerCase() || '')) {
      actions.push(action({ id: `eb:${project.id}:project`, moduleId: 'eb', title: project.title,
        subtitle: joined(project.clientName, project.address), nextStep: 'Planera projektets första besiktning', category: 'other', href, actionLabel: 'Öppna projekt' }, undefined, today))
    }
    for (const inspection of project.inspections) {
      const lifecycle = getEbInspectionLifecycle(inspection, project.status)
      const title = `${inspection.variantLabel} · ${project.title}`
      const subtitle = joined(inspection.clientName || project.clientName, project.address)
      const inspectionHref = `${href}/inspections/${encodeURIComponent(inspection.inspectionId)}/perform`
      if (!lifecycle.isOpen) {
        if (lifecycle.deliveryAction) actions.push(action({ id: `eb:${inspection.inspectionId}:delivery`, moduleId: 'eb', title, subtitle,
          nextStep: lifecycle.deliveryAction, category: 'other', href: `${href}/inspections/${encodeURIComponent(inspection.inspectionId)}/report`, actionLabel: 'Hantera leverans' }, undefined, today))
        continue
      }
      activeCount += 1
      const confirmation = byInspection.get(inspection.inspectionId)
      const bookingSource = confirmation ? confirmationBookings?.get(confirmation.assignmentId) : undefined
      const cancelledConfirmation = confirmation?.status === 'cancelled'
      const next = lifecycle.isReopened ? null : confirmationNextStep(confirmation?.status || 'not_created', Boolean(confirmation?.acceptedAt))
      if (next) actions.push(action({ id: `eb:${inspection.inspectionId}:confirmation`, moduleId: 'eb', title, subtitle,
        ...next, category: 'confirmation', href }, inspection.date, today))
      const date = inspection.date ? stockholmDate(inspection.date) : ''
      const inspectionNextStep = !date ? 'Planera och färdigställ besiktningen' : date < today ? 'Färdigställ besiktningen och utlåtandet' : date === today ? 'Genomför besiktningen' : 'Förbered besiktningen'
      actions.push(action({ id: `eb:${inspection.inspectionId}:inspection`, moduleId: 'eb', title, subtitle,
        nextStep: lifecycle.isReopened ? 'Färdigställ ändringarna och lås utlåtandet' : cancelledConfirmation ? 'Kontrollera besiktningen efter avbokningen' : knownOpenStatus(inspection.status) ? inspectionNextStep : 'Kontrollera besiktningens status',
        category: 'inspection', href: inspectionHref, actionLabel: 'Öppna besiktning' }, !lifecycle.isReopened && !cancelledConfirmation && knownOpenStatus(inspection.status) ? inspection.date : undefined, today))
      // Reopened authoring is work, not a new visit at the original report date.
      if (lifecycle.isReopened) continue
      const pendingConfirmation = tentativeConfirmation(bookingSource) || (!bookingSource && confirmation
        && (confirmation.status === 'sent' && !confirmation.acceptedAt ? 'Inväntar kund'
          : confirmation.status === 'expired' && confirmation.lastSentAt ? 'Bekräftelselänken har gått ut' : undefined))
      // Preserve the shared dashboard's draft reservations. Report drafts after
      // acceptance and unsent reissues do not displace an existing visit.
      const currentStatus = bookingSource?.status || confirmation?.status || 'not_created'
      const initialDraft = ['draft', 'utkast'].includes(inspection.status?.trim().toLowerCase() || '')
        && !inspection.invitationSentAt && !inspection.invitationDate && (confirmation?.versionNo ?? 1) === 1
        && ['draft', 'not_created'].includes(currentStatus)
      const missingInspectionDate = !inspection.date || !stockholmDate(inspection.date)
      const draftStatus = !bookingSource?.archived_at && initialDraft ? 'Bekräftelse ej skickad'
        : missingInspectionDate && bookingSource?.status === 'draft' && !bookingSource.archived_at ? 'Bekräftelse ej skickad' : undefined
      const fallbackConfirmation = missingInspectionDate && bookingSource && !bookingSource.archived_at
        && ['sent', 'ordered', 'booked'].includes(bookingSource.status) && (bookingSource.last_sent_at || bookingSource.accepted_at)
      const confirmationStatus = pendingConfirmation || draftStatus || (fallbackConfirmation ? 'Tid behöver bekräftas' : undefined)
      let startsAt: string | undefined
      if (!cancelledConfirmation && bookingSource?.status !== 'cancelled' && !(initialDraft && bookingSource?.archived_at)) {
        if (draftStatus) {
          startsAt = bookingSource?.preferred_date
            ? bookingStart(bookingSource.preferred_date, bookingSource.preferred_time)
            : bookingStart(inspection.date, inspection.inspectionTime || inspection.startMeetingTime)
        } else if (confirmationStatus) {
          startsAt = bookingStart(bookingSource ? bookingSource.preferred_date : inspection.date, bookingSource ? bookingSource.preferred_time : null)
        } else startsAt = bookingStart(inspection.date, inspection.inspectionTime || inspection.startMeetingTime)
      }
      if (startsAt) bookings.push({ id: `eb:${inspection.inspectionId}`, moduleId: 'eb', title, href: confirmationStatus ? href : inspectionHref, startsAt,
        ...(confirmationStatus ? { status: 'tentative' as const, confirmationStatus } : {}),
        ...(project.address ? { address: [project.address, project.postalCode, project.city].filter(Boolean).join(', ') } : {}) })
    }
  }
  return { activeCount, actions, bookings }
}
