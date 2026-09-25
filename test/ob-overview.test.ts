import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Domain from '../src/lib/ob/overview'
import type * as Fixtures from './fixtures/ob-overview-data'

function load<T>(path: string, dependencies: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const domain = load<typeof Domain>('src/lib/ob/overview.ts')
const { overviewAssignment: assignment, overviewInspection: inspection } = load<typeof Fixtures>('test/fixtures/ob-overview-data.ts', {
  '../../src/lib/ob/overview': domain,
})
const { buildObOverview: build, selectObOverview: select } = domain
const options = { search: '', filter: 'all' as const, sort: 'date-desc' as const, attentionOnly: false, showArchived: false }

test('early start shows waiting for customer AND ongoing in one row', () => {
  const rows = build([assignment({ inspection_id: 'inspection-1' })], [inspection()], [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].confirmation, 'Inväntar kund')
  assert.equal(rows[0].inspection, 'Pågår')
  assert.equal(rows[0].closed, false)
  assert.equal(rows[0].inspectionHref, '/properties/property-1/ob/inspection-1')
})
test('conversion is not a completed inspection', () => {
  const [row] = build([assignment({ inspection_id: 'inspection-1', status: 'completed', accepted_at: '2026-09-20',
    booked_at: '2026-09-20', approvalVerified: true })], [inspection()], [])
  assert.equal(row.confirmation, 'Godkänd och accepterad')
  assert.equal(row.inspection, 'Pågår')
  assert.equal(row.closed, false)
})
test('booked without acceptance evidence does not imply approval', () => {
  const [row] = build([assignment({ status: 'booked', accepted_at: '2026-09-20', booked_at: '2026-09-20' })], [], [])
  assert.match(row.confirmation, /kontrolleras/)
  assert.ok(row.attention.length)
})
test('approved by customer has an explicit accept action', () => {
  const [row] = build([assignment({ status: 'ordered', accepted_at: '2026-09-20', approvalVerified: true })], [], [])
  assert.equal(row.confirmation, 'Godkänd av kund')
  assert.equal(row.confirmationAction, 'Acceptera uppdrag')
  assert.equal(row.confirmationHref, '/ob/assignments/assignment-1')
})
test('accepted assignment without an inspection points to the existing start flow', () => {
  const [row] = build([assignment({ status: 'booked', accepted_at: '2026-09-20', booked_at: '2026-09-20', approvalVerified: true })], [], [])
  assert.equal(row.confirmationAction, 'Starta besiktning')
  assert.equal(row.confirmationHref, '/ob/assignments/assignment-1')
})
test('archiving a confirmation does not hide its ongoing inspection', () => {
  const [row] = build([assignment({ inspection_id: 'inspection-1', archived_at: '2026-09-20' })], [inspection()], [])
  assert.equal(row.archived, false)
  assert.match(row.confirmation, /Arkiverad/)
  assert.equal(select([row], options).length, 1)
})
test('reissue uses workflow pointer and retains a single inspection row', () => {
  const rows = build([
    assignment({ id: 'old', inspection_id: 'inspection-1', status: 'cancelled' }),
    assignment({ id: 'middle', inspection_id: 'inspection-1', status: 'cancelled' }),
    assignment({ id: 'current', inspection_id: 'inspection-1', status: 'draft' }),
  ], [inspection()], [{ inspection_id: 'inspection-1', initial_assignment_id: 'old', current_assignment_id: 'current',
    paused: true, needsReview: true, reason: 'Uppdatera uppdraget' }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].confirmation, 'Utkast')
  assert.equal(rows[0].confirmationHref, '/ob/assignments/current')
})
test('workflow can link current assignment even without its inspection_id', () => {
  const rows = build([assignment()], [inspection()], [{ inspection_id: 'inspection-1', initial_assignment_id: 'assignment-1',
    current_assignment_id: 'assignment-1', paused: false, needsReview: true, reason: null }])
  assert.equal(rows.length, 1)
})
test('multiple inspections on the same property are never merged by address', () => {
  assert.equal(build([], [inspection(), inspection({ id: 'second' })], []).length, 2)
})
test('unlinked legacy inspection is retained and not labelled approved', () => {
  const [row] = build([], [inspection({ status: 'completed' })], [])
  assert.equal(row.confirmation, 'Ingen kopplad')
  assert.equal(row.confirmationHref, null)
  assert.equal(row.closed, true)
})
test('inaccessible linked inspection gets no link and is not labelled not started', () => {
  const [row] = build([assignment({ inspection_id: 'secret' })], [], [])
  assert.equal(row.inspection, 'Ej tillgänglig')
  assert.equal(row.inspectionHref, null)
})
test('unknown inspection status stays visible and actionable', () => {
  const [row] = build([], [inspection({ status: 'future-status' })], [])
  assert.equal(row.inspection, 'Status saknas')
  assert.equal(row.closed, false)
  assert.ok(row.attention.length)
})
test('expired link and unresolved technical failure require action', () => {
  const [row] = build([assignment({ activeLink: false, linkIssue: true })], [], [])
  assert.equal(row.confirmation, 'Länk behöver förnyas')
  assert.equal(row.attention.length, 2)
})
test('cancellation does not close an already ongoing inspection', () => {
  const [row] = build([assignment({ status: 'cancelled', inspection_id: 'inspection-1' })], [inspection()], [])
  assert.equal(row.closed, false)
})
test('reconciliation is flagged using authoritative workflow state', () => {
  const [row] = build([assignment({ inspection_id: 'inspection-1', status: 'booked', approvalVerified: true,
    accepted_at: '2026-09-20', booked_at: '2026-09-20' })], [inspection()], [{ inspection_id: 'inspection-1',
    initial_assignment_id: 'assignment-1', current_assignment_id: 'assignment-1', paused: false, needsReview: true, reason: null }])
  assert.ok(row.attention.some(reason => reason.includes('Stäm av')))
})
test('filters and search use both domains and inspection snapshot metadata', () => {
  const rows = build([assignment({ id: 'draft', status: 'draft' })], [inspection(), inspection({ id: 'done', status: 'completed' }),
    inspection({ id: 'archive', status: 'archived' })], [])
  assert.equal(select(rows, options).length, 3)
  assert.equal(select(rows, { ...options, filter: 'closed' }).length, 1)
  assert.equal(select(rows, { ...options, showArchived: true }).length, 4)
  assert.equal(select(rows, { ...options, attentionOnly: true }).length, 1)
  assert.equal(select(rows, { ...options, search: '2026-0925-01 täby' }).length, 2)
  assert.equal(select(rows, { ...options, search: 'saknas' }).length, 0)
})
test('missing dates sort last with stable tie breakers in either direction', () => {
  const rows = build([], [inspection({ id: 'a', date: null }), inspection({ id: 'b' }), inspection({ id: 'c', date: '2026-09-01' })], [])
  assert.deepEqual(select(rows, options).map(row => row.id), ['inspection:b', 'inspection:c', 'inspection:a'])
  assert.deepEqual(select(rows, { ...options, sort: 'date-asc' }).map(row => row.id), ['inspection:c', 'inspection:b', 'inspection:a'])
})
