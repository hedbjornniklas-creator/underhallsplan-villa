import type { ObOverviewItem } from '@/lib/ob/overview'
import type { TuAssignmentListItem, TuInspectionSummary } from '@/lib/tu/server'
import type { EbProjectListItem } from '@/lib/eb/server'
import type { EbAssignmentConfirmationSummary } from '@/lib/eb/assignmentConfirmationTypes'
import type { MoistureProject } from '@/lib/moisture/domain'
import type { TaskWorkspace } from '@/lib/tasks/contracts'

export type DashboardModuleId = 'ob' | 'eb' | 'tu' | 'moisture' | 'tasks'
export type DashboardModule = {
  id: DashboardModuleId
  title: string
  code: string
  href: string
  active: boolean
  activeCount: number
  actionCount: number
}
export type DashboardAction = {
  id: string
  moduleId: DashboardModuleId
  title: string
  subtitle?: string
  nextStep: string
  category: 'inspection' | 'confirmation' | 'other'
  href: string
  actionLabel: string
  dueDate?: string
  priority: 'overdue' | 'today' | 'normal'
}
export type DashboardBooking = {
  id: string
  moduleId: DashboardModuleId
  title: string
  href: string
  /** Date-only when no visit time has been entered; otherwise an ISO timestamp. */
  startsAt: string
  endsAt?: string
  address?: string
  latitude?: number
  longitude?: number
  /** Legacy bookings without a status are confirmed. */
  status?: 'confirmed' | 'tentative'
  confirmationStatus?: string
}
/** Only the current confirmation, read inside the signed-in user's RLS boundary. */
export type DashboardConfirmationBookingSource = {
  status: string
  preferred_date: string | null
  preferred_time: string | null
  accepted_at: string | null
  booked_at: string | null
  last_sent_at: string | null
  archived_at: string | null
}
export type DashboardData = {
  modules: DashboardModule[]
  actions: DashboardAction[]
  bookings: DashboardBooking[]
  issues?: Array<{ moduleId: DashboardModuleId; message: string }>
  organizationId?: string
  today: string
}
export type DashboardModuleSummary = {
  activeCount: number
  actions: DashboardAction[]
  bookings: DashboardBooking[]
}

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
})
const wallTimeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const first = (...values: Array<string | null | undefined>) => values.find(value => value?.trim())?.trim() || ''
const joined = (...values: Array<string | null | undefined>) => values.filter(value => value?.trim()).join(' · ')
const closedStatuses = new Set(['completed', 'done', 'klar', 'archived', 'arkiverad', 'cancelled', 'canceled', 'avbokad', 'avbruten'])
const closed = (status: string | null | undefined) => closedStatuses.has(status?.trim().toLowerCase() || '')
const knownOpenStatus = (status: string | null | undefined) => ['draft', 'utkast', 'ongoing', 'in_progress', 'pågående', 'pågår'].includes(status?.trim().toLowerCase() || '')

export function getStockholmDate(value: Date | string | number = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : ''
  }
  if (typeof value === 'string' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !getStockholmDate(value.slice(0, 10)))) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = dateFormat.formatToParts(date)
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-')
}

/** Never invent a midnight appointment for a booking whose time is unknown. */
export function dashboardBookingStart(dateValue: string | null | undefined, timeValue?: string | null): string | undefined {
  if (!dateValue) return undefined
  const date = getStockholmDate(dateValue)
  if (!date) return undefined
  const time = timeValue?.trim()
  if (!time) return date
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) return date
  const normalized = time.length === 5 ? `${time}:00` : time
  // Validate both possible Swedish offsets. This also rejects the missing hour
  // when clocks move forward, without depending on the server's local timezone.
  for (const offset of ['+02:00', '+01:00']) {
    const candidate = `${date}T${normalized}${offset}`
    const parts = wallTimeFormat.formatToParts(new Date(candidate))
    const part = (key: string) => parts.find(item => item.type === key)?.value
    const rendered = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`
    if (rendered === `${date}T${normalized}`) return candidate
  }
  return date
}

export function dashboardPriority(dueDate: string | null | undefined, today: string): DashboardAction['priority'] {
  const date = dueDate ? getStockholmDate(dueDate) : ''
  if (!date) return 'normal'
  return date < today ? 'overdue' : date === today ? 'today' : 'normal'
}

function action(input: Omit<DashboardAction, 'priority' | 'dueDate'>, date: string | null | undefined, today: string): DashboardAction {
  const dueDate = date ? getStockholmDate(date) : ''
  return { ...input, ...(dueDate ? { dueDate } : {}), priority: dashboardPriority(dueDate, today) }
}
function inspectionNextStep(date: string | null | undefined, today: string, noun = 'besiktningen') {
  const priority = dashboardPriority(date, today)
  if (priority === 'overdue') return `Färdigställ ${noun} och utlåtandet`
  if (priority === 'today') return `Genomför ${noun}`
  return date ? `Förbered ${noun}` : `Planera och färdigställ ${noun}`
}
function confirmationNextStep(status: string, accepted: boolean): { nextStep: string; actionLabel: string } | null {
  if (status === 'draft' || status === 'not_created') return { nextStep: status === 'draft' ? 'Färdigställ och skicka uppdragsbekräftelsen' : 'Skapa uppdragsbekräftelsen', actionLabel: 'Hantera bekräftelse' }
  if (status === 'expired') return { nextStep: 'Förnya uppdragsbekräftelsen', actionLabel: 'Förnya bekräftelse' }
  if (status === 'sent' && !accepted) return { nextStep: 'Följ upp kundens godkännande', actionLabel: 'Följ upp' }
  return null
}

function tentativeConfirmation(source: DashboardConfirmationBookingSource | undefined, clientAcceptanceConfirms = false): string | undefined {
  if (!source || source.archived_at || ['draft', 'cancelled', 'completed'].includes(source.status)) return undefined
  if (source.status === 'expired' && source.last_sent_at) return 'Bekräftelselänken har gått ut'
  if (source.status === 'sent' && !source.accepted_at) return 'Inväntar kund'
  if (!clientAcceptanceConfirms && source.accepted_at && !source.booked_at && ['sent', 'ordered'].includes(source.status)) return 'Inväntar bokning'
  return undefined
}

function tentativeState(confirmationStatus: string): Pick<DashboardBooking, 'status' | 'confirmationStatus'> {
  return { status: 'tentative', confirmationStatus }
}

function draftConfirmation(source: DashboardConfirmationBookingSource | undefined): string | undefined {
  return source?.status === 'draft' && !source.archived_at ? 'Bekräftelse ej skickad' : undefined
}

export function buildObDashboard(items: ObOverviewItem[], times: Map<string, string | null>, today: string,
  inspectionDates?: Map<string, string | null>, confirmations?: Map<string, DashboardConfirmationBookingSource>): DashboardModuleSummary {
  const rows = items.filter(item => (!('canEdit' in item) || item.canEdit !== false) && !item.closed && !item.archived
    && !(item.confirmation.startsWith('Avbokad') && !item.inspectionHref))
  const actions: DashboardAction[] = [], bookings: DashboardBooking[] = []
  for (const row of rows) {
    const title = row.address === 'Adress saknas' ? first(row.customer, 'Överlåtelsebesiktning') : row.address
    const subtitle = joined(row.customer, row.city)
    const displayedDate = row.date ? getStockholmDate(row.date) : ''
    // The ordinary overview falls back to a customer's preferred date. Read the
    // actual inspection date separately so an unsent draft cannot move a visit.
    const sourceDate = row.inspectionHref && inspectionDates?.has(row.id) ? inspectionDates.get(row.id) : row.date
    const date = sourceDate ? getStockholmDate(sourceDate) : ''
    const cancelledConfirmation = row.confirmation.startsWith('Avbokad')
    const confirmation = confirmations?.get(row.id)
    // Older overview consumers do not supply raw confirmation metadata. Its
    // known sent/accepted labels can still prevent a pending visit appearing booked.
    const presentationPending = !confirmation && (['Inväntar kund', 'Länk behöver förnyas'].includes(row.confirmation)
      ? 'Inväntar kund' : row.confirmation === 'Godkänd av kund' ? 'Inväntar bokning'
        : row.inspectionHref && row.confirmation === 'Länken har gått ut' ? 'Bekräftelselänken har gått ut' : undefined)
    const draftStatus = !row.inspectionHref || !date ? draftConfirmation(confirmation)
      || (!confirmation && row.inspection === 'Ej startad' && row.confirmation === 'Utkast' ? 'Bekräftelse ej skickad' : undefined) : undefined
    const pendingConfirmation = tentativeConfirmation(confirmation) || presentationPending || draftStatus
    const confirmationPending = !cancelledConfirmation && (row.attention.length > 0 || row.confirmation === 'Inväntar kund'
      || (!row.inspectionHref && row.confirmationAction === 'Starta besiktning'))
    if (row.confirmationHref && confirmationPending) {
      const nextStep = row.attention[0] || (row.confirmation === 'Inväntar kund' ? 'Följ upp kundens godkännande' : 'Starta den bokade besiktningen')
      actions.push(action({ id: `ob:${row.id}:confirmation`, moduleId: 'ob', title, subtitle,
        nextStep, category: 'confirmation', href: row.confirmationHref,
        actionLabel: row.confirmation === 'Inväntar kund' ? 'Följ upp' : row.confirmationAction }, displayedDate, today))
    }
    if (row.inspectionHref) actions.push(action({ id: `ob:${row.id}:inspection`, moduleId: 'ob', title, subtitle,
      nextStep: cancelledConfirmation ? 'Kontrollera besiktningen efter avbokningen' : row.inspection === 'Status saknas' ? 'Kontrollera besiktningens status' : inspectionNextStep(date, today),
      category: 'inspection', href: row.inspectionHref, actionLabel: 'Öppna besiktning' }, cancelledConfirmation || row.inspection === 'Status saknas' ? undefined : date, today))
    // Current drafts and sent/reissued confirmations reserve their proposed
    // visit without asserting that it is booked. An existing visit keeps its
    // actual date while an attached confirmation remains an unsent draft.
    const missingInspectionDate = Boolean(row.inspectionHref && !date)
    const fallbackConfirmation = missingInspectionDate && confirmation && !confirmation.archived_at
      && ['sent', 'ordered', 'booked'].includes(confirmation.status)
      && (confirmation.last_sent_at || confirmation.accepted_at)
    const confirmationStatus = pendingConfirmation || (fallbackConfirmation ? 'Tid behöver bekräftas' : undefined)
    const bookingDate = confirmationStatus ? (confirmation ? confirmation.preferred_date : row.date) : date
    const bookingTime = confirmationStatus ? (confirmation ? confirmation.preferred_time : row.inspectionHref ? null : times.get(row.id)) : times.get(row.id)
    if (!cancelledConfirmation && confirmation?.status !== 'cancelled' && bookingDate
      && (confirmationStatus || row.inspectionHref || row.confirmation === 'Godkänd och accepterad')) {
      const startsAt = dashboardBookingStart(bookingDate, bookingTime)
      if (startsAt) bookings.push({ id: `ob:${row.id}`, moduleId: 'ob', title,
        href: confirmationStatus ? row.confirmationHref || row.inspectionHref || '/ob' : row.inspectionHref || row.confirmationHref || '/ob',
        startsAt, ...(confirmationStatus ? tentativeState(confirmationStatus) : {}),
        ...(row.address !== 'Adress saknas' ? { address: [row.address, row.city].filter(Boolean).join(', ') } : {}) })
    }
  }
  return { activeCount: rows.length, actions, bookings }
}

export function buildTuDashboard(orgId: string, assignments: TuAssignmentListItem[], investigations: TuInspectionSummary[], today: string): DashboardModuleSummary {
  const scoped = assignments.filter(item => item.org_id === orgId && item.assignment_type === 'TU')
  const byId = new Map(scoped.map(item => [item.id, item]))
  const byInspection = new Map(scoped.filter(item => item.inspection_id).map(item => [item.inspection_id, item]))
  const used = new Set<string>(), actions: DashboardAction[] = [], bookings: DashboardBooking[] = []
  let activeCount = 0
  const url = (path: string) => `${path}?orgId=${encodeURIComponent(orgId)}`
  for (const investigation of investigations) {
    const assignment = (investigation.assignmentId ? byId.get(investigation.assignmentId) : undefined) || byInspection.get(investigation.inspectionId)
    if (assignment) used.add(assignment.id)
    if (closed(investigation.status) || investigation.reportLockedAt) continue
    activeCount += 1
    const title = first(investigation.title, investigation.propertyAddress, 'Teknisk utredning')
    const address = first(investigation.propertyAddress, assignment?.property_address, assignment?.preliminary_address)
    const city = first(investigation.propertyCity, assignment?.property_city)
    const subtitle = joined(investigation.customerName || assignment?.customer_name, address)
    const href = url(`/tu/investigations/${encodeURIComponent(investigation.inspectionId)}`)
    const cancelledConfirmation = assignment?.status === 'cancelled'
    const next = assignment && !assignment.archived_at ? confirmationNextStep(assignment.status, Boolean(assignment.accepted_at)) : null
    if (next) actions.push(action({ id: `tu:${investigation.inspectionId}:confirmation`, moduleId: 'tu', title, subtitle,
      ...next, category: 'confirmation', href: url(`/tu/assignments/${encodeURIComponent(assignment!.id)}`) }, investigation.date, today))
    actions.push(action({ id: `tu:${investigation.inspectionId}:inspection`, moduleId: 'tu', title, subtitle,
      nextStep: cancelledConfirmation ? 'Kontrollera utredningen efter avbokningen' : knownOpenStatus(investigation.status) ? inspectionNextStep(investigation.date, today, 'utredningen') : 'Kontrollera utredningens status',
      category: 'inspection', href, actionLabel: 'Öppna utredning' }, !cancelledConfirmation && knownOpenStatus(investigation.status) ? investigation.date : undefined, today))
    const pendingConfirmation = tentativeConfirmation(assignment)
    const fallbackConfirmation = !investigation.date && assignment && !assignment.archived_at
      && ['sent', 'ordered', 'booked'].includes(assignment.status) && (assignment.last_sent_at || assignment.accepted_at)
    const confirmationStatus = pendingConfirmation || (fallbackConfirmation ? 'Tid behöver bekräftas' : undefined)
    const startsAt = cancelledConfirmation ? undefined : confirmationStatus
      ? dashboardBookingStart(assignment?.preferred_date, assignment?.preferred_time)
      : dashboardBookingStart(investigation.date, investigation.inspectionTime)
    if (startsAt) bookings.push({ id: `tu:${investigation.inspectionId}`, moduleId: 'tu', title,
      href: confirmationStatus && assignment ? url(`/tu/assignments/${encodeURIComponent(assignment.id)}`) : href, startsAt,
      ...(confirmationStatus ? tentativeState(confirmationStatus) : {}),
      ...(address ? { address: [address, city].filter(Boolean).join(', ') } : {}) })
  }
  for (const assignment of scoped) {
    if (used.has(assignment.id) || assignment.archived_at || ['cancelled', 'completed'].includes(assignment.status)) continue
    activeCount += 1
    const next = confirmationNextStep(assignment.status, Boolean(assignment.accepted_at)) || {
      nextStep: assignment.inspection_id ? 'Kontrollera den kopplade utredningen' : assignment.status === 'ordered' ? 'Starta den godkända utredningen' : 'Planera uppdraget och starta utredningen',
      actionLabel: 'Hantera uppdrag',
    }
    const title = first(assignment.property_address, assignment.preliminary_address, assignment.customer_name, 'Teknisk utredning')
    const href = url(`/tu/assignments/${encodeURIComponent(assignment.id)}`)
    actions.push(action({ id: `tu:${assignment.id}:confirmation`, moduleId: 'tu', title,
      subtitle: joined(assignment.customer_name, assignment.property_city), ...next, category: 'confirmation', href }, assignment.preferred_date, today))
    const confirmationStatus = tentativeConfirmation(assignment)
      || (assignment.status === 'draft' ? 'Bekräftelse ej skickad' : undefined)
    // A dated TU draft is also a planned visit. Keep it tentative and point to
    // the unsent confirmation; a linked investigation keeps its own visit above.
    if (confirmationStatus || (assignment.status === 'booked' && assignment.booked_at)) {
      const startsAt = dashboardBookingStart(assignment.preferred_date, assignment.preferred_time)
      const address = first(assignment.property_address, assignment.preliminary_address)
      if (startsAt) bookings.push({ id: `tu:assignment:${assignment.id}`, moduleId: 'tu', title, href, startsAt,
        ...(confirmationStatus ? tentativeState(confirmationStatus) : {}),
        ...(address ? { address: [address, assignment.property_city].filter(Boolean).join(', ') } : {}) })
    }
  }
  return { activeCount, actions, bookings }
}

export function buildEbDashboard(orgId: string, projects: EbProjectListItem[], confirmations: EbAssignmentConfirmationSummary[], today: string,
  confirmationBookings?: Map<string, DashboardConfirmationBookingSource>): DashboardModuleSummary {
  const byInspection = new Map(confirmations.map(item => [item.inspectionId, item]))
  const actions: DashboardAction[] = [], bookings: DashboardBooking[] = []
  let activeCount = 0
  for (const project of projects) {
    if (project.orgId !== orgId || closed(project.status)) continue
    const open = project.inspections.filter(item => !closed(item.status) && !item.reportLockedAt)
    if (project.inspections.length > 0 && open.length === 0) continue
    activeCount += open.length || 1
    const href = `/eb/projects/${encodeURIComponent(project.id)}`
    if (!project.inspections.length) actions.push(action({ id: `eb:${project.id}:project`, moduleId: 'eb', title: project.title,
      subtitle: joined(project.clientName, project.address), nextStep: 'Planera projektets första besiktning', category: 'other', href, actionLabel: 'Öppna projekt' }, undefined, today))
    for (const inspection of open) {
      const title = `${inspection.variantLabel} · ${project.title}`
      const subtitle = joined(inspection.clientName || project.clientName, project.address)
      const confirmation = byInspection.get(inspection.inspectionId)
      const bookingSource = confirmation ? confirmationBookings?.get(confirmation.assignmentId) : undefined
      const cancelledConfirmation = confirmation?.status === 'cancelled'
      const next = confirmationNextStep(confirmation?.status || 'not_created', Boolean(confirmation?.acceptedAt))
      if (next) actions.push(action({ id: `eb:${inspection.inspectionId}:confirmation`, moduleId: 'eb', title, subtitle,
        ...next, category: 'confirmation', href }, inspection.date, today))
      const inspectionHref = `${href}/inspections/${encodeURIComponent(inspection.inspectionId)}/perform`
      actions.push(action({ id: `eb:${inspection.inspectionId}:inspection`, moduleId: 'eb', title, subtitle,
        nextStep: cancelledConfirmation ? 'Kontrollera besiktningen efter avbokningen' : knownOpenStatus(inspection.status) ? inspectionNextStep(inspection.date, today) : 'Kontrollera besiktningens status',
        category: 'inspection', href: inspectionHref, actionLabel: 'Öppna besiktning' }, !cancelledConfirmation && knownOpenStatus(inspection.status) ? inspection.date : undefined, today))
      // EB accepts the customer's order directly; there is no separate internal
      // booking step. A sent confirmation still uses its current proposal slot.
      const pendingConfirmation = tentativeConfirmation(bookingSource, true) || (!bookingSource && confirmation
        && (confirmation.status === 'sent' && !confirmation.acceptedAt ? 'Inväntar kund'
          : confirmation.status === 'expired' && confirmation.lastSentAt ? 'Bekräftelselänken har gått ut' : undefined))
      // "draft" is also the report's editing state after an accepted booking.
      // Only the initial unsent confirmation (or an initial inspection without
      // one) makes its planned visit tentative. A reissue or an existing sent
      // invitation must not displace an actual visit while it is still unsent.
      const currentStatus = bookingSource?.status || confirmation?.status || 'not_created'
      const initialDraft = ['draft', 'utkast'].includes(inspection.status?.trim().toLowerCase() || '')
        && !inspection.invitationSentAt && !inspection.invitationDate && (confirmation?.versionNo ?? 1) === 1
        && ['draft', 'not_created'].includes(currentStatus)
      const missingInspectionDate = !inspection.date || !getStockholmDate(inspection.date)
      const draftStatus = !bookingSource?.archived_at && initialDraft ? 'Bekräftelse ej skickad'
        : missingInspectionDate ? draftConfirmation(bookingSource) : undefined
      const fallbackConfirmation = missingInspectionDate && bookingSource && !bookingSource.archived_at
        && ['sent', 'ordered', 'booked'].includes(bookingSource.status) && (bookingSource.last_sent_at || bookingSource.accepted_at)
      const confirmationStatus = pendingConfirmation || draftStatus || (fallbackConfirmation ? 'Tid behöver bekräftas' : undefined)
      let startsAt: string | undefined
      if (!cancelledConfirmation && bookingSource?.status !== 'cancelled' && !(initialDraft && bookingSource?.archived_at)) {
        if (draftStatus) {
          startsAt = bookingSource?.preferred_date
            ? dashboardBookingStart(bookingSource.preferred_date, bookingSource.preferred_time)
            : dashboardBookingStart(inspection.date, inspection.inspectionTime || inspection.startMeetingTime)
        } else if (confirmationStatus) {
          startsAt = dashboardBookingStart(bookingSource ? bookingSource.preferred_date : inspection.date, bookingSource ? bookingSource.preferred_time : null)
        } else startsAt = dashboardBookingStart(inspection.date, inspection.inspectionTime || inspection.startMeetingTime)
      }
      if (startsAt) bookings.push({ id: `eb:${inspection.inspectionId}`, moduleId: 'eb', title, href: confirmationStatus ? href : inspectionHref, startsAt,
        ...(confirmationStatus ? tentativeState(confirmationStatus) : {}),
        ...(project.address ? { address: [project.address, project.postalCode, project.city].filter(Boolean).join(', ') } : {}) })
    }
  }
  return { activeCount, actions, bookings }
}

export function buildMoistureDashboard(orgId: string, projects: MoistureProject[], today: string): DashboardModuleSummary {
  const rows = projects.filter(project => project.orgId === orgId && project.status !== 'archived')
  return { activeCount: rows.length, bookings: [], actions: rows.map(project => action({
    id: `moisture:${project.id}`, moduleId: 'moisture', title: project.title,
    subtitle: joined(project.customer?.name, project.property.address),
    nextStep: project.status === 'draft' ? 'Färdigställ uppdragets uppgifter' : 'Fortsätt fuktsäkerhetsarbetet',
    category: 'other', href: `/fuktsakerhet/projekt/${encodeURIComponent(project.id)}?orgId=${encodeURIComponent(orgId)}`, actionLabel: 'Öppna uppdrag',
  }, undefined, today)) }
}

export function buildTaskDashboard(workspace: TaskWorkspace, today: string): DashboardModuleSummary {
  const tasks = workspace.tasks.filter(task => !['approved', 'cancelled'].includes(task.status))
  const actions: DashboardAction[] = []
  for (const task of tasks) {
    const isIssuer = task.issuerId === workspace.currentUser.id
    const isAssignee = task.assignee.kind === 'profile' && task.assignee.id === workspace.currentUser.id
    const pendingDeadline = task.deadlineRequests.some(request => request.status === 'pending')
    const review = task.status === 'ready_for_review'
    const hasBall = (task.ballHolder === 'issuer' && isIssuer) || (task.ballHolder === 'assignee' && isAssignee)
    const needsFollowup = isIssuer && dashboardPriority(task.nextFollowupAt, today) !== 'normal'
    const deliveryProblem = task.notificationDeliveryProblemCount > 0 && isIssuer
    const pendingSend = isIssuer && task.initialDispatchPending
    const unread = task.unreadMessageCount > 0 && (isIssuer || isAssignee)
    const suggestions = isIssuer && task.aiSuggestions.length > 0
    if (!hasBall && !needsFollowup && !pendingSend && !unread && !suggestions && !(isIssuer && (pendingDeadline || deliveryProblem))) continue
    let nextStep = 'Fortsätt arbetet och uppdatera status'
    if (pendingDeadline && isIssuer) nextStep = 'Hantera begäran om nytt slutdatum'
    else if (deliveryProblem) nextStep = 'Kontrollera det misslyckade utskicket'
    else if (pendingSend) nextStep = 'Skicka uppgiften till mottagaren'
    else if (task.status === 'draft') nextStep = 'Färdigställ och tilldela uppgiften'
    else if (review && isIssuer) nextStep = 'Kontrollera och godkänn färdigbeviset'
    else if (unread) nextStep = 'Läs och hantera det nya meddelandet'
    else if (suggestions) nextStep = 'Ta ställning till Gizmos förslag'
    else if (task.status === 'returned' && isAssignee) nextStep = 'Komplettera uppgiften enligt återkopplingen'
    else if (task.status === 'waiting' || needsFollowup) nextStep = 'Följ upp uppgiftens nästa steg'
    actions.push(action({ id: `tasks:${task.id}`, moduleId: 'tasks', title: task.title,
      subtitle: joined(task.contextLabel, task.assignee.name), nextStep, category: 'other',
      href: `/uppdrag?task=${encodeURIComponent(task.id)}`, actionLabel: review && isIssuer ? 'Granska uppgift' : 'Öppna uppgift',
    }, task.dueAt, today))
  }
  return { activeCount: tasks.length, actions, bookings: [] }
}

export function sortDashboardActions(actions: DashboardAction[]): DashboardAction[] {
  const priority = { overdue: 0, today: 1, normal: 2 }
  return [...actions].sort((left, right) => priority[left.priority] - priority[right.priority]
    || (left.dueDate || '9999').localeCompare(right.dueDate || '9999')
    || left.title.localeCompare(right.title, 'sv-SE') || left.id.localeCompare(right.id))
}
