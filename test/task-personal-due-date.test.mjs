import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
function load(name, dependencies = {}) {
  const source = readFileSync(new URL(`../src/lib/tasks/${name}.ts`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name] }, loaded, loaded.exports)
  return loaded.exports
}
const domain = load('domain', { './dateTime': load('dateTime') })
const due = load('personalDueDate', { './domain': domain })

const own = { issuer_profile_id: 'self', assignee_profile_id: 'self', assignee_contact_id: null, parent_task_id: null, task_kind: 'simple', created_source: 'manual', status: 'assigned' }
test('only personal open manual to-dos get the date editor', () => {
  assert.equal(due.canEditPersonalDueDate(own, 'self'), true)
  for (const patch of [{ issuer_profile_id: 'other' }, { assignee_profile_id: 'other' }, { assignee_contact_id: 'contact' }, { parent_task_id: 'parent' }, { task_kind: 'warranty' }, { created_source: 'system' }, { status: 'approved' }, { status: 'cancelled' }])
    assert.equal(due.canEditPersonalDueDate({ ...own, ...patch }, 'self'), false)
})
test('dates require an explicit null or a full absolute timestamp, never omitted or silently normalized dates', () => {
  assert.equal(due.normalizePersonalDueDate(null), null)
  assert.equal(due.normalizePersonalDueDate('2030-01-10T16:00:00+01:00'), '2030-01-10T15:00:00.000Z')
  for (const value of [undefined, '', '2030-01-10', '2030-02-30T16:00:00Z', '2030-01-10T24:00:00Z', true, 0, 'invalid']) assert.throws(() => due.normalizePersonalDueDate(value), /TASK_DUE_REQUIRED/)
})

function harness(patch = {}, failure = null) {
  const row = { ...own, id: 'task', org_id: 'org', version: 4, ...patch }, calls = []
  const admin = { from() { const q = new Proxy({}, { get(_, key) { return key === 'maybeSingle' ? async () => ({ data: row }) : () => q } }); return q }, async rpc(name, args) { calls.push({ name, args }); return { error: failure } } }
  const source = readFileSync(new URL('../src/lib/tasks/server.ts', import.meta.url), 'utf8') + '\nexport { setPersonalDueDate };'
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === './personalDueDate') return due
    if (name === './domain') return { DEFAULT_TASK_AUTOMATION_LIMITS: {}, isTerminalTaskStatus: status => ['approved', 'cancelled'].includes(status) }
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
    return {}
  }, loaded, loaded.exports)
  return { calls, edit: payload => loaded.exports.setPersonalDueDate({ orgId: 'org', userId: 'self', isOrgAdmin: true, payload: { taskId: 'task', version: 4, dueAt: null, ...payload } }) }
}
test('server uses the session actor and writes only the date RPC with optimistic version', async () => {
  const h = harness()
  await h.edit({ actorId: 'forged', status: 'approved', nextFollowupAt: 'forged', dueAt: '2030-01-10T16:00:00+01:00' })
  assert.deepEqual(h.calls, [{ name: 'set_personal_task_due_date', args: { p_org_id: 'org', p_task_id: 'task', p_actor_profile_id: 'self', p_expected_version: 4, p_due_at: '2030-01-10T15:00:00.000Z' } }])
  await assert.rejects(harness({ assignee_profile_id: 'other' }).edit({}), /FORBIDDEN/)
  await assert.rejects(harness({ status: 'approved' }).edit({}), /TERMINAL/)
  await assert.rejects(h.edit({ version: undefined }), /VERSION_REQUIRED/)
  await assert.rejects(harness({}, { message: 'TASK_VERSION_CONFLICT' }).edit({}), /CONFLICT/)
  await assert.rejects(harness({}, { code: 'PGRST202' }).edit({}), /SCHEMA_REQUIRED/)
})
test('API enforces same origin and maps schedule errors', async () => {
  const source = readFileSync(new URL('../src/app/api/tasks/route.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }, calls = []
  let failure = null
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'next/server') return { NextResponse: { json: (body, opts = {}) => ({ body, status: opts.status ?? 200 }) }, after() {} }
    if (name === '@/lib/access/server') return { requireModuleAccess: async () => {} }
    if (name === '@/lib/assignments/server') return { requireOrgContext: async () => ({ orgId: 'org', userId: 'self', role: 'member' }) }
    if (name === '@/lib/tasks/server') return { performTaskInternalAction: async input => { if (failure) throw Error(failure); calls.push(input); return { workspace: {} } } }
    return {}
  }, loaded, loaded.exports)
  const request = origin => new Request('https://hushub.se/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify({ action: 'set_personal_due_date', payload: { taskId: 'task', dueAt: null, version: 4 } }) })
  for (const origin of [null, 'https://other.example.test']) assert.equal((await loaded.exports.POST(request(origin))).status, 403)
  assert.equal(calls.length, 0)
  assert.equal((await loaded.exports.POST(request('https://hushub.se'))).status, 200)
  assert.equal(calls[0].userId, 'self')
  for (const [code, status] of [['TASK_DUE_REQUIRED', 400], ['TASK_DUE_EDIT_CHILDREN', 400], ['TASK_DUE_EDIT_RECURRENCE', 400], ['TASK_DUE_EDIT_PENDING_REQUEST', 400], ['TASK_DUE_EDIT_FORBIDDEN', 403], ['TASK_VERSION_CONFLICT', 409], ['TASK_DUE_EDIT_SCHEMA_REQUIRED', 503]]) {
    failure = code
    assert.equal((await loaded.exports.POST(request('https://hushub.se'))).status, status)
  }
})
