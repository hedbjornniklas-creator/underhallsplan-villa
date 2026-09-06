import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactNode } from 'react'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import * as contracts from '../src/lib/besiktapp/interestContracts.ts'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import * as commercial from '../src/lib/publicCommercialContent.ts'
import type * as InterestService from '../src/lib/besiktapp/interest'
import type * as CommercialSections from '../src/components/public/PublicCommercialSections'
import type * as ProductIntro from '../src/components/public/PublicProductIntro'

const nodeRequire = createRequire(import.meta.url)
function loadSource<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputText)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'node:crypto' || name === 'react/jsx-runtime') return nodeRequire(name)
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

const submission = {
  name: 'Test Person', email: 'person@example.test', company: 'Exempelföretaget', phone: '',
  message: 'Jag arbetar med överlåtelsebesiktningar.', website: '', submissionId: 'ca90d944-d455-44f9-ae0a-d4f4a2aa0011',
}
type EmailInput = { to: string; from: string; replyTo: string; html: string; text: string; subject: string; idempotencyKey: string }
function service(send: (input: EmailInput) => Promise<{ providerMessageId: string | null }> = async () => ({ providerMessageId: 'test-message' })) {
  return loadSource<typeof InterestService>('src/lib/besiktapp/interest.ts', {
    'server-only': {}, './interestContracts': contracts, '@/lib/assignments/mailer': { sendAssignmentEmail: send },
  })
}
function request(body: unknown = submission, overrides: HeadersInit = {}) {
  return new Request('https://example.test/api/besiktapp/interest', {
    method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', ...overrides }, body: JSON.stringify(body),
  })
}
function configure(context: { after: (fn: () => void) => void }) {
  const values = { BESIKTAPP_INTEREST_TO: 'team@example.test', ASSIGNMENTS_MAIL_FROM: 'HusHub <noreply@example.test>', RESEND_API_KEY: 'test-key', VERCEL: '0' }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  context.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
}

test('public prices and contact information are unpublished, with no rendered empty sections', () => {
  const sections = loadSource<typeof CommercialSections>('src/components/public/PublicCommercialSections.tsx', { '@/lib/publicCommercialContent': commercial })
  for (const product of ['besiktapp', 'renoapp'] as const) {
    assert.equal(commercial.publishedPricing(commercial.PUBLIC_COMMERCIAL_CONTENT.pricing[product]), null)
    assert.equal(sections.PublicPricingSection({ product }), null)
  }
  assert.equal(commercial.publishedContact(commercial.PUBLIC_COMMERCIAL_CONTENT.contact), null)
  assert.equal(sections.PublicContactSection(), null)
})

test('pricing and contact can be enabled through content alone; fixtures never enter production config', () => {
  const pricing = { heading: 'Testpriser', introduction: 'Enbart testdata.', taxNote: 'Testvillkor', plans: [{ name: 'Testplan', price: 'Testbelopp', billing: 'Testperiod', features: ['Testfunktion'] }] }
  const contact = { heading: 'Testkontakt', introduction: 'Enbart testdata.', companyName: 'Testbolag', email: 'test@example.test', phone: '+46 70 000 00 00' }
  const sections = loadSource<typeof CommercialSections>('src/components/public/PublicCommercialSections.tsx', {
    '@/lib/publicCommercialContent': { ...commercial, PUBLIC_COMMERCIAL_CONTENT: { pricing: { besiktapp: { enabled: true, content: pricing } }, contact: { enabled: true, content: contact } } },
  })
  const pricingHtml = renderToStaticMarkup(sections.PublicPricingSection({ product: 'besiktapp' }))
  const contactHtml = renderToStaticMarkup(sections.PublicContactSection())
  assert.match(pricingHtml, /id="priser"/)
  assert.match(pricingHtml, /Testfunktion/)
  assert.match(contactHtml, /id="kontakt"/)
  assert.match(contactHtml, /mailto:test@example.test/)
  assert.match(contactHtml, /tel:\+46700000000/)
  assert.equal(commercial.publishedPricing({ enabled: false, content: pricing }), null)
  assert.equal(commercial.publishedPricing({ enabled: true, content: { ...pricing, plans: [] } }), null)
  assert.equal(commercial.publishedContact({ enabled: false, content: contact }), null)
  assert.equal(commercial.publishedContact({ enabled: true, content: { ...contact, email: '', phone: '' } }), null)
})

test('interest validation accepts optional fields and rejects invalid values, types, controls and honeypot', () => {
  const result = contracts.validateInterestSubmission({ ...submission, name: ' Test Person ', company: '', message: 'Rad 1\r\nRad 2' })
  assert.equal(result.ok, true)
  if (result.ok) { assert.equal(result.value.name, 'Test Person'); assert.equal(result.value.message, 'Rad 1\nRad 2') }
  for (const input of [null, [], 'text', {}, { ...submission, name: '' }, { ...submission, name: 3 }, { ...submission, company: null }, { ...submission, email: 'a@b' }, { ...submission, email: 'a@example.test\nBcc: other@example.test' }, { ...submission, name: 'ab\ncd' }, { ...submission, message: 'a\u0000b' }, { ...submission, message: 'x'.repeat(2001) }, { ...submission, website: 'spam.test' }, { ...submission, submissionId: 'invalid' }]) {
    assert.equal(contracts.validateInterestSubmission(input).ok, false)
  }
})

test('product introduction adds its price link only when usable pricing is published', () => {
  const content = { heading: 'Test', introduction: 'Test', plans: [{ name: 'Test', price: 'Test', billing: 'Test', features: ['Test'] }], taxNote: 'Test' }
  for (const enabled of [false, true]) {
    const intro = loadSource<typeof ProductIntro>('src/components/public/PublicProductIntro.tsx', {
      'next/image': { default: () => null },
      'next/link': { default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) },
      'lucide-react': { ArrowRight: () => null },
      '@/lib/publicNavigation': { PUBLIC_PRODUCTS: { besiktapp: { name: 'BesiktApp', logo: '', width: 1, height: 1 } } },
      '@/lib/publicCommercialContent': { ...commercial, PUBLIC_COMMERCIAL_CONTENT: { pricing: { besiktapp: { enabled, content } } } },
      './PublicSession': { PublicProductLink: ({ children }: { children: ReactNode }) => createElement('a', { href: '/login' }, children) },
    })
    const html = renderToStaticMarkup(intro.default({ product: 'besiktapp', audience: 'Test', title: 'Test', children: 'Test', interestHref: '/besiktapp/intresse', interestLabel: 'Intresse', aside: null }))
    assert.equal(html.includes('href="#priser"'), enabled)
    assert.match(html, /href="\/besiktapp\/intresse"/)
  }
})

test('mail goes only to the configured private recipient and escapes submitted HTML', async context => {
  configure(context)
  const emails: EmailInput[] = []
  const intake = service(async input => { emails.push(input); return { providerMessageId: 'accepted' } })
  const response = await intake.handleBesiktInterest(request({ ...submission, message: '<script>alert("x")</script>\nNästa rad' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(emails.length, 1)
  assert.equal(emails[0].to, 'team@example.test')
  assert.equal(emails[0].replyTo, submission.email)
  assert.equal(emails[0].subject, 'Ny intresseanmälan för BesiktApp')
  assert.match(emails[0].html, /&lt;script&gt;/)
  assert.doesNotMatch(emails[0].html, /<script>/)
  assert.match(emails[0].html, /<br>Nästa rad/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('retries retain their provider idempotency key; edits and new submissions get distinct keys', async context => {
  configure(context)
  const keys: string[] = []
  const intake = service(async input => { keys.push(input.idempotencyKey); return { providerMessageId: 'accepted' } })
  for (const body of [submission, submission, { ...submission, message: 'Ny text' }, { ...submission, submissionId: 'aa90d944-d455-44f9-ae0a-d4f4a2aa0011' }]) {
    assert.equal((await intake.handleBesiktInterest(request(body))).status, 200)
  }
  assert.equal(keys[0], keys[1])
  assert.notEqual(keys[0], keys[2])
  assert.notEqual(keys[0], keys[3])
  assert.ok(keys[0].length < 256)
})

test('missing or malformed delivery config closes intake and never sends', async context => {
  configure(context)
  let sends = 0
  const intake = service(async () => { sends += 1; return { providerMessageId: 'accepted' } })
  for (const [key, invalid] of [['BESIKTAPP_INTEREST_TO', ''], ['BESIKTAPP_INTEREST_TO', 'bad'], ['ASSIGNMENTS_MAIL_FROM', ''], ['ASSIGNMENTS_MAIL_FROM', 'a@example.test\nBcc: x@example.test'], ['RESEND_API_KEY', '']]) {
    const previous = process.env[key]
    process.env[key] = invalid
    assert.equal(intake.isBesiktInterestAvailable(), false)
    const response = await intake.handleBesiktInterest(request())
    assert.equal(response.status, 503)
    assert.doesNotMatch(JSON.stringify(await response.json()), /BESIKTAPP_INTEREST_TO|team@example/)
    process.env[key] = previous
  }
  assert.equal(sends, 0)
})

test('provider failures, timeouts and missing message ids cannot produce a success receipt', async context => {
  configure(context)
  for (const outcome of ['error', 'timeout', 'missing', 'blank']) {
    const intake = service(async () => {
      if (outcome === 'error' || outcome === 'timeout') throw new Error(outcome)
      return { providerMessageId: outcome === 'missing' ? null : ' ' }
    })
    const response = await intake.handleBesiktInterest(request())
    assert.equal(response.status, 502)
    assert.equal((await response.json()).ok, undefined)
  }
})

test('cross-origin, missing origin, invalid content, oversized streamed body and honeypot never send', async context => {
  configure(context)
  let sends = 0
  const intake = service(async () => { sends += 1; return { providerMessageId: 'accepted' } })
  assert.equal((await intake.handleBesiktInterest(request(submission, { origin: 'https://unrelated.test' }))).status, 403)
  assert.equal((await intake.handleBesiktInterest(request(submission, { origin: '' }))).status, 403)
  assert.equal((await intake.handleBesiktInterest(request(submission, { 'content-type': 'text/plain' }))).status, 415)
  assert.equal((await intake.handleBesiktInterest(request({ ...submission, website: 'robot' }))).status, 400)
  for (const body of ['{invalid', JSON.stringify({ ...submission, extra: 'x'.repeat(20_000) })]) {
    const response = await intake.handleBesiktInterest(new Request('https://example.test/api/besiktapp/interest', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', 'content-length': '1' }, body }))
    assert.equal(response.status, 400)
  }
  assert.equal(sends, 0)
})

test('instance-local throttling caps per-client and total submissions and expires', () => {
  const intake = service()
  const permit = intake.createInterestRateLimit()
  for (let index = 0; index < 5; index++) assert.equal(permit('one', 1000), true)
  assert.equal(permit('one', 1000), false)
  for (let index = 0; index < 25; index++) assert.equal(permit(`other-${index}`, 1000), true)
  assert.equal(permit('last', 1000), false)
  assert.equal(permit('one', 602_000), true)
})

test('route throttling returns retry guidance without another email', async context => {
  configure(context)
  let sends = 0
  const intake = service(async () => { sends += 1; return { providerMessageId: 'accepted' } })
  for (let index = 0; index < 5; index++) assert.equal((await intake.handleBesiktInterest(request())).status, 200)
  const limited = await intake.handleBesiktInterest(request())
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '600')
  assert.equal(sends, 5)
})
