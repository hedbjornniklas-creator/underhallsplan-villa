import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as properties from '../src/lib/properties/identity.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import * as costing from '../src/lib/action-cases/customerOfferCosting.ts'
import { emptyContractDetails, editContractProperty } from '../src/lib/action-cases/customerContract.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3)
const property = { municipality: 'Danderyd', cadastralDesignation: 'BYLGIA 24', street: 'Lokevägen 6', postalCode: '182 75', city: 'Djursholm' }
function harness(options = {}) {
  const calls = [], reads = [], loaded = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/propertyRegistryServer.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const db = { async rpc(name, args) { calls.push({ name, args }); return { data: options.data ?? [], error: options.error ?? null } },
    from(table) { const read = { table, filters: [] }; reads.push(read); const chain = {
      select(columns) { read.columns = columns; return chain }, eq(...args) { read.filters.push(args); return chain },
      async maybeSingle() { return { data: options.row ?? null, error: options.error ?? null } }
    }; return chain } }
  const deps = { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/properties/identity': properties, './customerOffers': offers, './customerOfferCosting': costing }
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in deps)) throw new Error('Unexpected dependency ' + name)
    return deps[name]
  }, loaded, loaded.exports)
  return { ...loaded.exports, calls, reads }
}
function payload() {
  return { revision: 0, binding: { mode: 'create', property, requestId: id(4) },
    draft: { ...offers.emptyCustomerOffer(), contractDetails: editContractProperty(emptyContractDetails(), property) }, costing: {} }
}

test('shared-property writes are atomic, actor and organization scoped, revision guarded and explicit', async () => {
  const h = harness(), input = payload()
  await h.bindProjectProperty(ctx, caseId, input)
  assert.equal(h.calls.length, 1)
  const { name, args } = h.calls[0]
  assert.equal(name, 'write_action_case_contract_property')
  assert.deepEqual([args.p_org_id, args.p_user_id, args.p_case_id, args.p_mode], [ctx.orgId, ctx.userId, caseId, 'create'])
  assert.equal(args.p_data.revision, 0)
  assert.equal(args.p_data.requestId, id(4))
  assert.deepEqual(args.p_data.property, property)
  assert.deepEqual(args.p_data.body.contractDetails.property, property)
  assert.deepEqual(args.p_data.costing, {})
  assert.equal(h.reads.length, 0)
})

test('selection strips unrelated data and never writes directly to properties or changes recipients', async () => {
  const h = harness(), input = payload()
  input.binding = { ...input.binding, mode: 'existing', propertyId: id(5), property: { ...property, owner: id(6), name: 'Ignored' } }
  await h.bindProjectProperty(ctx, caseId, input)
  assert.equal(h.calls[0].args.p_data.propertyId, id(5))
  assert.deepEqual(h.calls[0].args.p_data.property, property)
  assert.equal(h.reads.length, 0)
})

test('invalid input never reaches the database and missing migrations have a safe error', async () => {
  for (const input of [{ ...payload(), revision: -1 }, { ...payload(), binding: [] },
    { ...payload(), binding: { ...payload().binding, mode: 'overwrite' } },
    { ...payload(), binding: { ...payload().binding, property: { ...property, city: null } } },
    { ...payload(), binding: { ...payload().binding, requestId: 'bad' } }]) {
    const h = harness()
    await assert.rejects(h.bindProjectProperty(ctx, caseId, input), /INVALID/)
    assert.equal(h.calls.length, 0)
  }
  await assert.rejects(harness({ error: { code: '42883' } }).bindProjectProperty(ctx, caseId, payload()), /PROPERTY_SCHEMA/)
  await assert.rejects(harness({ error: { message: 'PROPERTY_AMBIGUOUS' } }).bindProjectProperty(ctx, caseId, payload()), /PROPERTY_AMBIGUOUS/)
  await assert.rejects(harness({ error: { message: 'private connection detail' } }).bindProjectProperty(ctx, caseId, payload()), /PROPERTY_FAILED/)
})

test('property options use the authorized project RPC; absent schema never performs a global lookup', async () => {
  const h = harness({ data: [{ id: id(5), ...property }] })
  assert.deepEqual(await h.getProjectProperties(ctx, caseId), [{ id: id(5), ...property }])
  assert.deepEqual(h.calls, [{ name: 'action_case_property_options', args: { p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId } }])
  assert.equal(h.reads.length, 0)
  const legacy = harness()
  assert.deepEqual(await legacy.getProjectPropertyLink(null, false), { available: false, property: null })
  assert.equal(legacy.reads.length, 0)
  const linked = harness({ row: { id: id(5), name: 'Lokevägen 6', municipality: 'Danderyd', cadastral_id: 'BYLGIA 24', address: 'Lokevägen 6', postal_code: '182 75', city: 'Djursholm' } })
  assert.equal((await linked.getProjectPropertyLink(id(5), true)).property.cadastralDesignation, 'BYLGIA 24')
  assert.deepEqual(linked.reads[0].filters, [['id', id(5)]])
})
