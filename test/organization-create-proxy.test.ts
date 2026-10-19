import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createServerClient } from '@supabase/ssr'
import ts from 'typescript'

// Next's matcher test helpers load server internals which expect the runtime's
// AsyncLocalStorage global. The standalone Node test runner does not install it.
Object.assign(globalThis, { AsyncLocalStorage })
const require = createRequire(import.meta.url)
const { NextRequest, NextResponse } = require('next/server') as typeof import('next/server')
const { RequestCookiesAdapter } = require('next/dist/server/web/spec-extension/adapters/request-cookies')
const { unstable_doesMiddlewareMatch } = require('next/dist/experimental/testing/server/middleware-testing-utils') as typeof import('next/experimental/testing/server')
const path = '/settings/organisation/skapa'
const dashboardPath = '/dashboard-v1'
const entityId = '22222222-2222-4222-8222-222222222222'
const protectedPaths = [
  path, dashboardPath, '/ob', `/ob/assignments/${entityId}`,
  `/eb/projects/${entityId}/inspections/${entityId}/perform`, `/tu/assignments/${entityId}`,
  `/fuktsakerhet/projekt/${entityId}`, `/uppdrag/${entityId}/kund`,
  `/properties/${entityId}/ob/${entityId}`, '/inspections', '/settings/profil', '/admin/access', '/app',
  `/utlatande/${entityId}/${entityId}`,
  `/renoapp/app/cases/${entityId}`, `/renoapp/review/${entityId}`,
  '/mina-uppdrag', `/mina-uppdrag/uppdrag/${entityId}`,
]
const origin = 'https://hushub.example.test'
const authOrigin = 'https://local.supabase.test'
const cookieName = 'sb-local-auth-token'
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.test', aud: 'authenticated', role: 'authenticated' }
const now = Math.floor(Date.now() / 1000)
const jwt = (expiresAt: number) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: expiresAt, iat: now - 3600 })).toString('base64url'),
  'synthetic-signature',
].join('.')
const session = (expired = false) => ({ access_token: jwt(expired ? now - 5 : now + 3600),
  refresh_token: 'synthetic-refresh', expires_at: expired ? now - 5 : now + 3600,
  expires_in: 3600, token_type: 'bearer', user })
const encode = (value: unknown) => `base64-${Buffer.from(JSON.stringify(value)).toString('base64url')}`

function load<T>(file: string, dependencies: Record<string, unknown>, environment: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: authOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key',
}): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'process', output)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected test dependency: ${name}`)
    return dependencies[name]
  }, mod, mod.exports, { env: environment })
  return mod.exports as T
}

const returnPaths = load<{
  authLoginUrl: (value: unknown) => string
  safeAuthReturnPath: (value: unknown, fallback?: string) => string
}>('src/lib/auth/returnPath.ts', {})
const proxyDependencies = { 'next/server': { NextResponse }, '@/lib/auth/returnPath': returnPaths }

function expectedLoginPath(target: string) {
  if (target.startsWith('/renoapp/')) return '/renoapp/login'
  if (target === '/mina-uppdrag' || target.startsWith('/mina-uppdrag/uppdrag/')) return '/mina-uppdrag/logga-in'
  return '/login'
}

function fixture(mode: 'success' | 'revoked' | 'unavailable' = 'success') {
  const calls: string[] = []
  const fetch: typeof globalThis.fetch = async input => {
    const url = new URL(String(input))
    assert.equal(url.origin, authOrigin, 'No real network or production request is permitted')
    calls.push(url.pathname)
    if (mode === 'revoked') return new Response(JSON.stringify({ code: 'refresh_token_not_found', message: 'Synthetic revoked session' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
    })
    assert.ok(['/auth/v1/token', '/auth/v1/user'].includes(url.pathname))
    if (mode === 'unavailable' && url.pathname === '/auth/v1/user') return new Response('Synthetic upstream failure', { status: 503 })
    return new Response(JSON.stringify(url.pathname.endsWith('/token') ? session() : user), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  const sdk = { createServerClient: (url: string, key: string, options: Parameters<typeof createServerClient>[2]) =>
    createServerClient(url, key, { ...options, global: { fetch } }) }
  const proxyModule = load<{ proxy: (request: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof NextResponse>>; config: { matcher: string[] } }>(
    'src/proxy.ts', { '@supabase/ssr': sdk, ...proxyDependencies },
  )
  const request = (expired?: boolean, target = path) => new NextRequest(`${origin}${target}`, {
    headers: {
      ...(expired === undefined ? {} : { cookie: `${cookieName}=${encode(session(expired))}` }),
      'x-hushub-return-path': 'https://untrusted.example.test/spoofed',
    },
  })
  return { ...proxyModule, sdk, request, calls }
}

function assertPrivate(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
  assert.equal(response.headers.get('pragma'), 'no-cache')
  assert.equal(response.headers.get('expires'), '0')
}

test('unrefreshed expired RSC session reproduces the real cookie-write crash, even with a page-level catch', () => {
  // Isolate the known SDK background rejection in a child process: swallowing
  // only getUser in the page does not contain the original failure completely.
  const script = `
    const fs = require('fs'), ts = require('typescript');
    const { createServerClient } = require('@supabase/ssr');
    const { RequestCookiesAdapter } = require('next/dist/server/web/spec-extension/adapters/request-cookies');
    const unhandled = [];
    process.on('unhandledRejection', error => unhandled.push(error.message));
    console.error = () => {};
    const expired = ${JSON.stringify(session(true))};
    const fresh = ${JSON.stringify(session())};
    const readonly = RequestCookiesAdapter.seal({ getAll: () => [{
      name: '${cookieName}', value: 'base64-' + Buffer.from(JSON.stringify(expired)).toString('base64url'),
    }] });
    const fetch = async input => {
      const url = new URL(String(input));
      if (url.origin !== '${authOrigin}') throw new Error('Unexpected host');
      return new Response(JSON.stringify(url.pathname.endsWith('/token') ? fresh : fresh.user), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    };
    const code = ts.transpileModule(fs.readFileSync('src/lib/supabase/server.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} }, deps = {
      'next/headers': { cookies: () => Promise.resolve(readonly) },
      '@supabase/ssr': { createServerClient: (url, key, options) => createServerClient(url, key, { ...options, global: { fetch } }) },
    };
    new Function('require', 'module', 'exports', 'process', code)(name => deps[name], mod, mod.exports, {
      env: { NEXT_PUBLIC_SUPABASE_URL: '${authOrigin}', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key' },
    });
    (async () => {
      let caught = null;
      try { await mod.exports.createSupabaseServerClient().auth.getUser(); } catch (error) { caught = error.message; }
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log(JSON.stringify({ caught, unhandled }));
      process.exit(0);
    })().catch(error => { console.log(error.message); process.exit(1); });
  `
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10_000, windowsHide: true,
  })
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout.trim()) as { caught: string; unhandled: string[] }
  assert.match(result.caught, /Cookies can only be modified in a Server Action or Route Handler/)
  assert.ok(result.unhandled.length > 0, 'A page-level catch alone must not be mistaken for a complete fix')
  assert.ok(result.unhandled.every(message => message.includes('Cookies can only be modified')))
})

for (const target of protectedPaths) test(`${target} proxy refreshes expired real SDK cookies for BOTH RSC request and browser response`, async () => {
  const f = fixture()
  const request = f.request(true, target)
  const original = request.cookies.get(cookieName)?.value
  const response = await f.proxy(request)
  assert.equal(response.status, 200)
  assertPrivate(response)
  assert.notEqual(request.cookies.get(cookieName)?.value, original)
  assert.equal(response.cookies.get(cookieName)?.value, request.cookies.get(cookieName)?.value)
  assert.equal(response.cookies.get(cookieName)?.path, '/')
  assert.ok((response.cookies.get(cookieName)?.maxAge ?? 0) > 0)
  assert.equal(response.headers.get('x-middleware-request-cookie'), request.headers.get('cookie'))
  assert.ok(response.headers.get('x-middleware-override-headers')?.split(',').map(v => v.trim()).includes('cookie'))
  assert.equal(request.headers.get('x-hushub-return-path'), target)
  assert.equal(response.headers.get('x-middleware-request-x-hushub-return-path'), target)
  assert.ok(response.headers.get('x-middleware-override-headers')?.split(',').map(v => v.trim()).includes('x-hushub-return-path'))
  assert.equal(f.calls.filter(call => call === '/auth/v1/token').length, 1)

  // The unchanged app helper uses Next's real read-only RSC adapter. Before
  // this fix it throws on expired-cookie refresh. After proxy, no write is
  // attempted, and the RSC independently verifies the refreshed user.
  const readonly = RequestCookiesAdapter.seal(request.cookies)
  const server = load<{ createSupabaseServerClient: () => ReturnType<typeof createServerClient> }>(
    'src/lib/supabase/server.ts', { 'next/headers': { cookies: () => Promise.resolve(readonly) }, '@supabase/ssr': f.sdk },
  )
  const result = await server.createSupabaseServerClient().auth.getUser()
  assert.equal(result.error, null)
  assert.equal(result.data.user?.id, user.id)
  assert.equal(f.calls.filter(call => call === '/auth/v1/token').length, 1, 'RSC must never refresh the same token')
  assert.ok(f.calls.includes('/auth/v1/user'))
  // Allow SDK background promises to settle; node:test also fails on any
  // uncaught exception or unhandled rejection after the test completes.
  await new Promise(resolve => setTimeout(resolve, 30))
})

for (const target of protectedPaths) test(`${target} fresh session still validates with Auth and does not manufacture cookies`, async () => {
  const f = fixture()
  const response = await f.proxy(f.request(false, target))
  assert.equal(response.status, 200)
  assertPrivate(response)
  assert.deepEqual(f.calls, ['/auth/v1/user'])
  assert.deepEqual(response.cookies.getAll(), [])
  assert.equal(response.headers.get('x-middleware-request-x-hushub-return-path'), target)
})

for (const targetPath of protectedPaths) test(`${targetPath} anonymous and rejected sessions return through the product login; rejection clears reach browser`, async t => {
  t.mock.method(console, 'error', () => {}) // The real SDK logs the expected synthetic revocation.
  for (const expired of [undefined, true]) {
    const f = fixture(expired ? 'revoked' : 'success')
    const request = f.request(expired, `${targetPath}?next=https://untrusted.example.test&other=value`)
    const response = await f.proxy(request)
    assert.equal(response.status, 307)
    const target = new URL(response.headers.get('location')!)
    assert.equal(target.origin, origin)
    assert.equal(target.pathname, expectedLoginPath(targetPath))
    assert.equal(target.searchParams.get('next'), targetPath === path ? path : `${targetPath}?other=value`)
    assert.deepEqual([...target.searchParams.keys()], ['next'])
    assertPrivate(response)
    if (expired) {
      assert.equal(response.cookies.get(cookieName)?.value, '')
      assert.equal(response.cookies.get(cookieName)?.maxAge, 0)
      assert.equal(request.cookies.get(cookieName)?.value, '')
    } else {
      assert.deepEqual(f.calls, [])
      assert.deepEqual(response.cookies.getAll(), [])
    }
  }
  await new Promise(resolve => setTimeout(resolve, 30))
})

test('deep module path and safe organization/view query survive refresh and login while redirect/auth values are removed', async () => {
  const destination = `/tu/investigations/${entityId}?orgId=${entityId}&tab=measurements&view=report`
  const requested = `${destination}&next=https%3A%2F%2Funtrusted.example.test&access_token=synthetic-secret`
  for (const expired of [false, undefined]) {
    const f = fixture()
    const request = f.request(expired, requested)
    const response = await f.proxy(request)
    if (expired === undefined) {
      const target = new URL(response.headers.get('location')!)
      assert.equal(target.origin, origin)
      assert.equal(target.pathname, '/login')
      assert.equal(target.searchParams.get('next'), destination)
    } else {
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('x-middleware-request-x-hushub-return-path'), destination)
    }
    assert.equal(request.headers.get('x-hushub-return-path'), destination)
  }
})

test('matcher covers every protected module and does not intercept public links, logins, APIs or assets', async () => {
  const f = fixture()
  for (const target of protectedPaths) {
    assert.equal(unstable_doesMiddlewareMatch({ config: f.config, url: `${origin}${target}` }), true, target)
  }
  const publicPaths = [
    '/', '/login', '/auth/session-unavailable', '/auth/callback', '/auth/reset-password',
    '/api/organizations', '/api/tu/assignments', '/api/renoapp/cases', '/_next/static/app.js', '/favicon.ico',
    '/besiktapp', '/besiktapp/aktivera', '/renoapp', '/renoapp/login', '/renoapp/apply',
    '/renoapp/case/synthetic-token', '/renoapp/invite/synthetic-token', '/renoapp/brf/example/apply',
    '/renoapp/request-access', '/mina-uppdrag/logga-in', '/mina-uppdrag/aktivera/synthetic-token',
    '/rapport/synthetic-token', '/atgarder/synthetic-token', '/accept/synthetic-token', '/utlatande',
    '/organisation/inbjudan', '/application', '/settings-other',
  ]
  for (const target of publicPaths) {
    assert.equal(unstable_doesMiddlewareMatch({ config: f.config, url: `${origin}${target}` }), false, target)
  }
  // Broad framework matchers can encounter invalid/asset paths under a module;
  // the runtime guard must also refuse to instantiate Auth for those requests.
  for (const target of [...publicPaths, '/ob/asset.png', '/tu/styles.css',
    `/utlatande/${entityId}/not-an-inspection`, `/utlatande/not-a-property/${entityId}`,
    `/utlatande/${entityId}/${entityId}/other`, `${path}/other`, `${dashboardPath}/other`]) {
    const response = await f.proxy(f.request(true, target))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), null)
    assert.deepEqual(response.cookies.getAll(), [])
  }
  assert.deepEqual(f.calls, [])
})

for (const targetPath of protectedPaths) test(`${targetPath} missing configuration and unexpected Auth failures fail closed without a login redirect loop`, async () => {
  for (const mode of ['missing', 'throws', 'unavailable'] as const) {
    let clients = 0
    const proxyModule = load<{ proxy: (request: InstanceType<typeof NextRequest>) => Promise<Response> }>('src/proxy.ts', {
      ...proxyDependencies,
      '@supabase/ssr': { createServerClient: (_url: string, _key: string, options: {
        cookies: { setAll: (cookies: { name: string; value: string; options: { path: string; maxAge: number } }[]) => void }
      }) => {
        clients++
        return { auth: { getUser: async () => {
          // Rotation/clear may precede a later upstream failure. The 503 must
          // preserve both instead of losing an already-issued refresh token.
          options.cookies.setAll([
            { name: 'synthetic-rotated', value: 'new', options: { path: '/', maxAge: 3600 } },
            { name: 'synthetic-cleared', value: '', options: { path: '/', maxAge: 0 } },
          ])
          if (mode === 'throws') throw new Error('Synthetic private diagnostic')
          return { data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 500 } }
        } } }
      } },
    }, mode === 'missing' ? {} : { NEXT_PUBLIC_SUPABASE_URL: authOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key' })
    const response = await proxyModule.proxy(new NextRequest(`${origin}${targetPath}?next=https://untrusted.example.test&private=value`))
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('location'), null)
    const recovery = new URL(response.headers.get('x-middleware-rewrite')!)
    assert.equal(recovery.origin, origin)
    assert.equal(recovery.pathname, '/auth/session-unavailable')
    const expectedReturn = targetPath === path ? path : `${targetPath}?private=value`
    assert.equal(recovery.searchParams.get('next'), expectedReturn)
    assert.deepEqual([...recovery.searchParams.keys()], ['next'])
    assert.equal(response.headers.get('x-middleware-request-x-hushub-return-path'), expectedReturn)
    assertPrivate(response)
    assert.doesNotMatch(await response.text(), /private diagnostic/)
    assert.equal(clients, mode === 'missing' ? 0 : 1)
    if (mode !== 'missing') {
      assert.match(response.headers.get('set-cookie') ?? '', /synthetic-rotated=new/)
      assert.match(response.headers.get('set-cookie') ?? '', /synthetic-cleared=;.*Max-Age=0/)
    }
  }
})

for (const targetPath of [dashboardPath, `/renoapp/app/cases/${entityId}`, `/mina-uppdrag/uppdrag/${entityId}`]) test(`${targetPath} upstream failure after real SDK rotation preserves rotated and cleared cookies in public recovery`, async () => {
  const f = fixture('unavailable')
  // The old chunk is removed when the smaller refreshed session becomes one
  // cookie. Both browser changes must survive the recovery-page rewrite.
  const request = new NextRequest(`${origin}${targetPath}?next=https://untrusted.example.test&private=value`, {
    headers: {
      cookie: `${cookieName}.0=${encode(session(true))}`,
      'x-hushub-return-path': 'https://untrusted.example.test/spoofed',
    },
  })
  const response = await f.proxy(request)
  assert.equal(response.status, 503)
  assertPrivate(response)
  assert.equal(response.headers.get('location'), null)
  const recovery = new URL(response.headers.get('x-middleware-rewrite')!)
  assert.equal(recovery.origin, origin)
  assert.equal(recovery.pathname, '/auth/session-unavailable')
  assert.equal(recovery.searchParams.get('next'), `${targetPath}?private=value`)
  assert.equal(response.headers.get('x-middleware-request-x-hushub-return-path'), `${targetPath}?private=value`)
  assert.equal(response.headers.get('x-middleware-request-cookie'), request.headers.get('cookie'))
  assert.equal(response.cookies.get(cookieName)?.value, request.cookies.get(cookieName)?.value)
  assert.ok((response.cookies.get(cookieName)?.maxAge ?? 0) > 0)
  assert.equal(response.cookies.get(`${cookieName}.0`)?.value, '')
  assert.equal(response.cookies.get(`${cookieName}.0`)?.maxAge, 0)
  assert.equal(request.cookies.get(`${cookieName}.0`)?.value, '')
  assert.equal(f.calls.filter(call => call === '/auth/v1/token').length, 1)
  assert.ok(f.calls.includes('/auth/v1/user'))
  await new Promise(resolve => setTimeout(resolve, 30))
})
