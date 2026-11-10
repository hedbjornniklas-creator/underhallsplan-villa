import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Billing from '../src/lib/tu/billing'
import type * as Server from '../src/lib/tu/billingServer'
import type * as Route from '../src/app/api/tu/investigations/[inspectionId]/billing/route'

function load<T>(path: string, dependencies: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiledModule = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  new Function('require', 'module', 'exports', code)((key: string) => {
    if (Object.hasOwn(dependencies, key)) return dependencies[key]
    throw new Error(`Unexpected TU billing dependency: ${key}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const billing = load<typeof Billing>('src/lib/tu/billing.ts')
const adminHttp = load<typeof import('../src/lib/organizations/administrationHttp')>('src/lib/organizations/administrationHttp.ts')
const ORG = '11111111-1111-4111-8111-111111111111', ID = '22222222-2222-4222-8222-222222222222'
const scope = { orgId: ORG, inspectionId: ID }
type Row = Record<string, unknown>

test('TU domain keeps unknown distinct, uses exact revision/number validation and strips private fields from list status', () => {
  const empty = billing.emptyTuInvestigationBilling()
  assert.equal(empty.status, 'not_invoiced'); assert.notEqual(empty, billing.emptyTuInvestigationBilling())
  assert.equal(billing.unavailableTuInvestigationBilling().status, 'unavailable')
  assert.deepEqual(billing.parseTuInvestigationBillingPatch({ isInvoiced: false, invoiceNumber: ' F-1 ', expectedRevision: 2, userId: 'spoof' }),
    { isInvoiced: false, invoiceNumber: 'F-1', expectedRevision: 2 })
  for (const bad of [null, [], {}, { isInvoiced: true, expectedRevision: 0 },
    { isInvoiced: 'true', invoiceNumber: null, expectedRevision: 0 },
    { isInvoiced: true, invoiceNumber: null, expectedRevision: -1 },
    { isInvoiced: true, invoiceNumber: null, expectedRevision: 2147483648 },
    { isInvoiced: true, invoiceNumber: 'F\n1', expectedRevision: 0 },
    { isInvoiced: true, invoiceNumber: 'x'.repeat(101), expectedRevision: 0 }]) {
    assert.throws(() => billing.parseTuInvestigationBillingPatch(bad), /TU_BILLING_INPUT_INVALID/)
  }
  assert.deepEqual(billing.parseTuInvestigationBilling(empty), empty)
  assert.deepEqual(billing.parseTuInvestigationBillingStatus({ ...empty, invoiceNumber: 'PRIVATE' }), { status: 'not_invoiced' })
  assert.equal(billing.parseTuInvestigationBillingStatus({ status: 'unavailable' }), null)
  for (const bad of [billing.unavailableTuInvestigationBilling(), { ...empty, status: 'invoiced' },
    { ...empty, revision: -1 }, { ...empty, updatedAt: 'not a date' }, { ...empty, invoiceNumber: 12 }]) {
    assert.equal(billing.parseTuInvestigationBilling(bad), null)
  }
})

function fixture() {
  const detail = (id: string): Row => ({ org_id: ORG, inspection_id: id,
    inspections: { id, inspection_family: 'TU', type: 'TU' } })
  const tables: Record<string, Row[]> = { technical_investigation_details: [detail(ID)], tu_investigation_billing: [] }
  const reads: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }> = []
  const writes: Array<{ name: string; input: Row }> = []
  const controls: { error: { code?: string; message?: string } | null; reject: boolean; result: unknown } = {
    error: null, reject: false, result: billing.emptyTuInvestigationBilling(),
  }
  const server = load<typeof Server>('src/lib/tu/billingServer.ts', {
    'server-only': {}, './billing': billing,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from(table: string) {
        assert.ok(table in tables, 'no reads/writes to report, delivery or work state')
        const filters: Array<[string, unknown]> = []; let columns = ''
        const execute = (single: boolean) => {
          reads.push({ table, columns, filters })
          if (controls.reject) throw new Error('PRIVATE_NETWORK_ERROR')
          const data = tables[table].filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value))
          return { data: single ? data[0] ?? null : data, error: table === 'tu_investigation_billing' ? controls.error : null }
        }
        const query = {
          select(value: string) { columns = value; return query },
          eq(key: string, value: unknown) { filters.push([key, value]); return query },
          in(key: string, value: unknown[]) { filters.push([key, value]); return query },
          async maybeSingle() { return execute(true) },
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
            return Promise.resolve().then(() => execute(false)).then(resolve, reject)
          },
        }
        return query
      },
      async rpc(name: string, input: Row) {
        writes.push({ name, input })
        if (controls.reject) throw new Error('PRIVATE_NETWORK_ERROR')
        return { data: controls.result, error: controls.error }
      },
    }) },
  })
  return { tables, detail, reads, writes, controls, server }
}

test('private reads verify exact TU detail/organization/family before treating absent metadata as unbilled', async () => {
  const f = fixture()
  assert.deepEqual(await f.server.getTuInvestigationBilling(scope), billing.emptyTuInvestigationBilling())
  assert.equal(f.reads.length, 2)
  assert.ok(f.reads.every(read => read.filters.some(([key, value]) => key === 'org_id' && value === ORG)
    && read.filters.some(([key, value]) => key === 'inspection_id' && value === ID)))
  await assert.rejects(f.server.getTuInvestigationBilling({ ...scope, orgId: 'other' }), /TU_INVESTIGATION_NOT_FOUND/)
  await assert.rejects(f.server.getTuInvestigationBilling({ ...scope, inspectionId: 'other' }), /TU_INVESTIGATION_NOT_FOUND/)
  f.tables.technical_investigation_details[0].inspections = { id: ID, inspection_family: 'EB', type: 'TU' }
  await assert.rejects(f.server.getTuInvestigationBilling(scope), /TU_INVESTIGATION_NOT_FOUND/)
  f.tables.technical_investigation_details = [f.detail(ID)]
  f.controls.error = { code: 'PGRST205', message: 'PRIVATE_TABLE_NAME' }
  await assert.rejects(f.server.getTuInvestigationBilling(scope), /TU_BILLING_CONFIGURATION/)
  f.controls.error = null; f.controls.reject = true
  await assert.rejects(f.server.getTuInvestigationBilling(scope), /TU_BILLING_UNAVAILABLE/)
})

test('list bulk reads use scoped 200-ID batches, select only status columns and fail closed for the entire requested set', async () => {
  const f = fixture()
  const ids = Array.from({ length: 401 }, (_, n) => `inspection-${n}`)
  f.tables.technical_investigation_details = ids.map(f.detail)
  f.tables.tu_investigation_billing = [{ inspection_id: ids[1], org_id: ORG, is_invoiced: true }]
  const result = await f.server.getTuInvestigationBillingStatuses({ orgId: ORG, inspectionIds: ids })
  assert.equal(result.size, 401); assert.equal(f.reads.length, 6)
  assert.deepEqual(result.get(ids[1]), { status: 'invoiced' })
  assert.deepEqual(result.get(ids[2]), { status: 'not_invoiced' })
  for (const read of f.reads) {
    assert.ok(read.filters.some(([key, value]) => key === 'org_id' && value === ORG))
    assert.ok(read.filters.some(([key, value]) => key === 'inspection_id' && Array.isArray(value) && value.length <= 200))
    if (read.table === 'tu_investigation_billing') assert.equal(read.columns, 'inspection_id,org_id,is_invoiced')
  }
  assert.doesNotMatch(JSON.stringify([...result]), /invoiceNumber|invoicedAt|updatedByName|revision/)
  for (const error of [{ code: '42P01' }, { code: 'OTHER', message: 'PRIVATE_DB_ERROR' }]) {
    f.controls.error = error
    assert.ok([...(await f.server.getTuInvestigationBillingStatuses({ orgId: ORG, inspectionIds: ids })).values()]
      .every(value => value.status === 'unavailable'))
  }
  f.controls.error = null; f.tables.technical_investigation_details.pop()
  assert.ok([...(await f.server.getTuInvestigationBillingStatuses({ orgId: ORG, inspectionIds: ids })).values()]
    .every(value => value.status === 'unavailable'), 'an unverified foreign/missing ID is never labelled not invoiced')
  assert.deepEqual([...await f.server.getTuInvestigationBillingStatuses({ orgId: ORG, inspectionIds: [] })], [])
})

test('saves call only the transactional RPC with normalized patch, explicit trusted actor/org and safe errors', async () => {
  const f = fixture()
  const patch = { ...scope, userId: 'session-actor', isInvoiced: false, invoiceNumber: ' F-1 ', expectedRevision: 3 }
  await f.server.saveTuInvestigationBilling(patch)
  assert.deepEqual(f.writes, [{ name: 'tu_set_investigation_billing', input: {
    p_org_id: ORG, p_inspection_id: ID, p_actor: 'session-actor', p_is_invoiced: false,
    p_invoice_number: 'F-1', p_expected_revision: 3,
  } }]); assert.equal(f.reads.length, 0)
  for (const message of ['TU_BILLING_CONFLICT', 'TU_BILLING_ACTOR_FORBIDDEN', 'TU_BILLING_INPUT_INVALID']) {
    f.controls.error = { message }; await assert.rejects(f.server.saveTuInvestigationBilling(patch), new RegExp(message))
  }
  f.controls.error = { code: 'PGRST202' }
  await assert.rejects(f.server.saveTuInvestigationBilling(patch), /TU_BILLING_CONFIGURATION/)
  f.controls.error = null; f.controls.result = null
  await assert.rejects(f.server.saveTuInvestigationBilling(patch), /TU_BILLING_UNAVAILABLE/)
})

function apiFixture() {
  const calls: Array<{ name: string; input: unknown }> = []
  const controls = { deny: '', storageError: '', billingData: billing.emptyTuInvestigationBilling() }
  const serverSource = readFileSync(new URL('../src/lib/tu/server.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('server.ts', serverSource, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'requireTuRequestContext')!
  const guardCode = ts.transpileModule(node.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const requireTuRequestContext = new Function('exports', 'requireTuContext', `${guardCode}; return requireTuRequestContext`)(
    {}, async (org: unknown) => {
      calls.push({ name: 'context', input: org })
      if (controls.deny) throw new Error(controls.deny)
      if (org !== ORG) throw new Error('ORG_MEMBERSHIP_REQUIRED')
      return { orgId: ORG, userId: 'session-actor' }
    })
  const route = load<typeof Route>('src/app/api/tu/investigations/[inspectionId]/billing/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/tu/server': { requireTuRequestContext }, '@/lib/organizations/administrationHttp': adminHttp,
    '@/lib/tu/billing': billing,
    '@/lib/tu/billingServer': {
      getTuInvestigationBilling: async (input: unknown) => { calls.push({ name: 'get', input });
        if (controls.storageError) throw new Error(controls.storageError); return controls.billingData },
      saveTuInvestigationBilling: async (input: unknown) => { calls.push({ name: 'save', input });
        if (controls.storageError) throw new Error(controls.storageError); return controls.billingData },
    },
  })
  const context = { params: Promise.resolve({ inspectionId: ID }) }
  return { route, controls, calls, context }
}
function request(method = 'GET', body?: unknown, orgQuery = `orgId=${ORG}`, origin = 'https://hushub.se') {
  return new Request(`https://hushub.se/api/tu/investigations/${ID}/billing?${orgQuery}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { Origin: origin, 'Content-Type': 'application/json' },
  })
}

test('billing API uses the real exact-one-org TU request guard, keeps all responses private and ignores forged scope/user', async () => {
  const f = apiFixture()
  const get = await f.route.GET(request(), f.context)
  assert.equal(get.status, 200); assert.deepEqual(await get.json(), { billing: f.controls.billingData, canEdit: true })
  assert.match(get.headers.get('cache-control')!, /private.*no-store/)
  const patch = { isInvoiced: true, invoiceNumber: ' F-2 ', expectedRevision: 1,
    orgId: 'spoof', userId: 'spoof', inspectionId: 'spoof' }
  assert.equal((await f.route.PATCH(request('PATCH', patch), f.context)).status, 200)
  assert.deepEqual(f.calls.find(call => call.name === 'save')?.input, {
    orgId: ORG, inspectionId: ID, userId: 'session-actor', isInvoiced: true, invoiceNumber: 'F-2', expectedRevision: 1,
  })
  const count = f.calls.filter(call => call.name === 'get').length
  for (const query of ['', `orgId=${ORG}&orgId=${ORG}`]) assert.equal((await f.route.GET(request('GET', undefined, query), f.context)).status, 400)
  assert.equal(f.calls.filter(call => call.name === 'get').length, count)
  assert.equal((await f.route.GET(request('GET', undefined, 'orgId=other'), f.context)).status, 403)
  assert.equal((await f.route.GET(request(), { params: Promise.resolve({ inspectionId: 'bad-id' }) })).status, 400)
})

test('API rejects cross-origin/malformed bodies and authentication/module failures before writes; conflicts and missing schema are explicit', async () => {
  const f = apiFixture()
  const patch = { isInvoiced: true, invoiceNumber: null, expectedRevision: 0 }
  assert.equal((await f.route.PATCH(request('PATCH', patch, `orgId=${ORG}`, 'https://evil.example'), f.context)).status, 403)
  assert.equal((await f.route.PATCH(request('PATCH', { ...patch, expectedRevision: -1 }), f.context)).status, 400)
  for (const [code, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403], ['MODULE_ACCESS_REQUIRED', 403]] as const) {
    f.controls.deny = code
    const response = await f.route.PATCH(request('PATCH', patch), f.context)
    assert.equal(response.status, status); assert.match(response.headers.get('cache-control')!, /private.*no-store/)
  }
  assert.equal(f.calls.some(call => call.name === 'save'), false)
  f.controls.deny = ''
  for (const [code, status] of [['TU_BILLING_CONFLICT', 409], ['TU_BILLING_CONFIGURATION', 503], ['TU_INVESTIGATION_NOT_FOUND', 404], ['PRIVATE_PROVIDER_DETAIL', 503]] as const) {
    f.controls.storageError = code
    const response = await f.route.PATCH(request('PATCH', patch), f.context)
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /PRIVATE_PROVIDER_DETAIL/)
  }
})
