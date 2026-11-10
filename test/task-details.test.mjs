import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as dates from '../src/lib/tasks/dateTime.ts'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load(path, dependencies, extra = '') {
  const loaded = { exports: {} }
  const js = ts.transpileModule(read(path) + extra, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', js)(name => dependencies[name] ?? {}, loaded, loaded.exports)
  return loaded.exports
}
const domain = load('src/lib/tasks/domain.ts', { './dateTime': dates })
const person = '11111111-1111-4111-8111-111111111111'
test('details API enforces same origin and trusted actor, never sending background follow-up on Save', async () => {
  const calls = []; let background = 0
  const api = load('src/app/api/tasks/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) }, after() { background++ } },
    '@/lib/assignments/server': { requireOrgContext: async () => ({ orgId: 'org', userId: 'trusted', role: 'member' }) },
    '@/lib/access/server': { requireModuleAccess: async () => {} },
    '@/lib/tasks/server': { performTaskInternalAction: async input => { calls.push(input); return { workspace: {} } } },
  })
  const request = origin => new Request('https://hushub.se/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify({ action: 'edit_task_details', payload: { actorId: 'forged', taskId: 'task' } }) })
  for (const origin of [null, 'https://evil.example.test']) assert.equal((await api.POST(request(origin))).status, 403)
  assert.equal(calls.length, 0)
  assert.equal((await api.POST(request('https://hushub.se'))).status, 200)
  assert.equal(calls[0].userId, 'trusted'); assert.equal(background, 0)
})
test('editor sends a whitelisted snapshot/version to the audited RPC, not client actor, status, costs or source', async () => {
  const calls = []
  const row = { id: 'task', org_id: 'org', issuer_profile_id: 'trusted', status: 'in_progress', created_source: 'manual', primary_channel: 'email', fallback_channel: null }
  const admin = { from(table) {
    const query = new Proxy({}, { get(_, method) { return method === 'maybeSingle' ? async () => ({ data: table === 'operational_tasks' ? row : { profile_id: person } }) : () => query } })
    return query
  }, async rpc(name, args) { calls.push({ name, args }); return { error: null } } }
  const server = load('src/lib/tasks/server.ts', {
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin }, './domain': domain,
    './internalAccess': { hasInternalTaskModuleAccess: async () => true },
  }, '\nexport { editTaskDetails };')
  const payload = { taskId: 'task', title: ' Ny rubrik ', description: ' Ny text ', contextLabel: ' Test ', version: 7, assigneeRef: `profile:${person}`, dueAt: '2027-01-01T15:00:42.000Z', nextFollowupAt: '2026-12-30T08:00:42.000Z', primaryChannel: 'email', fallbackChannel: null, confirmRecipientChange: true, actorId: 'forged', status: 'approved', price: 1000, createdSource: 'manual' }
  await server.editTaskDetails({ orgId: 'org', userId: 'trusted', payload })
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'edit_operational_task_details')
  const args = calls[0].args
  assert.equal(args.p_actor_profile_id, 'trusted'); assert.equal(args.p_expected_version, 7)
  assert.deepEqual(Object.keys(args.p_changes).sort(), ['title','description','contextLabel','dueAt','nextFollowupAt','primaryChannel','fallbackChannel','assigneeProfileId','assigneeContactId'].sort())
  assert.equal(args.p_changes.title, 'Ny rubrik'); assert.equal(args.p_changes.dueAt, payload.dueAt)
  await assert.rejects(server.editTaskDetails({ orgId: 'org', userId: 'someone-else', payload }), /FORBIDDEN/)
  row.created_source = 'system'
  await assert.rejects(server.editTaskDetails({ orgId: 'org', userId: 'trusted', payload }), /MANAGED/)
  assert.equal(calls.length, 1)
})
test('reassignment starts a new reminder history without destroying old audit messages or bypassing delivery safety', async () => {
  const messages = [{ id: 'old', created_at: '2026-11-01T08:00:00Z', message_type: 'assignment', metadata: {} }]
  let reassignment = [{ created_at: '2026-11-10T08:00:00Z' }]
  const calls = []
  const admin = { from(table) {
    const filters = []
    const query = new Proxy({}, { get(_, method) {
      if (method === 'then') return resolve => resolve({ error: null, data: table === 'task_events' ? reassignment : table === 'task_messages' ? messages : [] })
      return (...args) => { filters.push([method, ...args]); calls.push({ table, method, args }); return query }
    } }); return query
  } }
  const { loadTaskHistory } = load('src/lib/tasks/automation.ts', { '@/lib/tasks/domain': domain }, '\nexport { loadTaskHistory };')
  const task = { id: 'task', org_id: 'org', primary_channel: 'email', created_at: '2026-11-01T08:00:00Z', last_activity_at: '2026-11-10T08:00:00Z' }
  const fresh = await loadTaskHistory(admin, task)
  assert.equal(fresh.reassigned, true); assert.equal(fresh.lastAssigneeReminderAt, null); assert.equal(fresh.totalAssigneeReminders, 0)
  assert.deepEqual(messages, [{ id: 'old', created_at: '2026-11-01T08:00:00Z', message_type: 'assignment', metadata: {} }])
  assert.ok(calls.some(call => call.table === 'task_message_deliveries' && call.method === 'in' && call.args[0] === 'status' && call.args[1].includes('ambiguous')))
  reassignment = []
  assert.equal((await loadTaskHistory(admin, task)).reassigned, false)
  assert.match(read('src/lib/tasks/automation.ts'), /assignedAt: history.reassigned \? null : task.created_at/)
})
