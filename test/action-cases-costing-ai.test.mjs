import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as costing from '../src/lib/action-cases/costing.ts'

const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/costingAiServer.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const proposal = { lines: [{ category: 'own_labor', description: 'Förarbete', quantity: 2, unit: 'tim', quantityBasis: 'estimated', notes: 'Kontrollera tidsåtgång.' }], warnings: [] }
function harness({ found = true, scope = 'Byt skadad list', schemaError = false, httpStatus = 200, status = 'completed', content, fetchError, saveError = false, apiKey = 'test-only-key' } = {}) {
  const saved = [], calls = [], reads = []
  const admin = { from(table) {
    const query = { table, filters: [] }; reads.push(query)
    const result = table === 'action_case_items' ? { data: found ? { id: 'item', title: 'Reparation', scope, updated_at: '2026-09-08T12:00:00Z' } : null, error: null }
      : table === 'action_case_cost_lines' ? { data: [{ description: 'Befintlig rad', unit_cost: 123 }], error: null }
        : { count: 0, error: schemaError ? { code: '42P01' } : null }
    const chain = {
      select() { return chain }, order() { return chain }, eq(...args) { query.filters.push(args); return chain },
      gte() { return chain }, maybeSingle() { return Promise.resolve(result) },
      then(resolve) { return Promise.resolve(result).then(resolve) },
      insert(row) { if (!saveError) saved.push(row); return Promise.resolve({ error: saveError ? {} : null }) },
    }
    return chain
  } }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'fetch', 'process', code)(mod, mod.exports, (name) => {
    if (name === 'server-only') return {}
    if (name === './costing') return costing
    if (name === 'node:crypto') return { randomUUID: () => 'generated-id' }
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
    throw new Error(name)
  }, async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) })
    if (fetchError) throw fetchError
    return new Response(JSON.stringify({ status, output: [{ content: content ?? [{ type: 'output_text', text: JSON.stringify(proposal) }] }] }), { status: httpStatus })
  }, { env: { OPENAI_API_KEY: apiKey } })
  return { saved, calls, reads, run: () => mod.exports.generateActionCaseCosts({ orgId: 'org', userId: 'user' }, { itemId: 'item', caseId: 'case' }) }
}
test('generates a persisted preview from scoped saved data, with no price or write tools', async () => {
  const h = harness(); await h.run()
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].source_updated_at, '2026-09-08T12:00:00Z')
  assert.equal(h.saved[0].lines[0].id, 'generated-id')
  assert.equal('unitCost' in h.saved[0].lines[0], false)
  assert.equal(h.calls[0].body.store, false)
  assert.equal(h.calls[0].body.text.format.strict, true)
  assert.equal(h.calls[0].body.tools, undefined)
  assert.ok(h.calls[0].options.signal)
  assert.ok(h.reads.slice(0, 3).every((query) => query.filters.some(([key, value]) => key === 'org_id' && value === 'org')))
})
test('refusal, incomplete output, invalid JSON, timeout and provider errors never save rows', async () => {
  for (const options of [
    { content: [{ type: 'refusal' }] }, { status: 'incomplete' },
    { content: [{ type: 'output_text', text: 'not json' }] },
    { fetchError: new DOMException('timeout', 'TimeoutError') }, { httpStatus: 429 }, { httpStatus: 500 },
    { saveError: true },
  ]) {
    const h = harness(options)
    await assert.rejects(h.run(), /ACTION_CASE_AI_/)
    assert.equal(h.saved.length, 0)
  }
})
test('missing tenant item, empty scope, missing schema/key stop before OpenAI', async () => {
  for (const options of [{ found: false }, { scope: '' }, { schemaError: true }, { apiKey: '' }]) {
    const h = harness(options); await assert.rejects(h.run()); assert.equal(h.calls.length, 0)
  }
})
