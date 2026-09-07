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

function manager(context: unknown, calls: string[], published = true) {
  return load<typeof ManagerRoute>('src/app/api/renoapp/app/brf/rules/route.ts', {
    '@/lib/renoapp/server': { requireRenoAppViewerContext: async () => {
      if (context instanceof Error) throw context
      return context
    } },
    '@/lib/renoapp/renovationRules': common,
    '@/lib/renoapp/renovationRulesServer': {
      getPublishedRules: async () => { calls.push('read'); return published ? version : null },
      getLatestSavedRules: async () => { calls.push('read-saved'); return version },
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

test('inactive rules remain available to the authorized board for reactivation', async () => {
  const calls: string[] = []
  const route = manager({ accessibleBrfIds: [brfId], profile: { id: actorId } }, calls, false)
  const response = await route.GET(new Request(`https://example.test/rules?brfId=${brfId}`))
  assert.deepEqual(await response.json(), { rules: null, savedRules: version })
  assert.deepEqual(calls, ['read', 'read-saved'])
})

function fileRoute(options: { published?: boolean; publicApply?: boolean; tokenCase?: { brf_id: string; rules_version_id: string | null }; tokenState?: string; member?: boolean; downloadError?: boolean; fileName?: string }) {
  const signed: string[] = [], downloaded: string[] = [], signingOptions: unknown[] = []
  const route = load<typeof FileRoute>('src/app/api/renoapp/rules/[id]/file/route.ts', {
    '@/lib/renoapp/renovationRules': common,
    '@/lib/renoapp/renovationRulesServer': { getRulesRow: async () => ({ ...version, file_name: options.fileName ?? version.file_name }) },
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
      storage: { from: () => ({
        download: async (path: string) => { downloaded.push(path); return options.downloadError ? { data: null, error: new Error('Not found') } : { data: new Blob(['%PDF-1.7\n%%EOF']), error: null } },
        createSignedUrl: async (path: string, _ttl: number, config: unknown) => { signed.push(path); signingOptions.push(config); return { data: { signedUrl: 'https://example.test/private-pdf' }, error: null } },
      }) },
    }) },
  })
  return { route, signed, downloaded, signingOptions }
}
test('only active public rules are available without an authenticated case or member', async () => {
  for (const options of [{}, { published: true }, { publicApply: true }]) {
    const { route, signed, downloaded } = fileRoute(options)
    assert.equal((await route.GET(new Request('https://example.test/file'), { params: Promise.resolve({ id: versionId }) })).status, 403)
    assert.deepEqual(signed, [])
    assert.deepEqual(downloaded, [])
  }
  const { route } = fileRoute({ published: true, publicApply: true })
  const response = await route.GET(new Request('https://example.test/file'), { params: Promise.resolve({ id: versionId }) })
  assert.equal(response.status, 200)
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
    assert.equal((await route.GET(new Request('https://example.test/file?token=secret'), { params: Promise.resolve({ id: versionId }) })).status, 200)
  }
  for (const options of [
    { tokenCase: { brf_id: 'other', rules_version_id: versionId } },
    { tokenCase: { brf_id: brfId, rules_version_id: 'other' } },
    { tokenCase: { brf_id: brfId, rules_version_id: versionId }, tokenState: 'revoked' },
    { tokenCase: { brf_id: brfId, rules_version_id: versionId }, tokenState: 'expired' },
  ]) {
    const { route, signed, downloaded } = fileRoute(options)
    assert.equal((await route.GET(new Request('https://example.test/file?token=secret'), { params: Promise.resolve({ id: versionId }) })).status, 403)
    assert.deepEqual(signed, [])
    assert.deepEqual(downloaded, [])
  }
})

test('open PDF streams inline with safe Unicode filename headers; old download links still work', async () => {
  const fileName = 'Föreningens "regler" (1).pdf'
  const { route, signed, downloaded, signingOptions } = fileRoute({ member: true, fileName })
  const context = { params: Promise.resolve({ id: versionId }) }
  const response = await route.GET(new Request('https://example.test/file'), context)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition')!, /^inline;/)
  assert.match(response.headers.get('content-disposition')!, /filename\*=UTF-8''F%C3%B6reningens%20%22regler%22%20%281%29.pdf/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('location'), null)
  assert.equal(await response.text(), '%PDF-1.7\n%%EOF')
  assert.deepEqual(downloaded, [filePath])
  assert.deepEqual(signed, [])
  const attachment = await route.GET(new Request('https://example.test/file?download=1'), context)
  assert.equal(attachment.status, 307)
  assert.deepEqual(signingOptions, [{ download: fileName }])
})

test('a missing stored PDF does not produce a successful inline response', async () => {
  const { route } = fileRoute({ member: true, downloadError: true })
  const response = await route.GET(new Request('https://example.test/file'), { params: Promise.resolve({ id: versionId }) })
  assert.equal(response.status, 404)
})

function publisher(bytes: string, options: { rpcError?: boolean; referenced?: boolean; timeout?: boolean; savedVersion?: typeof version } = {}) {
  const uploaded: string[] = [], removed: string[] = [], copied: Array<{ from: string; to: string }> = [], rpc: unknown[] = []
  const route = load<typeof Service>('src/lib/renoapp/renovationRulesServer.ts', {
    'server-only': {}, './renovationRules': common,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from: () => {
        let field = ''
        const builder = { select: () => builder, eq: (key: string) => { field = key; return builder }, maybeSingle: async () => ({ data: field === 'file_path' ? options.referenced ? version : null : options.savedVersion ?? version, error: null }) }
        return builder
      },
      rpc: async (_name: string, args: unknown) => { rpc.push(args); return { data: versionId, error: options.rpcError ? { message: options.timeout ? 'Network timeout' : 'RULES_VERSION_CHANGED' } : null } },
      storage: { from: () => ({
        download: async () => ({ data: new Blob([bytes]), error: null }),
        copy: async (from: string, to: string) => { copied.push({ from, to }); return { error: null } },
        upload: async (path: string, _data: unknown, config: { upsert: boolean }) => { assert.equal(config.upsert, false); uploaded.push(path); return { error: null } },
        remove: async (paths: string[]) => { removed.push(...paths); return { error: null } },
      }) },
    }) },
  })
  return { route, uploaded, removed, copied, rpc }
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

test('reactivation copies the saved PDF to a new version without touching the accepted original', async () => {
  const input = { ...pdfInput, uploadPath: undefined, reuseVersionId: versionId }
  const service = publisher('')
  await service.route.publishRules(input)
  assert.deepEqual(service.uploaded, [])
  assert.deepEqual(service.removed, [])
  assert.equal(service.copied[0].from, filePath)
  assert.ok(service.copied[0].to.startsWith(`${brfId}/published/`))
  assert.notEqual(service.copied[0].to, filePath)
  assert.deepEqual((service.rpc[0] as { p_content: unknown }).p_content, { format: 'pdf', file_path: service.copied[0].to, file_name: 'Regler.pdf' })
  for (const timeout of [false, true]) {
    const failed = publisher('', { rpcError: true, timeout, savedVersion: version })
    await assert.rejects(failed.route.publishRules(input), /RULES_VERSION_CHANGED|Network timeout/)
    assert.deepEqual(failed.removed, timeout ? [] : [failed.copied[0].to])
    assert.ok(!failed.removed.includes(filePath))
  }
  const other = publisher('')
  await assert.rejects(other.route.publishRules({ ...input, brfId: 'other-brf' }), /RULES_FORBIDDEN/)
  assert.deepEqual(other.rpc, [])
  const textVersion = publisher('', { savedVersion: { ...version, format: 'text' } })
  await assert.rejects(textVersion.route.publishRules(input), /RULES_UPLOAD_INVALID/)
  assert.deepEqual(textVersion.rpc, [])
})

test('saved rules lookup stays within the selected BRF and returns the latest version', async () => {
  const calls: unknown[] = []
  const service = load<typeof Service>('src/lib/renoapp/renovationRulesServer.ts', {
    'server-only': {}, './renovationRules': common,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: (table: string) => {
      calls.push(table)
      const query = { select: () => query,
        eq: (field: string, value: string) => { calls.push([field, value]); return query },
        order: (field: string, options: object) => { calls.push([field, options]); return query },
        limit: (value: number) => { calls.push(value); return query },
        maybeSingle: async () => ({ data: version, error: null }),
      }
      return query
    } }) },
  })
  assert.equal((await service.getLatestSavedRules(brfId))?.id, versionId)
  assert.deepEqual(calls, ['renoapp_brf_rules_versions', ['brf_id', brfId], ['version', { ascending: false }], 1])
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
