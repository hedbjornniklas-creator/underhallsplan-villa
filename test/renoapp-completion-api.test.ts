import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import type * as UploadRoute from '../src/app/api/renoapp/case-access/[token]/documents/route'
import type * as PublicRoute from '../src/app/api/renoapp/public/applications/route'
import type * as DocumentRoute from '../src/app/api/renoapp/app/cases/[id]/documents/[documentId]/route'
import type { UpdateRenoAppCaseStatusInput } from '../src/lib/renoapp/server'
import type { CompletionRequest } from '../src/lib/renoapp/completion'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', compile(read(path)))((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('node:') || name === 'next/server') return require(name)
    throw new Error(`Unexpected dependency ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
// Exercise the real orchestration functions without network, credentials or email delivery.
function serviceFunction<T>(names: string[], dependencies: Record<string, unknown>): T {
  const ast = ts.createSourceFile('server.ts', read('src/lib/renoapp/server.ts'), ts.ScriptTarget.Latest, true)
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  assert.equal(functions.length, names.length)
  const code = functions.map(node => node.getText(ast)).join('\n')
  return new Function(...Object.keys(dependencies), `${compile(code)};return ${names[0]}`)(...Object.values(dependencies)) as T
}
const common = load<typeof import('../src/lib/renoapp/completion')>('src/lib/renoapp/completion.ts', {})
const templates = load<Record<string, unknown>>('src/lib/renoapp/emailTemplate.ts', {})

test('failed completion email stays visible; retry sends the same snapshot and does not duplicate history', async () => {
  const requestId = randomUUID(), sent: Array<{ html: string; text: string; idempotencyKey: string }> = []
  let request: CompletionRequest | null = null, publications = 0, failMail = true
  const underlag = [
    { id: 'document:drawing', category: 'document', label: 'Received drawing', checked: true, requirementDecision: 'requested' },
    { id: 'participant:plumber', category: 'participant', label: 'Plumber', checked: false, requirementDecision: 'requested' },
  ]
  const admin = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      publications++
      request = { id: requestId, case_id: 'case', items: args.p_items, message: args.p_message,
        created_at: new Date().toISOString(), submitted_at: null, revision: 0, draft: {}, delivery_status: 'pending', delivery_error: null,
      } as CompletionRequest
      return { error: null }
    },
    from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { email: 'board@example.test' } }),
        update: (values: object) => { assert.equal(table, 'renoapp_completion_requests'); Object.assign(request!, values); return query },
      }
      return query
    },
  }
  const publish = serviceFunction<(id: string, input: UpdateRenoAppCaseStatusInput, actor: string, status: string) => Promise<{ completion: CompletionRequest }>>(['publishRenoAppCompletion'], {
    getRenoAppCaseDetail: async () => ({ id: 'case', caseNumber: 'RA-TEST', underlag,
      applicant: { name: 'Test <Person>', email: 'applicant@example.test' }, brf: { id: 'brf', name: 'Test BRF', slug: 'test' }, completion: request }),
    getLatestCompletion: async () => request, createSupabaseAdminClient: () => admin,
    ...common, ...templates, canonicalStringSet: (values: string[]) => [...new Set(values)].sort().join(','),
    getMailFromAddress: () => 'Hushub <noreply@example.test>', ensureReusableCaseAccessToken: async () => 'same-token',
    buildAbsoluteUrl: (origin: string, path: string) => new URL(path, origin).toString(),
    escapeHtml: (value: string) => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    sendAssignmentEmail: async (input: typeof sent[number]) => { sent.push(input); if (failMail) throw new Error('Simulated provider failure'); return { providerMessageId: 'test-provider-id' } },
    console: { error: () => {} },
  })
  const input: UpdateRenoAppCaseStatusInput = { status: 'need_info', completionRequestId: requestId,
    previousCompletionId: null, selectedRequirementIds: underlag.map(row => row.id), requestOrigin: 'https://example.test' }
  const failed = await publish('case', input, 'actor', 'review')
  assert.equal(failed.completion.delivery_status, 'failed')
  assert.ok(failed.completion.delivery_error)
  assert.deepEqual(failed.completion.items.map(item => item.id), ['participant:plumber'])
  assert.equal(publications, 1)
  failMail = false
  const retried = await publish('case', { ...input, retryCompletion: true }, 'actor', 'need_info')
  assert.equal(retried.completion.delivery_status, 'sent')
  assert.equal(retried.completion.provider_message_id, 'test-provider-id')
  assert.equal(publications, 1)
  assert.equal(sent.length, 2)
  assert.deepEqual(sent[0], sent[1])
  assert.match(sent[0].html, /same-token/)
  assert.doesNotMatch(sent[0].text, /Received drawing/)
  await publish('case', { ...input, retryCompletion: true }, 'actor', 'need_info')
  assert.equal(sent.length, 2)
  await assert.rejects(publish('case', { ...input, retryCompletion: true, completionRequestId: randomUUID() }, 'actor', 'need_info'), /COMPLETION_CHANGED/)
})

test('reusing an applicant link renews expiration and never revives a revoked token', async () => {
  let existing: object | null = { id: 'link', token: 'same-token', email: 'applicant@example.test' }
  const writes: Array<{ expires_at: string }> = [], filters: unknown[] = []
  const admin = { from: () => ({ update: (values: { expires_at: string }) => {
    writes.push(values)
    return { eq: () => ({ is: (...args: unknown[]) => { filters.push(args); return { select: () => ({ maybeSingle: async () => ({ data: { id: 'link' }, error: null }) }) } } }) }
  } }) }
  const renew = serviceFunction<(input: object) => Promise<string>>(['ensureReusableCaseAccessToken'], {
    findReusableCaseAccessToken: async () => existing,
    createCaseAccessToken: async () => ({ token: 'new-token' }),
  })
  assert.equal(await renew({ admin, caseId: 'case' }), 'same-token')
  assert.ok(Date.parse(writes[0].expires_at) > Date.now() + 13 * 86400000)
  assert.deepEqual(filters, [['revoked_at', null]])
  existing = null
  assert.equal(await renew({ admin, caseId: 'case' }), 'new-token')
})

test('applicant API passes the round and revision and returns reloadable conflicts', async () => {
  let input: Record<string, unknown> = {}
  let conflict = false
  const route = load<typeof PublicRoute>('src/app/api/renoapp/public/applications/route.ts', {
    '@/lib/renoapp/server': { upsertPublicApplication: async (value: typeof input) => { input = value; if (conflict) throw new Error('COMPLETION_DRAFT_CHANGED'); return { completionRevision: 4 } } },
    '@/lib/renoapp/completion': common, '@/lib/renoapp/renovationRules': { RULES_ERRORS: {} },
  })
  const request = () => new Request('https://example.test/apply', { method: 'POST', body: JSON.stringify({ mode: 'draft', completionRequestId: 'round', completionRevision: 3, replyMessage: 'Saved reply' }) })
  assert.equal((await route.POST(request())).status, 201)
  assert.equal(input.completionRequestId, 'round')
  assert.equal(input.completionRevision, 3)
  assert.equal(input.replyMessage, 'Saved reply')
  conflict = true
  const response = await route.POST(request())
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'COMPLETION_DRAFT_CHANGED')
})

test('a concurrent round change must not remove storage before the guarded delete succeeds', async () => {
  const calls: string[] = []
  const route = load<typeof UploadRoute>('src/app/api/renoapp/case-access/[token]/documents/route.ts', {
    '@/lib/renoapp/server': { getCaseAccessByToken: async () => ({ state: 'open', case: { id: 'case', status: 'need_info' }, access: { allowedActions: ['upload_documents'] } }) },
    '@/lib/renoapp/completionServer': { getLatestCompletion: async () => ({ id: 'round', submitted_at: null }) },
    '@/lib/renoapp/completion': common,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from: () => { let deleting = false; const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { id: 'doc', completion_request_id: 'round', storage_bucket: 'bucket', file_path: 'file' }, error: null }),
        delete: () => { deleting = true; calls.push('delete-row'); return query },
        then: (resolve: (value: unknown) => unknown) => resolve({ error: deleting ? { message: 'COMPLETION_CHANGED' } : null }),
      }; return query },
      storage: { from: () => ({ remove: async () => { calls.push('remove-file'); return { error: null } } }) },
    }) },
  })
  const response = await route.DELETE(new Request('https://example.test/documents?documentId=doc&completionRequestId=round'), { params: Promise.resolve({ token: 'secret' }) })
  assert.equal(response.status, 409)
  assert.deepEqual(calls, ['delete-row'])
})

test('open document is inline; normal download is unchanged and BRF authorization still applies', async () => {
  const signed: unknown[] = []
  let authorized = true
  const route = load<typeof DocumentRoute>('src/app/api/renoapp/app/cases/[id]/documents/[documentId]/route.ts', {
    '@/lib/renoapp/server': { requireRenoAppViewerContext: async () => ({ authorizedBrfIds: authorized ? ['brf'] : ['other'] }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'renovation_cases' ? { brf_id: 'brf' } : { storage_bucket: 'bucket', file_path: 'file', file_name: 'Drawing.pdf' }, error: null }) }; return query
    }, storage: { from: () => ({ createSignedUrl: async (_path: string, _ttl: number, options: unknown) => { signed.push(options); return { data: { signedUrl: 'https://example.test/signed' }, error: null } } }) } }) },
  })
  const context = { params: Promise.resolve({ id: 'case', documentId: 'document' }) }
  assert.equal((await route.GET(new Request('https://example.test/document?view=1'), context)).status, 307)
  assert.equal((await route.GET(new Request('https://example.test/document'), context)).status, 307)
  assert.deepEqual(signed, [undefined, { download: 'Drawing.pdf' }])
  authorized = false
  assert.equal((await route.GET(new Request('https://example.test/document?view=1'), context)).status, 404)
  assert.equal(signed.length, 2)
})
