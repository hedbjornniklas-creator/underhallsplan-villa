import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { questionMutation, questionSendRequirements } from '../src/lib/action-cases/projectQuestions.ts'
import * as dateTime from '../src/lib/tasks/dateTime.ts'

function load(path, deps, jsx = false) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) } }).outputText
  new Function('require', 'module', 'exports', code)(key => { assert.ok(key in deps, key); return deps[key] }, module, module.exports)
  return module.exports
}
const domain = load('../src/lib/tasks/domain.ts', { './dateTime': dateTime })
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const send = { questionId: id(1), requestId: id(2), revision: 1, operation: 'send', fileIds: [], confirmed: true, dueAt: '2026-11-19T16:00:00+01:00' }
test('deadline-only requests normalize to an internal checkpoint at the deadline without altering the caller', () => {
  for (const optional of [{}, { followupAt: null }, { followupAt: '' }]) {
    const request = { ...send, ...optional }, before = structuredClone(request)
    const parsed = questionMutation(request)
    assert.equal(parsed.dueAt, '2026-11-19T15:00:00.000Z')
    assert.equal(parsed.followupAt, parsed.dueAt)
    assert.deepEqual(request, before)
    assert.deepEqual(questionMutation(request), parsed)
  }
})
test('an explicit follow-up is retained, and malformed or late optional dates are not silently ignored', () => {
  const explicit = '2026-11-17T09:00:00+01:00'
  assert.equal(questionMutation({ ...send, followupAt: explicit }).followupAt, '2026-11-17T08:00:00.000Z')
  for (const value of ['bad', '2026-02-30T09:00:00Z', '2026-11-20T09:00:00Z', 0, {}, false]) assert.throws(() => questionMutation({ ...send, followupAt: value }), /DATES/)
  for (const patch of [{ dueAt: null }, { dueAt: '' }, { confirmed: false }]) assert.throws(() => questionMutation({ ...send, ...patch }), /DATES/)
})
test('ordinary deadline reminders remain active without an extra follow-up, with no early status check', () => {
  const request = questionMutation(send)
  const base = { taskId: id(3), status: 'in_progress', dueAt: request.dueAt, nextFollowUpAt: request.followupAt, assignedAt: '2026-11-12T09:00:00Z', lastActivityAt: '2026-11-12T09:00:00Z', primaryChannel: 'email', primaryDeliveryState: 'sent' }
  const evaluate = (now, extra = {}) => domain.evaluateTaskReminders({ ...base, now, ...extra })
  assert.deepEqual(evaluate('2026-11-13T09:00:00Z').actions, [])
  const three = evaluate('2026-11-16T15:00:00Z').actions[0]
  assert.equal(three.kind, 'due_soon'); assert.equal(three.workingDaysBeforeDue, 3)
  assert.deepEqual(evaluate('2026-11-17T15:00:00Z', { emittedIdempotencyKeys: [three.idempotencyKey] }).actions, [])
  assert.equal(evaluate('2026-11-18T15:00:00Z').actions[0].workingDaysBeforeDue, 1)
  assert.equal(evaluate('2026-11-19T08:00:00Z').actions[0].kind, 'due_today')
  assert.equal(evaluate('2026-11-20T15:00:00Z').actions[0].kind, 'overdue')
  assert.deepEqual(evaluate('2026-11-20T15:00:00Z', { status: 'approved' }).actions, [])
  const planned = evaluate('2026-11-13T09:00:00Z', { nextFollowUpAt: '2026-11-13T09:00:00Z' }).actions[0]
  assert.equal(planned.kind, 'status_check')
})
test('send checklist needs only the deadline, assignee and confirmation unless an optional date is incomplete', () => {
  const selection = { assignee: { id: id(4), kind: 'contact', name: 'Test', email: 'test@example.invalid' }, dueAt: send.dueAt, followupAt: null, confirmed: true }
  assert.deepEqual(questionSendRequirements(selection), [])
  assert.equal(questionSendRequirements({ ...selection, hasFollowup: true })[0].field, 'followup')
})
test('discreet schedule renders the real default policy, including overdue handling', () => {
  const render = (type, props) => ({ type, props })
  const ui = load('../src/components/tasks/QuestionReminderSchedule.tsx', { '@/lib/tasks/domain': domain, 'react/jsx-runtime': { jsx: render, jsxs: render } }, true)
  const text = n => typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : ''
  const result = text(ui.default())
  assert.match(result, /3 arbetsdagar före · 1 arbetsdag före · på svarsdagen/)
  assert.match(result, /var 24:e timme/); assert.match(result, /valfri extra avstämning/)
})
