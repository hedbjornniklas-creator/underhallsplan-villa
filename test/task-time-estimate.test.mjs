import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as time from '../src/lib/tasks/timeEstimate.ts'

test('estimates are optional whole active-work minutes, never a guessed zero or coerced string', () => {
  assert.equal(time.normalizeTaskEstimate(null), null)
  assert.equal(time.normalizeTaskEstimate(undefined), null)
  assert.equal(time.parseTaskEstimate(''), null)
  assert.equal(time.parseTaskEstimate(' 30 '), 30)
  for (const value of [0, -1, 1.5, 10081, Infinity, NaN, '5', true, {}]) assert.throws(() => time.normalizeTaskEstimate(value), /TASK_ESTIMATE_INVALID/)
  for (const value of ['5 min', '5.5', '5,5', '-1', '0']) assert.throws(() => time.parseTaskEstimate(value), /TASK_ESTIMATE_INVALID/)
  assert.equal(time.taskEstimateLabel(null), 'Tid ej angiven')
  assert.equal(time.taskEstimateLabel(5), '5 min')
  assert.equal(time.taskEstimateLabel(60), '1 tim')
  assert.equal(time.taskEstimateLabel(90), '1 tim 30 min')
})

test('unknown estimates sort last in either direction without confusing equal values', () => {
  const tasks = [null, 30, 5, undefined, 15, 5].map(estimatedMinutes => ({ estimatedMinutes }))
  assert.deepEqual([...tasks].sort((a,b) => time.compareTaskEstimates(a,b,'asc')).map(t => t.estimatedMinutes), [5,5,15,30,null,undefined])
  assert.deepEqual([...tasks].sort((a,b) => time.compareTaskEstimates(a,b,'desc')).map(t => t.estimatedMinutes), [30,15,5,5,null,undefined])
})

const task = patch => ({ status: 'assigned', ballHolder: 'assignee', issuerId: 'issuer', assignee: { id: 'self', kind: 'profile' }, ...patch })
test('time candidates require my ball and an open non-waiting task, regardless of hierarchy or deadline', () => {
  assert.equal(time.taskIsTimeCandidate(task({ dueAt: null, parentTaskId: 'large-parent' }), 'self'), true)
  assert.equal(time.taskIsTimeCandidate(task({ ballHolder: 'issuer', issuerId: 'self' }), 'self'), true)
  for (const patch of [{ status: 'approved' }, { status: 'cancelled' }, { status: 'waiting' }, { ballHolder: 'none' }, { assignee: { id: 'other', kind: 'profile' } }, { assignee: { id: 'self', kind: 'contact' } }]) {
    assert.equal(time.taskIsTimeCandidate(task(patch), 'self'), false)
  }
})

function serverHarness(options = {}) {
  const calls = [], row = { id: 'task', org_id: 'org', issuer_profile_id: 'issuer', assignee_profile_id: 'self', status: 'assigned', version: 4, ...options.task }
  const admin = { from() { const q = new Proxy({}, { get(_,key) { return key === 'maybeSingle' ? async () => ({ data: row }) : () => q } }); return q },
    async rpc(name, args) { calls.push({ name, args }); return options.rpc ?? { data: { id: 'new' }, error: null } } }
  const source = readFileSync(new URL('../src/lib/tasks/server.ts', import.meta.url),'utf8') + '\nexport { createTask, setTaskTimeEstimate };'
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }
  new Function('require','module','exports',compiled)(name => {
    if (name === './timeEstimate') return time
    if (name === './domain') return { DEFAULT_TASK_AUTOMATION_LIMITS: {}, isTerminalTaskStatus: s => ['approved','cancelled'].includes(s) }
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
    return {}
  }, loaded, loaded.exports)
  const input = payload => ({ orgId: 'org', userId: 'self', payload })
  return { calls,
    create: payload => loaded.exports.createTask(input({ title: 'Fiktiv uppgift', taskKind: 'simple', assigneeRef: 'profile:self', dueAt: null, nextFollowupAt: null, ...payload })),
    update: payload => loaded.exports.setTaskTimeEstimate(input({ taskId: 'task', estimatedMinutes: 5, estimateVersion: 2, version: 4, ...payload })) }
}

test('estimated personal tasks use atomic creation; old and blank tasks keep the original RPC', async () => {
  const h = serverHarness()
  await h.create({ estimatedMinutes: 5, actor: 'forged' })
  assert.equal(h.calls[0].name, 'create_task_with_time_estimate')
  assert.equal(h.calls[0].args.p_minutes, 5)
  assert.equal(h.calls[0].args.p_actor_profile_id, 'self')
  assert.equal(h.calls[0].args.p_without_dates, true)
  assert.equal(h.calls.length, 1)
  await h.create({ estimatedMinutes: null })
  assert.equal(h.calls[1].name, 'create_undated_personal_task')
  const invalid = serverHarness()
  await assert.rejects(invalid.create({ estimatedMinutes: 0 }), /TASK_ESTIMATE_INVALID/)
  assert.equal(invalid.calls.length, 0)
})

test('estimate edits send only the trusted actor and dedicated revisions, not status or deadlines', async () => {
  const h = serverHarness()
  await h.update({ actorId: 'forged', dueAt: '2099-01-01', status: 'approved' })
  assert.deepEqual(h.calls, [{ name: 'set_task_time_estimate', args: { p_org_id: 'org', p_task_id: 'task', p_actor_profile_id: 'self', p_task_version: 4, p_estimate_version: 2, p_minutes: 5 } }])
  await h.update({ estimatedMinutes: null })
  assert.equal(h.calls[1].args.p_minutes, null)
  await assert.rejects(serverHarness({ task: { assignee_profile_id: 'other' } }).update({}), /FORBIDDEN/)
  await assert.rejects(serverHarness({ task: { status: 'cancelled' } }).update({}), /TERMINAL/)
  await assert.rejects(serverHarness({ rpc: { error: { message: 'TASK_ESTIMATE_CONFLICT' } } }).update({}), /CONFLICT/)
  await assert.rejects(serverHarness({ rpc: { error: { code: 'PGRST202' } } }).update({}), /SCHEMA_REQUIRED/)
})

test('time filtering is flat and private; estimate updates cannot schedule opportunistic follow-up', () => {
  const ui = readFileSync(new URL('../src/components/tasks/TaskDashboardClient.tsx',import.meta.url),'utf8')
  const api = readFileSync(new URL('../src/app/api/tasks/route.ts',import.meta.url),'utf8')
  assert.match(ui, /effectiveListMode = timeBudgetActive \? 'all' : listMode/)
  assert.match(ui, /task\.estimatedMinutes <= timeBudget/)
  assert.match(ui, /Tid ej angiven \(/)
  assert.match(api, /!\['mark_messages_read', 'set_time_estimate'\]\.includes\(action\)/)
  assert.match(api, /\['complete_manually', 'set_time_estimate'\]\.includes\(action\).*request.headers.get\('origin'\)/)
})

test('workspace loading scopes estimates to the loaded tasks and tolerates only missing-schema errors', async () => {
  const source = readFileSync(new URL('../src/lib/tasks/server.ts',import.meta.url),'utf8') + '\nexport { loadRows };'
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  let estimateError = null
  const calls = [], estimates = [{ task_id: 'task', estimated_minutes: 15, version: 2 }]
  const results = { operational_tasks: { data: [{ id: 'task' }] }, task_time_estimates: { data: estimates }, task_organization_settings: { data: { timezone: 'Europe/Stockholm' } } }
  const admin = { from(table) {
    calls.push({ table })
    const result = () => table === 'task_time_estimates' && estimateError ? { data: null, error: estimateError } : { error: null, data: [], ...results[table] }
    const q = new Proxy({}, { get(_,key) {
      if (key === 'then') return (resolve) => resolve(result())
      if (key === 'maybeSingle') return async () => result()
      return (...args) => { calls.push({ table,method:key,args }); return q }
    } })
    return q
  } }
  const loaded = { exports: {} }
  new Function('require','module','exports',compiled)(name => {
    if (name === './domain') return { DEFAULT_TASK_AUTOMATION_LIMITS: {} }
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
    if (name === './internalAccess') return { getInternalTaskModuleAccessProfileIds: async () => new Set() }
    if (name === './dateTime') return { normalizeTaskTimeZone: value => value ?? 'Europe/Stockholm' }
    return {}
  },loaded,loaded.exports)
  const rows = await loaded.exports.loadRows('org')
  assert.equal(rows.timeEstimatesAvailable,true); assert.deepEqual(rows.timeEstimates,estimates)
  assert.ok(calls.some(call => call.table === 'task_time_estimates' && call.method === 'eq' && call.args[0] === 'org_id' && call.args[1] === 'org'))
  assert.ok(calls.some(call => call.table === 'task_time_estimates' && call.method === 'in' && call.args[0] === 'task_id' && call.args[1][0] === 'task'))
  for (const code of ['42P01','PGRST205','PGRST204']) {
    estimateError = { code }
    const old = await loaded.exports.loadRows('org')
    assert.equal(old.timeEstimatesAvailable,false); assert.deepEqual(old.timeEstimates,[])
  }
  estimateError = { code: '57014' }
  await assert.rejects(loaded.exports.loadRows('org'),/TASK_ESTIMATE_READ_FAILED/)
  calls.length = 0
  await loaded.exports.loadRows('org',true)
  assert.equal(calls.some(call => call.table === 'task_time_estimates'),false)
})

test('estimate API requires same origin and module access, keeps trusted identity and never runs background follow-up', async () => {
  const source = readFileSync(new URL('../src/app/api/tasks/route.ts',import.meta.url),'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }, calls = []
  let failure = null, backgroundCalls = 0, accessChecks = 0
  new Function('require','module','exports',compiled)(name => {
    if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) }, after() { backgroundCalls++ } }
    if (name === '@/lib/access/server') return { requireModuleAccess: async () => { accessChecks++ } }
    if (name === '@/lib/assignments/server') return { requireOrgContext: async () => ({ orgId:'org',userId:'session-actor',role:'member' }) }
    if (name === '@/lib/tasks/server') return { performTaskInternalAction: async input => { if (failure) throw Error(failure); calls.push(input); return { workspace:{} } } }
    return {}
  },loaded,loaded.exports)
  const request = origin => new Request('https://hushub.se/api/tasks', { method:'POST',headers:{ 'Content-Type':'application/json',...(origin ? { origin } : {}) }, body:JSON.stringify({ action:'set_time_estimate',payload:{ taskId:'task',estimatedMinutes:5,userId:'forged' } }) })
  assert.equal((await loaded.exports.POST(request(null))).status,403)
  assert.equal((await loaded.exports.POST(request('https://other.example.test'))).status,403)
  assert.equal(calls.length,0)
  assert.equal((await loaded.exports.POST(request('https://hushub.se'))).status,200)
  assert.equal(calls[0].userId,'session-actor'); assert.ok(accessChecks>0); assert.equal(backgroundCalls,0)
  for (const [error,status] of [['TASK_ESTIMATE_INVALID',400],['TASK_ESTIMATE_CONFLICT',409],['TASK_ESTIMATE_FORBIDDEN',403],['TASK_ESTIMATE_SCHEMA_REQUIRED',503],['TASK_ESTIMATE_SAVE_FAILED',503]]) {
    failure = error
    assert.equal((await loaded.exports.POST(request('https://hushub.se'))).status,status)
  }
})
