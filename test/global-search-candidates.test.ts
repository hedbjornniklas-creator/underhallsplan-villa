import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Native Node TypeScript tests require the extension.
import { readGlobalSearchCandidates } from '../src/lib/globalSearch/candidates.ts'
// @ts-expect-error Native Node TypeScript tests require the extension.
import { createGlobalSearchExecution } from '../src/lib/globalSearch/runtime.ts'

const project = (row: { id: string; matches: boolean }) => row.matches ? [{
  id: row.id, moduleId: 'tu', moduleLabel: 'Tekniska utredningar', kind: 'inspection' as const,
  title: row.id, subtitle: 'Björnen 1:12', href: `/tu/investigations/${row.id}`,
}] : []

test('an old match beyond several candidate pages is not silently lost', async () => {
  const calls: number[] = []
  const rows = Array.from({ length: 81 }, (_, index) => ({ id: `record-${index}`, matches: index === 80 }))
  const response = await readGlobalSearchCandidates({ query: 'Björnen', fields: ['title'], key: row => row.id, project,
    read: async (_field, offset, size) => { calls.push(offset); return rows.slice(offset, offset + size) } })
  assert.deepEqual(calls, [0, 25, 50, 75])
  assert.deepEqual(response.results.map(row => row.id), ['record-80'])
  assert.equal(response.hasMore, false)
})

test('duplicate metadata candidates are authorized/projected only once', async () => {
  let projected = 0
  const response = await readGlobalSearchCandidates({ query: 'Björnen', fields: ['title', 'address'], key: row => row.id,
    read: async () => [{ id: 'same', matches: true }],
    project: row => { projected++; return project(row) } })
  assert.equal(projected, 1)
  assert.equal(response.results.length, 1)
})

test('limits keep expensive entity checks bounded and disclose more matches', async () => {
  let projected = 0
  const response = await readGlobalSearchCandidates({ query: 'Björnen', fields: ['title'], key: row => row.id,
    read: async () => Array.from({ length: 25 }, (_, index) => ({ id: String(index), matches: true })),
    project: row => { projected++; return project(row) } })
  assert.equal(response.results.length, 8)
  assert.equal(projected, 9)
  assert.equal(response.hasMore, true)
})

test('a denied entity contributes no title, identifier or destination', async () => {
  const response = await readGlobalSearchCandidates({ query: 'Björnen', fields: ['title'], key: row => row.id,
    read: async () => [{ id: 'forbidden', matches: true }], project: () => [] })
  assert.deepEqual(response.results, [])
  assert.equal(response.hasMore, false)
})

test('source errors propagate instead of masquerading as no matches', async () => {
  await assert.rejects(readGlobalSearchCandidates({ query: 'Björnen', fields: ['title'], key: row => row.id, project,
    read: async () => { throw new Error('SOURCE_FAILED') } }), /SOURCE_FAILED/)
})

test('whole-field exact property designation is retained ahead of many earlier prefixes', async () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({ id: `early-${index}`, designation: `Svanen 2:1${index}` }))
  const exact = { id: 'late', designation: 'Svanen 2:1' }
  const response = await readGlobalSearchCandidates<{ id: string; designation: string }>({ query: 'Svanen 2:1', fields: ['designation'], exactFields: ['designation'],
    key: row => row.id,
    read: async (_field, offset, size, exactPhase) => exactPhase ? offset === 0 ? [exact] : [] : [...rows, exact].slice(offset, offset + size),
    project: row => [{ id: row.id, moduleId: 'tu', moduleLabel: 'TU', kind: 'inspection', title: row.id,
      subtitle: row.designation, propertyDesignation: row.designation, href: `/tu/${row.id}` }] })
  assert.equal(response.results[0].id, 'late')
  assert.equal(response.results.length, 8)
  assert.equal(response.hasMore, true)
})

test('a deadline retains matches from completed pages and explicitly marks partial results', async () => {
  const execution = createGlobalSearchExecution(undefined, 10)
  try {
    const response = await readGlobalSearchCandidates({ query: 'Björnen', fields: ['title'], execution, key: row => row.id, project,
      read: async (_field, offset) => {
        if (offset) { await new Promise(resolve => setTimeout(resolve, 40)); return [] }
        return Array.from({ length: 25 }, (_, index) => ({ id: String(index), matches: index === 0 }))
      } })
    assert.deepEqual(response.results.map(result => result.id), ['0'])
    assert.equal(response.hasMore, true)
    assert.match(response.issues?.[0].message ?? '', /lång tid/)
  } finally { execution.dispose() }
})

test('an aborted candidate request propagates cancellation instead of returning an empty success', async () => {
  const controller = new AbortController()
  controller.abort()
  const execution = createGlobalSearchExecution(controller.signal)
  try {
    await assert.rejects(readGlobalSearchCandidates({ query: 'Björnen', fields: ['title'], execution, key: row => row.id, project,
      read: async () => [{ id: 'never', matches: true }] }), /GLOBAL_SEARCH_ABORTED/)
  } finally { execution.dispose() }
})
