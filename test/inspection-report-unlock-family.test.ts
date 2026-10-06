import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as ReportFamily from '../src/lib/inspections/reportFamily'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected unlock test dependency: ${name}`)
    return dependencies[name]
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

const reportFamily = load<typeof ReportFamily>('src/lib/inspections/reportFamily.ts', { 'server-only': {} })
type Family = 'EB' | 'TU'
type Options = {
  family?: string | null
  type?: string | null
  missing?: boolean
  readError?: boolean
  obBinding?: boolean
  bindingReadError?: boolean
  authError?: string
  rpcError?: string
}

function fixture(reportModule: Family, options: Options = {}) {
  const events: string[] = []
  const admin = {
    from(table: string) {
      assert.ok(['inspections', 'ob_organization_bindings'].includes(table))
      events.push(table === 'inspections' ? 'read-parent' : 'read-binding')
      const filters: Record<string, unknown> = {}
      const query = {
        select(columns: string) {
          assert.equal(columns, table === 'inspections' ? 'id,inspection_family,type' : 'inspection_id')
          return query
        },
        eq(key: string, value: unknown) { filters[key] = value; return query },
        async maybeSingle() {
          if (table === 'ob_organization_bindings') {
            assert.deepEqual(filters, { inspection_id: 'inspection' })
            return { data: options.obBinding ? { inspection_id: 'inspection' } : null,
              error: options.bindingReadError ? { message: 'DATABASE_PRIVATE_ERROR' } : null }
          }
          assert.deepEqual(filters, { id: 'inspection' })
          return {
            data: options.missing ? null : { id: 'inspection',
              inspection_family: 'family' in options ? options.family : reportModule,
              type: 'type' in options ? options.type : reportModule },
            error: options.readError ? { message: 'DATABASE_PRIVATE_ERROR' } : null,
          }
        },
      }
      return query
    },
    async rpc(name: string, parameters: Record<string, unknown>) {
      events.push('unlock')
      assert.equal(name, reportModule === 'EB' ? 'unlock_eb_inspection_report' : 'unlock_tu_investigation_report')
      assert.deepEqual(parameters, {
        p_org_id: 'org', p_inspection_id: 'inspection', p_reason: 'Rätta uppgifterna.', p_performed_by: 'actor',
        ...(reportModule === 'EB' ? { p_project_id: 'project' } : {}),
      })
      return { error: options.rpcError ? { message: options.rpcError } : null }
    },
  }
  async function orgContext(orgId?: string) {
    if (reportModule === 'TU') assert.equal(orgId, 'org')
    events.push('authorize')
    if (options.authError) throw new Error(options.authError)
    return { orgId: 'org', userId: 'actor' }
  }
  const route = load<{ POST: (request: Request, context: unknown) => Promise<Response> }>(
    reportModule === 'EB'
      ? 'src/app/api/eb/projects/[projectId]/inspections/[inspectionId]/unlock/route.ts'
      : 'src/app/api/tu/investigations/[inspectionId]/unlock/route.ts', {
      'next/server': { NextResponse: Response },
      '@/lib/access/server': { requireModuleAccess: async () => undefined },
      '@/lib/assignments/server': { requireOrgContext: orgContext },
      '@/lib/tu/server': { requireTuContext: orgContext },
      '@/lib/eb/server': { getEbProjectById: async (input: unknown) => {
        assert.deepEqual(input, { orgId: 'org', projectId: 'project' })
        events.push('read-project'); return { id: 'project' }
      } },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
      '@/lib/inspections/reportFamily': reportFamily,
    }
  )
  return { events, post: (search = '?orgId=org', reason = 'Rätta uppgifterna.') => route.POST(
    new Request(`https://hushub.test/unlock${search}`, {
      method: 'POST', body: JSON.stringify({ reason }), headers: { 'Content-Type': 'application/json' },
    }), { params: Promise.resolve({ inspectionId: 'inspection', projectId: 'project' }) }
  ) }
}

test('EB and TU unlock reject an OB/STATUS parent despite a module detail row or old type', async () => {
  for (const reportModule of ['EB', 'TU'] as const) {
    for (const options of [
      { family: 'OB', type: reportModule }, { family: 'OB', type: 'STATUS' },
      { family: null, type: 'OB' }, { family: null, type: 'STATUS' },
      { family: null, type: 'SB' }, { family: 'UHP' },
      { family: reportModule === 'EB' ? 'TU' : 'EB' }, { family: 'UNKNOWN', type: reportModule },
      { family: '', type: reportModule }, { family: null, type: null }, { missing: true },
    ]) {
      const f = fixture(reportModule, options)
      assert.equal((await f.post()).status, 404, `${reportModule} ${JSON.stringify(options)}`)
      assert.deepEqual(f.events, ['authorize', 'read-parent'])
    }
  }
})

test('valid EB and TU unlock preserve organization, actor and project checks in the RPC', async () => {
  for (const reportModule of ['EB', 'TU'] as const) {
    const cases = reportModule === 'EB'
      ? [{ family: 'EB', type: 'OB' }, { family: 'EB', type: 'SB' },
        ...['EB', 'SLB', 'FB', 'GB', 'KSB', 'SAB'].map(type => ({ family: null, type }))]
      : [{ family: 'TU', type: 'OB' }, { family: null, type: 'TU' }]
    for (const options of cases) {
      const f = fixture(reportModule, options)
      const response = await f.post()
      assert.equal(response.status, 200, `${reportModule} ${JSON.stringify(options)}`)
      assert.equal((await response.json()).reportLockedAt, null)
      assert.deepEqual(f.events, ['authorize', 'read-parent', 'read-binding', 'unlock', ...(reportModule === 'EB' ? ['read-project'] : [])])
    }
    const outsideScope = fixture(reportModule, { rpcError: `${reportModule}_INSPECTION_NOT_FOUND` })
    assert.equal((await outsideScope.post()).status, 404)
    assert.deepEqual(outsideScope.events, ['authorize', 'read-parent', 'read-binding', 'unlock'])
  }
})

test('parent read failure is unavailable, not authorization, and never reaches unlock', async () => {
  for (const reportModule of ['EB', 'TU'] as const) {
    for (const options of [{ readError: true }, { bindingReadError: true }]) {
      const f = fixture(reportModule, options)
      const response = await f.post()
      assert.equal(response.status, 503)
      assert.doesNotMatch(await response.text(), /DATABASE_PRIVATE_ERROR/)
      assert.deepEqual(f.events, ['authorize', 'read-parent', ...(options.bindingReadError ? ['read-binding'] : [])])
    }
    const bound = fixture(reportModule, { obBinding: true })
    assert.equal((await bound.post()).status, 404)
    assert.deepEqual(bound.events, ['authorize', 'read-parent', 'read-binding'])
  }
})

test('authentication, organization/module authorization and reason validation precede parent reads', async () => {
  for (const reportModule of ['EB', 'TU'] as const) {
    for (const [authError, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403], ['MODULE_ACCESS_REQUIRED', 403]] as const) {
      const f = fixture(reportModule, { authError })
      assert.equal((await f.post()).status, status)
      assert.deepEqual(f.events, ['authorize'])
    }
    const invalidReason = fixture(reportModule)
    assert.equal((await invalidReason.post('?orgId=org', 'kort')).status, 400)
    assert.deepEqual(invalidReason.events, ['authorize'])
  }
  for (const search of ['', '?orgId=org&orgId=other']) {
    const f = fixture('TU')
    assert.equal((await f.post(search)).status, 400)
    assert.deepEqual(f.events, [])
  }
})
