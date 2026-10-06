import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = '33333333-3333-4333-8333-333333333333'
const ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY = '22222222-2222-4222-8222-222222222222'
type Handler = (request: Request, context?: { params: Promise<{ id: string; kind: string }> }) => Promise<Response>
type Api = Record<string, Handler>
const compiled = new Map<string, string>()
function load<T>(path: string, dependencies: Record<string, unknown>, unused = false): T {
  let code = compiled.get(path)
  if (!code) {
    code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
      fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    compiled.set(path, code)
  }
  const result = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (unused) return {}
    throw new Error(`Unexpected dependency ${name}`)
  }, result, result.exports)
  return result.exports as T
}

const administrationHttp = load<typeof import('../src/lib/organizations/administrationHttp')>('src/lib/organizations/administrationHttp.ts', {})
const http = load<typeof import('../src/lib/ob/organizationHttp')>('src/lib/ob/organizationHttp.ts', {
  '@/lib/organizations/administrationHttp': administrationHttp,
})
const objectType = load<Record<string, unknown>>('src/lib/ob/objectType.ts', {})
function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://hushub.test${path}`, { method,
    headers: { origin: 'https://hushub.test', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function harness(path: string, options: { deny?: string; identityError?: string; rpcError?: { code?: string; message: string }; rpcData?: unknown } = {}) {
  const calls = { access: [] as { name: string; args: unknown[] }[], db: [] as string[], rpc: [] as { name: string; args: unknown }[], created: [] as Record<string, unknown>[] }
  const context = { userId: ACTOR, orgId: ORG, role: 'inspector', orgName: 'Företaget', orgEmailFrom: null }
  const guard = (name: string) => async (...args: unknown[]) => {
    calls.access.push({ name, args })
    if (options.deny) throw new Error(options.deny)
    return context
  }
  const server = {
    createAssignment: async (input: Record<string, unknown>) => { calls.created.push(input); return { id: ID, responsible_profile_id: ACTOR } },
    listAssignmentsByOrg: async () => [],
    getAssignmentById: async () => ({ id: ID, responsible_profile_id: ACTOR, assignment_type: 'OB' }),
    getProfileContact: async () => ({ email: 'inspector@example.test' }),
    sendAssignmentConfirmation: async () => ({ acceptUrl: 'https://hushub.test/accept/test' }),
    buildBaseUrl: () => 'https://hushub.test', isMissingEnvError: () => false,
    AssignmentEmailSendError: class extends Error {},
  }
  const deps = {
    'next/server': { NextResponse: { json: Response.json.bind(Response) } },
    'node:crypto': { randomUUID }, crypto: { randomUUID },
    '@/lib/ob/organizationHttp': http,
    '@/lib/ob/reportIdentity': { resolveObReportIdentity: async (input: Record<string, unknown>) => {
      assert.equal(input.orgId, ORG)
      assert.equal(input.profileId, ACTOR)
      if (options.identityError) throw new Error(options.identityError)
      return { company_name: 'Configured company' }
    } },
    '@/lib/organizations/administrationHttp': administrationHttp,
    '@/lib/ob/organizationBindings': {
      requireObContext: guard('workspace'), requireObAssignmentContext: guard('assignment'), requireObInspectionContext: guard('inspection'),
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => {
      calls.db.push('admin')
      return { rpc: async (name: string, args: unknown) => {
        calls.rpc.push({ name, args })
        return { data: options.rpcData ?? (name === 'ob_create_organization_inspection'
          ? { inspectionId: ID, propertyId: PROPERTY, orgId: ORG } : []), error: options.rpcError ?? null }
      }, from: () => { throw new Error('Unexpected direct table access') } }
    } },
    '@/lib/assignments/server': server,
    '@/lib/ob/objectType': objectType,
    '@/lib/assignments/linkIncidents': { listAssignmentLinkIssues: async () => ({ available: true, items: [] }) },
    '@/lib/ob/noteSuggestionServer': { createNoteSuggestionLimit: () => () => true },
    '@/lib/organizations/profileCard': { getOrganizationProfileWorkspace: async (input: unknown) => ({ card: {}, input }) },
  }
  return { api: load<Api>(path, deps, true), calls }
}

function routePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? routePaths(path) : entry.name === 'route.ts' ? [path] : []
  })
}

test('every OB API handler denies before business queries when its organization guard fails', async () => {
  const directory = fileURLToPath(new URL('../src/app/api/ob', import.meta.url))
  for (const absolute of routePaths(directory)) {
    const path = `src/app/api/ob/${absolute.slice(directory.length + 1).replaceAll('\\', '/')}`
    for (const [code, status] of [['UNAUTHORIZED', 401], ['MODULE_ACCESS_REQUIRED', 403], ['OB_ORGANIZATION_MISMATCH', 409]] as const) {
      const h = harness(path, { deny: code })
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        if (typeof h.api[method] !== 'function') continue
        const response = await h.api[method](request(`/api/test?orgId=${ORG}`, method, method === 'GET' ? undefined : {}), {
          params: Promise.resolve({ id: ID, kind: 'radon' }),
        })
        assert.equal(response.status, status, `${path} ${method} ${code}`)
        assert.equal((await response.json()).code, code)
        assert.match(response.headers.get('cache-control') ?? '', /no-store/)
      }
      assert.deepEqual(h.calls.db, [], path)
      assert.deepEqual(h.calls.created, [], path)
      assert.ok(h.calls.access.length > 0)
    }
  }
})

test('organization selector rejects duplicate/malformed/empty IDs and requires workspace selection', () => {
  for (const suffix of ['', '?orgId=', '?orgId=bad', `?orgId=${ORG}&orgId=${ORG}`]) {
    assert.throws(() => http.obRequestOrgId(request(`/api/test${suffix}`), true), { message: 'ORG_SELECTION_INVALID' })
  }
  assert.equal(http.obRequestOrgId(request('/api/test')), undefined)
  assert.equal(http.obRequestOrgId(request(`/api/test?orgId=${ORG.toUpperCase()}`)), ORG)
})

test('new inspection creation sends only session actor/organization and optional property to one RPC', async () => {
  const h = harness('src/app/api/ob/inspections/route.ts')
  const response = await h.api.POST(request(`/api/ob/inspections?orgId=${ORG}`, 'POST', { propertyId: PROPERTY }))
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { inspectionId: ID, propertyId: PROPERTY, orgId: ORG })
  assert.deepEqual(h.calls.access, [{ name: 'workspace', args: [ORG, true] }])
  assert.deepEqual(h.calls.rpc, [{ name: 'ob_create_organization_inspection', args: { p_org_id: ORG, p_actor: ACTOR, p_property_id: PROPERTY } }])
})

test('creation rejects body actors, organizations, invalid property and cross-site/non-JSON/oversize input before RPC', async () => {
  const path = `/api/ob/inspections?orgId=${ORG}`
  const cases: [unknown, Record<string, string>, number][] = [
    [{ actor: ACTOR }, {}, 400], [{ orgId: OTHER_ORG }, {}, 400], [{ propertyId: 'invalid' }, {}, 400],
    [{}, { origin: 'https://other.test' }, 403], [{}, { 'content-type': 'text/plain' }, 415],
    [{}, { 'content-length': '100000' }, 413], [{ extra: 'x'.repeat(10000) }, {}, 413],
  ]
  for (const [body, headers, status] of cases) {
    const h = harness('src/app/api/ob/inspections/route.ts')
    assert.equal((await h.api.POST(request(path, 'POST', body, headers))).status, status)
    assert.deepEqual(h.calls.rpc, [])
  }
})

test('inspection list is scoped by explicit organization and optional property in the guarded RPC', async () => {
  const row = { id: ID, property_id: PROPERTY, hasReadyPdf: true }
  const h = harness('src/app/api/ob/inspections/route.ts', { rpcData: [row] })
  const response = await h.api.GET(request(`/api/ob/inspections?orgId=${ORG}&propertyId=${PROPERTY}`))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { inspections: [row], orgId: ORG })
  assert.deepEqual(h.calls.rpc, [{ name: 'ob_list_organization_inspections', args: { p_org_id: ORG, p_actor: ACTOR, p_property_id: PROPERTY } }])
})

test('new endpoints fail closed on missing RPC schema, opaque failures and inconsistent returned identity', async () => {
  for (const [rpcError, status] of [[{ code: 'PGRST202', message: 'private RPC definition' }, 503], [{ message: 'private server credentials' }, 500]] as const) {
    const h = harness('src/app/api/ob/inspections/route.ts', { rpcError })
    const response = await h.api.POST(request(`/api/ob/inspections?orgId=${ORG}`, 'POST', {}))
    assert.equal(response.status, status)
    assert.doesNotMatch(await response.text(), /private/)
  }
  const h = harness('src/app/api/ob/inspections/route.ts', { rpcData: { inspectionId: ID, propertyId: PROPERTY, orgId: OTHER_ORG } })
  assert.equal((await h.api.POST(request(`/api/ob/inspections?orgId=${ORG}`, 'POST', {}))).status, 503)
})

test('OB assignment create and quick-send reject EB/UHP and arbitrary responsible profiles', async () => {
  for (const path of ['src/app/api/ob/assignments/route.ts', 'src/app/api/ob/assignments/quick-send/route.ts']) {
    for (const [body, status] of [
      [{ assignmentType: 'EB' }, 400], [{ assignmentType: 'UHP' }, 400],
      [{ responsibleProfileId: PROPERTY }, 403], [{ orgId: OTHER_ORG }, 409],
    ] as const) {
      const h = harness(path)
      const response = await h.api.POST(request(`/api/test?orgId=${ORG}`, 'POST', {
        customerEmail: 'test@example.test', ordererRole: 'buyer', priceAmount: 1000, ...body,
      }))
      assert.equal(response.status, status, path)
      assert.deepEqual(h.calls.created, [])
    }
    const h = harness(path)
    assert.ok((await h.api.POST(request(`/api/test?orgId=${ORG}`, 'POST', {
      customerEmail: 'test@example.test', ordererRole: 'buyer', priceAmount: 1000, actor: PROPERTY,
    }))).status < 300)
    assert.equal(h.calls.created[0].createdBy, ACTOR)
    assert.equal(h.calls.created[0].responsibleProfileId, ACTOR)
    assert.equal(h.calls.created[0].orgId, ORG)
  }
})

test('profile-card uses OB context and its session identity, never TU or requested profile', async () => {
  const h = harness('src/app/api/ob/profile-card/route.ts')
  const response = await h.api.GET(request(`/api/ob/profile-card?orgId=${ORG}&profileId=${PROPERTY}`))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).workspace.input.profileId, ACTOR)
  assert.deepEqual(h.calls.access, [{ name: 'workspace', args: [ORG, true] }])
})

test('quick-send validates the configured issuer before creating OB or STATUS drafts', async () => {
  for (const assignmentType of ['OB', 'STATUS']) {
    const h = harness('src/app/api/ob/assignments/quick-send/route.ts', { identityError: 'ORG_PROFILE_CARD_REQUIRED' })
    const response = await h.api.POST(request(`/api/test?orgId=${ORG}`, 'POST', {
      assignmentType, customerEmail: 'customer@example.test', ordererRole: 'buyer', priceAmount: 100,
      scopeDescription: 'Badrum', objectType: 'property', statusCancellationFee: 0,
    }))
    assert.equal(response.status, 400)
    assert.deepEqual(h.calls.created, [])
  }
})

test('frozen identity and configuration errors have safe actionable responses', async () => {
  const response = http.obOrganizationFailure(new Error('OB_FROZEN_IDENTITY_REQUIRED'))!
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /sparade företagsuppgifter/)
  assert.equal(http.obOrganizationFailure(new Error('ORG_PROFILE_CARD_REQUIRED'))?.status, 400)
  for (const code of ['OB_ORGANIZATION_BINDING_IMMUTABLE', 'OB_ORGANIZATION_BINDING_REQUIRED', 'OB_BINDING_AUDIT_CONFLICT']) {
    assert.equal(http.obOrganizationFailure(new Error(code))?.status, 409)
  }
  assert.equal(http.obOrganizationFailure(new Error('secret arbitrary failure')), null)
})
