import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServerClient } from '@supabase/ssr'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { NextRequest, NextResponse } = require('next/server') as typeof import('next/server')
const { RequestCookiesAdapter } = require('next/dist/server/web/spec-extension/adapters/request-cookies')
const path = '/settings/organisation/skapa'
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

function fixture(mode: 'success' | 'revoked' = 'success') {
  const calls: string[] = []
  const fetch: typeof globalThis.fetch = async input => {
    const url = new URL(String(input))
    assert.equal(url.origin, authOrigin, 'No real network or production request is permitted')
    calls.push(url.pathname)
    if (mode === 'revoked') return new Response(JSON.stringify({ code: 'refresh_token_not_found', message: 'Synthetic revoked session' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
    })
    assert.ok(['/auth/v1/token', '/auth/v1/user'].includes(url.pathname))
    return new Response(JSON.stringify(url.pathname.endsWith('/token') ? session() : user), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  const sdk = { createServerClient: (url: string, key: string, options: Parameters<typeof createServerClient>[2]) =>
    createServerClient(url, key, { ...options, global: { fetch } }) }
  const proxyModule = load<{ proxy: (request: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof NextResponse>>; config: { matcher: string[] } }>(
    'src/proxy.ts', { '@supabase/ssr': sdk, 'next/server': { NextResponse } },
  )
  const request = (expired?: boolean, target = path) => new NextRequest(`${origin}${target}`, {
    headers: expired === undefined ? {} : { cookie: `${cookieName}=${encode(session(expired))}` },
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

test('creation proxy refreshes expired real SDK cookies for BOTH RSC request and browser response', async () => {
  const f = fixture()
  const request = f.request(true)
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

test('fresh session still validates with Auth and does not manufacture cookies', async () => {
  const f = fixture()
  const response = await f.proxy(f.request(false))
  assert.equal(response.status, 200)
  assertPrivate(response)
  assert.deepEqual(f.calls, ['/auth/v1/user'])
  assert.deepEqual(response.cookies.getAll(), [])
})

test('anonymous and rejected sessions redirect only to exact login return; rejection clears reach browser', async () => {
  for (const expired of [undefined, true]) {
    const f = fixture(expired ? 'revoked' : 'success')
    const request = f.request(expired)
    const response = await f.proxy(request)
    assert.equal(response.status, 307)
    const target = new URL(response.headers.get('location')!)
    assert.equal(target.origin, origin)
    assert.equal(target.pathname, '/login')
    assert.equal(target.searchParams.get('next'), path)
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

test('only the exact creation route is matched; unrelated routes never instantiate Auth or alter headers', async () => {
  const f = fixture()
  assert.deepEqual(f.config.matcher, [path])
  for (const target of ['/settings/organisation', '/login', '/api/organizations', '/renoapp/app', `${path}/other`]) {
    const response = await f.proxy(f.request(true, target))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), null)
    assert.deepEqual(response.cookies.getAll(), [])
  }
  assert.deepEqual(f.calls, [])
})

test('missing configuration and unexpected Auth failures fail closed without a login redirect loop', async () => {
  for (const mode of ['missing', 'throws', 'unavailable'] as const) {
    let clients = 0
    const proxyModule = load<{ proxy: (request: InstanceType<typeof NextRequest>) => Promise<Response> }>('src/proxy.ts', {
      'next/server': { NextResponse },
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
    const response = await proxyModule.proxy(new NextRequest(`${origin}${path}`))
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('location'), null)
    assertPrivate(response)
    assert.doesNotMatch(await response.text(), /private diagnostic/)
    assert.equal(clients, mode === 'missing' ? 0 : 1)
    if (mode !== 'missing') {
      assert.match(response.headers.get('set-cookie') ?? '', /synthetic-rotated=new/)
      assert.match(response.headers.get('set-cookie') ?? '', /synthetic-cleared=;.*Max-Age=0/)
    }
  }
})
