import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { formatTaskDateTime, taskIsoToDateTimeInput } from '../src/lib/tasks/dateTime.ts'

function harness() {
  const calls = []
  const source = readFileSync(new URL('../src/lib/tasks/server.ts', import.meta.url), 'utf8') + '\nexport { createTask };'
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => ({ async rpc(name, payload) { calls.push({ name, payload }); return { data: { id: 'new' } } } }) }
    if (name === './domain') return { DEFAULT_TASK_AUTOMATION_LIMITS: {} }
    return {}
  }, module, module.exports)
  return { calls, run: payload => module.exports.createTask({ orgId: 'org', userId: 'self', payload: { title: 'Fiktiv uppgift', taskKind: 'simple', assigneeRef: 'profile:self', dueAt: null, nextFollowupAt: null, ...payload } }) }
}

test('personal creation uses the session identity and never delegated task creation', async () => {
  const h = harness(), result = await h.run({ actorId: 'forged', primaryChannel: 'email' })
  assert.equal(result.undated, true)
  assert.deepEqual(h.calls, [{ name: 'create_undated_personal_task', payload: { p_org_id: 'org', p_actor_profile_id: 'self', p_title: 'Fiktiv uppgift', p_description: null, p_context_label: null } }])
})

test('no dates cannot bypass recipient, hierarchy, evidence or recurring requirements', async () => {
  for (const payload of [{ assigneeRef: 'profile:other' }, { assigneeRef: 'contact:external' }, { taskKind: 'warranty' }, { parentTaskId: 'parent' }, { sourceAiSuggestionId: 'ai' }, { recurrenceInterval: 'weekly' }, { evidenceRequirements: ['photo'] }, { newContact: { name: 'other' } }]) {
    const h = harness()
    await assert.rejects(h.run(payload), /FORBIDDEN/)
    assert.equal(h.calls.length, 0)
  }
  for (const payload of [{ dueAt: '2026-11-01T12:00:00Z' }, { nextFollowupAt: '2026-11-01T12:00:00Z' }]) {
    const h = harness()
    await assert.rejects(h.run(payload), /REQUIRED/)
    assert.equal(h.calls.length, 0)
  }
})

test('null dates are never rendered or edited as 1 January 1970', () => {
  assert.equal(formatTaskDateTime(null), 'Utan datum')
  assert.equal(taskIsoToDateTimeInput(null), null)
  assert.match(formatTaskDateTime('2026-10-30T12:00:00Z'), /2026/)
})
