import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const loaderSource = readFileSync(new URL('../src/lib/renoapp/publicApplicationLoad.ts', import.meta.url), 'utf8')
const loaderModule = { exports: {} }
new Function('exports', ts.transpileModule(loaderSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText)(loaderModule.exports)
const { APPLICATION_LOAD_ERROR, loadPublicApplicationJson } = loaderModule.exports as typeof import('../src/lib/renoapp/publicApplicationLoad')

test('initial reads recover from a gateway failure without saving or sending mail', async () => {
  const original = globalThis.fetch
  const calls: RequestInit[] = []
  globalThis.fetch = async (_url, init) => {
    calls.push(init!)
    return calls.length < 3 ? new Response('<html>gateway error</html>', { status: 502 }) : Response.json({ state: 'open' })
  }
  try {
    assert.deepEqual(await loadPublicApplicationJson('/fixture', new AbortController().signal), { state: 'open' })
    assert.equal(calls.length, 3)
    assert.ok(calls.every(call => call.method === 'GET' && call.cache === 'no-store' && !call.body))
  } finally { globalThis.fetch = original }
})

test('persistent network and HTML failures stop after three attempts with safe Swedish text', async () => {
  const original = globalThis.fetch
  try {
    for (const failure of ['network', 'html', 'database']) {
      let calls = 0
      globalThis.fetch = async () => {
        calls++
        if (failure === 'network') throw new TypeError('fetch failed secret-token')
        if (failure === 'html') return new Response('<html>private proxy details</html>')
        return Response.json({ error: 'Kunde inte lÃ¤sa utkastslÃ¤nk. secret-token' }, { status: 503 })
      }
      await assert.rejects(loadPublicApplicationJson('/fixture', new AbortController().signal), { message: APPLICATION_LOAD_ERROR })
      assert.equal(calls, 3)
    }
  } finally { globalThis.fetch = original }
})

test('missing links and permission failures are not retried or exposed as provider messages', async () => {
  const original = globalThis.fetch
  try {
    for (const status of [401, 403, 404, 410]) {
      let calls = 0
      globalThis.fetch = async () => { calls++; return Response.json({ error: 'private details' }, { status }) }
      await assert.rejects(loadPublicApplicationJson('/fixture', new AbortController().signal),
        status === 404 ? /kunde inte hittas/ : { message: APPLICATION_LOAD_ERROR })
      assert.equal(calls, 1)
    }
  } finally { globalThis.fetch = original }
})

test('expired and revoked link states are preserved, not renewed', async () => {
  const original = globalThis.fetch
  try {
    for (const state of ['expired', 'revoked']) {
      globalThis.fetch = async () => Response.json({ state })
      assert.deepEqual(await loadPublicApplicationJson('/fixture', new AbortController().signal), { state })
    }
  } finally { globalThis.fetch = original }
})

test('abandoned loads abort without issuing retries', async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  let calls = 0
  globalThis.fetch = async () => { calls++; controller.abort(); throw new TypeError('network error') }
  try {
    await assert.rejects(loadPublicApplicationJson('/fixture', controller.signal), { name: 'AbortError' })
    assert.equal(calls, 1)
  } finally { globalThis.fetch = original }
})

function route(path: string, service: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)((name: string) => {
    if (name === '@/lib/renoapp/server') return service
    if (name === 'next/server') return require(name)
    throw new Error(`Unexpected import: ${name}`)
  }, module.exports, module)
  return module.exports as { GET: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> }
}

test('both public load APIs redact database errors and preserve not-found and successful responses', async () => {
  for (const [path, serviceName] of [
    ['src/app/api/renoapp/public/applications/draft/[token]/route.ts', 'getPublicApplicationDraftByToken'],
    ['src/app/api/renoapp/brf/[slug]/public/route.ts', 'getRenoAppPublicGuideConfig'],
  ]) {
    for (const mode of ['error', 'missing', 'success']) {
      const api = route(path, { [serviceName]: async () => {
        if (mode === 'error') throw new Error('Kunde inte lÃ¤sa utkastslÃ¤nk. private database details')
        return mode === 'missing' ? null : { state: 'open' }
      } })
      const response = await api.GET(new Request('https://example.test/fixture?draft=test-token'), { params: Promise.resolve({ token: 'test-token', slug: 'test' }) })
      assert.equal(response.status, mode === 'error' ? 503 : mode === 'missing' ? 404 : 200)
      if (mode === 'error') assert.deepEqual(await response.json(), { error: APPLICATION_LOAD_ERROR })
      if (mode === 'success') assert.deepEqual(await response.json(), { state: 'open' })
    }
  }
})
