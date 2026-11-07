import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Billing from '../src/lib/ob/billing'
import type * as Server from '../src/lib/ob/billingServer'
import type * as Route from '../src/app/api/ob/inspections/[id]/billing/route'

function load<T>(path: string, dependencies: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', code)((key: string) => {
    if (Object.hasOwn(dependencies, key)) return dependencies[key]
    throw new Error(`Unexpected OB billing dependency: ${key}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const billing = load<typeof Billing>('src/lib/ob/billing.ts')
const adminHttp = load<typeof import('../src/lib/organizations/administrationHttp')>('src/lib/organizations/administrationHttp.ts')
const orgHttp = load<typeof import('../src/lib/ob/organizationHttp')>('src/lib/ob/organizationHttp.ts', {
  '@/lib/organizations/administrationHttp': adminHttp,
})
const ORG = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const scope = { orgId: ORG, inspectionId: ID }
type Row = Record<string, unknown>

test('OB billing contract distinguishes unknown from unbilled and validates explicit revisions and numbers', () => {
  const empty = billing.emptyObInspectionBilling()
  assert.equal(empty.status, 'not_invoiced')
  assert.equal(billing.unavailableObInspectionBilling().status, 'unavailable')
  assert.notEqual(billing.emptyObInspectionBilling(), empty)
  assert.deepEqual(billing.parseObInspectionBillingPatch({ isInvoiced: false, invoiceNumber: ' F-1 ', expectedRevision: 2, orgId: 'spoof' }),
    { isInvoiced: false, invoiceNumber: 'F-1', expectedRevision: 2 })
  for (const bad of [null, [], {}, { isInvoiced: true, expectedRevision: 0 },
    { isInvoiced: 'true', invoiceNumber: null, expectedRevision: 0 },
    { isInvoiced: true, invoiceNumber: null, expectedRevision: -1 },
    { isInvoiced: true, invoiceNumber: null, expectedRevision: 2147483648 },
    { isInvoiced: true, invoiceNumber: 'F\n1', expectedRevision: 0 },
    { isInvoiced: true, invoiceNumber: 'x'.repeat(101), expectedRevision: 0 }]) {
    assert.throws(() => billing.parseObInspectionBillingPatch(bad), /OB_BILLING_INPUT_INVALID/)
  }
  assert.deepEqual(billing.parseObInspectionBilling(empty), empty)
  assert.deepEqual(billing.parseObInspectionBillingStatus({ ...empty, invoiceNumber: 'PRIVATE' }), { status: 'not_invoiced' })
  assert.equal(billing.parseObInspectionBillingStatus({ status: 'unavailable' }), null)
  for (const bad of [billing.unavailableObInspectionBilling(), { ...empty, status: 'invoiced' },
    { ...empty, revision: -1 }, { ...empty, updatedAt: 'not a date' }, { ...empty, invoiceNumber: 12 }]) {
    assert.equal(billing.parseObInspectionBilling(bad), null)
  }
})

function serverFixture() {
  const tables: Record<string, Row[]> = {
    ob_organization_bindings: [{ org_id: ORG, inspection_id: ID }], ob_inspection_billing: [],
  }
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const writes: Array<{ name: string; input: Row }> = []
  const controls: { error: { code?: string; message?: string } | null; reject: boolean; result: unknown } = {
    error: null, reject: false, result: billing.emptyObInspectionBilling(),
  }
  const server = load<typeof Server>('src/lib/ob/billingServer.ts', {
    'server-only': {}, './billing': billing,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from(table: string) {
        assert.ok(table in tables, 'no reads or writes to report or delivery tables')
        const filters: Array<[string, unknown]> = []
        const query = {
          select() { return query },
          eq(key: string, value: unknown) { filters.push([key, value]); return query },
          async maybeSingle() {
            reads.push({ table, filters })
            if (controls.reject) throw new Error('PRIVATE_NETWORK_ERROR')
            return { data: tables[table].find(row => filters.every(([key, value]) => row[key] === value)) ?? null,
              error: table === 'ob_inspection_billing' ? controls.error : null }
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
  return { tables, reads, writes, controls, server }
}

test('authorized billing reads check the exact immutable organization binding and fail closed on missing schema', async () => {
  const f = serverFixture()
  assert.deepEqual(await f.server.getObInspectionBilling(scope), billing.emptyObInspectionBilling())
  assert.equal(f.reads.length, 2)
  assert.ok(f.reads.every(read => read.filters.some(([key, value]) => key === 'org_id' && value === ORG)
    && read.filters.some(([key, value]) => key === 'inspection_id' && value === ID)))
  await assert.rejects(f.server.getObInspectionBilling({ ...scope, orgId: 'other' }), /OB_INSPECTION_NOT_FOUND/)
  await assert.rejects(f.server.getObInspectionBilling({ ...scope, inspectionId: 'other' }), /OB_INSPECTION_NOT_FOUND/)
  f.tables.ob_inspection_billing.push({ org_id: ORG, inspection_id: ID, is_invoiced: true,
    invoiced_at: '2026-11-07T10:00:00Z', invoice_number: 'F-1', revision: 1,
    updated_at: '2026-11-07T10:00:00Z', updated_by_name: 'Inspektör' })
  assert.equal((await f.server.getObInspectionBilling(scope)).invoiceNumber, 'F-1')
  f.controls.error = { code: 'PGRST205', message: 'PRIVATE_DATABASE_DETAIL' }
  await assert.rejects(f.server.getObInspectionBilling(scope), /OB_BILLING_CONFIGURATION/)
  f.controls.error = null; f.controls.reject = true
  await assert.rejects(f.server.getObInspectionBilling(scope), /OB_BILLING_UNAVAILABLE/)
})

test('writes use the audited RPC only, retain explicit number on unmark and propagate revision/auth errors', async () => {
  const f = serverFixture()
  const patch = { ...scope, userId: 'actor', isInvoiced: false, invoiceNumber: ' F-1 ', expectedRevision: 3 }
  await f.server.saveObInspectionBilling(patch)
  assert.deepEqual(f.writes, [{ name: 'ob_set_inspection_billing', input: {
    p_org_id: ORG, p_inspection_id: ID, p_actor: 'actor', p_is_invoiced: false,
    p_invoice_number: 'F-1', p_expected_revision: 3,
  } }])
  assert.equal(f.reads.length, 0, 'scope verification/write/audit must share a single database transaction')
  for (const message of ['OB_BILLING_CONFLICT', 'OB_BILLING_ACTOR_FORBIDDEN', 'OB_BILLING_INPUT_INVALID']) {
    f.controls.error = { message }
    await assert.rejects(f.server.saveObInspectionBilling(patch), new RegExp(message))
  }
  f.controls.error = { code: 'PGRST202' }
  await assert.rejects(f.server.saveObInspectionBilling(patch), /OB_BILLING_CONFIGURATION/)
  f.controls.error = null; f.controls.result = { ...billing.emptyObInspectionBilling(), status: 'invoiced' }
  await assert.rejects(f.server.saveObInspectionBilling(patch), /OB_BILLING_UNAVAILABLE/)
})

function apiFixture() {
  const calls: Array<{ name: string; input: unknown }> = []
  const controls = { deny: '', denyWrite: false, canEdit: true, storageError: '', billingData: billing.emptyObInspectionBilling() }
  const guard = (name: string) => async (id: string, requestedOrg?: string) => {
    calls.push({ name, input: { id, requestedOrg } })
    if (controls.deny) throw new Error(controls.deny)
    if (name === 'write-guard' && controls.denyWrite) throw new Error('OB_ORGANIZATION_FORBIDDEN')
    return { orgId: ORG, userId: 'session-actor', canEdit: controls.canEdit }
  }
  const route = load<typeof Route>('src/app/api/ob/inspections/[id]/billing/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/ob/organizationBindings': { requireObInspectionContext: guard('write-guard'), requireObInspectionReadContext: guard('read-guard') },
    '@/lib/ob/organizationHttp': orgHttp,
    '@/lib/organizations/administrationHttp': adminHttp,
    '@/lib/ob/billing': billing,
    '@/lib/ob/billingServer': {
      getObInspectionBilling: async (input: unknown) => { calls.push({ name: 'get', input });
        if (controls.storageError) throw new Error(controls.storageError); return controls.billingData },
      saveObInspectionBilling: async (input: unknown) => { calls.push({ name: 'save', input });
        if (controls.storageError) throw new Error(controls.storageError); return controls.billingData },
    },
  })
  const context = { params: Promise.resolve({ id: ID }) }
  const url = `https://hushub.test/api/ob/inspections/${ID}/billing?orgId=${ORG}`
  const patch = (body: unknown, extraHeaders: Record<string, string> = {}) => route.PATCH(new Request(url, {
    method: 'PATCH', headers: { origin: 'https://hushub.test', 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  }), context)
  return { calls, controls, patch, get: (suffix = '') => route.GET(new Request(url + suffix), context) }
}

test('API permits authorized colleague reading but requires entity write permission for marking', async () => {
  const f = apiFixture()
  f.controls.canEdit = false; f.controls.denyWrite = true
  f.controls.billingData = { status: 'invoiced', invoicedAt: '2026-11-07T10:00:00Z',
    invoiceNumber: 'PRIVATE-INVOICE', revision: 9, updatedAt: '2026-11-07T10:00:00Z', updatedByName: 'PRIVATE-ACTOR' }
  const read = await f.get()
  assert.equal(read.status, 200)
  const payload = await read.json()
  assert.deepEqual(payload, { billing: { status: 'invoiced' }, canEdit: false })
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE|revision|updatedAt|invoicedAt/)
  assert.match(read.headers.get('cache-control')!, /private, no-store/)
  assert.equal((await f.patch({ isInvoiced: true, invoiceNumber: null, expectedRevision: 0 })).status, 403)
  assert.equal(f.calls.some(call => call.name === 'save'), false)
  assert.deepEqual(f.calls[0], { name: 'read-guard', input: { id: ID, requestedOrg: ORG } })
})

test('API uses session identity and route/bound organization, never client supplied actor, inspection or report status', async () => {
  const f = apiFixture()
  const response = await f.patch({ isInvoiced: true, invoiceNumber: ' F-1 ', expectedRevision: 4,
    orgId: 'spoof', userId: 'spoof', inspectionId: 'spoof', status: 'completed', locked_at: null })
  assert.equal(response.status, 200)
  assert.deepEqual(f.calls.find(call => call.name === 'save')?.input, {
    ...scope, userId: 'session-actor', isInvoiced: true, invoiceNumber: 'F-1', expectedRevision: 4,
  })
  assert.equal((await f.get(`&orgId=${ORG}`)).status, 400, 'ambiguous organization selection is forbidden')
  for (const [message, status] of [['UNAUTHORIZED', 401], ['MODULE_ACCESS_REQUIRED', 403],
    ['OB_ORGANIZATION_MISMATCH', 409], ['OB_ORGANIZATION_FORBIDDEN', 403]] as const) {
    f.controls.deny = message
    const previous = f.calls.filter(call => ['get', 'save'].includes(call.name)).length
    assert.equal((await f.get()).status, status)
    assert.equal((await f.patch({ isInvoiced: false, invoiceNumber: null, expectedRevision: 0 })).status, status)
    assert.equal(f.calls.filter(call => ['get', 'save'].includes(call.name)).length, previous)
  }
})

test('API validates same-origin bounded JSON, returns explicit CAS/schema errors and never database details', async () => {
  const f = apiFixture()
  const patch = { isInvoiced: false, invoiceNumber: null, expectedRevision: 0 }
  assert.equal((await f.patch(patch, { origin: 'https://evil.test' })).status, 403)
  assert.equal((await f.patch(patch, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await f.patch({ extra: 'x'.repeat(10001) })).status, 413)
  assert.equal((await f.patch({})).status, 400)
  for (const [message, status] of [['OB_BILLING_CONFLICT', 409], ['OB_BILLING_CONFIGURATION', 503],
    ['OB_BILLING_ACTOR_FORBIDDEN', 403], ['PRIVATE_DATABASE_DETAIL', 503]] as const) {
    f.controls.storageError = message
    const result = await f.patch(patch)
    assert.equal(result.status, status)
    assert.match(result.headers.get('cache-control')!, /no-store/)
    assert.doesNotMatch(JSON.stringify(await result.json()), /PRIVATE_DATABASE_DETAIL/)
  }
})

test('invoice-aware list completion cannot reopen a completed inspection on the shared dashboard', () => {
  const overview = load<typeof import('../src/lib/ob/overview')>('src/lib/ob/overview.ts')
  const model = load<typeof import('../src/lib/dashboard/model')>('src/lib/dashboard/model.ts', {
    '../eb/dashboard.ts': {}, // Unused EB re-export; the real OB dashboard builder is exercised below.
  })
  const inspection = {
    id: ID, property_id: 'property', status: 'completed', date: '2026-11-06',
    created_at: '2026-11-01T10:00:00Z', assignment_number: 'OB-test',
    customer_name: 'Testkund', client_name: null, address: 'Testgatan 1', city: 'Stockholm', snapshot_customer: null,
  }
  const unbilled = overview.makeObOverviewItem(undefined, inspection, undefined, { status: 'not_invoiced' })
  const billed = overview.makeObOverviewItem(undefined, inspection, undefined, { status: 'invoiced' })
  assert.equal(unbilled.closed, false, 'still current in the OB list')
  assert.equal(billed.closed, true, 'fully handled in the OB list')
  assert.equal(unbilled.inspection, 'Klar', 'the real work state remains completed')
  const readDashboard = (item: typeof unbilled) => model.buildObDashboard([item],
    new Map([[item.id, '10:00']]), '2026-11-07', new Map([[item.id, inspection.date]]))
  const dashboard = readDashboard(unbilled)
  assert.equal(dashboard.activeCount, 0)
  assert.deepEqual(dashboard.actions, [])
  assert.equal(dashboard.bookings.length, 1)
  assert.equal(dashboard.bookings[0].status, 'completed')
  assert.deepEqual(readDashboard(billed), dashboard, 'billing does not change dashboard tasks or historic visits')
})
