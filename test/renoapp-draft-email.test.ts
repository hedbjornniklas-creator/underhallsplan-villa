import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as Service from '../src/lib/renoapp/server'
import type * as ApplicationsRoute from '../src/app/api/renoapp/public/applications/route'

const nodeRequire = createRequire(import.meta.url)
const compiledSources = new Map<string, string>()

// Execute the real service/route, replacing only its imports. An unexpected
// dependency or any accidental network call fails rather than reaching live data.
function loadSource<T>(file: string, dependencies: Record<string, unknown>): T {
  let output = compiledSources.get(file)
  if (!output) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    compiledSources.set(file, output)
  }
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name === 'node:crypto' || name === 'next/server') return nodeRequire(name)
    throw new Error(`Unexpected test dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

const rules = loadSource('src/lib/renoapp/renovationRules.ts', {})
const completion = loadSource('src/lib/renoapp/completion.ts', {})
const originalFetch = globalThis.fetch
const originalMailFrom = process.env.ASSIGNMENTS_MAIL_FROM

before(() => {
  process.env.ASSIGNMENTS_MAIL_FROM = 'RenoApp <noreply@example.test>'
  globalThis.fetch = async () => { throw new Error('Network calls are forbidden in draft email tests') }
})

after(() => {
  globalThis.fetch = originalFetch
  if (originalMailFrom === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM
  else process.env.ASSIGNMENTS_MAIL_FROM = originalMailFrom
})

const brf = { id: 'brf-test', slug: 'test-brf', name: 'Test BRF', email: null, is_public_apply_enabled: true }
const existingToken = 'existing-draft-token'
const existingCase = {
  id: 'existing-case', brf_id: brf.id, case_number: 'RA-2026-0907-01', status: 'draft',
  applicant_contact_id: null, unit_id: null, submitted_at: '2026-09-07T08:00:00.000Z',
}
type Mutation = {
  table: string
  operation: 'insert' | 'update' | 'delete'
  payload: Record<string, unknown> | null
  filters: Record<string, unknown>
}
type Email = { to: string; text: string; html: string }

function draftInput(email: unknown, resumed = false): Service.CreatePublicApplicationInput {
  return {
    brfSlug: brf.slug, draftToken: resumed ? existingToken : null, mode: 'draft',
    applicantName: '', applicantEmail: email as string, applicantPhone: null,
    unitNumberInternal: null, unitNumberSkatteverket: null, description: '',
    actionTypeKeys: [], questionAnswers: {}, participantEntries: [],
  }
}

function fixture(resumed = false) {
  const mutations: Mutation[] = []
  const emails: Email[] = []
  const unexpected = () => { throw new Error('Unexpected non-draft service dependency') }
  const writeTables = new Set([
    'renovation_cases', 'renovation_case_action_types',
    'renoapp_case_question_answers', 'renoapp_case_participants', 'case_access_links',
  ])

  function query(table: string) {
    const filters: Record<string, unknown> = {}
    let selection = ''
    let mutation: Mutation | undefined
    function mutate(operation: Mutation['operation'], payload: Record<string, unknown> | null) {
      mutation = { table, operation, payload, filters }
      mutations.push(mutation)
      assert.ok(writeTables.has(table), `Unexpected write to ${table}`)
      return builder
    }
    function result() {
      if (mutation) {
        return { data: table === 'renovation_cases' && mutation.operation === 'insert' ? { id: 'new-case' } : null, error: null }
      }
      if (table === 'brf_associations') return { data: brf, error: null }
      if (table === 'case_access_links') {
        assert.ok(resumed, 'Only resumed drafts should read a token')
        return { data: { case_id: existingCase.id, revoked_at: null, expires_at: '2099-01-01T00:00:00.000Z' }, error: null }
      }
      if (table === 'renovation_cases' && selection === 'case_number') return { data: [], error: null }
      if (table === 'renovation_cases' && resumed) {
        assert.equal(filters.id, existingCase.id)
        assert.equal(filters.brf_id, brf.id)
        return { data: existingCase, error: null }
      }
      throw new Error(`Unexpected read from ${table}: ${selection}`)
    }
    const builder = {
      select: (columns: string) => { selection = columns; return builder },
      eq: (column: string, value: unknown) => { filters[column] = value; return builder },
      like: (column: string, value: unknown) => { filters[column] = value; return builder },
      order: () => builder,
      limit: () => builder,
      insert: (payload: Record<string, unknown>) => mutate('insert', payload),
      update: (payload: Record<string, unknown>) => mutate('update', payload),
      delete: () => mutate('delete', null),
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return builder
  }

  const service = loadSource<typeof Service>('src/lib/renoapp/server.ts', {
    'next/headers': { cookies: unexpected },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: query, rpc: unexpected }) },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (input: Email) => {
      emails.push(input)
      return { provider: 'mock', providerMessageId: 'mock-message' }
    } },
    '@/lib/renoapp/emailTemplate': {
      buildRenoAppEmailHtml: ({ bodyHtml }: { bodyHtml: string }) => bodyHtml,
      buildRenoAppEmailButton: unexpected,
    },
    '@/lib/renoapp/completion': completion,
    '@/lib/renoapp/completionServer': { getLatestCompletion: unexpected, saveCompletion: unexpected },
    '@/lib/access/server': { getCurrentUserPlatformAccessContext: unexpected },
    '@/lib/renoapp/brfAdminAccess': { requireBrfAdminContext: unexpected },
    '@/lib/renoapp/consultantReviewAccess': { requireConsultantReviewAccess: unexpected },
    '@/lib/renoapp/onboarding': { issueBrfInviteForAuthorizedUser: unexpected },
    '@/lib/renoapp/renovationRulesServer': { getPublishedRules: unexpected, getCaseRulesAcceptance: unexpected },
    '@/lib/renoapp/renovationRules': rules,
  })
  return { service, mutations, emails }
}

const rejectedEmails = [
  { label: 'empty', value: '', code: 'APPLICANT_EMAIL_REQUIRED' },
  { label: 'whitespace', value: ' \t\r\n ', code: 'APPLICANT_EMAIL_REQUIRED' },
  { label: 'null', value: null, code: 'APPLICANT_EMAIL_REQUIRED' },
  { label: 'undefined', value: undefined, code: 'APPLICANT_EMAIL_REQUIRED' },
  { label: 'missing at-sign', value: 'applicant.example.test', code: 'APPLICANT_EMAIL_INVALID' },
  { label: 'incomplete domain', value: 'applicant@example', code: 'APPLICANT_EMAIL_INVALID' },
  { label: 'embedded whitespace', value: 'app licant@example.test', code: 'APPLICANT_EMAIL_INVALID' },
] as const

for (const resumed of [false, true]) {
  for (const sample of rejectedEmails) {
    test(`${resumed ? 'resumed' : 'new'} draft rejects ${sample.label} email before any write or email`, async () => {
      const { service, mutations, emails } = fixture(resumed)
      await assert.rejects(service.upsertPublicApplication(draftInput(sample.value, resumed), 'https://example.test'), {
        message: sample.code,
      })
      assert.deepEqual(mutations, [])
      assert.deepEqual(emails, [])
    })
  }
}

test('valid normalized email alone can create a draft and a continuation link', async () => {
  const { service, mutations, emails } = fixture()
  const result = await service.upsertPublicApplication(draftInput('  Applicant@Example.TEST  '), 'https://example.test')
  assert.equal(result.status, 'draft')
  assert.equal(result.caseId, 'new-case')
  assert.equal(result.emailSent, true)
  assert.equal(result.emailError, null)
  const caseWrites = mutations.filter(item => item.table === 'renovation_cases')
  assert.equal(caseWrites.length, 1)
  assert.equal(caseWrites[0].operation, 'insert')
  assert.equal(caseWrites[0].payload?.applicant_contact_id, null)
  assert.equal(caseWrites[0].payload?.unit_id, null)
  const links = mutations.filter(item => item.table === 'case_access_links')
  assert.equal(links.length, 1)
  assert.equal(links[0].operation, 'insert')
  assert.equal(links[0].payload?.email, 'applicant@example.test')
  assert.equal(new URL(result.resumeUrl).searchParams.get('draft'), links[0].payload?.plain_token)
  assert.equal(emails.length, 1)
  assert.equal(emails[0].to, 'applicant@example.test')
  assert.ok(emails[0].text.includes(result.resumeUrl))
})

test('resaving a valid draft preserves its case and token without another receipt', async () => {
  const { service, mutations, emails } = fixture(true)
  const result = await service.upsertPublicApplication(draftInput('  Applicant@Example.TEST  ', true), 'https://example.test')
  assert.equal(result.caseId, existingCase.id)
  assert.equal(result.caseNumber, existingCase.case_number)
  assert.equal(result.status, 'draft')
  assert.equal(new URL(result.resumeUrl).searchParams.get('draft'), existingToken)
  assert.equal(result.emailSent, false)
  assert.equal(result.emailError, null)
  assert.deepEqual(emails, [])
  const caseWrites = mutations.filter(item => item.table === 'renovation_cases')
  assert.equal(caseWrites.length, 1)
  assert.equal(caseWrites[0].operation, 'update')
  assert.equal(caseWrites[0].filters.id, existingCase.id)
  const links = mutations.filter(item => item.table === 'case_access_links')
  assert.equal(links.length, 1)
  assert.equal(links[0].operation, 'update')
  assert.equal(links[0].payload?.plain_token, existingToken)
  assert.equal(links[0].payload?.email, 'applicant@example.test')
  assert.equal(mutations.some(item => item.operation === 'insert'), false)
})

test('public applications route maps missing and invalid draft email to HTTP 400', async () => {
  for (const sample of [
    { email: '', message: 'Ange e-postadress.' },
    { email: ' \t ', message: 'Ange e-postadress.' },
    { email: null, message: 'Ange e-postadress.' },
    { email: undefined, message: 'Ange e-postadress.' },
    { email: 'invalid-email', message: 'Ange en giltig e-postadress.' },
  ]) {
    const { service, mutations, emails } = fixture()
    const route = loadSource<typeof ApplicationsRoute>('src/app/api/renoapp/public/applications/route.ts', {
      '@/lib/renoapp/server': service,
      '@/lib/renoapp/renovationRules': rules,
      '@/lib/renoapp/completion': completion,
    })
    const response = await route.POST(new Request('https://example.test/api/renoapp/public/applications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftInput(sample.email)),
    }))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, sample.message)
    assert.deepEqual(mutations, [])
    assert.deepEqual(emails, [])
  }
})
