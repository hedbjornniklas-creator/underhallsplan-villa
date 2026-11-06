import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types runner requires the explicit extension.
import { buildEbDashboard } from '../src/lib/eb/dashboard.ts'
import type { EbDashboardInspection, EbDashboardProject, EbDashboardConfirmationBookingSource } from '../src/lib/eb/dashboard'
import type { EbAssignmentConfirmationSummary } from '../src/lib/eb/assignmentConfirmationTypes'

const today = '2026-10-15'
const lockedAt = `${today}T10:00:00Z`
const inspection = (overrides: Partial<EbDashboardInspection> = {}): EbDashboardInspection => ({
  inspectionId: 'i', variantLabel: 'Slutbesiktning 1', status: 'draft', date: today,
  clientName: 'Kund', inspectionTime: '10:00', startMeetingTime: null, reportLockedAt: null,
  reportReopenedAt: null, reportDeliveryStatus: 'not_sent', reportPdfStatus: null, reportLastSentAt: null, ...overrides,
})
const project = (inspections = [inspection()], overrides: Partial<EbDashboardProject> = {}): EbDashboardProject => ({
  id: 'p', orgId: 'org', status: 'active', title: 'Entreprenaden', clientName: 'Kund', address: 'Gatan 1',
  postalCode: '11111', city: 'Stockholm', inspections, ...overrides,
})
const build = (rows: EbDashboardProject[]) => buildEbDashboard('org', rows, [], today)

test('EB dashboard counts individual open inspections, not projects or completed delivery tasks', () => {
  const result = build([project([
    inspection(), inspection({ inspectionId: 'next', variantLabel: 'Efterbesiktning 1' }),
    inspection({ inspectionId: 'done', reportLockedAt: lockedAt, reportDeliveryStatus: 'not_sent' }),
  ], { status: 'completed' }), project([], { id: 'empty' }), project([inspection()], { id: 'foreign', orgId: 'other' })])
  assert.equal(result.activeCount, 2, 'project completion cannot hide its ongoing inspections')
  assert.equal(result.bookings.length, 3)
  assert.equal(result.bookings.filter(row => row.status === 'completed').length, 1)
  assert.equal(result.actions.filter(row => row.category === 'inspection').length, 2)
  assert.equal(result.actions.filter(row => row.id.endsWith(':delivery')).length, 1)
  assert.ok(result.actions.some(row => row.id === 'eb:empty:project'), 'unplanned projects retain an actionable entry without inflating inspection counts')
})

test('EB locked visits remain calendar history while only genuine delivery problems stay actionable', () => {
  const result = build([project([
    inspection({ inspectionId: 'sent', reportLockedAt: lockedAt, reportDeliveryStatus: 'sent', reportPdfStatus: 'ready' }),
    inspection({ inspectionId: 'failed', reportLockedAt: lockedAt, reportDeliveryStatus: 'failed' }),
    inspection({ inspectionId: 'pdf', reportLockedAt: lockedAt, reportDeliveryStatus: 'sent', reportPdfStatus: 'failed' }),
    inspection({ inspectionId: 'processing', reportLockedAt: lockedAt, reportDeliveryStatus: 'sent', reportPdfStatus: 'processing' }),
  ])])
  assert.equal(result.activeCount, 0)
  assert.equal(result.bookings.length, 4)
  assert.ok(result.bookings.every(row => row.status === 'completed' && row.startsAt === `${today}T10:00:00+02:00`))
  assert.deepEqual(result.actions.map(row => row.id), ['eb:failed:delivery', 'eb:pdf:delivery'])
  assert.ok(result.actions.every(row => row.href.endsWith('/report') && row.priority === 'normal' && !row.dueDate))
})

test('EB reopened authoring remains work while its original visit stays completed history', () => {
  const result = build([project([inspection({ status: 'completed', date: '2025-01-01', reportReopenedAt: lockedAt, reportDeliveryStatus: 'sent' })])])
  assert.equal(result.activeCount, 1)
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].status, 'completed')
  assert.equal(result.bookings[0].startsAt, '2025-01-01T10:00:00+01:00')
  assert.equal(result.actions.length, 1)
  assert.match(result.actions[0].nextStep, /ändringarna/)
  assert.equal(result.actions[0].priority, 'normal')
  assert.equal(result.actions[0].dueDate, undefined)
  assert.equal(build([project([inspection({ status: 'completed' })])]).actions.length, 0, 'missing lock alone cannot reopen legacy work')
})

test('EB completed statuses retain one actual visit without pending confirmation dates or tasks', () => {
  const confirmation: EbAssignmentConfirmationSummary = { assignmentId: 'a', inspectionId: 'i', versionNo: 2,
    status: 'sent', acceptedAt: null, lastSentAt: lockedAt, customerEmail: 'kund@example.test',
    priceAmount: 1000, currency: 'SEK', pricingModel: 'fixed' }
  const proposal: EbDashboardConfirmationBookingSource = { status: 'sent', preferred_date: '2026-12-02', preferred_time: '14:30',
    accepted_at: null, booked_at: null, last_sent_at: lockedAt, archived_at: null }
  for (const status of ['completed', 'done', 'klar']) {
    const result = buildEbDashboard('org', [project([inspection({ status })])], [confirmation], today, new Map([['a', proposal]]))
    assert.equal(result.activeCount, 0)
    assert.deepEqual(result.actions, [])
    assert.equal(result.bookings.length, 1)
    assert.deepEqual(result.bookings[0], {
      id: 'eb:i', moduleId: 'eb', title: 'Slutbesiktning 1 · Entreprenaden',
      href: '/eb/projects/p/inspections/i/perform', startsAt: `${today}T10:00:00+02:00`,
      status: 'completed', address: 'Gatan 1, 11111, Stockholm',
    })
  }
})

test('EB historical visits never invent a date from confirmation proposals or lock timestamps', () => {
  const confirmation: EbAssignmentConfirmationSummary = { assignmentId: 'a', inspectionId: 'i', versionNo: 1,
    status: 'ordered', acceptedAt: lockedAt, lastSentAt: lockedAt, customerEmail: 'kund@example.test',
    priceAmount: 1000, currency: 'SEK', pricingModel: 'fixed' }
  const proposal: EbDashboardConfirmationBookingSource = { status: 'ordered', preferred_date: today, preferred_time: '14:30',
    accepted_at: lockedAt, booked_at: lockedAt, last_sent_at: lockedAt, archived_at: null }
  for (const date of [null, '2026-02-30']) {
    const result = buildEbDashboard('org', [project([inspection({ date, reportLockedAt: lockedAt,
      reportDeliveryStatus: 'sent' })])], [confirmation], today, new Map([['a', proposal]]))
    assert.equal(result.bookings.length, 0)
    assert.equal(result.activeCount, 0)
    assert.deepEqual(result.actions, [])
  }
  const dateOnly = build([project([inspection({ status: 'completed', inspectionTime: null, startMeetingTime: null })])])
  assert.equal(dateOnly.bookings[0].startsAt, today)
  const meeting = build([project([inspection({ status: 'completed', inspectionTime: null, startMeetingTime: '08:30' })])])
  assert.equal(meeting.bookings[0].startsAt, `${today}T08:30:00+02:00`)
})

test('EB archived or cancelled parent and child records cannot leak delivery tasks or bookings', () => {
  for (const status of ['archived', 'cancelled', 'arkiverad', 'avbokad']) {
    const child = inspection({ reportLockedAt: lockedAt, reportDeliveryStatus: 'failed' })
    assert.deepEqual(build([project([child], { status })]), { activeCount: 0, actions: [], bookings: [] })
    assert.deepEqual(build([project([{ ...child, status }])]), { activeCount: 0, actions: [], bookings: [] })
  }
})

test('EB preserves tentative current proposal booking and acceptance without inventing visit times', () => {
  const confirmation: EbAssignmentConfirmationSummary = { assignmentId: 'a', inspectionId: 'i', versionNo: 1,
    status: 'sent', acceptedAt: null, lastSentAt: lockedAt, customerEmail: 'kund@example.test',
    priceAmount: 1000, currency: 'SEK', pricingModel: 'fixed' }
  const source: EbDashboardConfirmationBookingSource = { status: 'sent', preferred_date: '2026-10-16', preferred_time: '14:30',
    accepted_at: null, booked_at: null, last_sent_at: lockedAt, archived_at: null }
  const sent = buildEbDashboard('org', [project()], [confirmation], today, new Map([['a', source]]))
  assert.equal(sent.bookings.length, 1)
  assert.equal(sent.bookings[0].startsAt, '2026-10-16T14:30:00+02:00')
  assert.equal(sent.bookings[0].status, 'tentative')
  assert.equal(sent.bookings[0].href, '/eb/projects/p')
  const accepted = buildEbDashboard('org', [project()], [{ ...confirmation, status: 'ordered', acceptedAt: lockedAt }], today,
    new Map([['a', { ...source, status: 'ordered', accepted_at: lockedAt }]]))
  assert.equal(accepted.bookings.length, 1)
  assert.equal(accepted.bookings[0].startsAt, '2026-10-15T10:00:00+02:00')
  assert.notEqual(accepted.bookings[0].status, 'tentative')
  const missingSource = buildEbDashboard('org', [project()], [confirmation], today)
  assert.equal(missingSource.bookings[0].startsAt, today)
  const missingDate = buildEbDashboard('org', [project()], [confirmation], today,
    new Map([['a', { ...source, preferred_date: null }]]))
  assert.equal(missingDate.bookings.length, 0)
})

test('EB undated or invalid visits never fabricate appointments; winter time uses Swedish offset', () => {
  for (const date of [null, '2026-02-30']) assert.equal(build([project([inspection({ date })])]).bookings.length, 0)
  const winter = build([project([inspection({ date: '2026-12-01', inspectionTime: '09:15' })])])
  assert.equal(winter.bookings[0].startsAt, '2026-12-01T09:15:00+01:00')
  assert.equal(build([project([inspection({ inspectionTime: null })])]).bookings[0].startsAt, today)
})
