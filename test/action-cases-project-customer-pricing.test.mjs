import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as shared from '../src/lib/action-cases/projectCustomerPricing.ts'
import * as pricing from '../src/lib/action-cases/contractPricing.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import { importableCustomerPrice } from '../src/lib/action-cases/offerImport.ts'
import { contractSigningSections } from '../src/lib/action-cases/contractSigningPdf.ts'

const itemId = randomUUID(), caseId = randomUUID()
const terms = () => ({ ...shared.emptyProjectCustomerPricing(), split: 'separate', labour: { ...shared.emptyCustomerCharge(), fixedOre: 25000000 },
  material: { ...shared.emptyCustomerCharge(), mode: 'budget', budgetOre: 10000000, markupPercent: 15 }, assumptions: 'Fiktivt materialval.', reviewTerms: 'Samrad innan fortsatt arbete.' })
const price = (value = terms()) => ({ version: 1, mode: 'mixed', basis: 'rows', split: 'combined', display: 'priced',
  rows: [{ id: randomUUID(), sourceItemId: itemId, title: 'Fiktivt byggarbete', kind: 'running', amountOre: null, labourOre: null, materialOre: null, projectPricing: { revision: 1, terms: value } }],
  totalOre: null, labourOre: null, materialOre: null, running: { hourlyOre: null, markupPercent: null, managementOre: null, approximateOre: null } })
const draft = p => offers.normalizeCustomerOffer({ ...offers.emptyCustomerOffer('Fiktiv offert'), contractForm: 'custom', contractPricing: p,
  items: [{ id: randomUUID(), sourceItemId: itemId, title: 'Fiktivt byggarbete', scope: 'Fiktiv omfattning.', amountOre: null, kind: 'included' }] })
const expose = d => offers.mapCustomerOffer({ id: randomUUID(), snapshot: d, version: 1, status: 'published', files: [] }).snapshot
function load(path, deps, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => { assert.ok(name in deps, name); return deps[name] }, m, m.exports, ...Object.values(globals))
  return m.exports
}

test('one moment can have fixed labour and budgeted material, with no combined fixed+budget promise', () => {
  const p = pricing.normalizeContractPricing(price()), before = structuredClone(p)
  assert.equal(pricing.contractFixedAmount(p), 25000000)
  assert.equal(pricing.offerBudgetBreakdown(p).runningOre, 10000000)
  assert.deepEqual(pricing.contractPricingIssues(p), [])
  assert.equal(pricing.contractPriceModeLabel(p), 'Fast pris + löpande med budget')
  const document = contractSigningSections({ kind: 'offer', snapshot: { ...draft(p), issuerName: 'Fiktiv byggare', replyEmail: '', customerName: 'Fiktiv kund', customerEmail: '', projectTitle: 'Test', propertyAddress: 'Testgatan 1' }, files: [] })
  const text = JSON.stringify(document)
  assert.match(text, /Fiktivt byggarbete – arbete/)
  assert.match(text, /Fiktivt byggarbete – material/)
  assert.match(text, /Självkostnad \+ 15 % exkl. moms/)
  assert.doesNotMatch(text, /350 000|35000000|Samlad kostnadsplan/)
  assert.deepEqual(p, before)
})

test('zero is an agreed value; missing, running and budget amounts are not invented from internal calculation', () => {
  const t = terms(), p = price(t)
  t.labour.fixedOre = 0
  assert.equal(pricing.contractFixedAmount(p), 0)
  t.labour.fixedOre = null
  assert.equal(pricing.contractFixedAmount(p), null)
  assert.ok(pricing.contractPricingIssues(p).length)
  const source = { id: itemId, contractWork: { customerPricing: { terms: t } }, lumpSum: { verified: true, customerPrice: 999999, vatRate: 25 } }
  assert.equal(importableCustomerPrice(source), null)
  t.material = { ...shared.emptyCustomerCharge(), fixedOre: 0 }; t.labour.fixedOre = 100
  assert.equal(importableCustomerPrice(source), 100)
  const imported = pricing.importContractPrices({ ...p, rows: [] }, [{ id: itemId, title: 'Bygg', amountOre: null, projectPricing: { revision: 1, terms: terms() } }], [itemId])
  assert.equal(imported.mode, 'mixed'); assert.equal(pricing.contractFixedAmount(imported), 25000000)
})

test('customer projections hide inactive pricing memory and unpublished delpriser while retaining rates and separate budgets', () => {
  const t = terms(); t.combined.fixedOre = 987654321; t.material.fixedOre = 88888888; t.labour.budgetOre = 77777777
  for (const display of ['priced', 'unpriced', 'total']) {
    const p = price(t); p.display = display
    const publicDraft = expose(draft(p)), text = JSON.stringify(publicDraft)
    assert.doesNotMatch(text, /987654321|88888888|77777777/)
    assert.equal('sourceItemId' in publicDraft.contractPricing.rows[0], false)
    assert.equal(pricing.offerBudgetBreakdown(publicDraft.contractPricing).runningOre, 10000000)
    assert.equal(pricing.contractFixedAmount(publicDraft.contractPricing), 25000000)
    assert.equal(offers.normalizeCustomerOffer(publicDraft).baseAmountOre, 25000000)
    if (display !== 'priced') assert.equal(publicDraft.contractPricing.rows[0].projectPricing.terms.labour.fixedOre, null)
  }
})

test('normalization rejects unsafe inactive fields, malformed revisions, percent precision and aggregate overflow', () => {
  for (const value of [-1, 1.1, '100', 100000000001, NaN]) assert.throws(() => shared.normalizeProjectCustomerPricing({ ...terms(), combined: { ...shared.emptyCustomerCharge(), fixedOre: value } }), /INVALID/)
  assert.throws(() => shared.normalizeProjectPricingReference({ revision: 0, terms: terms() }), /INVALID/)
  assert.throws(() => shared.normalizeProjectCustomerPricing({ ...terms(), material: { ...terms().material, markupPercent: 1.001 } }), /INVALID/)
  const p = price(); p.rows.push({ ...p.rows[0], id: randomUUID(), sourceItemId: randomUUID(), projectPricing: { revision: 1, terms: { ...terms(), material: { ...terms().material, budgetOre: 100000000000 } } } })
  assert.throws(() => pricing.normalizeContractPricing(p), /INVALID/)
})

const tick = () => new Promise(resolve => setImmediate(resolve))
function autosaveHarness() {
  const slots = [], timers = new Map(), requests = [], saved = [], cleanups = []
  const react = { useRef: value => ({ current: value }), useCallback: fn => fn,
    useState: value => { const slot = { value }; slots.push(slot); return [value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next }] },
    useEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) } }
  const globals = { fetch: (_, options) => new Promise((resolve, reject) => requests.push({ payload: JSON.parse(options.body).payload, resolve, reject })),
    setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id }, clearTimeout: id => timers.delete(id) }
  const deps = { react, '@/lib/action-cases/projectCustomerPricing': shared }
  deps['@/hooks/useAutosaveQueue'] = load('src/hooks/useAutosaveQueue.ts', deps, globals)
  const coordinate = load('src/components/tasks/useActionSaveCoordinator.ts', deps, globals).useActionSaveCoordinator()
  const api = load('src/components/tasks/useProjectCustomerPricingAutosave.ts', deps, globals).useProjectCustomerPricingAutosave({ caseId, coordinate, onSaved: result => saved.push(result) })
  const state = { revision: 0, terms: null, candidates: [], documentRevisions: { offer: 1, contract: 1 } }
  return { api, requests, saved, state, states: () => slots[0].value,
    timers: async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await tick() },
    reply: async (index, patch = {}) => { const req = requests[index], p = req.payload; req.resolve(Response.json({ requestId: p.requestId, itemId, previousRevision: p.revision, revision: p.revision + 1, terms: p.terms, workspace: { cases: [{ items: [{ id: itemId, contractWork: { customerPricing: { revision: p.revision + 1, terms: p.terms } } }] }] }, ...patch })); await tick() },
    dispose: () => cleanups.reverse().forEach(fn => fn()) }
}

test('autosave coalesces edits, acknowledges exact versions and saves newer edits after an in-flight adoption', async () => {
  const h = autosaveHarness(), t = terms()
  h.api.change(itemId, h.state, t); h.api.change(itemId, h.state, { ...t, assumptions: 'New' }); await h.timers()
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].payload.adopt, true)
  h.api.change(itemId, h.state, { ...t, assumptions: 'Latest' }); await h.timers(); assert.equal(h.requests.length, 1)
  await h.reply(0); await h.timers()
  assert.equal(h.requests[1].payload.revision, 1); assert.equal(h.requests[1].payload.adopt, false)
  assert.equal(h.requests[1].payload.terms.assumptions, 'Latest')
  await h.reply(1); assert.equal(h.states()[itemId].status, 'saved'); h.dispose()
})

test('ambiguous saves retry the same request before newer terms, and errors retain typed values', async () => {
  const h = autosaveHarness()
  h.api.change(itemId, h.state, terms()); await h.timers()
  const first = h.requests[0].payload
  h.api.change(itemId, h.state, { ...terms(), assumptions: 'Keep me' })
  h.requests[0].reject(Error('Nätfel')); await tick()
  assert.equal(h.states()[itemId].status, 'error'); assert.equal(await h.api.flushAll(), false)
  h.api.retry(itemId); await tick()
  assert.deepEqual(h.requests[1].payload, first)
  await h.reply(1); await h.timers(); assert.equal(h.requests[2].payload.terms.assumptions, 'Keep me')
  await h.reply(2); assert.equal(h.states()[itemId].status, 'saved'); h.dispose()
})

test('wrong acknowledgements do not clear unsaved customer terms or publish stale workspaces', async () => {
  const h = autosaveHarness()
  h.api.change(itemId, h.state, terms()); await h.timers(); await h.reply(0, { revision: 99 })
  assert.equal(h.states()[itemId].status, 'error'); assert.equal(h.saved.length, 0)
  assert.deepEqual(h.states()[itemId].terms, terms()); h.dispose()
})

test('the price RPC uses session actor and organization, validates before writing and propagates stale/lock errors', async () => {
  const calls = [], ctx = { orgId: randomUUID(), userId: randomUUID() }, requestId = randomUUID()
  let error = null
  const server = load('src/lib/action-cases/projectCustomerPricingServer.ts', { 'server-only': {}, './customerOffers': offers,
    './projectCustomerPricing': shared, './contractWorkServer': { contractWorkError: value => { if (value) throw Error(value.message) } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error,
      data: { itemId, requestId, revision: 1 } } } }) } })
  const payload = { caseId, itemId, requestId, revision: 0, terms: terms(), adopt: true, documentRevisions: { offer: 1, contract: null }, orgId: randomUUID(), userId: randomUUID(), unitCost: 1 }
  await server.saveProjectCustomerPricing(ctx, payload)
  assert.equal(calls[0].name, 'write_project_customer_price')
  assert.equal(calls[0].args.p_org_id, ctx.orgId); assert.equal(calls[0].args.p_user_id, ctx.userId)
  assert.equal('unitCost' in calls[0].args, false)
  await assert.rejects(server.saveProjectCustomerPricing(ctx, { ...payload, revision: -1 }), /INVALID/)
  assert.equal(calls.length, 1)
  error = { message: 'PROJECT_PRICE_STALE' }
  await assert.rejects(server.saveProjectCustomerPricing(ctx, payload), /PROJECT_PRICE_STALE/)
  error = { message: 'ACTION_CASE_CONTRACT_LOCKED' }
  await assert.rejects(server.saveProjectCustomerPricing(ctx, payload), /CONTRACT_LOCKED/)
})

test('the new HTTP write requires same-origin and module access before the canonical save path', async () => {
  const ctx = { orgId: randomUUID(), userId: randomUUID() }, calls = []
  const deps = Object.fromEntries(['server','costingAiServer','costingAiAlerts','quotesServer','quoteRequestsServer','workPartsServer','quotePackagesServer','rfqDeliveryServer','scopeDraft','costCompletionServer'].map(name => [`@/lib/action-cases/${name}`, {}]))
  const route = load('src/app/api/action-cases/route.ts', { ...deps,
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/access/server': { requireModuleAccess: async () => calls.push('access') }, '@/lib/assignments/server': { requireOrgContext: async () => ctx },
    '@/lib/action-cases/contractWorkServer': { assertContractWorkMutation: async () => {} },
    '@/lib/action-cases/server': { getActionCaseWorkspace: async () => ({ cases: [] }) },
    '@/lib/action-cases/projectCustomerPricingServer': { saveProjectCustomerPricing: async actor => { assert.deepEqual(actor, ctx); calls.push('save'); return {} } } })
  for (const origin of ['https://other.example', null]) {
    const response = await route.POST(new Request('https://example.test/api/action-cases', { method: 'POST', headers: origin ? { origin } : {}, body: JSON.stringify({ action: 'save_project_customer_pricing', payload: {} }) }))
    assert.equal(response.status, 403)
  }
  assert.equal(calls.includes('save'), false)
  const response = await route.POST(new Request('https://example.test/api/action-cases', { method: 'POST', headers: { origin: 'https://example.test' }, body: JSON.stringify({ action: 'save_project_customer_pricing', payload: {} }) }))
  assert.equal(response.status, 200); assert.equal(calls.at(-1), 'save')
})
