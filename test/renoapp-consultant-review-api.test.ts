import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as Service from '../src/lib/renoapp/consultantReviewServer'
import type * as Access from '../src/lib/renoapp/consultantReviewAccess'
import type * as Api from '../src/app/api/renoapp/app/cases/[id]/consultant-review/route'
import type * as FileApi from '../src/app/api/renoapp/review/[id]/files/[fileId]/route'

const require = createRequire(import.meta.url)
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
  }, fileName: path }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('node:') || ['next/server', 'react/jsx-runtime', 'lucide-react'].includes(name)) return require(name)
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const common = load('src/lib/renoapp/consultantReview.ts', {})
const template = load('src/lib/renoapp/emailTemplate.ts', {})
type Row = Record<string, unknown>
function fixture() {
  const state = { unauthorized: false, allowed: true, draft: false, failMail: false, failSave: false, lease: false }
  const tables: Record<string, Row[]> = {
    renovation_cases: [{ id: 'case', brf_id: 'brf', case_number: 'RA-1', title: 'Kitchen', status: 'review' }],
    brf_associations: [{ id: 'brf', name: '<BRF & test>' }], renoapp_consultant_reviews: [],
  }
  const mail: Row[] = [], sideEffects: string[] = []
  const admin = {
    from: (table: string) => {
      let filtered = tables[table], update: Row | null = null
      assert.ok(filtered, table)
      const result = () => {
        if (update) {
          if (state.failSave) return { error: { message: 'Save failed' }, data: null }
          filtered.forEach(row => Object.assign(row, update))
          if (update.delivery_attempt_at === null) state.lease = false
        }
        return { data: filtered, error: null }
      }
      const query = { select: () => query, eq: (key: string, value: unknown) => { filtered = filtered.filter(row => row[key] === value); return query },
        update: (values: Row) => { sideEffects.push('update'); update = values; return query },
        single: async () => ({ data: result().data?.[0] ?? null, error: null }), maybeSingle: async () => ({ data: result().data?.[0] ?? null, error: null }),
        then: (done: (result: unknown) => unknown) => done(result()),
      }
      return query
    },
    rpc: async (name: string, args: Row) => {
      sideEffects.push(name)
      if (name === 'renoapp_order_consultant_review') {
        if (!tables.renoapp_consultant_reviews.length) tables.renoapp_consultant_reviews.push({ id: 'order', case_id: 'case',
          price_ore: 150000, message: args.p_message || null, requester_name: args.p_name, created_at: '2026-09-07T12:00:00Z',
          email_payload: args.p_email_payload, delivery_status: 'pending' })
        return { data: structuredClone(tables.renoapp_consultant_reviews[0]), error: null }
      }
      assert.equal(name, 'renoapp_claim_review_email')
      if (state.lease) return { data: false, error: null }
      state.lease = true
      tables.renoapp_consultant_reviews[0].delivery_attempt_id = args.p_attempt
      return { data: true, error: null }
    },
  }
  const service = load<typeof Service>('src/lib/renoapp/consultantReviewServer.ts', {
    'server-only': {}, './consultantReview': common, '@/lib/renoapp/emailTemplate': template,
    '@/lib/renoapp/server': { requireRenoAppViewerContext: async () => {
      if (state.unauthorized) throw new Error('UNAUTHORIZED')
      tables.renovation_cases[0].status = state.draft ? 'draft' : 'review'
      return { authorizedBrfIds: state.allowed ? ['brf'] : [], profile: { id: 'profile', full_name: 'Board', email: 'board@example.test' } }
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (input: Row) => {
      mail.push(structuredClone(input))
      if (state.failMail) throw new Error('Provider timeout')
      return { providerMessageId: 'provider-id' }
    } },
  })
  return { state, tables, service, mail, sideEffects }
}
test('board login and BRF scope are checked before any order is read or created', async () => {
  for (const setting of ['unauthorized', 'allowed'] as const) {
    const f = fixture()
    f.state[setting] = setting === 'unauthorized'
    for (const call of [() => f.service.getBoardConsultantReview('case'), () => f.service.orderConsultantReview('case', { confirmedPriceOre: 150000 })]) {
      await assert.rejects(call(), setting === 'unauthorized' ? /UNAUTHORIZED/ : /CASE_NOT_FOUND/)
    }
    assert.deepEqual(f.mail, [])
    assert.deepEqual(f.sideEffects, [])
  }
})
test('the current fixed price must be accepted, message is optional but bounded, and draft cases cannot order', async () => {
  const f = fixture()
  for (const confirmedPriceOre of [undefined, true, '150000', 1]) await assert.rejects(f.service.orderConsultantReview('case', { confirmedPriceOre }), /REVIEW_PRICE_REQUIRED/)
  for (const message of [123, 'x'.repeat(4001)]) await assert.rejects(f.service.orderConsultantReview('case', { confirmedPriceOre: 150000, message }), /REVIEW_MESSAGE_INVALID/)
  f.state.draft = true
  await assert.rejects(f.service.orderConsultantReview('case', { confirmedPriceOre: 150000 }), /REVIEW_DRAFT/)
  f.state.draft = false
  await assert.rejects(f.service.orderConsultantReview('case', { retry: true }), /REVIEW_NOT_FOUND/)
  assert.deepEqual(f.sideEffects, [])
  assert.equal((await f.service.orderConsultantReview('case', { confirmedPriceOre: 150000 })).deliveryStatus, 'sent')
})
test('one saved order emails the named recipient with escaped HTML, text version, reply-to and a protected case button', async () => {
  const f = fixture()
  const result = await f.service.orderConsultantReview('case', { confirmedPriceOre: 150000, message: '<script>alert(1)</script>' })
  assert.equal(result.priceOre, 150000)
  assert.equal(result.deliveryStatus, 'sent')
  assert.equal('email_payload' in result, false)
  assert.equal(f.mail.length, 1)
  const mail = f.mail[0]
  assert.equal(mail.to, 'jn@hedbjorn.se')
  assert.equal(mail.replyTo, 'board@example.test')
  assert.match(String(mail.html), /&lt;script&gt;/)
  assert.match(String(mail.html), /&lt;BRF &amp; test&gt;/)
  assert.match(String(mail.html), /Öppna ärendet/)
  assert.match(String(mail.text), /1 500 kr exkl\. moms/)
  assert.match(String(mail.text), /\/renoapp\/review\/case/)
  assert.equal(mail.idempotencyKey, 'renoapp-consultant-review-order')
  await f.service.orderConsultantReview('case', { confirmedPriceOre: 150000 })
  assert.equal(f.mail.length, 1)
  assert.equal(f.tables.renoapp_consultant_reviews.length, 1)
  assert.equal(f.tables.renovation_cases[0].status, 'review')
})
test('failed delivery is visible and retries reuse the exact original email and paid order', async () => {
  const f = fixture()
  f.state.failMail = true
  assert.equal((await f.service.orderConsultantReview('case', { confirmedPriceOre: 150000 })).deliveryStatus, 'failed')
  f.tables.brf_associations[0].name = 'Renamed'
  f.state.failMail = false
  const result = await f.service.orderConsultantReview('case', { retry: true, message: 'Changed' })
  assert.equal(result.deliveryStatus, 'sent')
  assert.deepEqual(f.mail[0], f.mail[1])
  assert.equal(f.tables.renoapp_consultant_reviews.length, 1)
})
test('an uncertain delivery-record write stays pending and a held lease does not send a second email', async () => {
  const f = fixture()
  f.state.failSave = true
  assert.equal((await f.service.orderConsultantReview('case', { confirmedPriceOre: 150000 })).deliveryStatus, 'pending')
  await f.service.orderConsultantReview('case', { retry: true })
  assert.equal(f.mail.length, 1)
})
test('admin review access requires module permission before looking up the requested case', async () => {
  let authorized = false, exists = true, reads = 0
  const access = load<typeof Access>('src/lib/renoapp/consultantReviewAccess.ts', {
    'server-only': {}, '@/lib/renoapp/brfAdminAccess': { requireBrfAdminContext: async () => { if (!authorized) throw new Error('MODULE_ACCESS_REQUIRED') } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => {
      reads++
      const query = { select: () => query, eq: (_key: string, value: string) => { assert.equal(value, 'case'); return query },
        maybeSingle: async () => ({ data: exists ? { id: 'order', brf_id: 'brf', case_id: 'case' } : null, error: null }) }
      return query
    } }) },
  })
  await assert.rejects(access.requireConsultantReviewAccess('case'), /MODULE_ACCESS_REQUIRED/)
  assert.equal(reads, 0)
  authorized = true
  assert.equal((await access.requireConsultantReviewAccess('case')).brf_id, 'brf')
  exists = false
  await assert.rejects(access.requireConsultantReviewAccess('case'), /REVIEW_NOT_FOUND/)
})

test('admin case loader authorizes first and loads only the BRF of the existing order', async () => {
  const source = readFileSync(new URL('../src/lib/renoapp/server.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getRenoAppConsultantCaseDetail')!
  const code = ts.transpileModule(node.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  let allowed = false, loads = 0
  const loader = new Function('requireConsultantReviewAccess', 'loadRenoAppCaseDetail', 'exports', `${code}; return getRenoAppConsultantCaseDetail`)(
    async () => { if (!allowed) throw new Error('FORBIDDEN'); return { brf_id: 'ordered-brf' } },
    async (id: string, ids: string[]) => { loads++; assert.equal(id, 'case'); assert.deepEqual(ids, ['ordered-brf']); return { id } }, {},
  )
  await assert.rejects(loader('case'), /FORBIDDEN/)
  assert.equal(loads, 0)
  allowed = true
  assert.equal((await loader('case')).item.id, 'case')
})

test('review page preserves the login destination, denies non-admins and renders a read-only complete case', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  let failure: string | null = 'UNAUTHORIZED', reads = 0
  const page = load<typeof import('../src/app/renoapp/review/[id]/page')>('src/app/renoapp/review/[id]/page.tsx', {
    'next/link': () => null,
    'next/navigation': { notFound: () => { throw new Error('NOT_FOUND') }, redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } },
    '@/lib/renoapp/server': { getRenoAppConsultantCaseDetail: async () => {
      if (failure) throw new Error(failure)
      return { order: { brf_id: 'brf', price_ore: 150000, created_at: '2026-09-07', requester_name: 'Board', requester_email: 'board@example.test', message: 'Please review the wall' },
        item: { caseNumber: 'RA-1', title: 'Wall removal', brf: { name: 'Test BRF' }, status: 'review', updatedAt: '2026-09-07',
          applicant: { name: 'Applicant', email: 'applicant@example.test', phone: '0700000000' }, unit: { unitNumberInternal: '123' },
          actionTypes: [], actionType: { label: 'Wall' }, description: 'Full description', underlag: [], documents: [{ id: 'drawing', fileName: 'Drawing.pdf' }],
          rulesAcceptance: { version: { version: 1, format: 'pdf', fileName: 'Rules.pdf' }, acceptedAt: '2026-09-01' },
          reviewFlags: [], decisions: [], messages: [{ id: 'reply', authorName: 'Applicant', message: 'My reply' }],
        } }
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: (table: string) => {
      reads++
      const query = { select: () => query, eq: () => query,
        single: async () => ({ data: { org_number: '123456-7890', invoice_email: 'invoice@example.test' }, error: null }),
        then: (done: (value: unknown) => unknown) => done({ data: table === 'renoapp_case_question_answers' ? [{ id: 'answer', renoapp_apply_questions: { label: 'Plumbing affected?' }, renoapp_apply_question_options: { label: 'Yes' } }] : [], error: null }),
      }
      return query
    } }) },
  })
  const call = () => page.default({ params: Promise.resolve({ id }) })
  await assert.rejects(call(), new RegExp(`REDIRECT:/login\\?next=${encodeURIComponent(`/renoapp/review/${id}`)}`))
  assert.equal(reads, 0)
  failure = 'MODULE_ACCESS_REQUIRED'
  const { renderToStaticMarkup } = require('react-dom/server')
  assert.match(renderToStaticMarkup(await call()), /Åtkomst nekad/)
  assert.equal(reads, 0)
  failure = null
  const html = renderToStaticMarkup(await call())
  for (const text of ['Please review the wall', 'Full description', 'Plumbing affected?', 'Yes', 'Drawing.pdf', 'Rules.pdf', 'My reply', 'invoice@example.test']) assert.ok(html.includes(text), text)
  assert.ok(html.includes(`/api/renoapp/review/${id}/files/drawing`))
  assert.doesNotMatch(html, /<form|Beställ granskning|Dokumentera styrelsens beslut/)
})
test('paid-action API rejects cross-site submissions and does not expose internal errors', async () => {
  let calls = 0
  const api = load<typeof Api>('src/app/api/renoapp/app/cases/[id]/consultant-review/route.ts', {
    '@/lib/renoapp/consultantReview': common,
    '@/lib/renoapp/consultantReviewServer': { orderConsultantReview: async () => { calls++; throw new Error('private credentials') }, getBoardConsultantReview: async () => null },
  })
  const context = { params: Promise.resolve({ id: 'case' }) }
  assert.equal((await api.POST(new Request('https://example.test/api', { method: 'POST', headers: { origin: 'https://evil.test' }, body: '{}' }), context)).status, 403)
  assert.equal(calls, 0)
  const response = await api.POST(new Request('https://example.test/api', { method: 'POST', body: '{}' }), context)
  assert.equal(response.status, 500)
  assert.doesNotMatch(await response.text(), /credentials/)
  assert.equal((await api.GET(new Request('https://example.test'), context)).headers.get('cache-control'), 'private, no-store')
})
test('consultant file routes reject unauthorized, cross-case and cross-BRF files; rules use the accepted version', async () => {
  const state = { allowed: false, brf: 'brf' }, signed: string[] = []
  const api = load<typeof FileApi>('src/app/api/renoapp/review/[id]/files/[fileId]/route.ts', {
    '@/lib/renoapp/consultantReviewAccess': { requireConsultantReviewAccess: async () => { if (!state.allowed) throw new Error('FORBIDDEN'); return { brf_id: 'brf' } } },
    '@/lib/renoapp/renovationRules': { RULES_BUCKET: 'rules' },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
      from: (table: string) => {
        const rows: Record<string, Row[]> = { renovation_cases: [{ id: 'case', brf_id: state.brf, rules_version_id: 'accepted' }],
          renovation_case_documents: [{ id: 'doc', case_id: 'case', storage_bucket: 'docs', file_path: 'case/doc.pdf', file_name: 'Doc.pdf' }, { id: 'other', case_id: 'other-case', storage_bucket: 'docs', file_path: 'secret.pdf' }],
          renoapp_brf_rules_versions: [{ id: 'accepted', brf_id: 'brf', file_path: 'brf/accepted.pdf', file_name: 'Rules.pdf' }] }
        let filtered = rows[table]
        const query = { select: () => query, eq: (key: string, value: unknown) => { filtered = filtered.filter(row => row[key] === value); return query }, single: async () => ({ data: filtered[0] ?? null, error: null }) }
        return query
      }, storage: { from: () => ({ createSignedUrl: async (path: string) => { signed.push(path); return { data: { signedUrl: 'https://storage.test/file' }, error: null } } }) },
    }) },
  })
  const get = (fileId: string) => api.GET(new Request('https://example.test/file'), { params: Promise.resolve({ id: 'case', fileId }) })
  assert.equal((await get('doc')).status, 404)
  assert.deepEqual(signed, [])
  state.allowed = true
  assert.equal((await get('other')).status, 404)
  state.brf = 'other-brf'
  assert.equal((await get('doc')).status, 404)
  assert.deepEqual(signed, [])
  state.brf = 'brf'
  assert.equal((await get('doc')).status, 307)
  assert.equal((await get('rules')).status, 307)
  assert.deepEqual(signed, ['case/doc.pdf', 'brf/accepted.pdf'])
})
