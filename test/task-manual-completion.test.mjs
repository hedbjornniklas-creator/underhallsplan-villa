import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { manualCompletionGaps, canManuallyCompleteTask } from '../src/lib/tasks/manualCompletion.ts'

const requirement = (id, status, required = true) => ({ id, label: id, status, required })
const task = () => ({ issuerId: 'issuer', status: 'assigned', canCompleteManually: true, requirements: [], attachments: [], evidenceRequirements: [], evidenceRequirement: 'optional' })

test('manual action belongs only to the issuer of an active eligible task', () => {
  for (const status of ['assigned', 'in_progress', 'waiting', 'returned', 'ready_for_review']) assert.equal(canManuallyCompleteTask({ ...task(), status }, 'issuer'), true)
  for (const status of ['approved', 'cancelled', 'draft']) assert.equal(canManuallyCompleteTask({ ...task(), status }, 'issuer'), false)
  assert.equal(canManuallyCompleteTask(task(), 'assignee'), false)
  assert.equal(canManuallyCompleteTask(task(), 'another-admin'), false)
  assert.equal(canManuallyCompleteTask({ ...task(), canCompleteManually: false }, 'issuer'), false)
  assert.equal(canManuallyCompleteTask({ ...task(), canCompleteManually: undefined }, 'issuer'), false)
})

test('gaps are precise, sorted, and never confuse attachments with completion evidence', () => {
  const t = { ...task(), requirements: [requirement('b', 'evidence_detected'), requirement('a', 'pending'), requirement('done', 'verified'), requirement('waived', 'waived'), requirement('optional', 'pending', false)],
    evidenceRequirements: ['text', 'document', 'photo'], attachments: [{ type: 'document', isCompletionEvidence: false }, { type: 'audio', isCompletionEvidence: true, transcriptText: 'redovisning' }] }
  assert.deepEqual(manualCompletionGaps(t).acknowledgement, { requirementIds: ['a', 'b'], evidenceTypes: ['document', 'photo'] })
  assert.equal(manualCompletionGaps({ ...t, attachments: [{ type: 'audio', isCompletionEvidence: true, transcriptText: ' ' }] }).evidenceTypes.includes('text'), true)
  assert.equal(manualCompletionGaps(task()).hasGaps, false)
})

test('legacy evidence requirements remain enforceable', () => {
  assert.deepEqual(manualCompletionGaps({ ...task(), evidenceRequirement: 'any' }).evidenceTypes, ['any'])
  assert.deepEqual(manualCompletionGaps({ ...task(), evidenceRequirement: 'photo' }).evidenceTypes, ['photo'])
  assert.equal(manualCompletionGaps({ ...task(), evidenceRequirement: 'any', attachments: [{ type: 'text', isCompletionEvidence: true }] }).hasGaps, false)
})

function serverHarness(options = {}) {
  const calls = []
  const row = { id: 'task', org_id: 'org', issuer_profile_id: options.issuer ?? 'issuer', created_source: options.source ?? 'manual' }
  const admin = { from(table) { calls.push(['read', table]); const builder = new Proxy({}, { get(_, key) { return key === 'maybeSingle' ? async () => ({ data: table === 'operational_tasks' ? row : null }) : () => builder } }); return builder },
    async rpc(name, payload) { calls.push([name, payload]); return options.result ?? { data: { task: { status: 'approved', completion_method: 'manual' }, replayed: false }, error: null } } }
  const source = readFileSync(new URL('../src/lib/tasks/server.ts', import.meta.url), 'utf8') + '\nexport { completeTaskManually };'
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
    if (name === './manualCompletion') return { MANUAL_COMPLETION_COMMENT_LIMIT: 4000 }
    if (name === './domain') return { DEFAULT_TASK_AUTOMATION_LIMITS: {} }
    return {}
  }, module, module.exports)
  return { run: payload => module.exports.completeTaskManually({ orgId: 'org', userId: 'issuer', payload: { taskId: 'task', version: 7, confirmed: true, comment: 'Bekräftat per telefon', acknowledgedGaps: { requirementIds: [], evidenceTypes: [] }, ...payload } }), calls }
}

test('server uses a scoped atomic RPC with the session actor, never a recipient impersonation', async () => {
  const h = serverHarness()
  assert.match(await h.run({ actorId: 'impostor' }), /manuellt klarmarkerad/)
  const [, payload] = h.calls.find(([name]) => name === 'complete_operational_task_manually')
  assert.equal(payload.p_actor_profile_id, 'issuer')
  assert.equal(payload.p_org_id, 'org')
  assert.equal(h.calls.some(([name]) => name === 'transition_operational_task'), false)
})

test('invalid input and non-issuer/system tasks cannot reach the write RPC', async () => {
  for (const [options, payload, error] of [[{ issuer: 'other' }, {}, /FORBIDDEN/], [{ source: 'system' }, {}, /MANAGED/], [{}, { confirmed: false }, /CONFIRM_REQUIRED/], [{}, { comment: ' ' }, /COMMENT_REQUIRED/], [{}, { comment: 'x'.repeat(4001) }, /COMMENT_REQUIRED/], [{}, { version: 0 }, /VERSION_REQUIRED/]]) {
    const h = serverHarness(options)
    await assert.rejects(h.run(payload), error)
    assert.equal(h.calls.some(([name]) => name === 'complete_operational_task_manually'), false)
  }
})

test('stale writes and a missing migration are clear failures; replay does not dispatch recurrence twice', async () => {
  await assert.rejects(serverHarness({ result: { error: { message: 'TASK_VERSION_CONFLICT' } } }).run(), /VERSION_CONFLICT/)
  await assert.rejects(serverHarness({ result: { error: { code: 'PGRST202' } } }).run(), /SCHEMA_REQUIRED/)
  const h = serverHarness({ result: { data: { task: { status: 'approved', completion_method: 'manual' }, replayed: true } } })
  assert.match(await h.run(), /redan manuellt/)
  assert.equal(h.calls.some(([name, table]) => name === 'read' && table === 'task_events'), false)
})

test('UI and API retain the explicit confirmation, retry and dialog boundaries', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const dialog = read('src/components/tasks/TaskManualCompletionDialog.tsx')
  assert.match(dialog, /showModal\(\)/)
  assert.match(dialog, /acknowledgedKey === acknowledgementKey/)
  assert.match(dialog, /JSON.stringify\(\[task.id, task.version, gaps.acknowledgement\]\)/)
  assert.match(dialog, /maxLength=\{MANUAL_COMPLETION_COMMENT_LIMIT\}/)
  assert.match(dialog, /task.openChildCount > 0/)
  assert.match(dialog, /submittingRef.current/)
  assert.match(read('src/components/tasks/TaskDetailSheet.tsx'), /if \(manualCompletionOpen\) return/)
  assert.match(read('src/app/api/tasks/route.ts'), /'TASK_MANUAL_COMPLETION_FORBIDDEN'/)
  assert.match(read('src/app/api/tasks/route.ts'), /action === 'complete_manually' && request.headers.get\('origin'\)/)
})

test('API checks the origin of manual completion and derives the actor from its session', async () => {
  const source = readFileSync(new URL('../src/app/api/tasks/route.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }, calls = []
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) }, after() {} }
    if (name === '@/lib/access/server') return { requireModuleAccess: async () => {} }
    if (name === '@/lib/assignments/server') return { requireOrgContext: async () => ({ orgId: 'org', userId: 'session-actor', role: 'member' }) }
    if (name === '@/lib/tasks/server') return { performTaskInternalAction: async input => { calls.push(input); return { workspace: {} } } }
    return {}
  }, module, module.exports)
  const request = origin => new Request('https://hushub.se/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify({ action: 'complete_manually', payload: { userId: 'spoofed' } }) })
  assert.equal((await module.exports.POST(request('https://other.example.test'))).status, 403)
  assert.equal((await module.exports.POST(request(null))).status, 403)
  assert.equal(calls.length, 0)
  assert.equal((await module.exports.POST(request('https://hushub.se'))).status, 200)
  assert.equal(calls[0].userId, 'session-actor')
})
