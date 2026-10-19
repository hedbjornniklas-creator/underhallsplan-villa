import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(name, dependencies = {}) {
  const source = readFileSync(new URL(`../src/lib/tasks/${name}.ts`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)((key) => {
    assert.ok(key in dependencies, `Unexpected dependency: ${key}`)
    return dependencies[key]
  }, loaded, loaded.exports)
  return loaded.exports
}
const domain = load('domain', { './dateTime': load('dateTime') })
const assignedAt = '2026-10-19T07:07:20.729321+00:00'
const input = {
  taskId: 'test-question-task', status: 'assigned', now: '2026-10-19T07:08:00Z',
  assignedAt, lastActivityAt: assignedAt, dueAt: '2026-10-20T14:00:00+00:00',
  nextFollowUpAt: '2026-10-20T07:00:00+00:00', primaryChannel: 'email',
  fallbackChannel: null, primaryDeliveryState: 'unknown',
}

test('database timestamps accept one through six fractional digits and preserve milliseconds', () => {
  for (const zone of ['Z', '+00:00', '+02:00', '-05:30']) {
    for (const fraction of ['', '.7', '.72', '.729', '.7293', '.72932', '.729321']) {
      const value = `2026-10-19T07:07:20${fraction}${zone}`
      assert.equal(domain.taskTimeToEpoch(value), Date.parse(value), value)
    }
  }
  assert.equal(domain.taskTimeToEpoch(assignedAt), domain.taskTimeToEpoch('2026-10-19T07:07:20.729Z'))
})

test('invalid calendar dates, offsets and unsupported precision remain rejected', () => {
  for (const value of ['2026-02-30T07:07:20.729321Z', '2026-10-19T24:00:00.123456Z',
    '2026-10-19T07:07:20.123456+14:01', '2026-10-19T07:07:20.1234567Z',
    '2026-10-19T07:07:20.123456', 'not-a-date']) {
    assert.equal(domain.taskTimeToEpoch(value), null, value)
  }
})

test('first external assignment is emitted for a real PostgreSQL creation timestamp', () => {
  const result = domain.evaluateTaskReminders(input)
  assert.deepEqual(result.policyIssues, [])
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].kind, 'assignment')
  assert.equal(result.actions[0].channel, 'email')
  assert.equal(result.actions[0].target, 'assignee')
  const replay = domain.evaluateTaskReminders({
    ...input, emittedIdempotencyKeys: [result.actions[0].idempotencyKey],
    primaryDeliveryState: 'delivered', lastAssigneeReminderAt: input.now,
  })
  assert.equal(replay.actions.some(action => action.kind === 'assignment'), false)
})

test('future assignments and terminal tasks still cannot send', () => {
  assert.equal(domain.evaluateTaskReminders({ ...input, now: '2026-10-19T07:07:19Z' }).actions.some(action => action.kind === 'assignment'), false)
  for (const status of ['draft', 'approved', 'cancelled']) {
    assert.equal(domain.evaluateTaskReminders({ ...input, status }).actions.length, 0)
  }
})
