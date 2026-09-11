import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as ProviderModule from '../src/lib/fortnox/provider'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiledModule = { exports: {} }

  new Function('require', 'module', 'exports', code)(
    (name: string) => {
      if (name in dependencies) return dependencies[name]
      throw new Error(`Unexpected dependency: ${name}`)
    },
    compiledModule,
    compiledModule.exports
  )

  return compiledModule.exports as T
}

const provider = load<typeof ProviderModule>('src/lib/fortnox/provider.ts', {
  'server-only': {},
  './domain': fortnoxDomain,
})

const configuration: ProviderModule.FortnoxConfiguration = {
  clientId: 'fortnox-client-id',
  clientSecret: 'client-secret-never-leak',
  redirectUri: fortnoxDomain.FORTNOX_PRODUCTION_REDIRECT_URI,
}

type CapturedRequest = {
  url: string
  init: RequestInit
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function capturingFetch(value: unknown, calls: CapturedRequest[]): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      init: init ?? {},
    })
    return response(value)
  }
}

function requestHeaders(call: CapturedRequest) {
  return new Headers(call.init.headers)
}

function requestBody(call: CapturedRequest) {
  assert.ok(call.init.body instanceof URLSearchParams)
  return call.init.body
}

function jsonRequestBody(call: CapturedRequest) {
  assert.equal(typeof call.init.body, 'string')
  return JSON.parse(call.init.body as string) as unknown
}

function assertCommonRequestContract(call: CapturedRequest) {
  assert.equal(call.init.cache, 'no-store')
  assert.ok(call.init.signal instanceof AbortSignal)
  assert.equal(call.init.signal.aborted, false)
}

async function capturedError(action: () => Promise<unknown>) {
  try {
    await action()
    assert.fail('Expected the provider operation to reject.')
  } catch (error) {
    assert.ok(error instanceof Error)
    return error
  }
}

function assertOpaqueError(error: Error, expectedMessage: string, sensitiveValues: string[]) {
  assert.equal(error.message, expectedMessage)
  const surfaced = [error.name, error.message, error.stack ?? '', JSON.stringify(error)].join('\n')
  for (const value of sensitiveValues) {
    assert.equal(surfaced.includes(value), false, `Leaked sensitive value: ${value}`)
  }
}

test('Fortnox configuration trims secrets and validates the exact callback shape', () => {
  assert.deepEqual(
    provider.getFortnoxConfiguration({
      FORTNOX_CLIENT_ID: ' client-id ',
      FORTNOX_CLIENT_SECRET: ' client-secret ',
    }),
    {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: fortnoxDomain.FORTNOX_PRODUCTION_REDIRECT_URI,
    }
  )

  assert.deepEqual(
    provider.getFortnoxConfiguration({
      FORTNOX_CLIENT_ID: 'client-id',
      FORTNOX_CLIENT_SECRET: 'client-secret',
      FORTNOX_REDIRECT_URI: `http://localhost:3000${fortnoxDomain.FORTNOX_CALLBACK_PATH}`,
      APP_BASE_URL: 'http://localhost:3000',
    }),
    {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: `http://localhost:3000${fortnoxDomain.FORTNOX_CALLBACK_PATH}`,
    }
  )

  const mismatchedOrigins = {
      FORTNOX_CLIENT_ID: 'client-id',
      FORTNOX_CLIENT_SECRET: 'client-secret',
      FORTNOX_REDIRECT_URI: `https://staging.hushub.se${fortnoxDomain.FORTNOX_CALLBACK_PATH}`,
      APP_BASE_URL: 'https://hushub.se',
    }
  assert.throws(
    () => provider.getFortnoxConfiguration(mismatchedOrigins),
    { message: 'FORTNOX_CONFIGURATION_INVALID' }
  )
  assert.equal(provider.isFortnoxConfigured(mismatchedOrigins), false)

  for (const environment of [
    {},
    { FORTNOX_CLIENT_ID: 'client-id' },
    { FORTNOX_CLIENT_SECRET: 'client-secret' },
    { FORTNOX_CLIENT_ID: 'client\nid', FORTNOX_CLIENT_SECRET: 'client-secret' },
  ]) {
    assert.throws(
      () => provider.getFortnoxConfiguration(environment),
      { message: 'FORTNOX_CONFIGURATION_MISSING' }
    )
    assert.equal(provider.isFortnoxConfigured(environment), false)
  }

  for (const clientId of ['client id', `client-${'x'.repeat(506)}`]) {
    const environment = {
      FORTNOX_CLIENT_ID: clientId,
      FORTNOX_CLIENT_SECRET: 'client-secret',
    }
    assert.throws(
      () => provider.getFortnoxConfiguration(environment),
      { message: 'FORTNOX_CONFIGURATION_INVALID' }
    )
    assert.equal(provider.isFortnoxConfigured(environment), false)
  }

  for (const redirectUri of [
    'http://example.test/api/integrations/fortnox/callback',
    'https://example.test/not-the-fortnox-callback',
    'https://example.test/api/integrations/fortnox/callback?code=unsafe',
    'https://user:password@example.test/api/integrations/fortnox/callback',
  ]) {
    const environment = {
      FORTNOX_CLIENT_ID: 'client-id',
      FORTNOX_CLIENT_SECRET: 'client-secret',
      FORTNOX_REDIRECT_URI: redirectUri,
    }
    assert.throws(
      () => provider.getFortnoxConfiguration(environment),
      { message: 'FORTNOX_CONFIGURATION_INVALID' }
    )
    assert.equal(provider.isFortnoxConfigured(environment), false)
  }
})

test('authorization-code exchange sends the exact Fortnox token request and returns no refresh token', async () => {
  const calls: CapturedRequest[] = []
  const token = await provider.exchangeFortnoxAuthorizationCode(
    {
      code: 'one-time-authorization-code',
      requestedScopes: fortnoxDomain.FORTNOX_CONNECTION_SCOPES,
      configuration,
    },
    capturingFetch(
      {
        access_token: 'short-lived-access-token',
        refresh_token: 'refresh-token-never-leak',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'companyinformation customer invoice customer',
      },
      calls
    )
  )

  assert.deepEqual(token, {
    accessToken: 'short-lived-access-token',
    scopes: ['companyinformation', 'customer', 'invoice'],
    expiresIn: 3600,
    tokenType: 'bearer',
  })
  assert.equal('refreshToken' in token, false)
  assert.equal(calls.length, 1)

  const call = calls[0]
  assert.equal(call.url, fortnoxDomain.FORTNOX_TOKEN_ENDPOINT)
  assert.equal(call.init.method, 'POST')
  assertCommonRequestContract(call)
  const headers = requestHeaders(call)
  assert.deepEqual([...headers.keys()].sort(), ['accept', 'authorization', 'content-type'])
  assert.equal(headers.get('accept'), 'application/json')
  assert.equal(headers.get('content-type'), 'application/x-www-form-urlencoded')
  assert.equal(
    headers.get('authorization'),
    `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`, 'utf8').toString('base64')}`
  )
  assert.deepEqual([...requestBody(call).entries()], [
    ['grant_type', 'authorization_code'],
    ['code', 'one-time-authorization-code'],
    ['redirect_uri', fortnoxDomain.FORTNOX_PRODUCTION_REDIRECT_URI],
  ])
})

test('client-credentials exchange sends TenantId and the requested scope exactly once', async () => {
  const calls: CapturedRequest[] = []
  const token = await provider.requestFortnoxClientCredentialsToken(
    {
      tenantId: '123456',
      requestedScopes: fortnoxDomain.FORTNOX_CONNECTION_SCOPES,
      configuration,
    },
    capturingFetch(
      {
        access_token: 'client-credentials-access-token',
        refresh_token: 'refresh-token-never-leak',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'companyinformation customer invoice',
      },
      calls
    )
  )

  assert.deepEqual(token, {
    accessToken: 'client-credentials-access-token',
    scopes: ['companyinformation', 'customer', 'invoice'],
    expiresIn: 3600,
    tokenType: 'bearer',
  })
  assert.equal('refreshToken' in token, false)
  assert.equal(calls.length, 1)

  const call = calls[0]
  assert.equal(call.url, fortnoxDomain.FORTNOX_TOKEN_ENDPOINT)
  assert.equal(call.init.method, 'POST')
  assertCommonRequestContract(call)
  const headers = requestHeaders(call)
  assert.deepEqual([...headers.keys()].sort(), [
    'accept',
    'authorization',
    'content-type',
    'tenantid',
  ])
  assert.equal(headers.get('tenantid'), '123456')
  assert.equal(
    headers.get('authorization'),
    `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`, 'utf8').toString('base64')}`
  )
  assert.deepEqual([...requestBody(call).entries()], [
    ['grant_type', 'client_credentials'],
    ['scope', 'companyinformation customer invoice'],
  ])
})

test('company-information lookup sends the exact bearer request and parses the Fortnox envelope', async () => {
  const calls: CapturedRequest[] = []
  const company = await provider.fetchFortnoxCompanyInformation(
    'short-lived-access-token',
    capturingFetch(
      {
        CompanyInformation: {
          DatabaseNumber: 123456,
          CompanyName: '  Testbolaget AB  ',
          OrganizationNumber: '5561234567',
        },
      },
      calls
    )
  )

  assert.deepEqual(company, {
    tenantId: '123456',
    companyName: 'Testbolaget AB',
    organizationNumber: '556123-4567',
  })
  assert.equal(calls.length, 1)

  const call = calls[0]
  assert.equal(call.url, `${fortnoxDomain.FORTNOX_API_BASE_URL}/companyinformation`)
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.body, undefined)
  assertCommonRequestContract(call)
  const headers = requestHeaders(call)
  assert.deepEqual([...headers.keys()].sort(), ['accept', 'authorization'])
  assert.equal(headers.get('accept'), 'application/json')
  assert.equal(headers.get('authorization'), 'Bearer short-lived-access-token')
})

test('provider responses fail closed when scope or response envelopes drift', async () => {
  const missingScope = await capturedError(() =>
    provider.exchangeFortnoxAuthorizationCode(
      {
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      capturingFetch(
        {
          access_token: 'short-lived-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'customer',
        },
        []
      )
    )
  )
  assert.equal(missingScope.message, 'FORTNOX_REQUIRED_SCOPE_MISSING')

  const extraScope = await capturedError(() =>
    provider.exchangeFortnoxAuthorizationCode(
      {
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      capturingFetch(
        {
          access_token: 'short-lived-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'companyinformation customer',
        },
        []
      )
    )
  )
  assert.equal(extraScope.message, 'FORTNOX_REQUIRED_SCOPE_MISSING')

  const malformedToken = await capturedError(() =>
    provider.exchangeFortnoxAuthorizationCode(
      {
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      capturingFetch({ access_token: 123, scope: 'customer' }, [])
    )
  )
  assert.equal(malformedToken.message, 'FORTNOX_INVALID_PROVIDER_RESPONSE')

  const malformedTokenEnvelopeWithWrongScope = await capturedError(() =>
    provider.exchangeFortnoxAuthorizationCode(
      {
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      capturingFetch(
        {
          access_token: '',
          token_type: 'mac',
          expires_in: 0,
          scope: 'customer',
        },
        []
      )
    )
  )
  assert.equal(
    malformedTokenEnvelopeWithWrongScope.message,
    'FORTNOX_INVALID_PROVIDER_RESPONSE'
  )

  const malformedCompany = await capturedError(() =>
    provider.fetchFortnoxCompanyInformation(
      'short-lived-access-token',
      capturingFetch(
        {
          CompanyInformation: {
            DatabaseNumber: 'not-a-tenant',
            CompanyName: 'Testbolaget AB',
            OrganizationNumber: '556123-4567',
          },
        },
        []
      )
    )
  )
  assert.equal(malformedCompany.message, 'FORTNOX_INVALID_PROVIDER_RESPONSE')
})

test('HTTP status and safe OAuth errors distinguish connection failures from app configuration', async () => {
  const failingFetch = (status: number, error = 'provider-body-never-leak'): typeof fetch =>
    async () => response({ error }, status)

  const cases: Array<{
    expected: string
    run: (fetchImplementation: typeof fetch) => Promise<unknown>
  }> = [
    {
      expected: 'FORTNOX_CONFIGURATION_INVALID',
      run: (fetchImplementation) => provider.exchangeFortnoxAuthorizationCode({
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      }, fetchImplementation),
    },
    {
      expected: 'FORTNOX_CONFIGURATION_INVALID',
      run: (fetchImplementation) => provider.requestFortnoxClientCredentialsToken({
        tenantId: '123456',
        requestedScopes: ['companyinformation'],
        configuration,
      }, fetchImplementation),
    },
    {
      expected: 'FORTNOX_ACCESS_TOKEN_REJECTED',
      run: (fetchImplementation) => provider.fetchFortnoxCompanyInformation(
        'short-lived-access-token',
        fetchImplementation
      ),
    },
  ]

  for (const item of cases) {
    const error = await capturedError(() => item.run(failingFetch(401)))
    assert.equal(error.message, item.expected)
  }

  const rejectedAuthorization = await capturedError(() =>
    provider.exchangeFortnoxAuthorizationCode(
      {
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      failingFetch(400, 'invalid_grant')
    )
  )
  assert.equal(rejectedAuthorization.message, 'FORTNOX_AUTHORIZATION_REJECTED')

  const rejectedTenantGrant = await capturedError(() =>
    provider.requestFortnoxClientCredentialsToken(
      {
        tenantId: '123456',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      failingFetch(400, 'invalid_grant')
    )
  )
  assert.equal(rejectedTenantGrant.message, 'FORTNOX_CLIENT_CREDENTIALS_REJECTED')

  for (const oauthError of ['invalid_client', 'invalid_scope', 'unauthorized_client']) {
    const configurationError = await capturedError(() =>
      provider.requestFortnoxClientCredentialsToken(
        {
          tenantId: '123456',
          requestedScopes: ['companyinformation'],
          configuration,
        },
        failingFetch(400, oauthError)
      )
    )
    assert.equal(configurationError.message, 'FORTNOX_CONFIGURATION_INVALID')
  }

  for (const missingLicense of ['error_missing_license', 'error_missing_app_license']) {
    const licenseError = await capturedError(() =>
      provider.exchangeFortnoxAuthorizationCode(
        {
          code: 'one-time-authorization-code',
          requestedScopes: ['companyinformation'],
          configuration,
        },
        failingFetch(400, missingLicense)
      )
    )
    assert.equal(licenseError.message, 'FORTNOX_PERMISSION_OR_LICENSE_MISSING')
  }

  const unknownTenantError = await capturedError(() =>
    provider.requestFortnoxClientCredentialsToken(
      {
        tenantId: '123456',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      failingFetch(400, 'unexpected_provider_error')
    )
  )
  assert.equal(unknownTenantError.message, 'FORTNOX_PROVIDER_REQUEST_FAILED')

  for (const status of [403, 429, 500]) {
    const error = await capturedError(() =>
      provider.fetchFortnoxCompanyInformation('short-lived-access-token', failingFetch(status))
    )
    assert.equal(
      error.message,
      status === 403 ? 'FORTNOX_PERMISSION_OR_LICENSE_MISSING' : 'FORTNOX_TEMPORARILY_UNAVAILABLE'
    )
  }

  const unexpectedStatus = await capturedError(() =>
    provider.fetchFortnoxCompanyInformation('short-lived-access-token', failingFetch(418))
  )
  assert.equal(unexpectedStatus.message, 'FORTNOX_PROVIDER_REQUEST_FAILED')
})

test('network and provider failures never expose client secrets, refresh tokens or provider bodies', async () => {
  const sensitiveValues = [
    configuration.clientSecret,
    'refresh-token-never-leak',
    'provider-body-never-leak',
  ]
  const networkError = await capturedError(() =>
    provider.exchangeFortnoxAuthorizationCode(
      {
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      async () => {
        throw new Error(sensitiveValues.join(':'))
      }
    )
  )
  assertOpaqueError(networkError, 'FORTNOX_TEMPORARILY_UNAVAILABLE', sensitiveValues)

  const providerError = await capturedError(() =>
    provider.exchangeFortnoxAuthorizationCode(
      {
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      async () => response({
        error: sensitiveValues[2],
        refresh_token: sensitiveValues[1],
        client_secret: sensitiveValues[0],
      }, 400)
    )
  )
  assertOpaqueError(providerError, 'FORTNOX_AUTHORIZATION_REJECTED', sensitiveValues)

  const invalidSuccess = await capturedError(() =>
    provider.exchangeFortnoxAuthorizationCode(
      {
        code: 'one-time-authorization-code',
        requestedScopes: ['companyinformation'],
        configuration,
      },
      async () => response({
        provider_detail: sensitiveValues[2],
        refresh_token: sensitiveValues[1],
        client_secret: sensitiveValues[0],
      })
    )
  )
  assertOpaqueError(invalidSuccess, 'FORTNOX_INVALID_PROVIDER_RESPONSE', sensitiveValues)
})

test('exact customer lookup uses the path identifier and treats only 404 as absent', async () => {
  const calls: CapturedRequest[] = []
  const customer = await provider.fetchFortnoxCustomer(
    'short-lived-access-token',
    ' HH1001 ',
    capturingFetch(
      {
        Customer: {
          CustomerNumber: 'HH1001',
          ExternalReference: 'HH550E8400E29B41D4A716446655440000',
          OrganisationNumber: '5561234567',
          Name: 'Testkund AB',
        },
      },
      calls
    )
  )

  assert.deepEqual(customer, {
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    organizationNumber: '556123-4567',
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${fortnoxDomain.FORTNOX_API_BASE_URL}/customers/HH1001`)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.body, undefined)
  assertCommonRequestContract(calls[0])
  assert.deepEqual([...requestHeaders(calls[0]).entries()], [
    ['accept', 'application/json'],
    ['authorization', 'Bearer short-lived-access-token'],
  ])

  const absent = await provider.fetchFortnoxCustomer(
    'short-lived-access-token',
    'HH1002',
    async () => response({ provider_detail: 'not-returned' }, 404)
  )
  assert.equal(absent, null)
})

test('organization-number search paginates and locally removes Fortnox fuzzy matches', async () => {
  const calls: CapturedRequest[] = []
  const pages = [
    {
      Customers: [
        {
          CustomerNumber: 'HH1001',
          ExternalReference: 'HH550E8400E29B41D4A716446655440000',
          OrganisationNumber: '5561234567',
        },
        {
          CustomerNumber: 'FUZZY1',
          ExternalReference: null,
          OrganisationNumber: '556765-4321',
        },
      ],
      MetaInformation: {
        '@CurrentPage': 1,
        '@TotalPages': 2,
        '@TotalResources': 3,
      },
    },
    {
      Customers: [
        {
          CustomerNumber: 'MANUAL2',
          ExternalReference: null,
          OrganisationNumber: '556123-4567',
        },
      ],
      MetaInformation: {
        '@CurrentPage': 2,
        '@TotalPages': 2,
        '@TotalResources': 3,
      },
    },
  ]
  const fetchImplementation: typeof fetch = async (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      init: init ?? {},
    })
    return response(pages[calls.length - 1])
  }

  const customers = await provider.findFortnoxCustomersByOrganizationNumber(
    'short-lived-access-token',
    '5561234567',
    fetchImplementation
  )
  assert.deepEqual(customers, [
    {
      customerNumber: 'HH1001',
      externalReference: 'HH550E8400E29B41D4A716446655440000',
      organizationNumber: '556123-4567',
    },
    {
      customerNumber: 'MANUAL2',
      externalReference: null,
      organizationNumber: '556123-4567',
    },
  ])
  assert.equal(calls.length, 2)
  for (const [index, call] of calls.entries()) {
    const url = new URL(call.url)
    assert.equal(url.origin + url.pathname, `${fortnoxDomain.FORTNOX_API_BASE_URL}/customers`)
    assert.deepEqual([...url.searchParams.entries()], [
      ['organisationnumber', '556123-4567'],
      ['limit', String(fortnoxDomain.FORTNOX_CUSTOMER_LIST_LIMIT)],
      ['page', String(index + 1)],
    ])
    assert.equal(call.init.method, 'GET')
    assertCommonRequestContract(call)
  }
})

test('customer reads fail closed on invalid input, response drift and provider failures', async () => {
  let calls = 0
  const mustNotFetch: typeof fetch = async () => {
    calls += 1
    throw new Error('must not fetch')
  }
  await assert.rejects(
    provider.fetchFortnoxCustomer('short-lived-access-token', '', mustNotFetch),
    { message: 'FORTNOX_CUSTOMER_NUMBER_INVALID' }
  )
  await assert.rejects(
    provider.findFortnoxCustomersByOrganizationNumber(
      'short-lived-access-token',
      'invalid',
      mustNotFetch
    ),
    { message: 'FORTNOX_CUSTOMER_ORGANIZATION_NUMBER_INVALID' }
  )
  await assert.rejects(
    provider.fetchFortnoxCustomer('unsafe\ntoken', 'HH1001', mustNotFetch),
    { message: 'FORTNOX_INVALID_PROVIDER_RESPONSE' }
  )
  assert.equal(calls, 0)

  for (const [status, expected] of [
    [401, 'FORTNOX_ACCESS_TOKEN_REJECTED'],
    [403, 'FORTNOX_PERMISSION_OR_LICENSE_MISSING'],
    [429, 'FORTNOX_TEMPORARILY_UNAVAILABLE'],
    [500, 'FORTNOX_TEMPORARILY_UNAVAILABLE'],
    [418, 'FORTNOX_PROVIDER_REQUEST_FAILED'],
  ] as const) {
    await assert.rejects(
      provider.fetchFortnoxCustomer(
        'short-lived-access-token',
        'HH1001',
        async () => response({ ErrorInformation: { Code: 1 } }, status)
      ),
      { message: expected }
    )
  }

  await assert.rejects(
    provider.fetchFortnoxCustomer(
      'short-lived-access-token',
      'HH1001',
      async () => {
        throw new Error('network-provider-detail-never-leak')
      }
    ),
    { message: 'FORTNOX_TEMPORARILY_UNAVAILABLE' }
  )
  await assert.rejects(
    provider.fetchFortnoxCustomer(
      'short-lived-access-token',
      'HH1001',
      async () => response({ Customer: { CustomerNumber: 1001 } })
    ),
    { message: 'FORTNOX_INVALID_PROVIDER_RESPONSE' }
  )
  await assert.rejects(
    provider.findFortnoxCustomersByOrganizationNumber(
      'short-lived-access-token',
      '556123-4567',
      async () =>
        response({
          Customers: [],
          MetaInformation: {
            '@CurrentPage': 2,
            '@TotalPages': 2,
            '@TotalResources': 0,
          },
        })
    ),
    { message: 'FORTNOX_INVALID_PROVIDER_RESPONSE' }
  )
})

test('customer creation sends only the strict Customer envelope and verifies its identity', async () => {
  const draft = fortnoxDomain.buildFortnoxCustomerDraft({
    customerType: 'business',
    name: 'Testkund AB',
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    organizationNumber: '556123-4567',
    email: 'kontakt@example.se',
    invoiceEmail: 'faktura@example.se',
    phone: '0700000000',
    address: 'Testgatan 1',
    addressLine2: null,
    postalCode: '11122',
    city: 'Stockholm',
    countryCode: 'SE',
  })
  const calls: CapturedRequest[] = []
  const fetchImplementation: typeof fetch = async (input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      init: init ?? {},
    })
    return response(
      {
        Customer: {
          ...draft,
          Name: 'Provider may return more fields',
        },
      },
      201
    )
  }

  const customer = await provider.createFortnoxCustomer(
    'short-lived-access-token',
    draft,
    fetchImplementation
  )
  assert.deepEqual(customer, {
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    organizationNumber: '556123-4567',
  })
  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.equal(call.url, `${fortnoxDomain.FORTNOX_API_BASE_URL}/customers`)
  assert.equal(call.init.method, 'POST')
  assertCommonRequestContract(call)
  assert.deepEqual([...requestHeaders(call).keys()].sort(), [
    'accept',
    'authorization',
    'content-type',
  ])
  assert.equal(requestHeaders(call).get('authorization'), 'Bearer short-lived-access-token')
  assert.equal(requestHeaders(call).get('content-type'), 'application/json')
  assert.deepEqual(jsonRequestBody(call), { Customer: draft })
})

test('customer creation rejects cast payload additions before sending data', async () => {
  const draft = fortnoxDomain.buildFortnoxCustomerDraft({
    customerType: 'private',
    name: 'Privatkund',
    customerNumber: 'HH1002',
    externalReference: 'HH550E8400E29B41D4A716446655440001',
    countryCode: 'SE',
  })
  let calls = 0
  await assert.rejects(
    provider.createFortnoxCustomer(
      'short-lived-access-token',
      { ...draft, PersonalIdentityNumber: '19000101-0000' } as never,
      async () => {
        calls += 1
        return response({}, 201)
      }
    ),
    { message: 'FORTNOX_CUSTOMER_PAYLOAD_INVALID' }
  )
  await assert.rejects(
    provider.createFortnoxCustomer('unsafe\ntoken', draft, async () => {
      calls += 1
      return response({}, 201)
    }),
    { message: 'FORTNOX_INVALID_PROVIDER_RESPONSE' }
  )
  assert.equal(calls, 0)
})

test('customer write failures distinguish rejection, conflict and unknown outcome', async () => {
  const draft = fortnoxDomain.buildFortnoxCustomerDraft({
    customerType: 'business',
    name: 'Testkund AB',
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    organizationNumber: '556123-4567',
    countryCode: 'SE',
  })
  const failingFetch = (status: number, code = 1): typeof fetch =>
    async () => response({ ErrorInformation: { Code: code, Error: 1, Message: 'secret' } }, status)

  for (const [status, code, expected] of [
    [400, 2_000_637, 'FORTNOX_CUSTOMER_NUMBER_CONFLICT'],
    [409, 2_000_637, 'FORTNOX_CUSTOMER_NUMBER_CONFLICT'],
    [400, 1, 'FORTNOX_CUSTOMER_REJECTED'],
    [422, 1, 'FORTNOX_CUSTOMER_REJECTED'],
    [401, 1, 'FORTNOX_ACCESS_TOKEN_REJECTED'],
    [403, 1, 'FORTNOX_PERMISSION_OR_LICENSE_MISSING'],
    [408, 1, 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN'],
    [429, 1, 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN'],
    [500, 2_000_637, 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN'],
    [418, 1, 'FORTNOX_PROVIDER_REQUEST_FAILED'],
  ] as const) {
    const error = await capturedError(() =>
      provider.createFortnoxCustomer(
        'short-lived-access-token',
        draft,
        failingFetch(status, code)
      )
    )
    assertOpaqueError(error, expected, ['secret'])
  }

  const networkError = await capturedError(() =>
    provider.createFortnoxCustomer('short-lived-access-token', draft, async () => {
      throw new Error('network-secret-never-leak')
    })
  )
  assertOpaqueError(networkError, 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN', [
    'network-secret-never-leak',
  ])
})

test('malformed or mismatched customer create success is always an unknown outcome', async () => {
  const draft = fortnoxDomain.buildFortnoxCustomerDraft({
    customerType: 'business',
    name: 'Testkund AB',
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    organizationNumber: '556123-4567',
    countryCode: 'SE',
  })
  const successPayload = {
    Customer: {
      CustomerNumber: draft.CustomerNumber,
      ExternalReference: draft.ExternalReference,
      OrganisationNumber: draft.OrganisationNumber,
    },
  }
  const cases: Array<() => Promise<Response>> = [
    async () => new Response('not-json', { status: 201 }),
    async () => response({}, 201),
    async () => response(successPayload, 200),
    async () =>
      response(
        {
          Customer: { ...successPayload.Customer, CustomerNumber: 'DIFFERENT' },
        },
        201
      ),
    async () =>
      response(
        {
          Customer: { ...successPayload.Customer, ExternalReference: 'DIFFERENT' },
        },
        201
      ),
    async () =>
      response(
        {
          Customer: { ...successPayload.Customer, OrganisationNumber: '556765-4321' },
        },
        201
      ),
  ]

  for (const fetchResponse of cases) {
    await assert.rejects(
      provider.createFortnoxCustomer('short-lived-access-token', draft, fetchResponse),
      { message: 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN' }
    )
  }
})
