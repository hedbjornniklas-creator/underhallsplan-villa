import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node native TypeScript imports use the extension.
import { buildEbOverviewItems, getEbOverviewItemState, selectEbOverviewPage } from '../src/lib/eb/overview.ts'
// @ts-expect-error Node native TypeScript imports use the extension.
import { buildEbDashboard } from '../src/lib/eb/dashboard.ts'
// @ts-expect-error Node native TypeScript imports use the extension.
import { ebOverviewDemo, ebOverviewProject, ebOverviewInspection } from './fixtures/eb-overview-data.ts'

test('one row per inspection retains shared project/property identity and separate follow-up visits', () => {
  const projects = ebOverviewDemo()
  const before = JSON.stringify(projects)
  const items = buildEbOverviewItems(projects)
  assert.equal(items.length, 16)
  const siblings = items.filter(item => item.project.id === 'project-alpha')
  assert.equal(siblings.length, 4)
  assert.equal(new Set(siblings.map(item => item.id)).size, 4)
  assert.equal(new Set(siblings.map(item => item.project.propertyId)).size, 1)
  const active = selectEbOverviewPage(items, { filter: 'active', pageSize: 50 })
  assert.deepEqual(active.counts, { all: 16, active: 13, closed: 3, 'to-invoice': 0 })
  assert.ok(active.items.some(item => item.id === 'inspection-after'))
  assert.ok(active.items.some(item => item.id === 'inspection-delivery' && !item.lifecycle.isOpen && item.lifecycle.needsAttention))
  assert.ok(!active.items.some(item => item.id === 'inspection-closed'))
  const closed = selectEbOverviewPage(items, { filter: 'closed' })
  assert.ok(closed.items.every(item => !item.lifecycle.isOpen && !item.lifecycle.needsAttention))
  assert.equal(JSON.stringify(projects), before)
})

test('filtering, searching and pagination never replace an inspection with its parent project', () => {
  const items = buildEbOverviewItems(ebOverviewDemo())
  const searched = selectEbOverviewPage(items, { filter: 'all', search: 'Renovering Testvillan' })
  assert.equal(searched.total, 4)
  assert.equal(selectEbOverviewPage(items, { search: 'EB 2026-1021-01' }).items[0]?.id, 'inspection-after')
  assert.equal(selectEbOverviewPage(items, { filter: 'active', attentionOnly: true }).total, 2)
  const first = selectEbOverviewPage(items, { filter: 'all', pageSize: 10 })
  const next = selectEbOverviewPage(items, { filter: 'all', pageSize: 10, page: 2 })
  assert.equal(new Set([...first.items, ...next.items].map(item => item.id)).size, 16)
  assert.equal(selectEbOverviewPage(items, { search: 'no match', page: 20 }).page, 1)
})

test('archived data is available on request; completed parent does not hide new work', () => {
  const items = buildEbOverviewItems([
    ebOverviewProject({ status: 'completed', inspections: [ebOverviewInspection()] }),
    ebOverviewProject({ id: 'archived', status: 'archived', inspections: [ebOverviewInspection({ inspectionId: 'old' })] }),
  ])
  assert.equal(selectEbOverviewPage(items).total, 1)
  assert.equal(selectEbOverviewPage(items, { filter: 'all', showArchived: true }).total, 2)
})

test('sorting keeps undated inspections after dated work in both directions', () => {
  const items = buildEbOverviewItems([ebOverviewProject({ inspections: [
    ebOverviewInspection({ inspectionId: 'undated', date: null }),
    ebOverviewInspection({ inspectionId: 'early', date: '2026-10-01' }),
    ebOverviewInspection({ inspectionId: 'late', date: '2026-10-20' }),
  ] })])
  assert.deepEqual(selectEbOverviewPage(items, { sort: 'date-asc' }).items.map(item => item.id), ['early', 'late', 'undated'])
  assert.deepEqual(selectEbOverviewPage(items, { sort: 'date-desc' }).items.map(item => item.id), ['late', 'early', 'undated'])
})

test('Att fakturera is independent of work and delivery filters and only includes confirmed unbilled completed inspections', () => {
  const billing = { status: 'not_invoiced' as const, invoicedAt: null, invoiceNumber: null,
    updatedAt: null, updatedByName: null, revision: 0 }
  const completed = { status: 'completed', reportLockedAt: '2026-10-20T10:00:00Z', reportDeliveryStatus: 'sent' as const }
  const projects = [ebOverviewProject({ inspections: [
    ebOverviewInspection({ ...completed, inspectionId: 'unbilled', billing }),
    ebOverviewInspection({ ...completed, inspectionId: 'pending-delivery', reportDeliveryStatus: 'not_sent', billing }),
    ebOverviewInspection({ ...completed, inspectionId: 'invoiced', billing: { ...billing, status: 'invoiced', invoicedAt: '2026-10-20T10:00:00Z' } }),
    ebOverviewInspection({ ...completed, inspectionId: 'unavailable', billing: { ...billing, status: 'unavailable' } }),
    ebOverviewInspection({ ...completed, inspectionId: 'unknown' }),
    ebOverviewInspection({ inspectionId: 'ongoing', billing }),
  ] })]
  const before = JSON.stringify(projects)
  const items = buildEbOverviewItems(projects)
  const filtered = selectEbOverviewPage(items, { filter: 'to-invoice', attentionOnly: true })
  assert.deepEqual(new Set(filtered.items.map(item => item.id)), new Set(['unbilled', 'pending-delivery']))
  assert.equal(filtered.counts['to-invoice'], 2)
  assert.equal(filtered.unavailableBillingCount, 2, 'Unavailable and absent status are explicitly counted, never treated as invoiced')
  assert.ok(selectEbOverviewPage(items, { filter: 'active', pageSize: 50 }).items.some(item => item.id === 'unbilled'))
  assert.equal(filtered.items.find(item => item.id === 'unbilled')?.lifecycle.workStatus, 'completed')
  assert.equal(filtered.items.find(item => item.id === 'unbilled')?.lifecycle.deliveryLabel, 'Skickat')
  assert.equal(JSON.stringify(projects), before)
})

test('list completion requires invoicing without changing the completed inspection or dashboard', () => {
  const billing = { status: 'not_invoiced' as const, invoicedAt: null, invoiceNumber: null,
    updatedAt: null, updatedByName: null, revision: 0 }
  const invoiced = { ...billing, status: 'invoiced' as const, invoicedAt: '2026-11-07T10:00:00Z' }
  const completed = { status: 'completed', reportLockedAt: '2026-11-07T09:00:00Z',
    reportDeliveryStatus: 'sent' as const, reportPdfStatus: 'ready' as const }
  const projects = [ebOverviewProject({ inspections: [
    ebOverviewInspection({ ...completed, inspectionId: 'unbilled', billing }),
    ebOverviewInspection({ ...completed, inspectionId: 'invoiced', billing: invoiced }),
    ebOverviewInspection({ ...completed, inspectionId: 'unknown' }),
    ebOverviewInspection({ ...completed, inspectionId: 'unavailable', billing: { ...billing, status: 'unavailable' } }),
    ebOverviewInspection({ ...completed, inspectionId: 'failed-delivery', reportDeliveryStatus: 'failed', billing: invoiced }),
    ebOverviewInspection({ ...completed, inspectionId: 'pdf-failed', reportPdfStatus: 'failed', billing: invoiced }),
    ebOverviewInspection({ inspectionId: 'ongoing-invoiced', billing: invoiced }),
    ebOverviewInspection({ ...completed, inspectionId: 'reopened', reportLockedAt: null,
      reportReopenedAt: '2026-11-07T10:00:00Z', billing: invoiced }),
  ] })]
  const before = structuredClone(projects)
  const dashboardBefore = buildEbDashboard(projects[0].orgId, projects, [], '2026-11-07')
  const items = buildEbOverviewItems(projects)
  const active = selectEbOverviewPage(items, { filter: 'active', pageSize: 50 })
  const closed = selectEbOverviewPage(items, { filter: 'closed', pageSize: 50 })
  assert.deepEqual(active.counts, { all: 8, active: 7, closed: 1, 'to-invoice': 1 })
  assert.equal(active.total, active.counts.active)
  assert.deepEqual(closed.items.map(item => item.id), ['invoiced'])
  assert.deepEqual(new Set(active.items.map(item => item.id)),
    new Set(['unbilled', 'unknown', 'unavailable', 'failed-delivery', 'pdf-failed', 'ongoing-invoiced', 'reopened']))
  for (const item of items) {
    const state = getEbOverviewItemState(item)
    assert.equal(state.active, active.items.includes(item))
    assert.equal(state.closed, closed.items.includes(item))
    assert.equal(state.marker, ['failed-delivery', 'pdf-failed'].includes(item.id)
      ? 'attention' : item.id === 'invoiced' ? 'closed' : 'active')
  }
  assert.deepEqual(selectEbOverviewPage(items, { attentionOnly: true }).items.map(item => item.id),
    ['failed-delivery', 'pdf-failed'])
  assert.equal(active.items.find(item => item.id === 'unbilled')?.lifecycle.workLabel, 'Klar')
  assert.deepEqual(projects, before)
  assert.deepEqual(buildEbDashboard(projects[0].orgId, projects, [], '2026-11-07'), dashboardBefore)
  const withoutBilling = projects.map(project => ({ ...project, inspections: project.inspections.map(inspection => ({ ...inspection, billing: undefined })) }))
  assert.deepEqual(buildEbDashboard(projects[0].orgId, withoutBilling, [], '2026-11-07'), dashboardBefore,
    'Invoicing does not change actual visit completion, bookings or global dashboard actions')
})

test('marking and unmarking invoicing moves only list grouping; archived and cancelled remain excluded', () => {
  const billing = { status: 'not_invoiced' as const, invoicedAt: null, invoiceNumber: null,
    updatedAt: null, updatedByName: null, revision: 0 }
  const inspection = ebOverviewInspection({ status: 'completed', reportLockedAt: '2026-11-07T09:00:00Z',
    reportDeliveryStatus: 'sent', billing })
  for (const status of ['not_invoiced', 'invoiced', 'not_invoiced'] as const) {
    const items = buildEbOverviewItems([ebOverviewProject({ inspections: [{ ...inspection, billing: { ...billing, status } }] })])
    const billed = status === 'invoiced'
    assert.equal(selectEbOverviewPage(items, { filter: 'active' }).total, billed ? 0 : 1)
    assert.equal(selectEbOverviewPage(items, { filter: 'closed' }).total, billed ? 1 : 0)
    assert.equal(selectEbOverviewPage(items, { filter: 'to-invoice' }).total, billed ? 0 : 1)
    assert.equal(items[0].lifecycle.workStatus, 'completed')
    assert.equal(items[0].inspection.reportLockedAt, inspection.reportLockedAt)
  }
  for (const status of ['archived', 'cancelled']) {
    for (const parent of [true, false]) {
      const items = buildEbOverviewItems([ebOverviewProject({ status: parent ? status : 'active',
        inspections: [{ ...inspection, status: parent ? 'completed' : status }] })])
      assert.equal(selectEbOverviewPage(items).total, 0)
      assert.equal(selectEbOverviewPage(items, { showArchived: true }).total, 0)
      assert.equal(selectEbOverviewPage(items, { filter: 'closed', showArchived: true }).total, 0)
      assert.equal(selectEbOverviewPage(items, { filter: 'to-invoice', showArchived: true }).total, 0)
      assert.equal(selectEbOverviewPage(items, { filter: 'all', showArchived: true }).total, 1)
    }
  }
})
