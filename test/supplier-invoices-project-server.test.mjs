import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/projectCompletion.ts'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, ctx = { orgId: id(1), userId: id(2) }, project = id(3)
function load(file, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, module = { exports: {} }
  new Function('require', 'module', 'exports', code)(key => { if (key in dependencies) return dependencies[key]; throw Error(key) }, module, module.exports)
  return module.exports
}
function harness(options = {}) {
  const reads = [], calls = [], rows = options.sources ?? []
  const db = { from(table) { const r = { table, filters: [], offset: 0, end: 499 }; reads.push(r); const q = { select() { return q }, eq(...args) { r.filters.push(args); return q }, order() { return q }, range(a, b) { r.offset = a; r.end = b; return q }, then(resolve) { resolve({ data: rows.slice(r.offset, r.end + 1) }) } }; return q }, rpc: async (name, args) => { calls.push({ name, args }); if (options.error) return { error: options.error }; return { data: name === 'project_supplier_invoice_context' ? { userId: ctx.userId, status: 'in_progress', targets: [] } : { id: args.p_request.id, revision: 1 } } } }
  const server = load('src/lib/supplier-invoices/projectServer.ts', { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/action-cases/projectCompletion': domain, './server': { getSupplierInvoiceWorkspace: async () => ({ invoices: [{ id: id(4), allocations: [{ caseId: project }] }, { id: id(5), allocations: [{ caseId: id(6) }] }] }) } })
  return { server, calls, reads }
}
const request = () => ({ id: id(10), requestId: id(11), confirmed: true, body: domain.emptyInvoiceBasis({ issuer: 'Test AB', recipient: 'Testkund' }), sources: [{ invoiceId: id(4), revision: 1, allocationId: id(7), lineId: id(8), part: 'material', markupPercent: 15, vatRate: 25, description: 'Material', agreement: 'Kundens mejl 2026-11-07' }] })
test('project list authenticates before reading, scopes and paginates basis sources, filters other projects', async () => {
  const h = harness({ sources: Array.from({ length: 501 }, (_, n) => ({ invoice_id: id(4), allocation_id: id(n + 100), basis_id: id(10), line_id: id(n + 1000), customer_net_ore: '100', agreement: 'Test' })) })
  const result = await h.server.getProjectSupplierInvoices(ctx, project)
  assert.deepEqual(result.invoices.map(i => i.id), [id(4)]); assert.equal(result.links.length, 501)
  assert.equal(h.reads.length, 2)
  for (const read of h.reads) { assert.deepEqual(read.filters, [['org_id', ctx.orgId], ['action_case_id', project]]); assert.equal(read.table, 'supplier_invoice_basis_sources') }
  assert.deepEqual(h.calls[0].args, { p_org: ctx.orgId, p_case: project, p_actor: ctx.userId })
})
test('basis requests whitelist data and use server identity, not client organization or internal price', async () => {
  const h = harness(), r = request(); r.sources[0].customerNetOre = 1; r.body.contract = 'ignored'
  await h.server.createProjectSupplierBasis(ctx, project, { ...r, orgId: id(900) })
  const call = h.calls[1]; assert.equal(call.name, 'create_supplier_invoice_basis'); assert.equal(call.args.p_org, ctx.orgId); assert.equal(call.args.p_actor, ctx.userId)
  assert.equal(call.args.p_request.sources[0].customerNetOre, undefined); assert.equal(call.args.p_request.body.contract, undefined)
  assert.equal(call.args.p_request.sources[0].part, 'material')
})
test('malformed money, IDs, dates, parts, missing approvals and schema errors fail before a mutation', async () => {
  for (const patch of [{ markupPercent: null }, { markupPercent: -1 }, { markupPercent: 1.234 }, { markupPercent: Infinity }, { vatRate: '25' }, { allocationId: 'bad' }, { agreement: '' }, { description: '' }, { part: 'secret' }]) {
    const h = harness(), r = request(); r.sources[0] = { ...r.sources[0], ...patch }
    await assert.rejects(h.server.createProjectSupplierBasis(ctx, project, r), /INVALID/); assert.equal(h.calls.length, 1)
  }
  const h = harness({ error: { code: '42883' } }); await assert.rejects(h.server.getProjectSupplierInvoices(ctx, project), /SCHEMA_REQUIRED/); assert.equal(h.reads.length, 0)
})
