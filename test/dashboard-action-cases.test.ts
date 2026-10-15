import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Adapter from '../src/lib/dashboard/actionCases'
import type { DashboardActionCaseSource } from '../src/lib/dashboard/actionCases'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import * as model from '../src/lib/dashboard/model.ts'

const output = ts.transpileModule(readFileSync(new URL('../src/lib/dashboard/actionCases.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const compiled = { exports: {} }
new Function('require', 'module', 'exports', output)((name: string) => {
  assert.equal(name, './model')
  return model
}, compiled, compiled.exports)
const { buildActionCaseDashboard } = compiled.exports as typeof Adapter

const orgId = 'organization-a'
function project(overrides: Partial<DashboardActionCaseSource> = {}): DashboardActionCaseSource {
  return { id: 'project-a', org_id: orgId, title: 'Platsbesök inför tillbyggnad', status: 'preparing',
    site_visit_at: '2026-10-15T13:30:00+02:00', property_address: 'Testgatan 1, Stockholm', ...overrides }
}

test('a timed project draft becomes one tentative visit with its real 13:30 slot and project link', () => {
  const result = buildActionCaseDashboard(orgId, [project({ id: 'project / draft', property_address: '  Testgatan 1, Stockholm  ' })])
  assert.equal(result.activeCount, 1)
  assert.deepEqual(result.actions, [])
  assert.deepEqual(result.bookings, [{
    id: 'tasks:case:project / draft', moduleId: 'tasks', title: 'Platsbesök inför tillbyggnad',
    href: '/uppdrag/project%20%2F%20draft', startsAt: '2026-10-15T13:30:00+02:00',
    status: 'tentative', confirmationStatus: 'Planerat platsbesök', address: 'Testgatan 1, Stockholm',
  }])
})

test('visit timestamps remain unchanged across Stockholm midnight and winter time', () => {
  const starts = ['2026-10-14T22:30:00Z', '2026-12-14T23:30:00Z', '2026-10-15T13:30:00.123+02:00']
  const result = buildActionCaseDashboard(orgId, starts.map((site_visit_at, index) => project({ id: String(index), site_visit_at })))
  assert.deepEqual(result.bookings.map(booking => booking.startsAt), starts)
  assert.equal(model.getStockholmDate(result.bookings[0].startsAt), '2026-10-15')
  assert.equal(model.getStockholmDate(result.bookings[1].startsAt), '2026-12-15')
})

test('every known active project counts while missing or invalid visit times create no appointment', () => {
  const statuses = ['preparing', 'pricing', 'quote_ready', 'awaiting_customer', 'approved', 'in_progress']
  const invalidDates = [null, '', '2026-10-15', '2026-02-30T13:30:00Z', '2026-10-15T25:30:00Z',
    '2026-10-15T13:30:00', '2026-10-15T13:30:00+26:00', 'tomorrow']
  const rows = invalidDates.map((site_visit_at, index) => project({ id: String(index), status: statuses[index % statuses.length], site_visit_at }))
  const result = buildActionCaseDashboard(orgId, rows)
  assert.equal(result.activeCount, invalidDates.length)
  assert.deepEqual(result.bookings, [])
})

test('completed, cancelled, unknown-status and foreign-organization projects are excluded', () => {
  const result = buildActionCaseDashboard(orgId, [
    ...['completed', 'cancelled', 'archived', 'future_status', ''].map((status, index) => project({ id: String(index), status })),
    project({ id: 'foreign', org_id: 'organization-b' }),
  ])
  assert.deepEqual(result, { activeCount: 0, actions: [], bookings: [] })
})

test('active visits without an address remain in the calendar without an invented map location', () => {
  const result = buildActionCaseDashboard(orgId, [project({ property_address: null }), project({ id: 'blank', property_address: '   ' })])
  assert.equal(result.bookings.length, 2)
  for (const booking of result.bookings) {
    assert.equal('address' in booking, false)
    assert.equal('latitude' in booking, false)
    assert.equal('longitude' in booking, false)
  }
})

test('quote approval and work in progress never imply that a site visit was confirmed', () => {
  const statuses = ['preparing', 'pricing', 'quote_ready', 'awaiting_customer', 'approved', 'in_progress']
  const result = buildActionCaseDashboard(orgId, statuses.map((status, index) => project({ id: String(index), status })))
  assert.equal(result.activeCount, statuses.length)
  assert.equal(result.bookings.length, statuses.length)
  assert.ok(result.bookings.every(booking => booking.status === 'tentative' && booking.confirmationStatus === 'Planerat platsbesök'))
})
