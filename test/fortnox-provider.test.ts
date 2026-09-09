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
      requestedScopes: ['companyinformation'],
      configuration,
    },
    capturingFetch(
      {
        access_token: 'short-lived-access-token',
        refresh_token: 'refresh-token-never-leak',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'companyinformation companyinformation',
      },
      calls
    )
  )

  assert.deepEqual(token, {
    accessToken: 'short-lived-access-token',
    scopes: ['companyinformation'],
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
      requestedScopes: ['companyinformation'],
      configuration,
    },
    capturingFetch(
      {
        access_token: 'client-credentials-access-token',
        refresh_token: 'refresh-token-never-leak',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'companyinformation',
      },
      calls
    )
  )

  assert.deepEqual(token, {
    accessToken: 'client-credentials-access-token',
    scopes: ['companyinformation'],
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
    ['scope', 'companyinformation'],
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
