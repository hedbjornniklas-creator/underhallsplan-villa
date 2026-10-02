import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { buildTuOverviewItems, selectTuOverviewPage, canStartTuOverviewAssignment } from '../src/lib/tu/overview.ts'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import { tuAssignment, tuInvestigation, tuPreviewOrg, tuOverviewDemo } from './fixtures/tu-overview-data.ts'
import type { TuAssignmentListItem } from '../src/lib/tu/server'

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
  assert.equal(rows.filter(item => item.startAssignment).length, 1)
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
  const item = build([tuAssignment({ status: 'completed', inspection_id: 'inspection-1' })])[0]
  assert.equal(item.confirmation, 'Utredning startad')
  assert.equal(item.investigationStatus, 'Utkast')
  assert.equal(item.closed, false)
  assert.equal(build([tuAssignment({ status: 'sent', inspection_id: 'inspection-1' })])[0].confirmation, 'Skickad')
})

test('only approved, unarchived, unlinked assignments can start', () => {
  assert.equal(canStartTuOverviewAssignment(tuAssignment()), true)
  for (const override of [{ status: 'sent' as const }, { inspection_id: 'i' }, { archived_at: '2026-10-01' }]) {
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
  assert.deepEqual(first.counts, { all: 15, active: 11, closed: 4 })
  assert.equal(first.items.length, 10)
  assert.equal(first.items[0].address, 'Långgatan 18')
  const last = selectTuOverviewPage(rows, { ...options, page: 500 })
  assert.equal(last.page, 2)
  assert.equal(last.items.length, 5)
  const closed = selectTuOverviewPage(rows, { ...options, filter: 'closed' })
  assert.equal(closed.total, 4)
  assert.ok(closed.items.every(item => item.closed))
  const attention = selectTuOverviewPage(rows, { ...options, attentionOnly: true })
  assert.equal(attention.total, 1)
  assert.equal(attention.items[0].address, 'Långgatan 18')
  const customer = selectTuOverviewPage(rows, { ...options, sort: 'customer', pageSize: 50 })
  assert.equal(customer.items[0].customer, 'Anna Andersson')
  assert.equal(selectTuOverviewPage(rows, { ...options, page: -10 }).page, 1)
})
