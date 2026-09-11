import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

type ExportRoute = {
  POST: (
    request: Request,
    context: { params: Promise<{ customerId: string }> }
  ) => Promise<Response>
}

type FortnoxHttp = {
  FORTNOX_RESPONSE_HEADERS: Readonly<Record<string, string>>
  assertFortnoxSameOrigin: (request: Request) => void
  fortnoxFailure: (error: unknown) => { code: string; message: string; status: number }
}

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'

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
      throw new Error(`Unexpected export-route dependency: ${name}`)
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

function exportRoute(
  service: (orgId: unknown, customerId: unknown, version: unknown) => Promise<unknown>
) {
  return load<ExportRoute>(
    'src/app/api/integrations/fortnox/customers/[customerId]/export/route.ts',
    {
      'next/server': nextServer,
      '@/lib/fortnox/http': http,
      '@/lib/fortnox/server': { exportOrganizationCustomerToFortnox: service },
    }
  )
}

function request(body: string, headers: Record<string, string> = {}) {
  return new Request(
    `https://hushub.se/api/integrations/fortnox/customers/${CUSTOMER_ID}/export`,
    {
      method: 'POST',
      headers: {
        origin: 'https://hushub.se',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        ...headers,
      },
      body,
    }
  )
}

function context(customerId = CUSTOMER_ID) {
  return { params: Promise.resolve({ customerId }) }
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

test('customer export POST is same-origin, strictly shaped and returns the updated customer', async () => {
  const calls: unknown[][] = []
  const customer = {
    id: CUSTOMER_ID,
    customerNumber: '1001',
    name: 'Testkund',
    fortnoxCustomerNumber: 'HH1001',
    version: 2,
  }
  const route = exportRoute(async (...args) => {
    calls.push(args)
    return customer
  })

  const response = await route.POST(
    request(JSON.stringify({ orgId: ORG_ID, version: 1 })),
    context()
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await json(response), { customer })
  assert.deepEqual(calls, [[ORG_ID, CUSTOMER_ID, 1]])
  assertPrivateNoStore(response)
})

test('customer export rejects cross-origin and malformed envelopes before service work', async () => {
  const calls: unknown[][] = []
  const route = exportRoute(async (...args) => {
    calls.push(args)
    return {}
  })
  const cases = [
    request(JSON.stringify({ orgId: ORG_ID, version: 1 }), {
      origin: 'https://attacker.test',
    }),
    request(JSON.stringify({ orgId: ORG_ID, version: 1 }), {
      'content-type': 'text/plain',
    }),
    request('{'),
    request(JSON.stringify({ orgId: ORG_ID })),
    request(JSON.stringify({ orgId: ORG_ID, version: 1, customer: { name: 'unsafe' } })),
    request(JSON.stringify([ORG_ID, 1])),
    request(JSON.stringify({ orgId: ORG_ID, version: 1 }), {
      'content-length': '2048',
    }),
  ]

  for (const candidate of cases) {
    const response = await route.POST(candidate, context())
    assert.ok(response.status === 400 || response.status === 403)
    assertPrivateNoStore(response)
  }
  assert.deepEqual(calls, [])
})

test('customer export exposes only allowlisted failures and never provider diagnostics', async () => {
  const unknownOutcome = exportRoute(async () => {
    throw new Error('FORTNOX_CUSTOMER_OUTCOME_UNKNOWN')
  })
  const unknownResponse = await unknownOutcome.POST(
    request(JSON.stringify({ orgId: ORG_ID, version: 1 })),
    context()
  )
  assert.equal(unknownResponse.status, 503)
  assert.equal((await json(unknownResponse)).code, 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN')
  assertPrivateNoStore(unknownResponse)

  const diagnostic =
    'access_token=secret personnummer=900101-1234 email=private@example.test provider body'
  const opaque = exportRoute(async () => {
    throw new Error(diagnostic)
  })
  const opaqueResponse = await opaque.POST(
    request(JSON.stringify({ orgId: ORG_ID, version: 1 })),
    context()
  )
  const opaqueBody = await json(opaqueResponse)
  assert.equal(opaqueResponse.status, 500)
  assert.equal(opaqueBody.code, 'FORTNOX_REQUEST_FAILED')
  assert.doesNotMatch(
    JSON.stringify(opaqueBody),
    /access_token|900101|private@example|provider body/i
  )
  assertPrivateNoStore(opaqueResponse)
})
