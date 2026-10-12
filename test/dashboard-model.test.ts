import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { buildObDashboard, buildTuDashboard, buildEbDashboard, buildMoistureDashboard, buildTaskDashboard, dashboardBookingStart, dashboardPriority, getStockholmDate } from '../src/lib/dashboard/model.ts'
import type { ObOverviewItem } from '../src/lib/ob/overview'
import type { EbProjectListItem } from '../src/lib/eb/server'
import type { EbAssignmentConfirmationSummary } from '../src/lib/eb/assignmentConfirmationTypes'
import type { MoistureProject } from '../src/lib/moisture/domain'
import type { TaskView, TaskWorkspace } from '../src/lib/tasks/contracts'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { tuAssignment, tuInvestigation, tuPreviewOrg } from './fixtures/tu-overview-data.ts'

const today = '2026-10-12'

test('Stockholm dates cross UTC midnight correctly and invalid dates are never overdue', () => {
  assert.equal(getStockholmDate('2026-10-11T22:30:00Z'), today)
  assert.equal(getStockholmDate('2026-12-10T23:30:00Z'), '2026-12-11')
  assert.equal(getStockholmDate(today), today)
  for (const invalid of ['2026-02-30', '2026-02-30T10:00:00Z', '2026', 'Monday', '2026-10-12T10:00:00']) {
    assert.equal(getStockholmDate(invalid), '')
    assert.equal(dashboardPriority(invalid, today), 'normal')
  }
})

test('bookings retain real summer/winter clock times and dates with no entered time', () => {
  assert.equal(dashboardBookingStart(today, '09:30'), '2026-10-12T09:30:00+02:00')
  assert.equal(dashboardBookingStart('2026-12-12', '09:30:00'), '2026-12-12T09:30:00+01:00')
  assert.equal(dashboardBookingStart(today), today)
  assert.equal(dashboardBookingStart(today, '26:99'), today)
  assert.equal(dashboardBookingStart('2026-03-29', '02:30'), '2026-03-29')
  assert.equal(dashboardBookingStart('2026-02-30', '09:30'), undefined)
})

function ob(overrides: Partial<ObOverviewItem> = {}): ObOverviewItem {
  return { id: 'assignment:a', date: today, createdAt: today, address: 'Testgatan 1', city: 'Stockholm', customer: 'Kund',
    assignmentNumber: '', confirmation: 'Utkast', inspection: 'Ej startad', confirmationHref: '/ob/assignments/a', inspectionHref: null,
    confirmationAction: 'Öppna bekräftelse', attention: ['Färdigställ uppdragsbekräftelsen'], closed: false, archived: false, marker: 'attention', ...overrides }
}
test('OB excludes cancelled/completed rows and requested confirmation dates are not appointments', () => {
  const result = buildObDashboard([ob(), ob({ id: 'b', closed: true }), ob({ id: 'c', confirmation: 'Avbokad' }),
    ob({ id: 'inspection:d', inspection: 'Pågår', inspectionHref: '/properties/p/ob/d', confirmation: 'Inväntar kund', attention: [] })],
  new Map([['inspection:d', '13:15']]), today)
  assert.equal(result.activeCount, 2)
  assert.equal(result.actions.filter(item => item.category === 'confirmation').length, 2)
  assert.equal(result.actions.filter(item => item.category === 'inspection').length, 1)
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].startsAt, '2026-10-12T13:15:00+02:00')
  assert.equal(result.bookings[0].address, 'Testgatan 1, Stockholm')
})

test('OB overview preferred-date fallback cannot fabricate a booking on an unscheduled inspection', () => {
  const row = ob({ id: 'inspection:d', date: '2020-01-01', inspection: 'Pågår', inspectionHref: '/properties/p/ob/d' })
  const result = buildObDashboard([row], new Map([['inspection:d', '13:00']]), today, new Map([['inspection:d', null]]))
  assert.equal(result.activeCount, 1)
  assert.equal(result.bookings.length, 0)
  const inspection = result.actions.find(item => item.category === 'inspection')!
  assert.equal(inspection.priority, 'normal')
  assert.equal(inspection.dueDate, undefined)
  assert.equal(inspection.nextStep, 'Planera och färdigställ besiktningen')
  assert.ok(result.actions.some(item => item.category === 'confirmation'), 'draft confirmation attention remains visible')
})

test('OB converted confirmation marked completed keeps a live started inspection active', () => {
  const result = buildObDashboard([ob({ id: 'inspection:d', inspection: 'Pågår', confirmation: 'Godkänd och accepterad',
    inspectionHref: '/properties/p/ob/d', attention: [], confirmationAction: 'Öppna bekräftelse' })], new Map(), today,
  new Map([['inspection:d', today]]))
  assert.equal(result.activeCount, 1)
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].category, 'inspection')
  assert.equal(result.bookings.length, 1)
})

test('OB cancellation cannot hide a separately open inspection or imply a booked visit', () => {
  const result = buildObDashboard([ob({ id: 'inspection:d', inspection: 'Pågår', confirmation: 'Avbokad',
    inspectionHref: '/properties/p/ob/d', attention: ['Bekräftelsen behöver uppdateras'] })], new Map(), today,
  new Map([['inspection:d', today]]))
  assert.equal(result.activeCount, 1)
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].nextStep, 'Kontrollera besiktningen efter avbokningen')
  assert.equal(result.actions[0].priority, 'normal')
  assert.equal(result.bookings.length, 0)
})

test('TU deduplicates linked work, renews expired confirmations and preserves an open investigation with archived confirmation', () => {
  const assignment = tuAssignment({ inspection_id: 'inspection-1', status: 'draft', preferred_date: today })
  const result = buildTuDashboard(tuPreviewOrg, [assignment, tuAssignment({ id: 'expired', status: 'expired' }),
    tuAssignment({ id: 'completed', status: 'completed' }), tuAssignment({ id: 'foreign', org_id: 'other' })],
  [tuInvestigation({ date: today, inspectionTime: '11:00', assignmentId: assignment.id })], today)
  assert.equal(result.activeCount, 2)
  assert.equal(result.bookings.length, 1)
  assert.ok(result.actions.some(item => item.nextStep === 'Förnya uppdragsbekräftelsen'))
  for (const row of [...result.actions, ...result.bookings]) assert.equal(new URL(row.href, 'https://example.invalid').searchParams.get('orgId'), tuPreviewOrg)
  const archived = buildTuDashboard(tuPreviewOrg, [tuAssignment({ inspection_id: 'inspection-1', archived_at: today })], [tuInvestigation()], today)
  assert.equal(archived.activeCount, 1)
  assert.equal(archived.actions.filter(item => item.category === 'confirmation').length, 0)
  assert.equal(buildTuDashboard(tuPreviewOrg, [], [tuInvestigation({ status: 'completed' })], today).activeCount, 0)
})

test('TU includes unbooked unfinished work while excluding preferred dates from calendar', () => {
  const result = buildTuDashboard(tuPreviewOrg, [tuAssignment({ status: 'draft', preferred_date: today })],
    [tuInvestigation({ inspectionId: 'unlinked', assignmentId: null, date: null })], today)
  assert.equal(result.activeCount, 2)
  assert.equal(result.bookings.length, 0)
  assert.equal(result.actions.find(item => item.category === 'inspection')?.dueDate, undefined)
  assert.equal(result.actions.find(item => item.category === 'inspection')?.priority, 'normal')
})

test('unknown inspection states request verification without asserting overdue unfinished work', () => {
  const result = buildTuDashboard(tuPreviewOrg, [], [tuInvestigation({ status: 'unknown', date: '2020-01-01' })], today)
  assert.equal(result.actions[0].nextStep, 'Kontrollera utredningens status')
  assert.equal(result.actions[0].priority, 'normal')
})

function eb(overrides: Partial<EbProjectListItem> = {}): EbProjectListItem {
  return { id: 'p', orgId: tuPreviewOrg, title: 'Takrenovering', status: 'active', address: 'Takvägen 2', postalCode: '123 45', city: 'Stockholm',
    inspections: [{ inspectionId: 'i', status: 'draft', reportLockedAt: null, date: today, inspectionTime: '08:00', variantLabel: 'Slutbesiktning', clientName: 'Kund' }],
    ...overrides } as EbProjectListItem
}
test('EB distinguishes current confirmation states and excludes closed/foreign work', () => {
  const projects = [eb(), eb({ id: 'closed', status: 'Klar' }), eb({ id: 'foreign', orgId: 'other' })]
  const missing = buildEbDashboard(tuPreviewOrg, projects, [], today)
  assert.equal(missing.activeCount, 1)
  assert.equal(missing.actions[0].nextStep, 'Skapa uppdragsbekräftelsen')
  assert.equal(missing.bookings.length, 1)
  const approved = buildEbDashboard(tuPreviewOrg, projects, [{ inspectionId: 'i', status: 'ordered', acceptedAt: today } as EbAssignmentConfirmationSummary], today)
  assert.equal(approved.actions.filter(item => item.category === 'confirmation').length, 0)
  const cancelled = buildEbDashboard(tuPreviewOrg, projects, [{ inspectionId: 'i', status: 'cancelled', acceptedAt: null } as EbAssignmentConfirmationSummary], today)
  assert.equal(cancelled.activeCount, 1, 'an open inspection still needs reconciliation after its confirmation was cancelled')
  assert.equal(cancelled.actions.length, 1)
  assert.equal(cancelled.actions[0].nextStep, 'Kontrollera besiktningen efter avbokningen')
  assert.equal(cancelled.bookings.length, 0)
})

test('Fuktsäkerhet supplies only active organization projects, with no invented visit dates', () => {
  const project = { id: 'p', orgId: tuPreviewOrg, title: 'Fuktkontroll', status: 'draft', customer: null, property: { address: 'Testvägen 4' } } as MoistureProject
  const result = buildMoistureDashboard(tuPreviewOrg, [project, { ...project, id: 'archived', status: 'archived' }, { ...project, id: 'foreign', orgId: 'other' }], today)
  assert.equal(result.activeCount, 1)
  assert.equal(result.bookings.length, 0)
  assert.equal(result.actions[0].priority, 'normal')
})

function task(overrides: Partial<TaskView> = {}): TaskView {
  return { id: 't', title: 'Kontrollera tak', status: 'in_progress', ballHolder: 'assignee', dueAt: '2026-10-15T14:00:00Z', nextFollowupAt: '2026-10-14T14:00:00Z',
    issuerId: 'me', assignee: { id: 'other', kind: 'profile', name: 'Anna' }, deadlineRequests: [], notificationDeliveryProblemCount: 0,
    initialDispatchPending: false, unreadMessageCount: 0, aiSuggestions: [], ...overrides } as TaskView
}
function workspace(tasks: TaskView[]): TaskWorkspace {
  return { currentUser: { id: 'me', isOrgAdmin: true }, tasks } as TaskWorkspace
}
test('Tasks highlights work the current user can act on without turning deadlines into bookings', () => {
  const result = buildTaskDashboard(workspace([task(), task({ id: 'review', status: 'ready_for_review', ballHolder: 'issuer' }),
    task({ id: 'deadline', deadlineRequests: [{ status: 'pending' }] as TaskView['deadlineRequests'] }),
    task({ id: 'send', initialDispatchPending: true }), task({ id: 'done', status: 'approved' }),
    task({ id: 'cancelled', status: 'cancelled' })]), today)
  assert.equal(result.activeCount, 4)
  assert.equal(result.actions.length, 3)
  assert.equal(result.bookings.length, 0)
  assert.ok(result.actions.some(item => item.nextStep === 'Kontrollera och godkänn färdigbeviset'))
  assert.ok(result.actions.some(item => item.nextStep === 'Hantera begäran om nytt slutdatum'))
  assert.ok(result.actions.some(item => item.nextStep === 'Skicka uppgiften till mottagaren'))
  assert.ok(result.actions.every(item => item.href.startsWith('/uppdrag?task=')))
})
