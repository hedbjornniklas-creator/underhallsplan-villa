import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync('src/app/api/ob/inspections/[id]/frozen-inspector/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const original = { full_name: 'Historical inspector', company_name: 'Historical company',
  email: 'historical@example.test', certification_items: [{ key: 'cert', name: 'Historic certificate', category: 'certification' }] }

function harness(options: { canEdit?: boolean; locked?: boolean; noSnapshot?: boolean; denied?: boolean } = {}) {
  const calls: string[] = []
  const snapshot = { reportData: { mock: { profile: structuredClone(original) } } }
  const db = { from(table: string) {
    calls.push(table)
    assert.ok(['inspections', 'inspection_report_links'].includes(table), 'Current owner/viewer identity must never replace the frozen inspector')
    const filters: Record<string, unknown> = {}
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query },
      is: (key: string, value: unknown) => { filters[key] = value; return query }, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: { id: 'inspection', property_id: 'property', locked_at: options.locked === false ? null : '2026-10-01' }, error: null }),
      then: (resolve: (result: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        assert.deepEqual(filters, { inspection_id: 'inspection', org_id: 'org', revoked_at: null })
        return Promise.resolve({ data: options.noSnapshot ? [] : [{ snapshot_payload: snapshot }], error: null }).then(resolve, reject)
      },
    }
    return query
  } }
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: Response },
    '@/lib/ob/organizationBindings': { requireObInspectionReadContext: async () => {
      calls.push('read-guard')
      if (options.denied) throw Error('OB_ORGANIZATION_FORBIDDEN')
      return { orgId: 'org', userId: options.canEdit === false ? 'viewer' : 'current-owner', canEdit: options.canEdit !== false }
    } },
    '@/lib/ob/organizationHttp': { obRequestOrgId: () => 'org', obOrganizationFailure: (error: Error) =>
      error.message === 'OB_ORGANIZATION_FORBIDDEN' ? Response.json({ code: error.message }, { status: 403 }) : null },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => { calls.push('admin'); return db } },
  }
  const compiled = { exports: {} as { GET: (request: Request, context: unknown) => Promise<Response> } }
  new Function('require', 'module', 'exports', code)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name)
    return dependencies[name]
  }, compiled, compiled.exports)
  return { calls, snapshot, get: () => compiled.exports.GET(new Request('https://hushub.test/frozen?orgId=org'), {
    params: Promise.resolve({ id: 'inspection' }),
  }) }
}

test('owner and permitted colleague receive the identical historical inspector from the organization-scoped snapshot', async () => {
  const profiles = []
  for (const canEdit of [true, false]) {
    const h = harness({ canEdit }), before = structuredClone(h.snapshot)
    const response = await h.get(), result = await response.json()
    assert.equal(response.status, 200)
    assert.equal(result.locked, true)
    assert.equal(result.hasSnapshot, true)
    assert.equal(result.profile.full_name, original.full_name)
    assert.equal(result.profile.company_name, original.company_name)
    assert.equal(result.profile.email, original.email)
    assert.deepEqual(h.calls, ['read-guard', 'admin', 'inspections', 'inspection_report_links'])
    assert.deepEqual(h.snapshot, before)
    assert.match(response.headers.get('cache-control') ?? '', /private, no-store/)
    profiles.push(result.profile)
  }
  assert.deepEqual(profiles[0], profiles[1])
})

test('a missing or not-yet-frozen snapshot never substitutes the reader or current property owner', async () => {
  for (const options of [{ noSnapshot: true }, { locked: false }]) {
    const h = harness({ ...options, canEdit: false }), response = await h.get(), result = await response.json()
    assert.equal(response.status, 200)
    assert.equal(result.hasSnapshot, false)
    assert.equal(result.profile, null)
  }
})

test('denied frozen inspector reads never open the privileged client', async () => {
  const h = harness({ denied: true })
  assert.equal((await h.get()).status, 403)
  assert.deepEqual(h.calls, ['read-guard'])
})
