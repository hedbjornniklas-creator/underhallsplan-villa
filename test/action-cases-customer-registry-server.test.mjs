import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as registryDomain from '../src/lib/action-cases/customerRegistry.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import * as costing from '../src/lib/action-cases/customerOfferCosting.ts'
import { emptyContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { workspace, id } from './fixtures/customer-offer-data.ts'

function module(path, deps) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  new Function('require', 'exports', code)((key) => {
    if (!(key in deps)) throw new Error(`Missing dependency: ${key}`)
    return deps[key]
  }, exports)
  return exports
}
const customers = module('../src/lib/customers/domain.ts', { '@/lib/fortnox/domain': { normalizeFortnoxOrganizationNumber: () => null } })
const ctx = { orgId: id(90), userId: id(91) }
const registered = { id: id(92), version: 3, customerType: 'private', isActive: true, name: 'Sparad kund',
  identityNumber: '900101-1234', email: 'sparad@example.test', phone: '0701234567', address: 'Gatan 1', addressLine2: null, postalCode: '11122', city: 'Stockholm' }
function harness(options = {}) {
  const calls = []
  const api = module('../src/lib/action-cases/customerRegistryServer.ts', {
    'server-only': {}, './customerOffers': offers, './customerOfferCosting': costing, './customerRegistry': registryDomain,
    '@/lib/customers/domain': customers,
    '@/lib/customers/server': { async getOrganizationCustomerWorkspace(orgId) {
      calls.push({ list: orgId })
      return { organization: { id: options.foreignOrg ? id(93) : orgId, canManage: !options.noManage }, customers: [options.customer ?? registered] }
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ async rpc(name, args) { calls.push({ name, args }); return { error: options.error ?? null } } }) }
  })
  return { ...api, calls }
}
function payload() {
  const draft = structuredClone(workspace.draft)
  draft.contractParties = emptyContractParties('Ny kund', 'new@example.test', '0700000000')
  return { revision: 1, draft, requestId: id(94), binding: { mode: 'create' }, costing: {} }
}

test('uses common customer parser and atomic RPC with organization, actor, revision and idempotency key', async () => {
  const h = harness(), p = payload()
  p.draft.contractParties.customers[0].personalNumber = '199001011234'
  await h.writeContractCustomer(ctx, id(1), p, true)
  const { name, args } = h.calls[1]
  assert.equal(name, 'write_action_case_contract_parties')
  assert.equal(args.p_org_id, ctx.orgId)
  assert.equal(args.p_user_id, ctx.userId)
  assert.equal(args.p_mode, 'create')
  assert.equal(args.p_data.requestId, p.requestId)
  assert.equal(args.p_data.customerInput.identityNumber, '900101-1234')
  assert.equal(args.p_data.revision, 1)
  assert.deepEqual(args.p_data.costing, {})
})
test('existing private customer fills draft without changing the register and respects redacted identity', async () => {
  const h = harness({ noManage: true, customer: { ...registered, identityNumber: null } }), p = payload()
  p.binding = { mode: 'existing', customerId: registered.id, customerVersion: 3 }
  p.draft.contractParties.customers.push({ name: 'Andra kunden', personalNumber: '' })
  await h.writeContractCustomer(ctx, id(1), p, true)
  const args = h.calls[1].args
  assert.equal(args.p_data.includeIdentity, false)
  assert.equal(args.p_data.body.contractParties.customers[0].name, registered.name)
  assert.equal(args.p_data.body.contractParties.customers[0].personalNumber, '')
  assert.equal(args.p_data.body.contractParties.customers[1].name, 'Andra kunden')
  assert.equal(args.p_data.body.contractParties.email, registered.email)
  assert.equal(h.calls.length, 2)
})
test('inactive/business/foreign/version-conflicted customer selections cannot reach writer', async () => {
  const p = payload()
  p.binding = { mode: 'existing', customerId: registered.id, customerVersion: 3 }
  for (const options of [{ customer: { ...registered, isActive: false } }, { customer: { ...registered, customerType: 'business' } },
    { foreignOrg: true }, { customer: { ...registered, version: 4 } }]) {
    const h = harness(options)
    await assert.rejects(h.writeContractCustomer(ctx, id(1), p, true), /CUSTOMER_REGISTRY_(?:NOT_FOUND|FORBIDDEN|STALE)/)
    assert.equal(h.calls.length, 1)
  }
})
test('non-managers cannot create; invalid identity/contact/command fails before database write', async () => {
  const h = harness({ noManage: true })
  await assert.rejects(h.writeContractCustomer(ctx, id(1), payload(), true), /CUSTOMER_REGISTRY_FORBIDDEN/)
  for (const mutate of [p => p.draft.contractParties.email = 'wrong-email', p => p.draft.contractParties.customers[0].personalNumber = 'bad-id',
    p => p.binding = { mode: 'create', customerId: id(92) }, p => p.requestId = 'bad-uuid']) {
    const target = harness(), p = payload(); mutate(p)
    await assert.rejects(target.writeContractCustomer(ctx, id(1), p, true))
    assert.ok(!target.calls.some(row => row.name))
  }
})
test('ordinary contract save does not read or mutate the customer register; database errors are mapped safely', async () => {
  const h = harness()
  await h.writeContractCustomer(ctx, id(1), payload())
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].args.p_mode, 'save')
  for (const [error, code] of [[{ code: '23505' }, 'CUSTOMER_IDENTITY_EXISTS'], [{ code: 'PGRST202' }, 'CUSTOMER_REGISTRY_SCHEMA'],
    [{ message: 'CUSTOMER_REGISTRY_WITHDRAW_FIRST', code: 'P0001' }, 'CUSTOMER_REGISTRY_WITHDRAW_FIRST'], [{ message: 'secret SQL diagnostic', code: '9999' }, 'CUSTOMER_REGISTRY_FAILED']]) {
    await assert.rejects(harness({ error }).writeContractCustomer(ctx, id(1), payload()), new RegExp(code))
  }
})
