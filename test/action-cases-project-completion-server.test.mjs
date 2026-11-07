import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/projectCompletion.ts'

const org = id(), user = id(), caseId = id(), docId = id(), ctx = { orgId: org, userId: user }
const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/projectCompletionServer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options = {}) {
  const reads = [], writes = [], body = domain.emptyInvoiceBasis({ issuer: 'Saved issuer', recipient: 'Saved recipient' })
  const rows = { org_members: { profile_id: user }, action_cases: { id: caseId, title: 'Testprojekt', customer_name: 'Kund', status: 'in_progress', manager_profile_id: options.manager === false ? id() : user },
    action_case_completion: { revision: 2, work_complete: true, invoiced: false },
    action_case_invoice_basis: [{ id: docId, revision: 3, body, updated_at: '2026-11-07' }],
    action_case_questions: [{ body: { status: 'answered' } }, { body: { status: 'closed' } }], action_case_administration_events: [],
    action_case_contract_senders: { snapshot: { name: 'Brand', legalName: 'Legal Test AB', organizationNumber: '1234567890' } }, action_case_billing: { customer_id: id() },
    organization_customers: { name: 'Buyer', invoice_same_as_customer: false, invoice_name: 'Invoice recipient', invoice_address: 'Testgatan 1', invoice_postal_code: '12345', invoice_city: 'Teststad' } }
  if (options.noMember) rows.org_members = null
  if (options.noProject) rows.action_cases = null
  const db = { from(table) { const read = { table, filters: [] }; reads.push(read); const query = { select() { return query }, eq(...args) { read.filters.push(args); return query }, order() { return query }, limit() { return query }, maybeSingle() { return query }, then(resolve) { resolve({ data: rows[table], error: options.schema && table === 'action_case_completion' ? { code: '42P01' } : null }) } }; return query },
    rpc: async (name, payload) => { writes.push({ name, payload }); return options.rpcError ? { error: options.rpcError } : { data: { revision: 4, id: docId, status: 'in_progress' } } } }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'server-only') return {}
    if (name.includes('supabase/admin')) return { createSupabaseAdminClient: () => db }
    if (name === './projectCompletion') return domain
    throw Error(name)
  }, module, module.exports)
  return { ...module.exports, reads, writes, body }
}
test('workspace scopes private reads and keeps saved issuer/recipient snapshots separate from new defaults', async () => {
  const h = harness(), w = await h.getProjectCompletion(ctx, caseId)
  assert.equal(w.openQuestions, 1); assert.equal(w.defaults.issuer, 'Legal Test AB\n1234567890'); assert.match(w.defaults.recipient, /Invoice recipient\nTestgatan 1/)
  assert.equal(w.bases[0].body.issuer, 'Saved issuer'); assert.equal(w.bases[0].body.recipient, 'Saved recipient')
  for (const read of h.reads) assert.ok(read.filters.some(([field, value]) => field === 'org_id' && value === org), read.table)
})
test('unrelated employees cannot infer hidden question counts; missing membership/project/schema has a clear error', async () => {
  const h = harness({ manager: false }), w = await h.getProjectCompletion(ctx, caseId)
  assert.equal(w.canManage, false); assert.equal(w.openQuestions, null); assert.ok(!h.reads.some(r => r.table === 'action_case_questions'))
  for (const [options, error] of [[{ noMember: true }, /FORBIDDEN/], [{ noProject: true }, /NOT_FOUND/], [{ schema: true }, /SCHEMA/]]) await assert.rejects(harness(options).getProjectCompletion(ctx, caseId), error)
})
test('writes normalize only invoice data into its dedicated RPC, never contract/costing tables', async () => {
  const h = harness()
  await h.writeProjectCompletion(ctx, caseId, { operation: 'save_basis', id: docId, revision: 3, requestId: id(), body: h.body, contract: 'ignored' })
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].name, 'write_project_administration')
  assert.equal(h.writes[0].payload.p_org_id, org); assert.equal(h.writes[0].payload.p_actor_id, user)
  assert.ok(!('contract' in h.writes[0].payload.p_request))
  await assert.rejects(h.writeProjectCompletion(ctx, caseId, { operation: 'paid', revision: 0, requestId: id() }), /INVALID/)
  await assert.rejects(harness({ rpcError: { message: 'PROJECT_ADMIN_STALE' } }).writeProjectCompletion(ctx, caseId, { operation: 'complete', revision: 0, requestId: id(), confirmed: true }), /STALE/)
})
test('PDF endpoint authenticates, uses saved revision and checks again after rendering', () => {
  const route = readFileSync(new URL('../src/app/api/action-cases/[caseId]/invoice-basis/[basisId]/pdf/route.ts', import.meta.url), 'utf8')
  assert.match(route, /await customerOfferContext\(\)/); assert.match(route, /getProjectCompletion\(ctx, caseId\)/)
  assert.match(route, /searchParams.get\('revision'\)/); assert.match(route, /fresh.data.revision !== record.revision/)
  assert.match(route, /Cache-Control.*no-store/)
  assert.ok(route.indexOf('renderInvoiceBasisPdf') < route.lastIndexOf("from('action_case_invoice_basis')"))
})
