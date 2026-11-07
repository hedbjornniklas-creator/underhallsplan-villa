import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Route from '../src/app/api/eb/projects/[projectId]/inspections/[inspectionId]/billing/route'
import type * as Billing from '../src/lib/eb/billing'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected billing API dependency ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const billing = load<typeof Billing>('src/lib/eb/billing.ts', {})

function fixture() {
  const calls: Array<{ name: string; input?: unknown }> = []
  const controls = { authError: '', storageError: '' }
  const route = load<typeof Route>('src/app/api/eb/projects/[projectId]/inspections/[inspectionId]/billing/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/access/server': { requireModuleAccess: async (input: unknown) => {
      calls.push({ name: 'module', input }); if (controls.authError) throw new Error(controls.authError)
    } },
    '@/lib/assignments/server': { requireOrgContext: async () => ({ orgId: 'session-org', userId: 'session-user' }) },
    '@/lib/eb/billing': billing,
    '@/lib/eb/billingServer': {
      getEbInspectionBilling: async (input: unknown) => { calls.push({ name: 'get', input });
        if (controls.storageError) throw new Error(controls.storageError); return billing.emptyEbInspectionBilling() },
      saveEbInspectionBilling: async (input: unknown) => { calls.push({ name: 'save', input });
        if (controls.storageError) throw new Error(controls.storageError); return billing.emptyEbInspectionBilling() },
    },
  })
  const context = { params: Promise.resolve({ projectId: 'route-project', inspectionId: 'route-inspection' }) }
  return { calls, controls,
    get: () => route.GET(new Request('https://example.test/private-billing'), context),
    patch: (body: unknown) => route.PATCH(new Request('https://example.test/private-billing', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), context),
  }
}

test('billing API authenticates EB scope, remains private, and ignores forged org/user/project body values', async () => {
  const f = fixture()
  const read = await f.get(); assert.equal(read.status, 200)
  assert.match(read.headers.get('cache-control')!, /private, no-store/)
  const patch = await f.patch({ isInvoiced: true, invoiceNumber: ' F-1 ', expectedRevision: 0,
    orgId: 'forged', userId: 'forged', projectId: 'forged', inspectionId: 'forged', reportLockedAt: null })
  assert.equal(patch.status, 200)
  assert.deepEqual(f.calls.find(call => call.name === 'save')?.input, {
    orgId: 'session-org', userId: 'session-user', projectId: 'route-project', inspectionId: 'route-inspection',
    isInvoiced: true, invoiceNumber: 'F-1', expectedRevision: 0,
  })
  assert.deepEqual(f.calls[0].input, { productKey: 'dashboard', moduleKey: 'construction_inspections' })
  assert.deepEqual(await patch.json(), { billing: billing.emptyEbInspectionBilling() })
})

test('billing API rejects malformed writes and has explicit unavailable/concurrent/authorization errors', async () => {
  const f = fixture()
  for (const input of [null, {}, { isInvoiced: true, invoiceNumber: null }, { isInvoiced: 'true', invoiceNumber: null, expectedRevision: 0 }]) {
    assert.equal((await f.patch(input)).status, 400)
  }
  assert.equal(f.calls.some(call => call.name === 'save'), false)
  for (const [error, status] of [
    ['EB_BILLING_CONFIGURATION', 503], ['EB_BILLING_CONFLICT', 409],
    ['EB_INSPECTION_NOT_FOUND', 404], ['EB_BILLING_ACTOR_FORBIDDEN', 403],
    ['PRIVATE_DATABASE_DETAIL', 503],
  ] as const) {
    f.controls.storageError = error
    const result = await f.patch({ isInvoiced: false, invoiceNumber: 'F-1', expectedRevision: 1 })
    assert.equal(result.status, status); assert.match(result.headers.get('cache-control')!, /no-store/)
    assert.doesNotMatch(JSON.stringify(await result.json()), /PRIVATE_DATABASE_DETAIL/)
  }
  for (const [error, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403], ['MODULE_ACCESS_REQUIRED', 403]] as const) {
    f.controls.authError = error
    const before = f.calls.filter(call => ['save', 'get'].includes(call.name)).length
    assert.equal((await f.get()).status, status)
    assert.equal((await f.patch({ isInvoiced: true, invoiceNumber: null, expectedRevision: 0 })).status, status)
    assert.equal(f.calls.filter(call => ['save', 'get'].includes(call.name)).length, before)
  }
})
