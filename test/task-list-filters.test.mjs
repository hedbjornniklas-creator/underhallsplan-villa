import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as time from '../src/lib/tasks/timeEstimate.ts'

const source = readFileSync(new URL('../src/lib/tasks/listView.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === './timeEstimate') return time
  throw Error(`Unexpected dependency: ${name}`)
}, loaded, loaded.exports)
const list = loaded.exports
const make = (id, patch = {}) => ({
  id, title: `Uppgift ${id}`, assignee: { id: 'bo', kind: 'profile', name: 'Bo Exempel' },
  issuerId: 'anna', issuerName: 'Anna Exempel', status: 'assigned', ballHolder: 'assignee',
  contextLabel: 'Skolan', estimatedMinutes: 15, dueAt: '2026-11-20T12:00:00Z',
  createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-02T12:00:00Z', ...patch,
})
const facets = patch => ({ ...list.EMPTY_TASK_FACETS, ...patch })

test('options contain only people and contexts from loaded tasks, with stable typed identities', () => {
  const tasks = [make('1'), make('2'), make('3', { assignee: { id: 'bo', kind: 'contact', name: 'Bo Exempel' }, contextLabel: null }),
    make('4', { contextLabel: '  ', ballHolder: 'issuer' }), make('5', { ballHolder: 'nobody' })]
  const options = list.taskFacetOptions(tasks)
  assert.deepEqual(options.assignee.map(option => option.value).sort(), ['contact:bo', 'profile:bo'])
  assert.deepEqual(options.issuer, [{ value: 'anna', label: 'Anna Exempel' }])
  assert.deepEqual(options.context.map(option => option.value).sort(), ['context:Skolan', 'none'])
  assert.ok(options.ball.some(option => option.value === 'profile:anna'))
  assert.ok(options.ball.some(option => option.value === 'nobody'))
  assert.equal(list.taskMatchesFacets(tasks[0], facets({ assignee: 'contact:bo' })), false)
  assert.equal(list.taskMatchesFacets(tasks[2], facets({ assignee: 'contact:bo' })), true)
})

test('recipient, issuer, ball holder, status and context filters all apply to the same task', () => {
  const task = make('1')
  const selection = facets({ assignee: 'profile:bo', issuer: 'anna', ball: 'profile:bo', status: 'assigned', context: 'context:Skolan' })
  assert.equal(list.taskMatchesFacets(task, selection), true)
  for (const key of ['assignee', 'issuer', 'ball', 'status', 'context']) {
    assert.equal(list.taskMatchesFacets(task, { ...selection, [key]: 'different' }), false, key)
  }
  assert.equal(list.taskMatchesFacets(make('2', { ballHolder: 'issuer' }), facets({ assignee: 'profile:bo', ball: 'profile:anna' })), true)
  assert.equal(list.taskMatchesFacets(make('3', { ballHolder: 'nobody', contextLabel: null }), facets({ ball: 'nobody', context: 'none' })), true)
  assert.equal(list.taskContextKey(make('4', { contextLabel: 'none' })), 'context:none')
})

test('old, corrupt or foreign saved filter values cannot hide tasks with an unavailable choice', () => {
  const options = list.taskFacetOptions([make('1')])
  for (const value of [undefined, null, [], 'not an object', 2]) assert.deepEqual(list.readTaskFacets(value, options), facets({}))
  assert.deepEqual(list.readTaskFacets({ assignee: 'profile:bo', issuer: 'foreign-user', context: 'context:other-project',
    status: 'invalid', ball: 7, extra: true }, options), facets({ assignee: 'profile:bo' }))
  assert.deepEqual(list.readTaskFacets({ status: 'approved', issuer: 'anna' }, options), facets({ status: 'approved', issuer: 'anna' }))
  assert.deepEqual(list.readTaskFacets({ context: 'x'.repeat(1001) }), facets({}))
})

test('sorting supports Swedish names and numbers and is deterministic for equal names', () => {
  const tasks = [make('4', { title: 'Örebro' }), make('3', { title: 'Åby' }), make('2', { title: 'Uppgift 10' }), make('1', { title: 'Uppgift 2' })]
  assert.deepEqual([...tasks].sort((a,b) => list.compareTaskList(a,b,'title','asc')).map(task => task.id), ['1','2','3','4'])
  assert.equal(list.compareTaskList(make('a'), make('b'), 'assignee', 'asc') < 0, true)
  assert.equal(list.compareTaskList(make('a'), make('b'), 'assignee', 'desc') > 0, true)
  const same = [make('1'), make('2')], before = structuredClone(same)
  list.taskFacetOptions(same); list.compareTaskList(same[0], same[1], 'due', 'asc')
  assert.deepEqual(same, before)
})

test('missing deadlines, projects, ball holders and estimates remain last in either direction', () => {
  for (const direction of ['asc', 'desc']) {
    for (const [field, patch] of [['due', { dueAt: null }], ['due', { dueAt: 'invalid' }], ['context', { contextLabel: null }],
      ['ball', { ballHolder: 'nobody' }], ['estimate', { estimatedMinutes: null }]]) {
      assert.equal(list.compareTaskList(make('empty', patch), make('filled'), field, direction) > 0, true, `${field} ${direction}`)
    }
  }
})

test('recipient and actual ball holder sort independently, alongside issuer, project and creation date', () => {
  const a = make('a', { assignee: { id: 'x', kind: 'contact', name: 'Östen' }, issuerName: 'Anna',
    ballHolder: 'issuer', contextLabel: 'B', createdAt: '2026-11-03T12:00:00Z' })
  const b = make('b', { assignee: { id: 'y', kind: 'profile', name: 'Bo' }, issuerName: 'Östen',
    contextLabel: 'A', createdAt: '2026-11-01T12:00:00Z' })
  assert.ok(list.compareTaskList(a,b,'assignee','asc') > 0)
  assert.ok(list.compareTaskList(a,b,'ball','asc') < 0)
  assert.ok(list.compareTaskList(a,b,'issuer','asc') < 0)
  assert.ok(list.compareTaskList(a,b,'context','asc') > 0)
  assert.ok(list.compareTaskList(a,b,'created','desc') < 0)
  assert.ok(list.compareTaskList(make('1', { latestMessage: { createdAt: '2026-11-03T12:00:00Z' } }), make('2'), 'updated','desc') < 0)
})
