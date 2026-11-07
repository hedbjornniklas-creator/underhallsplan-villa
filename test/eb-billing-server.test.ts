import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Billing from '../src/lib/eb/billing'
import type * as Server from '../src/lib/eb/billingServer'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', code)((key: string) => {
    if (key in dependencies) return dependencies[key]
    throw new Error(`Unexpected billing dependency: ${key}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const billing = load<typeof Billing>('src/lib/eb/billing.ts', {})
type Row = Record<string, unknown>
const scope = { orgId: 'org', projectId: 'project', inspectionId: 'inspection' }

function fixture() {
  const rows: Record<string, Row[]> = {
    eb_projects: [{ org_id: 'org', id: 'project' }],
    eb_inspection_details: [{ org_id: 'org', eb_project_id: 'project', inspection_id: 'inspection' }],
    eb_inspection_billing: [],
  }
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const rpcCalls: Array<{ name: string; input: Row }> = []
  const controls: { error: { code?: string; message?: string } | null; reject: boolean;
    rpcError: { code?: string; message?: string } | null; rpcData: unknown } = {
    error: null, reject: false, rpcError: null, rpcData: billing.emptyEbInspectionBilling(),
  }
  const admin = {
    from(table: string) {
      assert.ok(table in rows)
      const filters: Array<[string, unknown]> = []
      const execute = (single: boolean) => {
        reads.push({ table, filters })
        if (controls.reject) throw { code: 'PGRST205' }
        if (controls.error && table === 'eb_inspection_billing') return { data: null, error: controls.error }
        const data = rows[table].filter(row => filters.every(([key, value]) =>
          Array.isArray(value) ? value.includes(row[key]) : value === row[key]))
        return { data: single ? data[0] ?? null : data, error: null }
      }
      const query = {
        select() { return query },
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
      rpcCalls.push({ name, input })
      if (controls.reject) throw new Error('NETWORK_FAILED_SECRET')
      return { data: controls.rpcData, error: controls.rpcError }
    },
  }
  const server = load<typeof Server>('src/lib/eb/billingServer.ts', {
    'server-only': {}, './billing': billing,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
  })
  return { rows, reads, rpcCalls, controls, server }
}

test('billing GET verifies exact org/project/inspection relation before interpreting missing metadata', async () => {
  const f = fixture()
  assert.deepEqual(await f.server.getEbInspectionBilling(scope), billing.emptyEbInspectionBilling())
  assert.equal(f.reads.length, 3)
  for (const changed of [{ orgId: 'other' }, { projectId: 'other' }, { inspectionId: 'other' }]) {
    await assert.rejects(f.server.getEbInspectionBilling({ ...scope, ...changed }), /EB_INSPECTION_NOT_FOUND/)
  }
  f.controls.error = { code: 'PGRST205', message: 'private database detail' }
  await assert.rejects(f.server.getEbInspectionBilling(scope), /EB_BILLING_CONFIGURATION/)
  f.controls.error = { code: 'XX', message: 'private database detail' }
  await assert.rejects(f.server.getEbInspectionBilling(scope), /EB_BILLING_UNAVAILABLE/)
  f.controls.reject = true
  await assert.rejects(f.server.getEbInspectionBilling(scope), /EB_BILLING_CONFIGURATION/)
})

test('bulk loads are org-scoped batches rather than one query per inspection; outage is never not-invoiced', async () => {
  const f = fixture()
  const projects = [{ id: 'project', inspections: Array.from({ length: 401 }, (_, i) => ({ inspectionId: `i-${i}` })) }]
  f.rows.eb_inspection_billing.push({ org_id: 'org', eb_project_id: 'project', inspection_id: 'i-1',
    is_invoiced: true, invoiced_at: '2026-11-07T10:00:00Z', invoice_number: 'F-1',
    updated_at: '2026-11-07T10:00:00Z', updated_by_name: 'Testperson', revision: 1 })
  const values = await f.server.loadEbInspectionBillingForProjects({ orgId: 'org', projects })
  assert.equal(values.size, 401); assert.equal(f.reads.length, 3)
  assert.equal(values.get('i-1')?.status, 'invoiced'); assert.equal(values.get('i-2')?.status, 'not_invoiced')
  for (const read of f.reads) {
    assert.ok(read.filters.some(([key, value]) => key === 'org_id' && value === 'org'))
    assert.ok(read.filters.some(([key, value]) => key === 'eb_project_id' && Array.isArray(value) && value.includes('project')))
  }
  f.controls.error = { code: '42P01' }
  assert.ok([...(await f.server.loadEbInspectionBillingForProjects({ orgId: 'org', projects })).values()]
    .every(value => value.status === 'unavailable'))
  assert.deepEqual([...await f.server.loadEbInspectionBillingForProjects({ orgId: 'org', projects: [] })], [])
})

test('save sends only explicit server scope, normalized values and revision to the audited RPC', async () => {
  const f = fixture()
  const input = { ...scope, userId: 'actor', isInvoiced: false, invoiceNumber: ' F-123 ', expectedRevision: 2 }
  assert.deepEqual(await f.server.saveEbInspectionBilling(input), billing.emptyEbInspectionBilling())
  assert.deepEqual(f.rpcCalls, [{ name: 'eb_set_inspection_billing', input: {
    p_org_id: 'org', p_project_id: 'project', p_inspection_id: 'inspection', p_actor: 'actor',
    p_is_invoiced: false, p_invoice_number: 'F-123', p_expected_revision: 2,
  } }])
  assert.equal(f.reads.length, 0, 'scope/revision validation and write share the atomic RPC')
  f.controls.rpcError = { message: 'EB_BILLING_CONFLICT' }
  await assert.rejects(f.server.saveEbInspectionBilling(input), /EB_BILLING_CONFLICT/)
  f.controls.rpcError = { code: 'PGRST202', message: 'missing RPC' }
  await assert.rejects(f.server.saveEbInspectionBilling(input), /EB_BILLING_CONFIGURATION/)
  f.controls.rpcError = null; f.controls.rpcData = null
  await assert.rejects(f.server.saveEbInspectionBilling(input), /EB_BILLING_UNAVAILABLE/)
  f.controls.reject = true
  await assert.rejects(f.server.saveEbInspectionBilling(input), /EB_BILLING_UNAVAILABLE/)
})
