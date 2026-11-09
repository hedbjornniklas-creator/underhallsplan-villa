import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/billingFlow.ts'
import * as sources from '../src/lib/action-cases/billingFlowSources.ts'
import * as completion from '../src/lib/action-cases/projectCompletion.ts'

const ctx = { orgId: id(), userId: id() }, caseId = id(), hash = '0123456789abcdef0123456789abcdef'
function load(file, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, m = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { if (name in dependencies) return dependencies[name]; throw Error(name) }, m, m.exports)
  return m.exports
}
function harness(options = {}) {
  const reads = [], calls = [], raw = { source: { caseId, title: 'Test', manager: options.denied ? id() : ctx.userId, status: 'in_progress', legacy: [], openQuestions: 0 }, body: options.body ?? null, revision: options.revision ?? 0, contextHash: hash, history: [] }
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return options.error ? { error: options.error } : { data: name.startsWith('read_') ? raw : { revision: 1 } } },
    from(table) { const read = { table, filters: [] }; reads.push(read); const q = { select() { return q }, eq(...args) { read.filters.push(args); return q }, maybeSingle: async () => ({ data: options.previous || null }) }; return q } }
  const server = load('src/lib/action-cases/billingFlowServer.ts', { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, './projectCompletion': completion, './billingFlow': domain, './billingFlowSources': sources })
  return { ...server, reads, calls, raw }
}
const command = { operation: 'confirm_legacy', note: 'Fiktiv avstämning' }
const request = () => ({ requestId: id(), revision: 0, contextHash: hash, command })

test('billing reads remain read-only and scoped to the authenticated organization/project', async () => {
  const h = harness(), w = await h.getBillingFlow(ctx, caseId)
  assert.equal(w.revision, 0); assert.deepEqual(w.flow, domain.emptyBillingFlow()); assert.equal(w.canManage, true)
  assert.deepEqual(h.calls, [{ name: 'read_project_billing_flow', args: { p_org: ctx.orgId, p_case: caseId, p_actor: ctx.userId } }])
  await assert.rejects(harness({ body: { version: 1 } }).getBillingFlow(ctx, caseId), /INVALID/)
  await assert.rejects(harness({ error: { code: '42883' } }).getBillingFlow(ctx, caseId), /SCHEMA_REQUIRED/)
})

test('only manager commands reach the billing RPC; arbitrary client body/contract fields are ignored', async () => {
  const h = harness(), payload = { ...request(), body: { prices: 'attack' }, contract: 'attack' }
  await h.writeBillingFlow(ctx, caseId, payload)
  const write = h.calls.at(-1)
  assert.equal(write.name, 'write_project_billing_flow'); assert.deepEqual(write.args.p_body, { ...domain.emptyBillingFlow(), legacyConfirmed: true, legacyNote: command.note })
  assert.deepEqual(write.args.p_request, command); assert.equal(write.args.p_actor, ctx.userId); assert.equal(write.args.p_org, ctx.orgId)
  assert.deepEqual(h.reads[0].filters.slice(1), [['org_id', ctx.orgId], ['action_case_id', caseId]])
  const denied = harness({ denied: true }); await assert.rejects(denied.writeBillingFlow(ctx, caseId, request()), /FORBIDDEN/)
  assert.equal(denied.calls.length, 1)
  for (const patch of [{ requestId: 'x' }, { revision: -1 }, { contextHash: '' }, { command: { operation: 'paid' } }]) await assert.rejects(harness().writeBillingFlow(ctx, caseId, { ...request(), ...patch }), /INVALID/)
})

test('uncertain responses replay exactly while stale or altered commands cannot overwrite newer data', async () => {
  const r = request(), previous = { revision: 1, request: command, actor_id: ctx.userId }, h = harness({ revision: 9, previous })
  assert.deepEqual(await h.writeBillingFlow(ctx, caseId, r), { revision: 1 }); assert.equal(h.calls.length, 1)
  await assert.rejects(h.writeBillingFlow(ctx, caseId, { ...r, command: { ...command, note: 'Ändrat' } }), /STALE/)
  await assert.rejects(harness({ revision: 1 }).writeBillingFlow(ctx, caseId, r), /STALE/)
  await assert.rejects(harness().writeBillingFlow(ctx, caseId, { ...r, contextHash: '1'.repeat(32) }), /SOURCE_CHANGED/)
})

function route(options = {}) {
  const basis = { id: id(), version: 1, title: 'Testunderlag', date: '2026-11-09', projectTitle: 'Fryst projektnamn', issuer: 'Fryst AB', recipient: 'Fryst kund', note: 'Kundnotering', lines: [{ id: id(), description: 'Fiktiv post', netOre: 10000, vatRate: 25 }], status: options.status || 'exported', historical: !!options.historical, exportedAt: '2026-11-09' }
  const calls = [], deps = { 'next/server': { NextResponse: Response }, '@/lib/action-cases/customerOffersHttp': { customerOfferContext: async () => { calls.push('auth'); if (options.denied) throw Error('DENIED'); return ctx }, offerRequestBody: async () => { calls.push('body'); if (options.badOrigin) throw Error('ORIGIN'); return request() } },
    '@/lib/action-cases/billingFlowHttp': { billingFlowError: e => Response.json({ error: e.message }, { status: 409 }) }, '@/lib/action-cases/projectCompletion': completion,
    '@/lib/action-cases/invoiceBasisPdf': { renderInvoiceBasisPdf: async (record, title, tax) => { calls.push('render'); assert.equal(record.body.issuer, 'Fryst AB'); assert.equal(record.body.recipient, 'Fryst kund'); assert.equal(title, 'Fryst projektnamn'); assert.equal(tax, true); return Buffer.from('%PDF-test') } },
    '@/lib/action-cases/billingFlowServer': { getBillingFlow: async (actual, project) => { assert.deepEqual(actual, ctx); assert.equal(project, caseId); const second = calls.includes('read'); calls.push('read'); return { title: 'Ändrat projektnamn', flow: { bases: [{ ...basis, ...(second && options.cancelled ? { status: 'cancelled' } : {}) }] } } }, writeBillingFlow: async () => { calls.push('write'); return { revision: 1 } } } }
  const pdf = load('src/app/api/action-cases/[caseId]/billing-flow/[basisId]/pdf/route.ts', deps), api = load('src/app/api/action-cases/[caseId]/billing-flow/route.ts', deps)
  return { calls, pdf: () => pdf.GET(new Request('http://localhost/pdf'), { params: Promise.resolve({ caseId, basisId: basis.id }) }), post: () => api.POST(new Request('http://localhost/api', { method: 'POST' }), { params: Promise.resolve({ caseId }) }) }
}
test('new PDF exports frozen data only, authenticates twice through scoped reads and blocks cancelled/historical documents', async () => {
  const h = route(), result = await h.pdf()
  assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert.match(result.headers.get('Content-Disposition'), /20261109/)
  assert.deepEqual(h.calls, ['auth', 'read', 'render', 'read'])
  for (const option of [{ status: 'reserved' }, { historical: true }, { denied: true }, { cancelled: true }]) assert.equal((await route(option).pdf()).status, 409)
})
test('POST authenticates and validates the request origin before a mutation', async () => {
  const denied = route({ denied: true }); await denied.post(); assert.deepEqual(denied.calls, ['auth'])
  const origin = route({ badOrigin: true }); await origin.post(); assert.deepEqual(origin.calls, ['auth', 'body'])
  const ok = route(); assert.equal((await ok.post()).status, 200); assert.deepEqual(ok.calls, ['auth', 'body', 'write'])
})
