import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node native TypeScript imports use the extension.
import { buildEbOverviewItems, selectEbOverviewPage } from '../src/lib/eb/overview.ts'
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
  assert.deepEqual(active.counts, { all: 16, active: 13, closed: 3 })
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
