import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

type VerifyRoute = {
  POST: (request: Request) => Promise<Response>
}

type FortnoxHttp = {
  FORTNOX_RESPONSE_HEADERS: Readonly<Record<string, string>>
  assertFortnoxSameOrigin: (request: Request) => void
  fortnoxFailure: (error: unknown) => { code: string; message: string; status: number }
}

const ORG_ID = 'f543b282-1bc6-401a-9f3c-ef4492187c62'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name in dependencies) return dependencies[name]
      throw new Error(`Unexpected dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )

  return compiled.exports as T
}

const http = load<FortnoxHttp>('src/lib/fortnox/http.ts', {
  'server-only': {},
  './domain': fortnoxDomain,
})

const nextServer = {
  NextResponse: {
    json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init)
    },
  },
}

function verifyRoute(service: (orgId: string) => Promise<unknown>) {
  return load<VerifyRoute>('src/app/api/integrations/fortnox/verify/route.ts', {
    'next/server': nextServer,
    '@/lib/fortnox/http': http,
    '@/lib/fortnox/server': { verifyFortnoxConnection: service },
  })
}

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('https://hushub.se/api/integrations/fortnox/verify', {
    method: 'POST',
    headers: {
      origin: 'https://hushub.se',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body,
  })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function assertPrivateNoStore(response: Response) {
  assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/)
  for (const header of ['pragma', 'referrer-policy', 'x-robots-tag']) {
    assert.ok(response.headers.has(header), `Missing security response header: ${header}`)
  }
}

test('verification POST is same-origin, strictly shaped and returns only safe connection status', async () => {
  const calls: string[] = []
  const connection = {
    companyName: 'HusHub Test AB',
    organizationNumber: '556123-4567',
    grantedScopes: ['companyinformation', 'customer', 'invoice'],
    status: 'connected',
    connectedAt: '2026-09-09T09:00:00.000Z',
    lastVerifiedAt: '2026-09-09T10:00:00.000Z',
  }
  const route = verifyRoute(async (orgId) => {
    calls.push(orgId)
    return connection
  })

  const response = await route.POST(request(JSON.stringify({ orgId: ORG_ID })))
  assert.equal(response.status, 200)
  assert.deepEqual(await json(response), { connection })
  assert.deepEqual(calls, [ORG_ID])
  assertPrivateNoStore(response)

  const rejected = [
    request(JSON.stringify({ orgId: ORG_ID }), { origin: 'https://attacker.test' }),
    request(JSON.stringify({ orgId: ORG_ID }), { 'content-type': 'text/plain' }),
    request('{'),
    request(JSON.stringify({ orgId: ORG_ID, tenantId: 'must-not-be-accepted' })),
    request(JSON.stringify({ orgId: 123 })),
    request(JSON.stringify({ orgId: ORG_ID }), { 'content-length': '1025' }),
  ]

  for (const invalidRequest of rejected) {
    const invalidResponse = await route.POST(invalidRequest)
    assert.ok(invalidResponse.status === 400 || invalidResponse.status === 403)
    assertPrivateNoStore(invalidResponse)
  }
  assert.deepEqual(calls, [ORG_ID])
})

test('verification POST maps expected failures and never exposes provider diagnostics', async () => {
  const missing = verifyRoute(async () => {
    throw new Error('FORTNOX_CONNECTION_NOT_FOUND')
  })
  const missingResponse = await missing.POST(request(JSON.stringify({ orgId: ORG_ID })))
  assert.equal(missingResponse.status, 404)
  assert.equal((await json(missingResponse)).code, 'FORTNOX_CONNECTION_NOT_FOUND')
  assertPrivateNoStore(missingResponse)

  const superseded = verifyRoute(async () => {
    throw new Error('FORTNOX_VERIFICATION_SUPERSEDED')
  })
  const supersededResponse = await superseded.POST(
    request(JSON.stringify({ orgId: ORG_ID }))
  )
  assert.equal(supersededResponse.status, 409)
  assert.equal(
    (await json(supersededResponse)).code,
    'FORTNOX_VERIFICATION_SUPERSEDED'
  )
  assertPrivateNoStore(supersededResponse)

  const rawDiagnostic =
    'TenantId=123456 client_secret=private access_token=private user@example.test'
  const failed = verifyRoute(async () => {
    throw new Error(rawDiagnostic)
  })
  const failedResponse = await failed.POST(request(JSON.stringify({ orgId: ORG_ID })))
  const failedBody = await json(failedResponse)
  assert.equal(failedResponse.status, 500)
  assert.equal(failedBody.code, 'FORTNOX_REQUEST_FAILED')
  assert.doesNotMatch(JSON.stringify(failedBody), /123456|client_secret|access_token|user@example/i)
  assertPrivateNoStore(failedResponse)
})
