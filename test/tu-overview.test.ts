import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { buildTuOverviewItems, selectTuOverviewPage, canStartTuOverviewAssignment } from '../src/lib/tu/overview.ts'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { tuAssignment, tuInvestigation, tuPreviewOrg, tuOverviewDemo } from './fixtures/tu-overview-data.ts'
import type { TuAssignmentListItem } from '../src/lib/tu/server'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { buildTuDashboard } from '../src/lib/dashboard/model.ts'

const build = (assignments: TuAssignmentListItem[], investigations = [tuInvestigation()]) =>
  buildTuOverviewItems({ organizationId: tuPreviewOrg, assignments, investigations })
const options = { search: '', filter: 'all' as const, sort: 'date-desc' as const, attentionOnly: false, showArchived: false, page: 1, pageSize: 10 }

test('joins confirmations and investigations using either existing link, without duplicates', () => {
  for (const [assignments, investigations] of [
    [[tuAssignment({ inspection_id: 'inspection-1' })], [tuInvestigation()]],
    [[tuAssignment()], [tuInvestigation({ assignmentId: 'assignment-1' })]],
  ] as const) {
    const rows = build([...assignments], [...investigations])
    assert.equal(rows.length, 1)
    assert.ok(rows[0].confirmationHref)
    assert.ok(rows[0].investigationHref)
    assert.equal(rows[0].startAssignment, null)
  }
})

test('includes unlinked investigations and every standalone TU confirmation', () => {
  const rows = buildTuOverviewItems({ organizationId: tuPreviewOrg, ...tuOverviewDemo() })
  assert.equal(rows.length, 16)
  assert.equal(rows.filter(item => item.confirmation === 'Utan bekräftelse').length, 11)
  assert.equal(rows.filter(item => item.startAssignment).length, 2)
})

test('rejects confirmations from other modules or organizations', () => {
  const assignments = [tuAssignment(), tuAssignment({ id: 'foreign', org_id: 'other' }),
    { ...tuAssignment({ id: 'ob' }), assignment_type: 'OB' } as unknown as TuAssignmentListItem]
  assert.deepEqual(build(assignments, []).map(item => item.id), ['assignment:assignment-1'])
})

test('all action URLs stay in TU and preserve the active organization', () => {
  const rows = buildTuOverviewItems({ organizationId: tuPreviewOrg, ...tuOverviewDemo() })
  for (const row of rows) for (const href of [row.confirmationHref, row.investigationHref, row.pdfHref].filter(Boolean)) {
    const url = new URL(href!, 'https://example.invalid')
    assert.equal(url.searchParams.get('orgId'), tuPreviewOrg)
    assert.match(url.pathname, /^\/(tu\/|api\/report-v2\/)/)
  }
  assert.equal(build([], [tuInvestigation({ reportLockedAt: '2026-10-01' })])[0].pdfHref, null, 'Locked does not imply a PDF exists')
})

test('approval and investigation status are separate; a converted confirmation is not assumed approved', () => {
  const item = build([tuAssignment({ status: 'completed', inspection_id: 'inspection-1', accepted_at: null })])[0]
  assert.equal(item.confirmation, 'Godkännande behöver kontrolleras')
  assert.equal(item.investigationStatus, 'Utkast')
  assert.equal(item.closed, false)
  assert.equal(build([tuAssignment({ status: 'sent', inspection_id: 'inspection-1' })])[0].confirmation, 'Inväntar kund')
})

test('approved or sent with a valid link can start; archives and existing investigations cannot', () => {
  assert.equal(canStartTuOverviewAssignment(tuAssignment()), true)
  assert.equal(canStartTuOverviewAssignment(tuAssignment({ status: 'sent' })), true)
  for (const override of [{ status: 'draft' as const }, { inspection_id: 'i' }, { archived_at: '2026-10-01' }]) {
    assert.equal(canStartTuOverviewAssignment(tuAssignment(override)), false)
  }
  const missing = build([tuAssignment({ inspection_id: 'missing' })], [])[0]
  assert.equal(missing.investigationStatus, 'Ej inläst')
  assert.equal(missing.startAssignment, null)
  assert.ok(missing.attention.length)
})

test('archived confirmations do not hide their active investigations', () => {
  const linked = tuAssignment({ inspection_id: 'inspection-1', archived_at: '2026-10-01' })
  const standalone = tuAssignment({ id: 'archived', archived_at: '2026-10-01' })
  const rows = build([linked, standalone])
  assert.equal(selectTuOverviewPage(rows, options).total, 1)
  assert.equal(selectTuOverviewPage(rows, { ...options, showArchived: true }).total, 2)
  assert.equal(rows[0].archived, false)
  assert.equal(rows[0].closed, false)
})

test('search matches full address, customer email, title and number without case sensitivity', () => {
  const rows = build([], [tuInvestigation()])
  for (const search of ['ANNA TESTGATAN', 'anna@example.invalid', '2026-1002-01', 'fuktskadeutredning', 'Exemplet']) {
    assert.equal(selectTuOverviewPage(rows, { ...options, search }).total, 1)
  }
  assert.equal(selectTuOverviewPage(rows, { ...options, search: 'annan adress' }).total, 0)
})

test('filters, sorting, page boundaries and counts derive from the same set of rows', () => {
  const rows = buildTuOverviewItems({ organizationId: tuPreviewOrg, ...tuOverviewDemo() })
  const first = selectTuOverviewPage(rows, options)
  assert.deepEqual(first.counts, { all: 15, active: 11, closed: 4, 'to-invoice': 0 })
  assert.equal(first.items.length, 10)
  assert.equal(first.items[0].address, 'Långgatan 18')
  const last = selectTuOverviewPage(rows, { ...options, page: 500 })
  assert.equal(last.page, 2)
  assert.equal(last.items.length, 5)
  const closed = selectTuOverviewPage(rows, { ...options, filter: 'closed' })
  assert.equal(closed.total, 4)
  assert.ok(closed.items.every(item => item.closed))
  const attention = selectTuOverviewPage(rows, { ...options, attentionOnly: true })
  assert.equal(attention.total, 2)
  assert.equal(attention.items[0].address, 'Långgatan 18')
  const customer = selectTuOverviewPage(rows, { ...options, sort: 'customer', pageSize: 50 })
  assert.equal(customer.items[0].customer, 'Anna Andersson')
  assert.equal(selectTuOverviewPage(rows, { ...options, page: -10 }).page, 1)
})

test('finished TU investigations remain current until confirmed invoiced, without reopening reports or dashboard work', () => {
  const completed = { status: 'completed', reportLockedAt: '2026-11-10T09:00:00Z' }
  const investigations = [
    tuInvestigation({ ...completed, inspectionId: 'unbilled', billing: { status: 'not_invoiced' } }),
    tuInvestigation({ ...completed, inspectionId: 'invoiced', billing: { status: 'invoiced' } }),
    tuInvestigation({ ...completed, inspectionId: 'unknown' }),
    tuInvestigation({ ...completed, inspectionId: 'unavailable', billing: { status: 'unavailable' } }),
    tuInvestigation({ inspectionId: 'ongoing-invoiced', billing: { status: 'invoiced' } }),
    tuInvestigation({ inspectionId: 'legacy-unbilled', status: 'klar', billing: { status: 'not_invoiced' } }),
  ]
  const before = structuredClone(investigations)
  const dashboard = buildTuDashboard(tuPreviewOrg, [], investigations, '2026-11-10')
  const rows = build([], investigations)
  const active = selectTuOverviewPage(rows, { ...options, filter: 'active', pageSize: 50 })
  const closed = selectTuOverviewPage(rows, { ...options, filter: 'closed' })
  assert.deepEqual(active.counts, { all: 6, active: 5, closed: 1, 'to-invoice': 2 })
  assert.equal(active.total, active.counts.active)
  assert.deepEqual(closed.items.map(item => item.id), ['investigation:invoiced'])
  assert.equal(active.unavailableBillingCount, 2)
  assert.equal(rows.find(item => item.id === 'investigation:unbilled')?.investigationStatus, 'Låst')
  assert.equal(rows.find(item => item.id === 'investigation:legacy-unbilled')?.investigationStatus, 'Klar')
  const invoicedOnly = investigations.map(investigation => ({ ...investigation, billing: { status: 'invoiced' as const } }))
  assert.deepEqual(buildTuDashboard(tuPreviewOrg, [], invoicedOnly, '2026-11-10'), dashboard,
    'Invoice changes never add work, alter the visit or reopen the common dashboard')
  assert.equal(dashboard.activeCount, 1)
  assert.deepEqual(investigations, before)
})

test('Att fakturera uses all completed unbilled rows before pagination and ignores unrelated attention filtering', () => {
  const investigations = Array.from({ length: 12 }, (_, index) => tuInvestigation({
    inspectionId: `unbilled-${index}`, status: 'completed', billing: { status: 'not_invoiced' },
  }))
  const assignments = [tuAssignment({ id: 'no-investigation' }), tuAssignment({ id: 'missing', inspection_id: 'missing' })]
  const rows = build(assignments, investigations)
  const first = selectTuOverviewPage(rows, { ...options, filter: 'to-invoice', attentionOnly: true })
  const next = selectTuOverviewPage(rows, { ...options, filter: 'to-invoice', attentionOnly: true, page: 2 })
  assert.equal(first.total, 12)
  assert.equal(first.counts['to-invoice'], 12)
  assert.equal(first.items.length, 10)
  assert.equal(next.items.length, 2)
  assert.equal(new Set([...first.items, ...next.items].map(item => item.id)).size, 12)
  assert.equal(rows.find(item => item.id === 'assignment:no-investigation')?.billingStatus, null)
  assert.equal(rows.find(item => item.id === 'assignment:missing')?.billingStatus, 'unavailable')
  assert.equal(rows.find(item => item.id === 'assignment:missing')?.workCompleted, false)
  assert.deepEqual(new Set(selectTuOverviewPage(rows, { ...options, attentionOnly: true }).items.map(item => item.id)),
    new Set(['assignment:no-investigation', 'assignment:missing']))
  assert.equal(selectTuOverviewPage(rows, { ...options, filter: 'to-invoice', search: 'no matches' }).total, 0)
})

test('invoice marking and unmarking moves only TU list grouping and keeps confirmation archive/cancellation handling', () => {
  for (const status of ['not_invoiced', 'invoiced', 'not_invoiced'] as const) {
    const rows = build([], [tuInvestigation({ status: 'done', billing: { status } })])
    assert.equal(rows[0].workCompleted, true)
    assert.equal(rows[0].closed, status === 'invoiced')
    assert.equal(selectTuOverviewPage(rows, { ...options, filter: 'to-invoice' }).total, status === 'invoiced' ? 0 : 1)
  }
  const rows = build([
    tuAssignment({ id: 'cancelled', status: 'cancelled' }),
    tuAssignment({ id: 'archived', archived_at: '2026-11-09T09:00:00Z' }),
    tuAssignment({ id: 'linked', inspection_id: 'inspection-1', archived_at: '2026-11-09T09:00:00Z' }),
  ], [tuInvestigation({ reportLockedAt: '2026-11-10T09:00:00Z', billing: { status: 'not_invoiced' } })])
  assert.equal(selectTuOverviewPage(rows, { ...options, filter: 'closed' }).total, 1)
  assert.equal(selectTuOverviewPage(rows, { ...options, filter: 'closed', showArchived: true }).total, 2)
  assert.equal(rows.find(item => item.id === 'investigation:inspection-1')?.archived, false)
  assert.equal(selectTuOverviewPage(rows, { ...options, filter: 'to-invoice', showArchived: true }).total, 1)
})
