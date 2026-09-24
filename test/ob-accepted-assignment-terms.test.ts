import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { AcceptedObTerms } from '../src/lib/assignments/acceptedObTerms'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

const documents = Object.fromEntries(['buyer', 'seller', 'apartment'].map(role => {
  const templateId = `STD_ASSIGNMENT_TEMPLATE_${role.toUpperCase()}_2026`
  const text = readFileSync(new URL(`../src/content/standardtexts/${templateId}.txt`, import.meta.url), 'utf8')
  return [role, { role, templateId, text, version: '2026-02-21.v1', documentHash: createHash('sha256').update(text).digest('hex') }]
}))
const assignment = {
  id: 'ob-1', assignment_type: 'OB', status: 'booked', orderer_role: 'buyer',
  accepted_at: '2026-09-24T09:00:00Z', terms_version: documents.buyer.version,
  terms_document_hash: documents.buyer.documentHash,
}
type TermsAssignment = Omit<typeof assignment, 'accepted_at' | 'terms_version' | 'terms_document_hash'> & {
  accepted_at: string | null; terms_version: string | null; terms_document_hash: string | null
}
const resolver = load<{ getAcceptedObTerms: (value: TermsAssignment) => AcceptedObTerms }>(
  'src/lib/assignments/acceptedObTerms.ts', {
    'server-only': {}, './terms': { getAssignmentTermsDocument: (role: string) => {
      assert.ok(role in documents, 'only OB templates may be used')
      return documents[role]
    } },
  })

for (const role of ['buyer', 'seller', 'apartment']) {
  test(`approved ${role} terms are returned in full, unchanged, regardless of current role/status`, () => {
    for (const status of ['ordered', 'booked', 'completed', 'cancelled']) {
      const result = resolver.getAcceptedObTerms({ ...assignment, status, orderer_role: 'later edited',
        terms_document_hash: documents[role].documentHash })
      assert.equal(result.available, true)
      if (result.available) {
        assert.equal(result.document.text, documents[role].text)
        assert.equal(result.document.role, role)
        assert.equal(result.acceptedAt, assignment.accepted_at)
      }
    }
  })
}

test('hash matching ignores case and surrounding whitespace', () => {
  assert.equal(resolver.getAcceptedObTerms({ ...assignment,
    terms_document_hash: ` ${assignment.terms_document_hash.toUpperCase()} ` }).available, true)
})

for (const [name, patch, reason] of [
  ['not accepted', { accepted_at: null }, 'not_accepted'],
  ['missing hash', { terms_document_hash: null }, 'missing_reference'],
  ['missing version', { terms_version: null }, 'missing_reference'],
  ['empty hash', { terms_document_hash: ' ' }, 'missing_reference'],
  ['different version', { terms_version: 'older-version' }, 'unavailable_version'],
  ['different hash', { terms_document_hash: '0'.repeat(64) }, 'unavailable_version'],
] as const) {
  test(`${name} never falls back to current terms`, () => {
    const result = resolver.getAcceptedObTerms({ ...assignment, ...patch })
    assert.equal(result.available, false)
    if (!result.available) assert.equal(result.reason, reason)
    assert.equal('document' in result, false)
    assert.equal('text' in result, false)
  })
}

function routeHarness(options: { assignment?: TermsAssignment | null; authError?: string; readError?: boolean; snapshot?: boolean } = {}) {
  const calls: string[] = []
  const api = load<{ GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> }>(
    'src/app/api/ob/assignments/[id]/terms/route.ts', {
      'next/server': { NextResponse: Response },
      '@/lib/assignments/acceptedObTerms': resolver,
      '@/lib/assignments/obConfirmationSnapshot': { getObConfirmationSnapshot: async () => options.snapshot
        ? { assignment, terms: documents.buyer } : null },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => {
        if (!options.snapshot) throw new Error('No mail reads for legacy terms')
        const chain = { select: () => chain, eq: () => chain, order: () => chain,
          limit: async () => ({ data: [{ status: 'failed' }], error: null }) }
        return { from: () => chain }
      } },
      '@/lib/assignments/server': {
        requireOrgContext: async () => {
          calls.push('auth')
          if (options.authError) throw new Error(options.authError)
          return { orgId: 'org-1' }
        },
        getAssignmentById: async (orgId: string, id: string) => {
          calls.push(`read:${orgId}:${id}`)
          if (options.readError) throw new Error('secret database detail')
          return 'assignment' in options ? options.assignment : assignment
        },
      },
    })
  return { calls, get: () => api.GET(new Request('https://example.test/api/ob/assignments/ob-1/terms'), {
    params: Promise.resolve({ id: 'ob-1' }),
  }) }
}

test('terms endpoint authenticates and scopes reads by organization, with private no-store responses', async () => {
  const { calls, get } = routeHarness()
  const response = await get()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), resolver.getAcceptedObTerms(assignment))
  assert.deepEqual(calls, ['auth', 'read:org-1:ob-1'])
})

for (const [error, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403]] as const) {
  test(`${error} cannot read terms or assignment data`, async () => {
    const { calls, get } = routeHarness({ authError: error })
    const response = await get()
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(calls, ['auth'])
  })
}

for (const type of [null, 'TU', 'EB', 'STATUS', 'UHP']) {
  test(`missing or non-OB (${type}) assignments return 404 without terms`, async () => {
    const response = await routeHarness({ assignment: type ? { ...assignment, assignment_type: type } : null }).get()
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal('document' in await response.json(), false)
  })
}

test('unavailable historical text is explicit and does not leak current text', async () => {
  const response = await routeHarness({ assignment: { ...assignment, terms_version: 'older-version' } }).get()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { available: false, reason: 'unavailable_version', version: 'older-version' })
})

test('database failures are retryable without leaking internal details', async () => {
  const response = await routeHarness({ readError: true }).get()
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal((await response.text()).includes('secret'), false)
})

test('frozen terms are displayed even when current assignment references have changed, with delivery failure status', async () => {
  const response = await routeHarness({ snapshot: true, assignment: { ...assignment,
    terms_version: 'later-version', terms_document_hash: '0'.repeat(64) } }).get()
  const data = await response.json()
  assert.deepEqual(data.document, documents.buyer)
  assert.equal(data.acceptedAt, assignment.accepted_at)
  assert.equal(data.confirmationDelivery, 'failed')
})
