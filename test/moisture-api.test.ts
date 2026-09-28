import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Domain from '../src/lib/moisture/domain'
import type * as Http from '../src/lib/moisture/http'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

const domain = load<typeof Domain>('src/lib/moisture/domain.ts', {})
const http = load<typeof Http>('src/lib/moisture/http.ts', {
  'server-only': {},
  'next/server': { NextResponse: { json: Response.json } },
  '@/lib/moisture/domain': domain,
})

const ORG = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'
const context = { orgId: ORG, userId: USER, orgName: 'Testorganisation' }
type Route = {
  GET(request: Request, params?: { params: Promise<{ id: string }> }): Promise<Response>
  POST(request: Request): Promise<Response>
  PATCH(request: Request, params: { params: Promise<{ id: string }> }): Promise<Response>
}

function harness(file = 'projects/route.ts', options: { accessError?: Error; writeError?: Error; missing?: boolean } = {}) {
  const calls: Array<{ operation: string; args: unknown[] }> = []
  const server = {
    async requireMoistureRequestContext(request: Request) {
      calls.push({ operation: 'access', args: [request.url] })
      if (options.accessError) throw options.accessError
      return context
    },
    async listMoistureProjects(...args: unknown[]) {
      calls.push({ operation: 'list', args })
      return [{ id: ID }]
    },
    async getMoistureProject(...args: unknown[]) {
      calls.push({ operation: 'get', args })
      return options.missing ? null : { id: ID }
    },
    async getMoistureOptions(...args: unknown[]) {
      calls.push({ operation: 'options', args })
      return { properties: [], customers: [] }
    },
    async createMoistureProject(...args: unknown[]) {
      calls.push({ operation: 'create', args })
      if (options.writeError) throw options.writeError
      return { id: ID, revision: 1 }
    },
    async updateMoistureProject(...args: unknown[]) {
      calls.push({ operation: 'update', args })
      if (options.writeError) throw options.writeError
      return { id: ID, revision: 2 }
    },
  }
  const route = load<Route>(`src/app/api/moisture/${file}`, {
    '@/lib/moisture/server': server,
    '@/lib/moisture/http': http,
  })
  return { route, calls }
}

function request(body: string, headers: Record<string, string> = {}, method = 'POST') {
  return new Request(`https://hushub.test/api/moisture/projects?orgId=${ORG}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body,
  })
}

test('create authenticates before parsing and never writes after denied access', async () => {
  const { route, calls } = harness('projects/route.ts', { accessError: Error('MODULE_ACCESS_REQUIRED') })
  const response = await route.POST(request('not json'))
  assert.equal(response.status, 403)
  assert.deepEqual(calls.map(call => call.operation), ['access'])
  assert.match((await response.json()).error, /behörighet/)
})

test('create passes only server-resolved context and returns saved identity', async () => {
  const { route, calls } = harness()
  const body = { projectId: ID, title: 'Fuktinventering' }
  const response = await route.POST(request(JSON.stringify(body)))
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { project: { id: ID, revision: 1 } })
  assert.deepEqual(calls[1], { operation: 'create', args: [context, body] })
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('malformed JSON and unsupported content type do not reach writes', async () => {
  for (const [body, headers, expected] of [
    ['{', {}, 400],
    ['{}', { 'content-type': 'text/plain' }, 415],
  ] as Array<[string, Record<string, string>, number]>) {
    const { route, calls } = harness()
    assert.equal((await route.POST(request(body, headers))).status, expected)
    assert.deepEqual(calls.map(call => call.operation), ['access'])
  }
})

test('cross-origin or cross-site mutations fail before database writes', async () => {
  const foreignHeaders: Array<Record<string, string>> = [{ origin: 'https://unrelated.test' }, { 'sec-fetch-site': 'cross-site' }]
  for (const headers of foreignHeaders) {
    const { route, calls } = harness()
    const response = await route.POST(request('{}', headers))
    assert.equal(response.status, 403)
    assert.deepEqual(calls.map(call => call.operation), ['access'])
  }
  const { route } = harness()
  assert.equal((await route.POST(request('{}', { origin: 'https://hushub.test' }))).status, 201)
})

test('body limit is enforced even without Content-Length', async () => {
  const { route, calls } = harness()
  const response = await route.POST(request(JSON.stringify({ title: 'å'.repeat(40_000) })))
  assert.equal(response.status, 413)
  assert.deepEqual(calls.map(call => call.operation), ['access'])
})

test('safe field errors, conflict and schema-required status survive the HTTP boundary', async () => {
  for (const [error, status] of [
    [new domain.MoistureError('MOISTURE_INVALID_INPUT', { title: 'Fyll i fältet.' }), 400],
    [Error('MOISTURE_CONFLICT'), 409],
    [Error('MOISTURE_SCHEMA_REQUIRED'), 503],
  ] as const) {
    const { route } = harness('projects/route.ts', { writeError: error })
    const response = await route.POST(request('{}'))
    assert.equal(response.status, status)
    const body = await response.json()
    if (status === 400) assert.equal(body.fieldErrors.title, 'Fyll i fältet.')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
})

test('unexpected database details are not exposed', async () => {
  const { route } = harness('projects/route.ts', { writeError: Error('secret-database-host internal SQL') })
  const response = await route.POST(request('{}'))
  assert.equal(response.status, 500)
  assert.doesNotMatch(await response.text(), /secret|internal SQL/)
})

test('update carries project identity and expected revision to the scoped service', async () => {
  const { route, calls } = harness('projects/[id]/route.ts')
  const body = { revision: 7, title: 'Uppdaterat' }
  const response = await route.PATCH(request(JSON.stringify(body), {}, 'PATCH'), { params: Promise.resolve({ id: ID }) })
  assert.equal(response.status, 200)
  assert.deepEqual(calls[1], { operation: 'update', args: [context, ID, body] })
})

test('a missing project has a generic 404 and no options or other resources are fetched', async () => {
  const { route, calls } = harness('projects/[id]/route.ts', { missing: true })
  const response = await route.GET(new Request(`https://hushub.test/api/moisture/projects/${ID}?orgId=${ORG}`), { params: Promise.resolve({ id: ID }) })
  assert.equal(response.status, 404)
  assert.deepEqual(calls.map(call => call.operation), ['access', 'get'])
})

test('lists and register options use resolved context and are never cacheable', async () => {
  for (const [file, operation, key] of [['projects/route.ts', 'list', 'projects'], ['options/route.ts', 'options', 'options']]) {
    const { route, calls } = harness(file)
    const response = await route.GET(new Request(`https://hushub.test/api/moisture/projects?orgId=${ORG}`))
    assert.equal(response.status, 200)
    assert.ok(key in await response.json())
    assert.deepEqual(calls[1], { operation, args: [context] })
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
})
