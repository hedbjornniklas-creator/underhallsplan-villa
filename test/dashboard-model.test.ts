import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { buildObDashboard, buildTuDashboard, buildEbDashboard, buildMoistureDashboard, buildTaskDashboard, dashboardBookingStart, dashboardPriority, getStockholmDate } from '../src/lib/dashboard/model.ts'
import type { ObOverviewItem } from '../src/lib/ob/overview'
import type { DashboardConfirmationBookingSource } from '../src/lib/dashboard/model'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { buildObOverview } from '../src/lib/ob/overview.ts'
import type { OverviewAssignment, OverviewInspection } from '../src/lib/ob/overview'
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
test('OB excludes cancelled/completed rows while keeping dated drafts and sent visits tentative', () => {
  const result = buildObDashboard([ob(), ob({ id: 'b', closed: true }), ob({ id: 'c', confirmation: 'Avbokad' }),
    ob({ id: 'inspection:d', inspection: 'Pågår', inspectionHref: '/properties/p/ob/d', confirmation: 'Inväntar kund', attention: [] })],
  new Map([['inspection:d', '13:15']]), today, undefined,
  new Map([['inspection:d', confirmation({ preferred_time: '13:15' })]]))
  assert.equal(result.activeCount, 2)
  assert.equal(result.actions.filter(item => item.category === 'confirmation').length, 2)
  assert.equal(result.actions.filter(item => item.category === 'inspection').length, 1)
  assert.equal(result.bookings.length, 2)
  assert.ok(result.bookings.every(item => item.status === 'tentative'))
  assert.equal(result.bookings[0].confirmationStatus, 'Bekräftelse ej skickad')
  assert.equal(result.bookings[1].startsAt, '2026-10-12T13:15:00+02:00')
  assert.equal(result.bookings[1].address, 'Testgatan 1, Stockholm')
})

function confirmation(overrides: Partial<DashboardConfirmationBookingSource> = {}): DashboardConfirmationBookingSource {
  return { status: 'sent', preferred_date: today, preferred_time: '09:30', accepted_at: null, booked_at: null,
    last_sent_at: '2026-10-11T10:00:00Z', archived_at: null, ...overrides }
}

test('OB dashboard preserves its editable-assignment scope and excludes shared read-only work', () => {
  const shared = Object.assign(ob({ id: 'assignment:colleague', confirmation: 'Inväntar kund', attention: [] }), { canEdit: false })
  const own = Object.assign(ob({ confirmation: 'Inväntar kund', attention: [] }), { canEdit: true })
  const result = buildObDashboard([shared, own], new Map(), today, undefined,
    new Map([[shared.id, confirmation()], [own.id, confirmation()]]))
  assert.equal(result.activeCount, 1)
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].id, `ob:${own.id}`)
  assert.ok(result.actions.every(item => !item.id.includes('colleague')))
})

test('OB sent confirmations reserve the proposed date and remain one booking on acceptance', () => {
  const row = ob({ confirmation: 'Inväntar kund', attention: [] })
  const sent = buildObDashboard([row], new Map(), today, undefined, new Map([[row.id, confirmation()]]))
  assert.equal(sent.bookings.length, 1)
  assert.equal(sent.bookings[0].status, 'tentative')
  assert.equal(sent.bookings[0].confirmationStatus, 'Inväntar kund')
  assert.equal(sent.bookings[0].startsAt, '2026-10-12T09:30:00+02:00')
  assert.equal(sent.bookings[0].href, row.confirmationHref)
  const accepted = buildObDashboard([{ ...row, confirmation: 'Godkänd och accepterad' }], new Map([[row.id, '09:30']]), today,
    undefined, new Map([[row.id, confirmation({ status: 'booked', accepted_at: today, booked_at: today })]]))
  assert.equal(accepted.bookings.length, 1)
  assert.equal(accepted.bookings[0].id, sent.bookings[0].id)
  assert.notEqual(accepted.bookings[0].status, 'tentative')
})

test('OB tentative confirmations never invent dates or visit times and exclude cancelled/archive', () => {
  const row = ob({ confirmation: 'Inväntar kund', attention: [] })
  const run = (source: DashboardConfirmationBookingSource) => buildObDashboard([row], new Map(), today, undefined, new Map([[row.id, source]]))
  assert.equal(run(confirmation({ preferred_date: null })).bookings.length, 0)
  assert.equal(run(confirmation({ preferred_date: '2026-02-30' })).bookings.length, 0)
  assert.equal(run(confirmation({ preferred_time: null })).bookings[0].startsAt, today)
  for (const source of [confirmation({ status: 'cancelled' }), confirmation({ archived_at: today }),
    confirmation({ status: 'expired', last_sent_at: null })]) assert.equal(run(source).bookings.length, 0)
  const expired = run(confirmation({ status: 'expired' })).bookings[0]
  assert.equal(expired.status, 'tentative')
  assert.equal(expired.confirmationStatus, 'Bekräftelselänken har gått ut')
  const accepted = run(confirmation({ status: 'ordered', accepted_at: today })).bookings[0]
  assert.equal(accepted.status, 'tentative')
  assert.equal(accepted.confirmationStatus, 'Inväntar bokning')
})

test('OB current dated drafts use canonical time and remain one visit through sending and booking', () => {
  const row = ob()
  const source = confirmation({ status: 'draft', preferred_time: '12:30:00', last_sent_at: null })
  const run = (current: DashboardConfirmationBookingSource, label = 'Utkast') => buildObDashboard([{ ...row, confirmation: label }],
    new Map([[row.id, '08:00']]), today, undefined, new Map([[row.id, current]])).bookings
  const drafts = run(source)
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].startsAt, '2026-10-12T12:30:00+02:00')
  assert.equal(drafts[0].status, 'tentative')
  assert.equal(drafts[0].confirmationStatus, 'Bekräftelse ej skickad')
  assert.equal(drafts[0].href, row.confirmationHref)
  const sent = run({ ...source, status: 'sent', last_sent_at: today }, 'Inväntar kund')
  const booked = run({ ...source, status: 'booked', accepted_at: today, booked_at: today }, 'Godkänd och accepterad')
  assert.equal(sent.length, 1)
  assert.equal(booked.length, 1)
  assert.equal(sent[0].id, drafts[0].id)
  assert.equal(booked[0].id, drafts[0].id)
  assert.equal(sent[0].confirmationStatus, 'Inväntar kund')
  assert.notEqual(booked[0].status, 'tentative')
  assert.equal(run({ ...source, preferred_time: null })[0].startsAt, today)
  for (const current of [{ ...source, preferred_date: null }, { ...source, preferred_date: '2026-02-30' },
    { ...source, archived_at: today }, { ...source, status: 'cancelled' }]) assert.equal(run(current).length, 0)
  assert.equal(buildObDashboard([ob({ date: null })], new Map(), today).bookings.length, 0)
  assert.equal(buildObDashboard([ob({ date: '2026-02-30' })], new Map(), today).bookings.length, 0)
})

test('OB unsent linked reissue cannot move or downgrade an existing visit, but can schedule an undated one tentatively', () => {
  const row = ob({ id: 'inspection:i', inspectionHref: '/properties/p/ob/i', inspection: 'Utkast', confirmationHref: '/ob/assignments/current' })
  const source = confirmation({ status: 'draft', preferred_date: '2026-10-15', preferred_time: '13:30', last_sent_at: null })
  const result = buildObDashboard([row], new Map([[row.id, '12:30']]), today,
    new Map([[row.id, today]]), new Map([[row.id, source]]))
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].id, 'ob:inspection:i')
  assert.equal(result.bookings[0].startsAt, '2026-10-12T12:30:00+02:00')
  assert.notEqual(result.bookings[0].status, 'tentative')
  assert.equal(result.bookings[0].href, row.inspectionHref)
  const unscheduled = buildObDashboard([row], new Map(), today,
    new Map([[row.id, null]]), new Map([[row.id, source]]))
  assert.equal(unscheduled.bookings.length, 1)
  assert.equal(unscheduled.bookings[0].startsAt, '2026-10-15T13:30:00+02:00')
  assert.equal(unscheduled.bookings[0].status, 'tentative')
  assert.equal(unscheduled.bookings[0].href, '/ob/assignments/current')
  const unavailable = buildObDashboard([ob({ inspection: 'Ej tillgänglig' })], new Map(), today)
  assert.equal(unavailable.bookings.length, 0, 'a missing linked inspection cannot become a standalone draft from its label')
})

test('OB current reissue supplies one tentative event at its proposal instead of a superseded inspection slot', () => {
  const assignment = (id: string, overrides: Partial<OverviewAssignment> = {}): OverviewAssignment => ({
    id, inspection_id: 'i', status: 'sent', customer_name: 'Kund', customer_email: 'kund@example.invalid',
    property_address: 'Testgatan 1', preliminary_address: null, property_city: 'Stockholm', preferred_date: today,
    accepted_at: null, booked_at: null, archived_at: null, created_at: today, approvalVerified: false,
    activeLink: true, linkIssue: false, ...overrides,
  })
  const rows = buildObOverview([assignment('old', { status: 'booked', accepted_at: today, booked_at: today }), assignment('current')],
    [{ id: 'i', property_id: 'p', status: 'draft', date: '2026-10-11', created_at: today, assignment_number: null,
      customer_name: null, client_name: null, address: 'Testgatan 1', city: 'Stockholm', snapshot_customer: null } satisfies OverviewInspection],
    [{ inspection_id: 'i', current_assignment_id: 'current', initial_assignment_id: 'old', needsReview: false, paused: false, reason: null }])
  assert.equal(rows.length, 1)
  const result = buildObDashboard(rows, new Map([['inspection:i', '08:00']]), today,
    new Map([['inspection:i', '2026-10-11']]), new Map([['inspection:i', confirmation({ preferred_date: '2026-10-14', preferred_time: '14:30' })]]))
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].id, 'ob:inspection:i')
  assert.equal(result.bookings[0].startsAt, '2026-10-14T14:30:00+02:00')
  assert.equal(result.bookings[0].status, 'tentative')
  assert.equal(result.bookings[0].href, '/ob/assignments/current')
  const unscheduled = buildObDashboard(rows, new Map(), today, new Map([['inspection:i', null]]),
    new Map([['inspection:i', confirmation({ status: 'booked', accepted_at: today, booked_at: today })]]))
  assert.equal(unscheduled.bookings[0].status, 'tentative', 'preferred-date fallback cannot assert that the inspection itself is booked')
  assert.equal(unscheduled.bookings[0].startsAt, '2026-10-12T09:30:00+02:00')
})

test('missing OB canonical metadata never upgrades a known pending confirmation to confirmed', () => {
  const row = ob({ id: 'inspection:i', inspectionHref: '/properties/p/ob/i', confirmation: 'Inväntar kund', attention: [] })
  const result = buildObDashboard([row], new Map([[row.id, '09:30']]), today, new Map([[row.id, today]]), new Map())
  assert.equal(result.bookings[0].status, 'tentative')
  assert.equal(result.bookings[0].startsAt, today, 'missing preferred time must not reuse a potentially superseded inspection time')
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

test('TU includes unscheduled unfinished work without inventing calendar visits', () => {
  const result = buildTuDashboard(tuPreviewOrg, [tuAssignment({ status: 'draft', preferred_date: null })],
    [tuInvestigation({ inspectionId: 'unlinked', assignmentId: null, date: null })], today)
  assert.equal(result.activeCount, 2)
  assert.equal(result.bookings.length, 0)
  assert.equal(result.actions.find(item => item.category === 'inspection')?.dueDate, undefined)
  assert.equal(result.actions.find(item => item.category === 'inspection')?.priority, 'normal')
})

test('TU dated drafts appear as unsent tentative visits, including the planned 13:30 visit', () => {
  const date = '2026-10-15'
  const assignment = tuAssignment({ status: 'draft', preferred_date: date, preferred_time: '13:30:00',
    accepted_at: null, booked_at: null, last_sent_at: null, inspection_id: null })
  const result = buildTuDashboard(tuPreviewOrg, [assignment], [], date)
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].startsAt, '2026-10-15T13:30:00+02:00')
  assert.equal(result.bookings[0].status, 'tentative')
  assert.equal(result.bookings[0].confirmationStatus, 'Bekräftelse ej skickad')
  assert.equal(result.bookings[0].href, `/tu/assignments/${assignment.id}?orgId=${tuPreviewOrg}`)
  const dateOnly = buildTuDashboard(tuPreviewOrg, [{ ...assignment, preferred_time: null }], [], date)
  assert.equal(dateOnly.bookings[0].startsAt, date)
  for (const source of [{ ...assignment, preferred_date: null }, { ...assignment, preferred_date: '2026-02-30' },
    { ...assignment, archived_at: date }, { ...assignment, status: 'cancelled' as const }]) {
    assert.equal(buildTuDashboard(tuPreviewOrg, [source], [], date).bookings.length, 0)
  }
})

test('TU linked investigation retains its confirmed visit when its attached confirmation is a draft', () => {
  const assignment = tuAssignment({ status: 'draft', inspection_id: 'inspection-1', preferred_date: '2026-10-15', preferred_time: '13:30' })
  const investigation = tuInvestigation({ assignmentId: assignment.id, date: today, inspectionTime: '11:00' })
  const result = buildTuDashboard(tuPreviewOrg, [assignment], [investigation], today)
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].startsAt, '2026-10-12T11:00:00+02:00')
  assert.notEqual(result.bookings[0].status, 'tentative')
  assert.equal(result.bookings[0].href, `/tu/investigations/${investigation.inspectionId}?orgId=${tuPreviewOrg}`)
})

test('TU sent and accepted proposals appear tentatively, deduplicate linked visits, and confirm through booking', () => {
  const assignment = tuAssignment({ status: 'sent', preferred_date: today, preferred_time: '11:00', last_sent_at: today })
  const sent = buildTuDashboard(tuPreviewOrg, [assignment], [], today)
  assert.equal(sent.bookings.length, 1)
  assert.equal(sent.bookings[0].status, 'tentative')
  assert.equal(sent.bookings[0].startsAt, '2026-10-12T11:00:00+02:00')
  const accepted = buildTuDashboard(tuPreviewOrg, [{ ...assignment, status: 'ordered', accepted_at: today }], [], today)
  assert.equal(accepted.bookings[0].confirmationStatus, 'Inväntar bokning')
  const booked = buildTuDashboard(tuPreviewOrg, [{ ...assignment, status: 'booked', accepted_at: today, booked_at: today }], [], today)
  assert.equal(booked.bookings.length, 1)
  assert.equal(booked.bookings[0].id, sent.bookings[0].id)
  assert.notEqual(booked.bookings[0].status, 'tentative')
  const linked = buildTuDashboard(tuPreviewOrg, [{ ...assignment, inspection_id: 'inspection-1' }], [tuInvestigation({ assignmentId: assignment.id, date: '2026-10-11' })], today)
  assert.equal(linked.bookings.length, 1)
  assert.equal(linked.bookings[0].startsAt, sent.bookings[0].startsAt)
  assert.equal(linked.bookings[0].status, 'tentative')
  assert.equal(linked.bookings[0].href, `/tu/assignments/${assignment.id}?orgId=${tuPreviewOrg}`)
  const noTime = buildTuDashboard(tuPreviewOrg, [{ ...assignment, preferred_time: null }], [], today)
  assert.equal(noTime.bookings[0].startsAt, today)
  assert.equal(buildTuDashboard(tuPreviewOrg, [{ ...assignment, preferred_date: null }], [], today).bookings.length, 0)
  for (const source of [{ ...assignment, archived_at: today }, { ...assignment, status: 'cancelled' as const },
    { ...assignment, status: 'expired' as const, last_sent_at: null }]) assert.equal(buildTuDashboard(tuPreviewOrg, [source], [], today).bookings.length, 0)
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
  const projects = [eb(), eb({ id: 'closed', status: 'archived' }), eb({ id: 'foreign', orgId: 'other' })]
  const missing = buildEbDashboard(tuPreviewOrg, projects, [], today)
  assert.equal(missing.activeCount, 1)
  assert.equal(missing.actions[0].nextStep, 'Skapa uppdragsbekräftelsen')
  assert.equal(missing.bookings.length, 1)
  assert.equal(missing.bookings[0].status, 'tentative')
  assert.equal(missing.bookings[0].confirmationStatus, 'Bekräftelse ej skickad')
  const approved = buildEbDashboard(tuPreviewOrg, projects, [{ inspectionId: 'i', status: 'ordered', acceptedAt: today } as EbAssignmentConfirmationSummary], today)
  assert.equal(approved.actions.filter(item => item.category === 'confirmation').length, 0)
  const cancelled = buildEbDashboard(tuPreviewOrg, projects, [{ inspectionId: 'i', status: 'cancelled', acceptedAt: null } as EbAssignmentConfirmationSummary], today)
  assert.equal(cancelled.activeCount, 1, 'an open inspection still needs reconciliation after its confirmation was cancelled')
  assert.equal(cancelled.actions.length, 1)
  assert.equal(cancelled.actions[0].nextStep, 'Kontrollera besiktningen efter avbokningen')
  assert.equal(cancelled.bookings.length, 0)
})

test('EB initial dated drafts use the current proposal and become confirmed without duplicating the visit', () => {
  const summary = { assignmentId: 'current', inspectionId: 'i', versionNo: 1, status: 'draft', acceptedAt: null, lastSentAt: null } as EbAssignmentConfirmationSummary
  const source = confirmation({ status: 'draft', preferred_date: '2026-10-15', preferred_time: '12:30', last_sent_at: null })
  const result = buildEbDashboard(tuPreviewOrg, [eb()], [summary], today, new Map([['current', source]]))
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].startsAt, '2026-10-15T12:30:00+02:00')
  assert.equal(result.bookings[0].status, 'tentative')
  assert.equal(result.bookings[0].confirmationStatus, 'Bekräftelse ej skickad')
  assert.equal(result.bookings[0].href, '/eb/projects/p')
  const sent = buildEbDashboard(tuPreviewOrg, [eb()], [{ ...summary, status: 'sent', lastSentAt: today }], today,
    new Map([['current', { ...source, status: 'sent', last_sent_at: today }]]))
  const accepted = buildEbDashboard(tuPreviewOrg, [eb()], [{ ...summary, status: 'ordered', acceptedAt: today }], today,
    new Map([['current', { ...source, status: 'ordered', accepted_at: today }]]))
  assert.equal(sent.bookings.length, 1)
  assert.equal(accepted.bookings.length, 1)
  assert.equal(sent.bookings[0].id, result.bookings[0].id)
  assert.equal(accepted.bookings[0].id, result.bookings[0].id)
  assert.equal(sent.bookings[0].confirmationStatus, 'Inväntar kund')
  assert.notEqual(accepted.bookings[0].status, 'tentative', 'a report can remain a draft after the customer has accepted its visit')
  assert.equal(accepted.bookings[0].startsAt, '2026-10-12T08:00:00+02:00')
})

test('EB unsent proposals preserve date-only visits and never invent dates from invalid or archived drafts', () => {
  const summary = { assignmentId: 'current', inspectionId: 'i', versionNo: 1, status: 'draft', acceptedAt: null, lastSentAt: null } as EbAssignmentConfirmationSummary
  const source = confirmation({ status: 'draft', preferred_date: '2026-10-15', preferred_time: null, last_sent_at: null })
  const run = (current: DashboardConfirmationBookingSource, project = eb()) => buildEbDashboard(tuPreviewOrg, [project], [summary], today,
    new Map([['current', current]])).bookings
  assert.equal(run(source)[0].startsAt, '2026-10-15', 'an unknown proposed time must not reuse the actual inspection time')
  assert.equal(run({ ...source, preferred_date: null })[0].startsAt, '2026-10-12T08:00:00+02:00', 'an initial unsent confirmation may use the inspection planned slot')
  for (const current of [{ ...source, preferred_date: '2026-02-30' }, { ...source, archived_at: today }, { ...source, status: 'cancelled' }]) {
    assert.equal(run(current).length, 0)
  }
  const withoutDate = eb({ inspections: [{ ...eb().inspections[0], date: null, inspectionTime: '13:30' }] })
  assert.equal(run({ ...source, preferred_date: null }, withoutDate).length, 0)
  assert.equal(buildEbDashboard(tuPreviewOrg, [withoutDate], [], today).bookings.length, 0)
  const dateOnly = eb({ inspections: [{ ...eb().inspections[0], inspectionTime: null, startMeetingTime: null }] })
  assert.equal(buildEbDashboard(tuPreviewOrg, [dateOnly], [], today).bookings[0].startsAt, today)
  const invalid = eb({ inspections: [{ ...eb().inspections[0], date: '2026-02-30' }] })
  assert.equal(buildEbDashboard(tuPreviewOrg, [invalid], [], today).bookings.length, 0)
  const fallbackTime = eb({ inspections: [{ ...eb().inspections[0], inspectionTime: null, startMeetingTime: '13:30' }] })
  assert.equal(buildEbDashboard(tuPreviewOrg, [fallbackTime], [], today).bookings[0].startsAt, '2026-10-12T13:30:00+02:00')
})

test('EB current unsent reissues, sent invitations and started inspections keep the existing actual visit', () => {
  const summary = { assignmentId: 'current', inspectionId: 'i', versionNo: 2, status: 'draft', acceptedAt: null, lastSentAt: null } as EbAssignmentConfirmationSummary
  const source = confirmation({ status: 'draft', preferred_date: '2026-10-15', preferred_time: '13:30', last_sent_at: null })
  const sources = new Map([['old', confirmation({ preferred_date: '2026-10-14', preferred_time: '10:00' })], ['current', source]])
  const reissue = buildEbDashboard(tuPreviewOrg, [eb()], [summary], today, sources)
  assert.equal(reissue.bookings.length, 1)
  assert.equal(reissue.bookings[0].startsAt, '2026-10-12T08:00:00+02:00')
  assert.notEqual(reissue.bookings[0].status, 'tentative')
  assert.equal(reissue.bookings[0].href, '/eb/projects/p/inspections/i/perform')
  const unscheduled = buildEbDashboard(tuPreviewOrg, [eb({ inspections: [{ ...eb().inspections[0], date: null }] })], [summary], today, sources)
  assert.equal(unscheduled.bookings.length, 1)
  assert.equal(unscheduled.bookings[0].startsAt, '2026-10-15T13:30:00+02:00')
  assert.equal(unscheduled.bookings[0].confirmationStatus, 'Bekräftelse ej skickad')
  for (const inspection of [{ ...eb().inspections[0], status: 'ongoing' }, { ...eb().inspections[0], invitationSentAt: today },
    { ...eb().inspections[0], invitationDate: today }]) {
    const result = buildEbDashboard(tuPreviewOrg, [eb({ inspections: [inspection] })], [{ ...summary, versionNo: 1 }], today, sources)
    assert.equal(result.bookings.length, 1)
    assert.equal(result.bookings[0].startsAt, '2026-10-12T08:00:00+02:00')
    assert.notEqual(result.bookings[0].status, 'tentative')
  }
})

test('EB sent confirmation uses its current proposed slot and confirms the same inspection after customer acceptance', () => {
  const summary = { assignmentId: 'current', inspectionId: 'i', status: 'sent', acceptedAt: null, lastSentAt: today } as EbAssignmentConfirmationSummary
  const source = confirmation({ preferred_date: '2026-10-14', preferred_time: '14:00' })
  const sent = buildEbDashboard(tuPreviewOrg, [eb()], [summary], today, new Map([['current', source]]))
  assert.equal(sent.bookings.length, 1)
  assert.equal(sent.bookings[0].status, 'tentative')
  assert.equal(sent.bookings[0].startsAt, '2026-10-14T14:00:00+02:00')
  assert.equal(sent.bookings[0].href, '/eb/projects/p')
  const accepted = buildEbDashboard(tuPreviewOrg, [eb()], [{ ...summary, status: 'ordered', acceptedAt: today }], today,
    new Map([['current', { ...source, status: 'ordered', accepted_at: today }]]))
  assert.equal(accepted.bookings.length, 1)
  assert.equal(accepted.bookings[0].id, sent.bookings[0].id)
  assert.notEqual(accepted.bookings[0].status, 'tentative')
  assert.equal(accepted.bookings[0].href, '/eb/projects/p/inspections/i/perform')
  const noDate = buildEbDashboard(tuPreviewOrg, [eb()], [summary], today, new Map([['current', { ...source, preferred_date: null }]]))
  assert.equal(noDate.bookings.length, 0, 'a current sent proposal without a date must not resurrect the old inspection slot')
  const missingSource = buildEbDashboard(tuPreviewOrg, [eb()], [summary], today, new Map())
  assert.equal(missingSource.bookings[0].status, 'tentative')
  assert.equal(missingSource.bookings[0].startsAt, today)
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
