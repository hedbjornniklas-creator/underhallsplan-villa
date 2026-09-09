import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as costing from '../src/lib/action-cases/costing.ts'

const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/costingAiServer.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const proposal = { lines: [{ category: 'own_labor', description: 'Förarbete', quantity: 2, unit: 'tim', quantityBasis: 'estimated', notes: 'Kontrollera tidsåtgång.' }], warnings: [] }
function harness({ found = true, scope = 'Byt skadad list', schemaError = false, count = 0, httpStatus = 200, httpBody, headers, status = 'completed', content, fetchError, saveError = false, apiKey = 'test-only-key' } = {}) {
  const saved = [], calls = [], reads = [], logs = []
  const admin = { from(table) {
    const query = { table, filters: [] }; reads.push(query)
    const result = table === 'action_case_items' ? { data: found ? { id: 'item', title: 'Reparation', scope, updated_at: '2026-09-08T12:00:00Z' } : null, error: null }
      : table === 'action_case_cost_lines' ? { data: [{ description: 'Befintlig rad', unit_cost: 123 }], error: null }
        : { count, error: schemaError ? { code: '42P01' } : null }
    const chain = {
      select() { return chain }, order() { return chain }, eq(...args) { query.filters.push(args); return chain },
      gte() { return chain }, maybeSingle() { return Promise.resolve(result) },
      then(resolve) { return Promise.resolve(result).then(resolve) },
      insert(row) { if (!saveError) saved.push(row); return Promise.resolve({ error: saveError ? {} : null }) },
    }
    return chain
  } }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'fetch', 'process', 'console', code)(mod, mod.exports, (name) => {
    if (name === 'server-only') return {}
    if (name === './costing') return costing
    if (name === 'node:crypto') return { randomUUID: () => 'generated-id' }
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
    throw new Error(name)
  }, async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) })
    if (fetchError) throw fetchError
    return new Response(httpBody ?? JSON.stringify({ status, output: [{ content: content ?? [{ type: 'output_text', text: JSON.stringify(proposal) }] }] }), { status: httpStatus, headers })
  }, { env: { OPENAI_API_KEY: apiKey } }, { error: (...args) => logs.push(args) })
  return { saved, calls, reads, logs, run: () => mod.exports.generateActionCaseCosts({ orgId: 'org', userId: 'user' }, { itemId: 'item', caseId: 'case' }) }
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

test('local organisation limit is distinct and stops before OpenAI', async () => {
  const h = harness({ count: 10 })
  await assert.rejects(h.run(), { message: 'ACTION_CASE_AI_ORG_LIMIT' })
  assert.equal(h.calls.length, 0)
  assert.equal(h.saved.length, 0)
  const allowed = harness({ count: 9 }); await allowed.run()
  assert.equal(allowed.saved.length, 1)
})

test('provider billing, access and temporary limits are distinguished without retries or writes', async () => {
  const cases = [
    [429, 'credit_balance_exhausted', 'insufficient_quota', 'CREDIT_BALANCE'],
    [429, 'insufficient_quota', 'insufficient_quota', 'QUOTA_EXCEEDED'],
    [429, null, 'insufficient_quota', 'QUOTA_EXCEEDED'],
    [429, 'organization_spend_limit_exceeded', null, 'QUOTA_EXCEEDED'],
    [429, 'project_spend_limit_exceeded', null, 'QUOTA_EXCEEDED'],
    [429, 'organization_usage_limit_exceeded', null, 'QUOTA_EXCEEDED'],
    [429, 'billing_hard_limit_reached', null, 'QUOTA_EXCEEDED'],
    [429, 'rate_limit_exceeded', 'tokens', 'RATE_LIMIT'],
    [429, 'slow_down', 'rate_limit_error', 'RATE_LIMIT'],
    [401, 'invalid_api_key', null, 'ACCESS_FAILED'],
    [403, null, null, 'ACCESS_FAILED'],
    [404, 'model_not_found', null, 'ACCESS_FAILED'],
    [500, 'server_error', null, 'FAILED'],
  ]
  for (const [httpStatus, providerCode, providerType, expected] of cases) {
    const h = harness({ httpStatus, headers: { 'x-request-id': 'req_test123' }, httpBody: JSON.stringify({ error: {
      code: providerCode, type: providerType, message: 'Private customer data and secret test-only-key',
    } }) })
    await assert.rejects(h.run(), { message: `ACTION_CASE_AI_${expected}` })
    assert.equal(h.calls.length, 1)
    assert.equal(h.saved.length, 0)
    assert.deepEqual(h.logs[0][1], { status: httpStatus, model: 'gpt-5.4-mini', providerCode, providerType, requestId: 'req_test123' })
    assert.doesNotMatch(JSON.stringify(h.logs), /Private customer|test-only-key|Byt skadad list/)
  }
})

test('missing or malformed upstream error bodies still return safe errors', async () => {
  for (const httpBody of ['<html>upstream unavailable</html>', 'null', '{}', '{"error":null}', '{"error":{"code":"secret with spaces","type":{}}}']) {
    const h = harness({ httpStatus: 429, httpBody, headers: { 'x-request-id': 'unexpected private data' } })
    await assert.rejects(h.run(), { message: 'ACTION_CASE_AI_RATE_LIMIT' })
    assert.equal(h.saved.length, 0)
    assert.deepEqual(h.logs[0][1], { status: 429, model: 'gpt-5.4-mini', providerCode: null, providerType: null, requestId: null })
  }
})

test('malformed success envelopes do not leak technical parsing errors', async () => {
  for (const httpBody of ['secret upstream response', 'null', '{}', '{"status":"completed","output":[null]}']) {
    const h = harness({ httpBody })
    await assert.rejects(h.run(), { message: 'ACTION_CASE_AI_INVALID' })
    assert.equal(h.saved.length, 0)
  }
})

test('action-case API keeps technical AI failures private and schedules admin handling', async () => {
  const routeCode = ts.transpileModule(readFileSync(new URL('../src/app/api/action-cases/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const [errorCode, status] of [
    ['CREDIT_BALANCE', 503], ['QUOTA_EXCEEDED', 503], ['ACCESS_FAILED', 503], ['NOT_CONFIGURED', 503],
    ['ORG_LIMIT', 429], ['RATE_LIMIT', 429], ['TIMEOUT', 504], ['INVALID', 502], ['FAILED', 502], ['SAVE_FAILED', 500],
    ['SCOPE_REQUIRED', 400], ['STALE', 409],
  ]) {
    const mod = { exports: {} }
    const alerts = []
    new Function('module', 'exports', 'require', routeCode)(mod, mod.exports, (name) => {
      if (name === 'next/server') return { NextResponse: { json: (data, init) => Response.json(data, init) } }
      if (name === '@/lib/access/server') return { requireModuleAccess: async () => {} }
      if (name === '@/lib/assignments/server') return { requireOrgContext: async () => ({ orgId: 'org', userId: 'user' }) }
      if (name === '@/lib/action-cases/costingAiServer') return { generateActionCaseCosts: async () => { throw new Error(`ACTION_CASE_AI_${errorCode}`) } }
      if (name === '@/lib/action-cases/costingAiAlerts') return { scheduleActionCaseAiAdminAlert: (code) => alerts.push(code) }
      if (['@/lib/action-cases/server', '@/lib/action-cases/quotesServer', '@/lib/action-cases/quoteRequestsServer'].includes(name)) return {}
      throw new Error(name)
    })
    const response = await mod.exports.POST(new Request('https://example.test/api/action-cases', {
      method: 'POST', body: JSON.stringify({ action: 'generate_cost_suggestions', payload: { itemId: 'item', caseId: 'case' } }),
    }))
    assert.equal(response.status, status)
    const body = await response.json()
    if (['SCOPE_REQUIRED', 'STALE'].includes(errorCode)) {
      assert.equal(body.code, `ACTION_CASE_AI_${errorCode}`)
      assert.match(body.error, /omfattning|Omfattningen/)
      assert.deepEqual(alerts, [])
    } else {
      assert.equal(body.code, 'ACTION_CASE_AI_UNAVAILABLE')
      assert.equal(body.error, 'Kalkylförslaget kunde inte skapas just nu. Försök igen senare. Dina befintliga kalkylrader är kvar.')
      assert.doesNotMatch(JSON.stringify(body), /OpenAI|saldo|kvot|API|CREDIT_BALANCE|QUOTA_EXCEEDED|NOT_CONFIGURED|ACCESS_FAILED|jn@/)
      assert.deepEqual(alerts, [`ACTION_CASE_AI_${errorCode}`])
    }
    assert.deepEqual(Object.keys(body).sort(), ['code', 'error'])
  }
})
