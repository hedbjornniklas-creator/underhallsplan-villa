import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as ManagerRoute from '../src/app/api/renoapp/app/brf/rules/route'
import type * as FileRoute from '../src/app/api/renoapp/rules/[id]/file/route'
import type * as Service from '../src/lib/renoapp/renovationRulesServer'

const require = createRequire(import.meta.url)
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'node:crypto' || name === 'next/server') return require(name)
    throw new Error(`Unexpected dependency ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const common = load('src/lib/renoapp/renovationRules.ts', {})
const brfId = '11111111-1111-4111-8111-111111111111', actorId = '22222222-2222-4222-8222-222222222222'
const versionId = '33333333-3333-4333-8333-333333333333'
const filePath = `${brfId}/published/file.pdf`
const version = { id: versionId, brf_id: brfId, version: 1, format: 'pdf', body: null, file_path: filePath, file_name: 'Regler.pdf', published_at: new Date().toISOString() }

function manager(context: unknown, calls: string[]) {
  return load<typeof ManagerRoute>('src/app/api/renoapp/app/brf/rules/route.ts', {
    '@/lib/renoapp/server': { requireRenoAppViewerContext: async () => {
      if (context instanceof Error) throw context
      return context
    } },
    '@/lib/renoapp/renovationRules': common,
    '@/lib/renoapp/renovationRulesServer': {
      getPublishedRules: async () => { calls.push('read'); return version },
      prepareRulesUpload: async () => { calls.push('upload'); return { path: filePath, token: 'test' } },
      publishRules: async () => { calls.push('publish'); return version },
    },
  })
}
test('manager API requires login and a matching BRF before reading, uploading or publishing', async () => {
  for (const context of [new Error('UNAUTHORIZED'), { accessibleBrfIds: ['different-brf'], profile: { id: actorId } }]) {
    const calls: string[] = [], route = manager(context, calls)
    const expected = context instanceof Error ? 401 : 403
    assert.equal((await route.GET(new Request(`https://example.test/rules?brfId=${brfId}`))).status, expected)
    for (const action of ['prepare_upload', 'publish']) {
      assert.equal((await route.POST(new Request('https://example.test/rules', { method: 'POST', body: JSON.stringify({ brfId, action, format: 'none' }) }))).status, expected)
    }
    assert.deepEqual(calls, [])
  }
  const calls: string[] = [], route = manager({ accessibleBrfIds: [brfId], profile: { id: actorId } }, calls)
  assert.equal((await route.GET(new Request(`https://example.test/rules?brfId=${brfId}`))).status, 200)
  assert.deepEqual(calls, ['read'])
})

function fileRoute(options: { published?: boolean; publicApply?: boolean; tokenCase?: { brf_id: string; rules_version_id: string | null }; tokenState?: string; member?: boolean }) {
  const signed: string[] = []
  const route = load<typeof FileRoute>('src/app/api/renoapp/rules/[id]/file/route.ts', {
    '@/lib/renoapp/renovationRules': common,
    '@/lib/renoapp/renovationRulesServer': { getRulesRow: async () => version },
    '@/lib/renoapp/server': {
      requireRenoAppViewerContext: async () => ({ accessibleBrfIds: options.member ? [brfId] : [] }),
      getCaseAccessByToken: async () => options.tokenCase ? { state: options.tokenState ?? 'open', access: { allowedActions: ['read'] }, case: { id: 'case-id' } } : null,
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from: (table: string) => {
        const builder = { select: () => builder, eq: () => builder,
          single: async () => ({ error: null, data: table === 'brf_associations' ? {
            renovation_rules_version_id: options.published ? versionId : null, is_public_apply_enabled: options.publicApply === true,
          } : options.tokenCase }) }
        return builder
      },
      storage: { from: () => ({ createSignedUrl: async (path: string) => { signed.push(path); return { data: { signedUrl: 'https://example.test/private-pdf' }, error: null } } }) },
    }) },
  })
  return { route, signed }
}
test('only active public rules are available without an authenticated case or member', async () => {
  for (const options of [{}, { published: true }, { publicApply: true }]) {
    const { route, signed } = fileRoute(options)
    assert.equal((await route.GET(new Request('https://example.test/file'), { params: Promise.resolve({ id: versionId }) })).status, 403)
    assert.deepEqual(signed, [])
  }
  const { route } = fileRoute({ published: true, publicApply: true })
  const response = await route.GET(new Request('https://example.test/file'), { params: Promise.resolve({ id: versionId }) })
  assert.equal(response.status, 307)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})
test('historical PDFs require a matching open case token or member', async () => {
  const variants = [
    { tokenCase: { brf_id: brfId, rules_version_id: versionId } },
    { member: true },
    { published: true, tokenCase: { brf_id: brfId, rules_version_id: null } },
  ]
  for (const options of variants) {
    const { route } = fileRoute(options)
    assert.equal((await route.GET(new Request('https://example.test/file?token=secret'), { params: Promise.resolve({ id: versionId }) })).status, 307)
  }
  for (const options of [
    { tokenCase: { brf_id: 'other', rules_version_id: versionId } },
    { tokenCase: { brf_id: brfId, rules_version_id: 'other' } },
    { tokenCase: { brf_id: brfId, rules_version_id: versionId }, tokenState: 'revoked' },
    { tokenCase: { brf_id: brfId, rules_version_id: versionId }, tokenState: 'expired' },
  ]) {
    const { route, signed } = fileRoute(options)
    assert.equal((await route.GET(new Request('https://example.test/file?token=secret'), { params: Promise.resolve({ id: versionId }) })).status, 403)
    assert.deepEqual(signed, [])
  }
})

function publisher(bytes: string, options: { rpcError?: boolean; referenced?: boolean; timeout?: boolean } = {}) {
  const uploaded: string[] = [], removed: string[] = [], rpc: unknown[] = []
  const route = load<typeof Service>('src/lib/renoapp/renovationRulesServer.ts', {
    'server-only': {}, './renovationRules': common,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from: () => {
        const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: options.rpcError ? options.referenced ? version : null : version, error: null }) }
        return builder
      },
      rpc: async (_name: string, args: unknown) => { rpc.push(args); return { data: versionId, error: options.rpcError ? { message: options.timeout ? 'Network timeout' : 'RULES_VERSION_CHANGED' } : null } },
      storage: { from: () => ({
        download: async () => ({ data: new Blob([bytes]), error: null }),
        upload: async (path: string, _data: unknown, config: { upsert: boolean }) => { assert.equal(config.upsert, false); uploaded.push(path); return { error: null } },
        remove: async (paths: string[]) => { removed.push(...paths); return { error: null } },
      }) },
    }) },
  })
  return { route, uploaded, removed, rpc }
}
const pdfInput = { brfId, actorId, expectedVersion: null, format: 'pdf' as const,
  uploadPath: `${brfId}/uploads/${actorId}/44444444-4444-4444-8444-444444444444.pdf`, fileName: 'Regler.pdf' }
test('PDF publication rejects cross-BRF staging paths, empty files and non-PDF data', async () => {
  for (const bytes of ['', '<html>Not a PDF</html>', '%PDF-1.7 missing end']) {
    const service = publisher(bytes)
    await assert.rejects(service.route.publishRules(pdfInput), /RULES_PDF_INVALID/)
    assert.deepEqual(service.rpc, [])
  }
  const service = publisher('%PDF-1.7\n%%EOF')
  await assert.rejects(service.route.publishRules({ ...pdfInput, uploadPath: `other/${actorId}/file.pdf` }), /RULES_UPLOAD_INVALID/)
  assert.deepEqual(service.uploaded, [])
})
test('a PDF is copied out of signed-upload scope before publishing and only staging is removed', async () => {
  const service = publisher('%PDF-1.7\n%%EOF')
  await service.route.publishRules(pdfInput)
  assert.equal(service.uploaded.length, 1)
  assert.ok(service.uploaded[0].startsWith(`${brfId}/published/`))
  assert.deepEqual(service.removed, [pdfInput.uploadPath])
  assert.equal((service.rpc[0] as { p_content: { file_path: string } }).p_content.file_path, service.uploaded[0])
})
test('failed publication cleans unreferenced copies, but an ambiguous response never deletes a published PDF', async () => {
  for (const referenced of [false, true]) {
    const service = publisher('%PDF-1.7\n%%EOF', { rpcError: true, referenced })
    await assert.rejects(service.route.publishRules(pdfInput), /RULES_VERSION_CHANGED/)
    assert.deepEqual(service.removed, referenced ? [] : service.uploaded)
  }
  const delayed = publisher('%PDF-1.7\n%%EOF', { rpcError: true, timeout: true, referenced: false })
  await assert.rejects(delayed.route.publishRules(pdfInput), /Network timeout/)
  assert.deepEqual(delayed.removed, [])
})
