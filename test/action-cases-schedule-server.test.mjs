import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as schedule from '../src/lib/action-cases/projectSchedule.ts'

function setup({ exists = true, stale = false, sourceExists = true, missing = false } = {}) {
  const calls = []
  const db = {
    from(table) {
      const query = { select(columns) { calls.push(['select', table, columns]); return this }, eq(key, value) { calls.push(['eq', table, key, value]); return this },
        async in(_key, values) { return { data: sourceExists ? values.map((id) => ({ id })) : [], error: null } },
        async maybeSingle() { return { data: table === 'action_cases' ? exists ? { id: 'case-a' } : null : { revision: 1, rows: [], shared_rows: [] }, error: missing && table === 'action_case_schedules' ? { code: '42P01' } : null } }
      }
      return query
    },
    async rpc(name, args) { calls.push(['rpc', name, args]); return { error: stale ? { message: 'PROJECT_SCHEDULE_STALE' } : null } }
  }
  const loaded = { exports: {} }
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/projectScheduleServer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', source)((name) => {
    if (name === 'server-only') return {}
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => db }
    if (name === './customerOffers') return { offerId: (id) => id }
    if (name === './projectSchedule') return schedule
    throw new Error(name)
  }, loaded, loaded.exports)
  return { ...loaded.exports, calls }
}
const ctx = { orgId: 'org-a', userId: 'user-a' }
test('schedule writes are scoped and optimistic, with no agreement mutation', async () => {
  const s = setup()
  await s.writeProjectSchedule(ctx, 'case-a', { operation: 'save', revision: 4, rows: [] })
  assert.ok(s.calls.some((c) => c[0] === 'eq' && c[1] === 'action_cases' && c[2] === 'org_id' && c[3] === 'org-a'))
  const rpc = s.calls.find((c) => c[0] === 'rpc')
  assert.equal(rpc[1], 'write_action_case_schedule')
  assert.deepEqual(rpc[2], { p_org_id: 'org-a', p_case_id: 'case-a', p_user_id: 'user-a', p_operation: 'save', p_revision: 4, p_rows: [] })
})
test('other-org/missing project cannot write, stale writes are reported', async () => {
  const s = setup({ exists: false })
  await assert.rejects(() => s.writeProjectSchedule(ctx, 'case-b', { operation: 'save', revision: 0, rows: [] }), /NOT_FOUND/)
  assert.equal(s.calls.some((c) => c[0] === 'rpc'), false)
  await assert.rejects(() => setup({ stale: true }).writeProjectSchedule(ctx, 'case-a', { operation: 'save', revision: 0, rows: [] }), /STALE/)
})
test('shared read never selects internal rows and pre-migration reads remain available', async () => {
  const s = setup()
  await s.getSharedProjectSchedule('org-a', 'case-a')
  assert.deepEqual(s.calls[0], ['select', 'action_case_schedules', 'shared_rows'])
  assert.equal((await setup({ missing: true }).getProjectSchedule(ctx, 'case-a')).available, false)
})
test('sharing requires explicit confirmation and cannot smuggle unsaved rows', async () => {
  const s = setup()
  await assert.rejects(() => s.writeProjectSchedule(ctx, 'case-a', { operation: 'share', revision: 0 }), /INVALID/)
  await s.writeProjectSchedule(ctx, 'case-a', { operation: 'share', revision: 0, confirmed: true, rows: ['untrusted'] })
  assert.deepEqual(s.calls.find((c) => c[0] === 'rpc')[2].p_rows, [])
})
test('foreign source items are rejected before the write', async () => {
  const s = setup({ sourceExists: false })
  await assert.rejects(() => s.writeProjectSchedule(ctx, 'case-a', { operation: 'save', revision: 0, rows: [{ id: '00000000-0000-4000-8000-000000000001', sourceItemId: '00000000-0000-4000-8000-000000000002', title: 'Moment', phase: '', startDate: '', endDate: '', status: 'planned' }] }), /INVALID/)
  assert.equal(s.calls.some((c) => c[0] === 'rpc'), false)
})
test('migration restricts direct access and locks first saves and later revisions', () => {
  const sql = readFileSync(new URL('../docs/db/2026-10-01_04_action_case_schedule.sql', import.meta.url), 'utf8')
  assert.match(sql, /enable row level security/)
  assert.match(sql, /from public, anon, authenticated/)
  assert.match(sql, /action_cases where id = p_case_id and org_id = p_org_id for update/)
  assert.match(sql, /s.revision <> p_revision/)
  assert.match(sql, /shared_rows = s.rows/)
  assert.doesNotMatch(sql, /update public.action_case_customer_offers/)
})
