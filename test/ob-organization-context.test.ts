import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ID = '11111111-1111-4111-8111-111111111111'
function load<T>(path: string, deps: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    assert.ok(Object.hasOwn(deps, name), name)
    return deps[name]
  }, compiled, compiled.exports)
  return compiled.exports as T
}
function routeHarness(error?: string) {
  const calls: unknown[] = []
  const route = load<{ GET: (r: Request) => Promise<Response> }>('src/app/api/organizations/context/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, options: ResponseInit) => Response.json(body, options) } },
    '@/lib/organizations/server': { getOrganizationSwitcherContext: async (surface: string, orgId: unknown, entity: unknown) => {
      calls.push(['switcher', surface, orgId, entity])
      if (error) throw new Error(error)
      return { organization: { id: orgId ?? ORG }, organizations: [{ id: orgId ?? ORG }] }
    } },
    '@/lib/organizations/administrationHttp': { isOrganizationUuid: (value: unknown) =>
      typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) },
  })
  return { calls, get: (query: string) => route.GET(new Request(`https://hushub.test/api/organizations/context?${query}`)) }
}

test('OB old deep links pass the authoritative entity selector to one combined context resolver', async () => {
  for (const kind of ['inspection', 'assignment']) {
    const h = routeHarness()
    const response = await h.get(`surface=ob&${kind}Id=${ID}`)
    assert.equal(response.status, 200)
    assert.deepEqual(h.calls, [['switcher', 'ob', undefined, { [`${kind}Id`]: ID }]])
    assert.equal((await response.json()).organization.id, ORG)
    assert.match(response.headers.get('cache-control') ?? '', /private, no-store/)
  }
})

test('OB entity errors never fall back to selected or default organization', async () => {
  for (const [error, status] of [['UNAUTHORIZED', 401], ['ORG_SELECTION_INVALID', 400], ['ORG_MEMBERSHIP_REQUIRED', 403],
    ['MODULE_ACCESS_REQUIRED', 403], ['OB_ORGANIZATION_FORBIDDEN', 403], ['OB_ASSIGNMENT_FORBIDDEN', 403],
    ['OB_ORGANIZATION_MISMATCH', 409], ['OB_ORGANIZATION_UNASSIGNED', 409], ['OB_ORGANIZATION_MIGRATION_REQUIRED', 409]]) {
    const h = routeHarness(String(error))
    const response = await h.get(`surface=ob&inspectionId=${ID}&orgId=${OTHER}`)
    assert.equal(response.status, status)
    assert.deepEqual(h.calls, [['switcher', 'ob', OTHER, { inspectionId: ID }]])
  }
})

test('context rejects ambiguous, malformed or non-OB entity selectors before any entity or organization lookup', async () => {
  for (const query of [`surface=ob&inspectionId=${ID}&assignmentId=${ID}`, `surface=ob&inspectionId=${ID}&inspectionId=${ID}`,
    'surface=ob&inspectionId=', 'surface=ob&assignmentId=invalid', `surface=tu&inspectionId=${ID}`,
    `surface=settings&assignmentId=${ID}`, `surface=ob&orgId=${ORG}&orgId=${OTHER}`, 'surface=ob&unexpected=1']) {
    const h = routeHarness()
    assert.equal((await h.get(query)).status, 400, query)
    assert.deepEqual(h.calls, [])
  }
})

test('workspace context accepts explicit organization without manufacturing an entity selector', async () => {
  const h = routeHarness()
  assert.equal((await h.get(`surface=ob&orgId=${ORG}`)).status, 200)
  assert.deepEqual(h.calls, [['switcher', 'ob', ORG, undefined]])
})
