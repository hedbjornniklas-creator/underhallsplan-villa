import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function harness(error) {
  const calls = [], mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (name) => name === '@/lib/supabase/admin'
    ? { createSupabaseAdminClient: () => ({ rpc: async (name, data) => { calls.push({ name, data }); return { error } } }) } : {})
  return { calls, remove: (more = {}) => mod.exports.deleteActionCaseItem({ orgId: id(1), userId: id(2) }, {
    caseId: id(3), itemId: id(4), expectedUpdatedAt: '2026-10-05T10:00:00Z', ...more,
  }) }
}
test('item deletion uses one transactional RPC with trusted tenant and user identity', async () => {
  const h = harness()
  await h.remove({ orgId: id(9), userId: id(9) })
  assert.deepEqual(h.calls, [{ name: 'delete_action_case_item', data: {
    p_org_id: id(1), p_user_id: id(2), p_case_id: id(3), p_item_id: id(4), p_expected_updated_at: '2026-10-05T10:00:00Z',
  } }])
  for (const patch of [{ itemId: '' }, { caseId: 'bad' }, { expectedUpdatedAt: null }, { expectedUpdatedAt: 'bad' }]) {
    const invalid = harness(); await assert.rejects(invalid.remove(patch)); assert.equal(invalid.calls.length, 0)
  }
})
test('deletion propagates safe conflict codes and explains a missing migration', async () => {
  for (const name of ['NOT_FOUND', 'ITEM_STALE', 'ITEM_DELETE_LOCKED', 'ITEM_DELETE_QUOTES', 'ITEM_DELETE_OFFER', 'ITEM_DELETE_SCHEDULE'])
    await assert.rejects(harness({ message: `ACTION_CASE_${name}` }).remove(), { message: `ACTION_CASE_${name}` })
  await assert.rejects(harness({ code: 'PGRST202', message: 'private schema details' }).remove(), /SCHEMA_REQUIRED/)
  await assert.rejects(harness({ message: 'private database details' }).remove(), { message: 'ACTION_CASE_ITEM_DELETE_FAILED' })
})
