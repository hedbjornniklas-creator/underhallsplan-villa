import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as HttpModule from '../src/lib/fortnox/http'
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

const http = load<typeof HttpModule>('src/lib/fortnox/http.ts', {
  'server-only': {},
  './domain': fortnoxDomain,
})

function request(headers: HeadersInit, url = 'https://hushub.se/api/integrations/fortnox/connect') {
  return new Request(url, { method: 'POST', headers })
}

function assertOriginRejected(value: Request) {
  assert.throws(
    () => http.assertFortnoxSameOrigin(value),
    { message: 'FORTNOX_ORIGIN_FORBIDDEN' }
  )
}

test('Fortnox response headers are immutable and prevent storage, referrers and indexing', () => {
  assert.deepEqual(http.FORTNOX_RESPONSE_HEADERS, {
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Cookie',
  })
  assert.equal(Object.isFrozen(http.FORTNOX_RESPONSE_HEADERS), true)
  assert.equal(
    Reflect.set(http.FORTNOX_RESPONSE_HEADERS as Record<string, string>, 'Vary', '*'),
    false
  )
  assert.equal(http.FORTNOX_RESPONSE_HEADERS.Vary, 'Cookie')
})

test('same-origin protection requires an exact Origin and only permits safe Fetch Metadata values', () => {
  const allowedHeaders: HeadersInit[] = [
    { Origin: 'https://hushub.se' },
    { Origin: 'https://hushub.se', 'Sec-Fetch-Site': 'same-origin' },
    { Origin: 'https://hushub.se', 'Sec-Fetch-Site': 'none' },
  ]
  for (const headers of allowedHeaders) {
    assert.doesNotThrow(() => http.assertFortnoxSameOrigin(request(headers)))
  }

  const rejectedHeaders: HeadersInit[] = [
    {},
    { Origin: 'https://evil.example' },
    { Origin: 'https://hushub.se/' },
    { Origin: 'https://hushub.se', 'Sec-Fetch-Site': '' },
    { Origin: 'https://hushub.se', 'Sec-Fetch-Site': 'same-site' },
    { Origin: 'https://hushub.se', 'Sec-Fetch-Site': 'cross-site' },
  ]
  for (const headers of rejectedHeaders) {
    assertOriginRejected(request(headers))
  }

  assertOriginRejected({
    url: 'not-a-url',
    headers: new Headers({ Origin: 'https://hushub.se' }),
  } as Request)
})

test('known errors map to stable Swedish failures while unknown details remain opaque', () => {
  assert.deepEqual(http.fortnoxFailure(new Error('UNAUTHORIZED')), {
    code: 'UNAUTHORIZED',
    message: 'Logga in för att fortsätta.',
    status: 401,
  })
  assert.deepEqual(http.fortnoxFailure(new Error('FORTNOX_ORGANIZATION_ADMIN_REQUIRED')), {
    code: 'FORTNOX_ORGANIZATION_ADMIN_REQUIRED',
    message: 'Endast en organisationsadministratör kan hantera Fortnox-anslutningen.',
    status: 403,
  })
  assert.deepEqual(http.fortnoxFailure(new Error('FORTNOX_ORGANIZATION_MISMATCH')), {
    code: 'FORTNOX_ORGANIZATION_MISMATCH',
    message: 'Det valda Fortnox-företaget har ett annat organisationsnummer.',
    status: 409,
  })
  assert.deepEqual(http.fortnoxFailure(new Error('FORTNOX_INVALID_PROVIDER_RESPONSE')), {
    code: 'FORTNOX_INVALID_PROVIDER_RESPONSE',
    message: 'Fortnox returnerade ett oväntat svar.',
    status: 502,
  })
  assert.deepEqual(http.fortnoxFailure(new Error('FORTNOX_CONFIGURATION_MISSING')), {
    code: 'FORTNOX_CONFIGURATION_MISSING',
    message: 'Fortnox-anslutningen är inte konfigurerad på servern.',
    status: 503,
  })
  assert.deepEqual(http.fortnoxFailure(new Error('FORTNOX_VERIFICATION_SUPERSEDED')), {
    code: 'FORTNOX_VERIFICATION_SUPERSEDED',
    message: 'Anslutningen ändrades medan kontrollen pågick. Statusen har hämtats på nytt.',
    status: 409,
  })

  const rawSecret = 'client-secret-and-provider-body-must-not-leak'
  for (const value of [
    new Error(rawSecret),
    new Error('constructor'),
    new Error('__proto__'),
    new Error('toString'),
    rawSecret,
    { message: 'UNAUTHORIZED' },
    null,
  ]) {
    const failure = http.fortnoxFailure(value)
    assert.deepEqual(failure, {
      code: 'FORTNOX_REQUEST_FAILED',
      message: 'Fortnox-anslutningen kunde inte hanteras just nu. Försök igen.',
      status: 500,
    })
    assert.equal(JSON.stringify(failure).includes(rawSecret), false)
  }
})

test('callback failures collapse to specific allowlisted status categories', () => {
  const mappings: Array<[string, HttpModule.FortnoxCallbackStatus]> = [
    ['FORTNOX_AUTHORIZATION_CANCELLED', 'cancelled'],
    ['UNAUTHORIZED', 'login_required'],
    ['PRODUCT_ACCESS_REQUIRED', 'hushub_access_denied'],
    ['MODULE_ACCESS_REQUIRED', 'hushub_access_denied'],
    ['FORTNOX_ORGANIZATION_MEMBER_REQUIRED', 'hushub_access_denied'],
    ['FORTNOX_ORGANIZATION_ADMIN_REQUIRED', 'hushub_access_denied'],
    ['FORTNOX_ORGANIZATION_NOT_FOUND', 'hushub_access_denied'],
    ['FORTNOX_AUTHORIZATION_REJECTED', 'fortnox_access_denied'],
    ['FORTNOX_CLIENT_CREDENTIALS_REJECTED', 'fortnox_access_denied'],
    ['FORTNOX_ACCESS_TOKEN_REJECTED', 'fortnox_access_denied'],
    ['FORTNOX_PERMISSION_OR_LICENSE_MISSING', 'permission_or_license_missing'],
    ['FORTNOX_REQUIRED_SCOPE_MISSING', 'scope_missing'],
    ['FORTNOX_STATE_INVALID', 'state_invalid'],
    ['FORTNOX_CALLBACK_INVALID', 'callback_invalid'],
    ['FORTNOX_AUTHORIZATION_SUPERSEDED', 'superseded'],
    ['FORTNOX_ORGANIZATION_MISMATCH', 'organization_mismatch'],
    ['FORTNOX_COMPANY_VERIFICATION_FAILED', 'organization_mismatch'],
    ['FORTNOX_TENANT_ALREADY_CONNECTED', 'tenant_conflict'],
    ['FORTNOX_CONFIGURATION_INVALID', 'configuration_error'],
    ['FORTNOX_DATABASE_NOT_READY', 'configuration_error'],
    ['FORTNOX_TEMPORARILY_UNAVAILABLE', 'provider_unavailable'],
    ['FORTNOX_DATABASE_FAILED', 'failed'],
  ]
  const allowed = new Set<HttpModule.FortnoxCallbackStatus>([
    'connected',
    'cancelled',
    'login_required',
    'hushub_access_denied',
    'fortnox_access_denied',
    'permission_or_license_missing',
    'scope_missing',
    'state_invalid',
    'callback_invalid',
    'superseded',
    'organization_mismatch',
    'tenant_conflict',
    'configuration_error',
    'provider_unavailable',
    'failed',
  ])

  for (const [code, expected] of mappings) {
    const status = http.fortnoxCallbackStatus(new Error(code))
    assert.equal(status, expected)
    assert.equal(allowed.has(status), true)
  }
  assert.equal(http.fortnoxCallbackStatus(new Error('raw-provider-detail')), 'failed')
  assert.equal(http.fortnoxCallbackStatus({ message: 'UNAUTHORIZED' }), 'failed')
})

test('settings redirects use only a validated application origin and allowlisted query values', () => {
  const mutableEnvironment = process.env as Record<string, string | undefined>
  const previousAppBaseUrl = process.env.APP_BASE_URL
  const previousFortnoxRedirectUri = process.env.FORTNOX_REDIRECT_URI
  const previousNodeEnvironment = process.env.NODE_ENV

  try {
    mutableEnvironment.NODE_ENV = 'production'
    delete process.env.FORTNOX_REDIRECT_URI
    process.env.APP_BASE_URL = ' https://preview.hushub.example/ '
    assert.equal(
      http.buildFortnoxSettingsRedirect(
        'https://attacker.example/stolen?code=raw-code',
        'connected',
        'F543B282-1BC6-401A-9F3C-EF4492187C62'
      ).toString(),
      'https://preview.hushub.example/settings?fortnox=connected&orgId=f543b282-1bc6-401a-9f3c-ef4492187c62'
    )

    const unsafe = http.buildFortnoxSettingsRedirect(
      'https://attacker.example/callback?code=raw-code&state=raw-state',
      'connected&next=https://attacker.example',
      'not-a-uuid&code=raw-code'
    )
    assert.equal(unsafe.toString(), 'https://preview.hushub.example/settings?fortnox=failed')
    assert.equal(unsafe.toString().includes('raw-code'), false)
    assert.equal(unsafe.toString().includes('raw-state'), false)
    assert.equal(unsafe.toString().includes('attacker.example/callback'), false)

    for (const invalidBaseUrl of [
      'http://preview.hushub.example',
      'https://user:password@preview.hushub.example',
      'https://preview.hushub.example/subpath',
      'https://preview.hushub.example/?next=https://attacker.example',
      'not-a-url',
    ]) {
      process.env.APP_BASE_URL = invalidBaseUrl
      assert.equal(
        http.buildFortnoxSettingsRedirect(
          'https://attacker.example/callback',
          'cancelled'
        ).toString(),
        'https://hushub.se/settings?fortnox=cancelled'
      )
    }

    delete process.env.APP_BASE_URL
    assert.equal(
      http.buildFortnoxSettingsRedirect(
        'http://localhost:3000/api/integrations/fortnox/callback?code=raw-code',
        'failed'
      ).toString(),
      'https://hushub.se/settings?fortnox=failed'
    )

    mutableEnvironment.NODE_ENV = 'development'
    assert.equal(
      http.buildFortnoxSettingsRedirect(
        'http://localhost:3000/api/integrations/fortnox/callback?code=raw-code',
        'provider_unavailable'
      ).toString(),
      'http://localhost:3000/settings?fortnox=provider_unavailable'
    )
    assert.equal(
      http.buildFortnoxSettingsRedirect(
        'http://127.0.0.1:3100/anything?state=raw-state',
        'cancelled'
      ).toString(),
      'http://127.0.0.1:3100/settings?fortnox=cancelled'
    )
    assert.equal(
      http.buildFortnoxSettingsRedirect(
        'http://attacker.example/callback',
        'connected'
      ).toString(),
      'https://hushub.se/settings?fortnox=connected'
    )

    process.env.APP_BASE_URL = 'http://localhost:3200'
    assert.equal(
      http.buildFortnoxSettingsRedirect(
        'http://attacker.example/callback',
        'connected'
      ).toString(),
      'http://localhost:3200/settings?fortnox=connected'
    )

    mutableEnvironment.NODE_ENV = 'production'
    process.env.APP_BASE_URL = 'https://wrong-environment.example'
    process.env.FORTNOX_REDIRECT_URI =
      'https://staging.hushub.example/api/integrations/fortnox/callback'
    assert.equal(
      http.buildFortnoxSettingsRedirect(
        'https://wrong-environment.example/api/integrations/fortnox/callback',
        'configuration_error'
      ).toString(),
      'https://staging.hushub.example/settings?fortnox=configuration_error'
    )
  } finally {
    if (previousAppBaseUrl === undefined) delete process.env.APP_BASE_URL
    else process.env.APP_BASE_URL = previousAppBaseUrl
    if (previousFortnoxRedirectUri === undefined) delete process.env.FORTNOX_REDIRECT_URI
    else process.env.FORTNOX_REDIRECT_URI = previousFortnoxRedirectUri
    if (previousNodeEnvironment === undefined) delete mutableEnvironment.NODE_ENV
    else mutableEnvironment.NODE_ENV = previousNodeEnvironment
  }
})
