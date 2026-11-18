/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic server and route boundaries. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Native Node TypeScript tests require the extension.
import * as model from '../src/lib/globalSearch/model.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function compile(path: string, dependencies: Record<string, any>) {
  const source = readFileSync(path, 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loadedModule = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected dependency: ${name}`)
  }, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

function result(moduleId: string, index = 0): model.GlobalSearchResult {
  return { id: `${moduleId}:${index}`, moduleId, moduleLabel: moduleId, kind: 'inspection',
    title: `Rosen ${index}`, subtitle: 'Tallstigen', href: `/work/${moduleId}/${index}`, propertyDesignation: 'Rosen 12:3' }
}

function server(options: {
  product?: boolean; modules?: string[]; user?: string; requestedOrg?: string
  providers?: Record<string, () => Promise<model.GlobalSearchProviderResult>>
} = {}) {
  const called: string[] = []
  const checks: any[] = []
  let disposed = 0
  const execute = (moduleId: string) => async () => {
    called.push(moduleId)
    return options.providers?.[moduleId]?.() ?? { results: [result(moduleId)], hasMore: false }
  }
  const load = compile('src/lib/globalSearch/server.ts', {
    'server-only': {},
    '@/lib/access/server': { createDashboardAccessRequest: async () => ({ userId: options.user ?? USER, hasAccess: async (input: any) => {
      checks.push(input)
      return input.moduleKey ? (options.modules ?? ['inspections']).includes(input.moduleKey) : options.product !== false
    } }) },
    '@/lib/assignments/server': { requireOrgContext: async (org?: unknown) => ({
      orgId: org === undefined ? ORG : options.requestedOrg ?? ORG, userId: USER, role: 'inspector',
    }) },
    './providers': { searchOb: execute('ob'), searchTu: execute('tu'), searchEb: execute('eb'), searchMoisture: execute('moisture') },
    './extended': { searchExtendedModules: execute('extended') },
    './model': model,
    './runtime': { createGlobalSearchExecution: () => ({ signal: new AbortController().signal,
      run: async (work: () => Promise<unknown>) => work(), check() {}, dispose() { disposed++ } }) },
  })
  return { search: load.searchHusHub, called, checks, disposed: () => disposed }
}

test('product denial and identity mismatch never reach search providers', async () => {
  for (const options of [{ product: false }, { user: 'different-user' }]) {
    const subject = server(options)
    await assert.rejects(subject.search('Rosen', ORG), /MODULE_ACCESS_REQUIRED|UNAUTHORIZED/u)
    assert.deepEqual(subject.called, [])
  }
})

test('only granted modules run, using the selected organization for every access check', async () => {
  const subject = server({ modules: ['technical_investigations'] })
  const response = await subject.search('  Rosen  12:3 ', ORG)
  assert.deepEqual([...subject.called].sort(), ['extended', 'tu'])
  assert.equal(response.query, 'Rosen 12:3')
  assert.ok(subject.checks.filter(check => check.scopeType === 'organization').every(check => check.scopeId === ORG))
  assert.deepEqual(response.issues, [])
  assert.equal(subject.disposed(), 1)
})

test('short queries and unsupported organization destinations perform no metadata reads', async () => {
  const short = server()
  assert.deepEqual((await short.search('R', ORG)).results, [])
  assert.deepEqual(short.called, [])
  const wrongOrg = server({ requestedOrg: OTHER_ORG })
  await assert.rejects(wrongOrg.search('Rosen', OTHER_ORG), /GLOBAL_SEARCH_ORGANIZATION_UNSUPPORTED/u)
  assert.deepEqual(wrongOrg.called, [])
})

test('one unavailable module preserves successful results and marks the response incomplete', async () => {
  const subject = server({ modules: ['inspections', 'technical_investigations'], providers: {
    tu: async () => { throw new Error('DATABASE_DETAILS_MUST_NOT_LEAK') },
  } })
  const response = await subject.search('Rosen', ORG)
  assert.ok(response.results.some((row: model.GlobalSearchResult) => row.moduleId === 'ob'))
  assert.ok(response.issues.some((issue: model.GlobalSearchIssue) => issue.moduleId === 'tu'))
  assert.ok(!JSON.stringify(response).includes('DATABASE_DETAILS'))
})

test('revoked module access is omitted, while lost identity aborts all results', async () => {
  const revoked = server({ providers: { ob: async () => { throw new Error('MODULE_ACCESS_REQUIRED') } } })
  const response = await revoked.search('Rosen', ORG)
  assert.ok(!response.results.some((row: model.GlobalSearchResult) => row.moduleId === 'ob'))
  assert.deepEqual(response.issues, [])
  for (const code of ['UNAUTHORIZED', 'GLOBAL_SEARCH_SCOPE_MISMATCH', 'GLOBAL_SEARCH_ABORTED']) {
    const lost = server({ providers: { ob: async () => { throw new Error(code) } } })
    await assert.rejects(lost.search('Rosen', ORG), new RegExp(code, 'u'))
  }
})

test('bounded responses represent every matching module even when one has many reports', async () => {
  const extraModules = ['tasks', 'properties', 'renoapp', 'customers']
  const subject = server({ modules: ['inspections', 'technical_investigations', 'construction_inspections', 'moisture_safety'],
    providers: Object.fromEntries(['ob', 'tu', 'eb', 'moisture', 'extended'].map(moduleId => [moduleId, async () => ({
      results: (moduleId === 'extended' ? extraModules : [moduleId]).flatMap(id => Array.from({ length: 15 }, (_, index) => result(id, index))),
      hasMore: false,
    })])),
  })
  const response = await subject.search('Rosen 12:3', ORG)
  assert.equal(response.results.length, 40)
  assert.equal(response.hasMore, true)
  const counts = new Map<string, number>()
  for (const row of response.results) counts.set(row.moduleId, (counts.get(row.moduleId) ?? 0) + 1)
  assert.equal(counts.size, 8)
  assert.ok([...counts.values()].every(count => count <= 8))
})

function route(search: (...args: any[]) => Promise<unknown>) {
  return compile('src/app/api/hushub/search/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/globalSearch/server': { searchHusHub: search }, '@/lib/globalSearch/model': model,
  }).GET
}

test('API rejects ambiguous or unknown parameters before invoking search', async () => {
  let reads = 0
  const get = route(async () => { reads++; return {} })
  for (const query of ['', '?q=a&q=b', '?q=Rosen&orgId=a&orgId=b', '?q=Rosen&owner=someone']) {
    assert.equal((await get(new Request(`https://hushub.test/api/hushub/search${query}`))).status, 400)
  }
  assert.equal(reads, 0)
})

test('API passes query, organization and cancellation and never caches personal results', async () => {
  let values: any[] = []
  const get = route(async (...args: any[]) => { values = args; return { query: 'Rosen', results: [], issues: [], hasMore: false } })
  const request = new Request(`https://hushub.test/api/hushub/search?q=Rosen&orgId=${ORG}`)
  const response = await get(request)
  assert.equal(response.status, 200)
  assert.equal(values[0], 'Rosen')
  assert.equal(values[1], ORG)
  assert.equal(values[2], request.signal)
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/u)
  assert.equal(response.headers.get('vary'), 'Cookie')
})

test('API distinguishes expired sessions, denied access and invalid organization without diagnostic leakage', async () => {
  for (const [code, status] of [ ['UNAUTHORIZED', 401], ['MODULE_ACCESS_REQUIRED', 403], ['ORG_MEMBERSHIP_REQUIRED', 403],
    ['ORG_SELECTION_INVALID', 400], ['GLOBAL_SEARCH_ORGANIZATION_UNSUPPORTED', 400], ['GLOBAL_SEARCH_ABORTED', 499] ] as const) {
    const get = route(async () => { throw new Error(code) })
    const response = await get(new Request('https://hushub.test/api/hushub/search?q=Rosen'))
    assert.equal(response.status, status, code)
    assert.match(response.headers.get('cache-control') ?? '', /no-store/u)
    assert.ok(!(await response.text()).includes(code))
  }
})
