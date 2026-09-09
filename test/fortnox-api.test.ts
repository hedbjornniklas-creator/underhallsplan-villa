import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

type StatusRoute = {
  GET: () => Promise<Response>
}

type OrganizationNumberRoute = {
  PATCH: (request: Request) => Promise<Response>
}

type ConnectRoute = {
  POST: (request: Request) => Promise<Response>
}

type CallbackRoute = {
  GET: (request: Request) => Promise<Response>
}

type FortnoxHttp = {
  FORTNOX_RESPONSE_HEADERS: Readonly<Record<string, string>>
  assertFortnoxSameOrigin: (request: Request) => void
  fortnoxFailure: (error: unknown) => { code: string; message: string; status: number }
  fortnoxCallbackStatus: (error: unknown) => string
  buildFortnoxSettingsRedirect: (
    requestUrl: string,
    status: unknown,
    orgId?: unknown
  ) => URL
}

const ORG_ID = 'f543b282-1bc6-401a-9f3c-ef4492187c62'
const CALLBACK_PATH = '/api/integrations/fortnox/callback'
const RESPONSE_HEADERS = ['cache-control', 'pragma', 'referrer-policy', 'x-robots-tag']

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
    redirect(destination: string | URL, init?: number | ResponseInit) {
      const responseInit = typeof init === 'number' ? { status: init } : { ...init }
      const headers = new Headers(responseInit.headers)
      headers.set('Location', String(destination))
      return new Response(null, { ...responseInit, headers })
    },
  },
}

function route<T>(file: string, service: Record<string, unknown>): T {
  return load<T>(file, {
    'next/server': nextServer,
    '@/lib/fortnox/http': http,
    '@/lib/fortnox/server': {
      fortnoxCallbackFailureOrganizationId: () => undefined,
      ...service,
    },
  })
}

function assertPrivateNoStore(response: Response) {
  assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/)
  for (const header of RESPONSE_HEADERS) {
    assert.ok(response.headers.has(header), `Missing security response header: ${header}`)
  }
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function sameOriginHeaders(contentType: string) {
  return {
    origin: 'https://hushub.se',
    'sec-fetch-site': 'same-origin',
    'content-type': contentType,
  }
}

function patchRequest(body: BodyInit, headers: Record<string, string>) {
  return new Request('https://hushub.se/api/integrations/fortnox/organization-number', {
    method: 'PATCH',
    headers,
    body,
  })
}

function connectRequest(
  body: URLSearchParams,
  headers: Record<string, string> = {
    origin: 'https://hushub.se',
    'sec-fetch-site': 'same-origin',
  }
) {
  return new Request('https://hushub.se/api/integrations/fortnox/connect', {
    method: 'POST',
    headers,
    body,
  })
}

function redirectLocation(response: Response) {
  const location = response.headers.get('location')
  assert.ok(location, 'Redirect response must include a Location header')
  return new URL(location)
}

test('status is private/no-store and never exposes an unexpected service error', async () => {
  const settings = {
    configured: true,
    organizations: [
      {
        id: ORG_ID,
        name: 'Testorganisation',
        organizationNumber: '556123-4567',
        isDefault: true,
        canManage: true,
        connection: null,
      },
    ],
  }
  const success = route<StatusRoute>('src/app/api/integrations/fortnox/status/route.ts', {
    getFortnoxSettings: async () => settings,
  })
  const response = await success.GET()

  assert.equal(response.status, 200)
  assert.deepEqual(await json(response), settings)
  assertPrivateNoStore(response)

  const privateError =
    'postgres relation missing; client_secret=do-not-leak; user=private@example.test'
  const failure = route<StatusRoute>('src/app/api/integrations/fortnox/status/route.ts', {
    getFortnoxSettings: async () => {
      throw new Error(privateError)
    },
  })
  const failedResponse = await failure.GET()
  const failedBody = await json(failedResponse)

  assert.equal(failedResponse.status, 500)
  assert.equal(failedBody.code, 'FORTNOX_REQUEST_FAILED')
  assert.doesNotMatch(JSON.stringify(failedBody), /client_secret|private@example|postgres/i)
  assertPrivateNoStore(failedResponse)

  const unauthorized = route<StatusRoute>('src/app/api/integrations/fortnox/status/route.ts', {
    getFortnoxSettings: async () => {
      throw new Error('UNAUTHORIZED')
    },
  })
  assert.equal((await unauthorized.GET()).status, 401)
})

test('organization-number PATCH validates origin, media type and body before calling the service', async () => {
  const calls: Array<[string, string]> = []
  const api = route<OrganizationNumberRoute>(
    'src/app/api/integrations/fortnox/organization-number/route.ts',
    {
      updateFortnoxOrganizationNumber: async (orgId: string, organizationNumber: string) => {
        calls.push([orgId, organizationNumber])
        return '556123-4567'
      },
    }
  )
  const validBody = JSON.stringify({ orgId: ORG_ID, organizationNumber: '5561234567' })
  const rejected = [
    patchRequest(validBody, {
      ...sameOriginHeaders('application/json'),
      origin: 'https://attacker.test',
    }),
    patchRequest(validBody, {
      ...sameOriginHeaders('application/json'),
      'sec-fetch-site': 'cross-site',
    }),
    patchRequest(validBody, {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    }),
  ]

  for (const request of rejected) {
    const response = await api.PATCH(request)
    assert.equal(response.status, 403)
    assert.equal((await json(response)).code, 'FORTNOX_ORIGIN_FORBIDDEN')
  }

  const invalidBodies: Request[] = [
    patchRequest(validBody, sameOriginHeaders('text/plain')),
    patchRequest('{', sameOriginHeaders('application/json')),
    patchRequest('[]', sameOriginHeaders('application/json')),
    patchRequest(
      JSON.stringify({ orgId: ORG_ID, organizationNumber: 5561234567 }),
      sameOriginHeaders('application/json')
    ),
    patchRequest(validBody, {
      ...sameOriginHeaders('application/json'),
      'content-length': '2049',
    }),
  ]

  for (const request of invalidBodies) {
    const response = await api.PATCH(request)
    assert.equal(response.status, 400)
    assert.equal((await json(response)).code, 'FORTNOX_REQUEST_INVALID')
  }
  assert.deepEqual(calls, [])

  const response = await api.PATCH(
    patchRequest(validBody, sameOriginHeaders('Application/JSON; charset=utf-8'))
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await json(response), { organizationNumber: '556123-4567' })
  assert.deepEqual(calls, [[ORG_ID, '5561234567']])
  assertPrivateNoStore(response)
})

test('organization-number PATCH maps authorization and service failures safely', async () => {
  const request = () =>
    patchRequest(
      JSON.stringify({ orgId: ORG_ID, organizationNumber: '5561234567' }),
      sameOriginHeaders('application/json')
    )

  for (const [message, expectedStatus, expectedCode] of [
    ['UNAUTHORIZED', 401, 'UNAUTHORIZED'],
    ['MODULE_ACCESS_REQUIRED', 403, 'MODULE_ACCESS_REQUIRED'],
    ['FORTNOX_ORGANIZATION_ADMIN_REQUIRED', 403, 'FORTNOX_ORGANIZATION_ADMIN_REQUIRED'],
  ] as const) {
    const api = route<OrganizationNumberRoute>(
      'src/app/api/integrations/fortnox/organization-number/route.ts',
      {
        updateFortnoxOrganizationNumber: async () => {
          throw new Error(message)
        },
      }
    )
    const response = await api.PATCH(request())
    assert.equal(response.status, expectedStatus)
    assert.equal((await json(response)).code, expectedCode)
    assertPrivateNoStore(response)
  }

  const rawFailure = route<OrganizationNumberRoute>(
    'src/app/api/integrations/fortnox/organization-number/route.ts',
    {
      updateFortnoxOrganizationNumber: async () => {
        throw new Error('tenant secret and private database diagnostics')
      },
    }
  )
  const response = await rawFailure.PATCH(request())
  assert.equal(response.status, 500)
  assert.doesNotMatch(await response.text(), /tenant secret|database diagnostics/i)
})

test('connect accepts a native same-origin form and returns a 303 to the Fortnox authorization URL', async () => {
  const calls: string[] = []
  const authorizationUrl =
    'https://apps.fortnox.se/oauth-v1/auth?client_id=test-client&state=provider-bound-state'
  const api = route<ConnectRoute>('src/app/api/integrations/fortnox/connect/route.ts', {
    createFortnoxAuthorization: async (orgId: string) => {
      calls.push(orgId)
      return authorizationUrl
    },
  })
  const body = new URLSearchParams({ orgId: ORG_ID })
  const response = await api.POST(connectRequest(body))

  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), authorizationUrl)
  assert.deepEqual(calls, [ORG_ID])
  assertPrivateNoStore(response)
})

test('connect redirects cross-origin and malformed forms safely back to settings', async () => {
  const calls: string[] = []
  const api = route<ConnectRoute>('src/app/api/integrations/fortnox/connect/route.ts', {
    createFortnoxAuthorization: async (orgId: string) => {
      calls.push(orgId)
      return 'https://apps.fortnox.se/oauth-v1/auth'
    },
  })
  const crossOrigin = connectRequest(new URLSearchParams({ orgId: ORG_ID }), {
    origin: 'https://attacker.test',
    'sec-fetch-site': 'cross-site',
  })
  const invalidContent = new Request('https://hushub.se/api/integrations/fortnox/connect', {
    method: 'POST',
    headers: sameOriginHeaders('application/json'),
    body: JSON.stringify({ orgId: ORG_ID }),
  })
  const missingOrganization = connectRequest(new URLSearchParams())
  const unknownRedirectField = connectRequest(
    new URLSearchParams({ orgId: ORG_ID, returnTo: 'https://attacker.test' })
  )

  for (const request of [crossOrigin, invalidContent, missingOrganization, unknownRedirectField]) {
    const response = await api.POST(request)
    const location = redirectLocation(response)
    assert.equal(response.status, 303)
    assert.equal(location.pathname, '/settings')
    assert.equal(location.searchParams.get('fortnox'), 'failed')
    assert.deepEqual([...location.searchParams.keys()], ['fortnox'])
    assertPrivateNoStore(response)
  }
  assert.deepEqual(calls, [])

  const unavailable = route<ConnectRoute>('src/app/api/integrations/fortnox/connect/route.ts', {
    createFortnoxAuthorization: async () => {
      throw new Error('FORTNOX_CONFIGURATION_MISSING')
    },
  })
  const unavailableResponse = await unavailable.POST(
    connectRequest(new URLSearchParams({ orgId: ORG_ID }))
  )
  const unavailableLocation = redirectLocation(unavailableResponse)
  assert.equal(unavailableLocation.searchParams.get('fortnox'), 'configuration_error')
  assert.equal(unavailableLocation.searchParams.get('orgId'), ORG_ID)
})

test('callback accepts Fortnox cross-site GET and forwards only state and one result', async () => {
  const received: unknown[] = []
  const api = route<CallbackRoute>('src/app/api/integrations/fortnox/callback/route.ts', {
    completeFortnoxAuthorization: async (input: unknown) => {
      received.push(input)
      return { orgId: ORG_ID.toUpperCase() }
    },
  })
  const state = 'opaque_state_value_that_must_not_return_1234567890'
  const code = 'one-time-authorization-code-secret'
  const url = new URL(CALLBACK_PATH, 'https://hushub.se')
  url.searchParams.set('state', state)
  url.searchParams.set('code', code)
  url.searchParams.set('error_description', 'private provider text and user@example.test')
  url.searchParams.set('tenantId', 'should-not-be-forwarded')

  const response = await api.GET(
    new Request(url, {
      headers: {
        origin: 'https://apps.fortnox.se',
        'sec-fetch-site': 'cross-site',
        referer: `https://apps.fortnox.se/private?code=${code}`,
      },
    })
  )
  const location = redirectLocation(response)

  assert.equal(response.status, 303)
  assert.deepEqual(received, [{ state, code, providerError: null }])
  assert.equal(location.pathname, '/settings')
  assert.equal(location.searchParams.get('fortnox'), 'connected')
  assert.equal(location.searchParams.get('orgId'), ORG_ID)
  assert.deepEqual([...location.searchParams.keys()].sort(), ['fortnox', 'orgId'])
  assert.doesNotMatch(
    `${location}${await response.text()}`,
    /opaque_state|authorization-code|provider text|user@example|tenantId/i
  )
  assertPrivateNoStore(response)
})

test('callback redirects failures with allowlisted status only and omits invalid organization ids', async () => {
  const privateProviderText = 'provider said client_secret=private and user@example.test'
  const cancelled = route<CallbackRoute>('src/app/api/integrations/fortnox/callback/route.ts', {
    completeFortnoxAuthorization: async () => {
      throw new Error('FORTNOX_AUTHORIZATION_CANCELLED')
    },
    fortnoxCallbackFailureOrganizationId: () => ORG_ID,
  })
  const cancelledUrl = new URL(CALLBACK_PATH, 'https://hushub.se')
  cancelledUrl.searchParams.set('state', 'private-state-value')
  cancelledUrl.searchParams.set('error', 'access_denied')
  cancelledUrl.searchParams.set('error_description', privateProviderText)
  const cancelledResponse = await cancelled.GET(new Request(cancelledUrl))
  const cancelledLocation = redirectLocation(cancelledResponse)

  assert.equal(cancelledResponse.status, 303)
  assert.equal(cancelledLocation.pathname, '/settings')
  assert.equal(cancelledLocation.searchParams.get('fortnox'), 'cancelled')
  assert.equal(cancelledLocation.searchParams.get('orgId'), ORG_ID)
  assert.deepEqual([...cancelledLocation.searchParams.keys()].sort(), ['fortnox', 'orgId'])
  assert.doesNotMatch(String(cancelledLocation), /private-state|access_denied|client_secret|user@example/i)

  const invalidCalls: unknown[] = []
  const invalidCallback = route<CallbackRoute>(
    'src/app/api/integrations/fortnox/callback/route.ts',
    {
      completeFortnoxAuthorization: async (input: unknown) => {
        invalidCalls.push(input)
        return { orgId: ORG_ID }
      },
    }
  )
  for (const query of [
    'state=state',
    'state=state&code=code&error=access_denied',
    'state=one&state=two&code=code',
    'state=state&code=one&code=two',
    'state=state&error=one&error=two',
  ]) {
    const invalidResponse = await invalidCallback.GET(
      new Request(`https://hushub.se${CALLBACK_PATH}?${query}`)
    )
    const invalidLocation = redirectLocation(invalidResponse)
    assert.equal(invalidLocation.searchParams.get('fortnox'), 'callback_invalid')
    assert.deepEqual([...invalidLocation.searchParams.keys()], ['fortnox'])
  }
  assert.deepEqual(invalidCalls, [])

  const invalidOrg = route<CallbackRoute>('src/app/api/integrations/fortnox/callback/route.ts', {
    completeFortnoxAuthorization: async () => ({
      orgId: `${ORG_ID}&code=private-code`,
    }),
  })
  const invalidOrgResponse = await invalidOrg.GET(
    new Request(`https://hushub.se${CALLBACK_PATH}?state=state&code=private-code`)
  )
  const invalidOrgLocation = redirectLocation(invalidOrgResponse)
  assert.equal(invalidOrgLocation.searchParams.get('fortnox'), 'connected')
  assert.equal(invalidOrgLocation.searchParams.has('orgId'), false)
  assert.doesNotMatch(String(invalidOrgLocation), /private-code|&code=/)

  const unknownFailure = route<CallbackRoute>('src/app/api/integrations/fortnox/callback/route.ts', {
    completeFortnoxAuthorization: async () => {
      throw new Error(privateProviderText)
    },
  })
  const unknownResponse = await unknownFailure.GET(
    new Request(`https://hushub.se${CALLBACK_PATH}?state=private-state&code=private-code`)
  )
  const unknownLocation = redirectLocation(unknownResponse)
  assert.equal(unknownLocation.searchParams.get('fortnox'), 'failed')
  assert.deepEqual([...unknownLocation.searchParams.keys()], ['fortnox'])
  assert.doesNotMatch(String(unknownLocation), /private-state|private-code|client_secret|user@example/i)

  const forcedUnsafe = http.buildFortnoxSettingsRedirect(
    `https://attacker.test${CALLBACK_PATH}`,
    'javascript:alert(1)',
    'not-a-uuid?code=secret'
  )
  assert.equal(forcedUnsafe.pathname, '/settings')
  assert.equal(forcedUnsafe.searchParams.get('fortnox'), 'failed')
  assert.deepEqual([...forcedUnsafe.searchParams.keys()], ['fortnox'])
})
