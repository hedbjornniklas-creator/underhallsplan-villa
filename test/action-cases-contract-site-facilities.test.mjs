import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as facilities from '../src/lib/action-cases/contractSiteFacilities.ts'
import * as contracts from '../src/lib/action-cases/customerContract.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import * as payments from '../src/lib/action-cases/customerPaymentPlan.ts'
import * as standard from '../src/lib/action-cases/standardContractTerms.ts'

const complete = () => facilities.editSiteFacility(undefined, 'electricity', {
  providedBy: 'customer', paidBy: 'contractor', details: 'TEST: Byggcentral vid garaget.\nAvtalad anslutning.'
})

test('workplace facilities are optional and never guessed or added to historical contracts', () => {
  const draft = { ...offers.emptyCustomerOffer(), contractDetails: contracts.emptyContractDetails() }
  const before = structuredClone(draft)
  assert.equal(offers.normalizeCustomerOffer(draft).contractDetails.siteFacilities, undefined)
  assert.equal(contracts.contractDetailsForEditing(draft.contractDetails).siteFacilities, undefined)
  assert.equal(standard.withAbs18ContractDefaults(draft).contractDetails.siteFacilities, undefined)
  assert.deepEqual(draft, before)
  assert.equal(facilities.siteFacilitiesSummary(), 'Inte angivet')
  assert.deepEqual(facilities.siteFacilitiesIssues(), [])
  assert.deepEqual(facilities.emptySiteFacilityEntry(), { providedBy: '', paidBy: '', details: '' })
})

test('editing, normalization and explicit clearing preserve sibling arrangements and unrelated contract data', () => {
  const value = complete(), before = structuredClone(value)
  const next = facilities.editSiteFacility(value, 'meals', { providedBy: 'contractor', paidBy: 'agreed', details: ' TEST: Rastbod enligt villkor. ' })
  assert.deepEqual(value, before)
  assert.deepEqual(next.entries.electricity, value.entries.electricity)
  assert.equal(facilities.normalizeSiteFacilities(next).entries.meals.details, 'TEST: Rastbod enligt villkor.')
  const details = { ...contracts.contractDetailsForEditing(contracts.emptyContractDetails()), otherAgreements: 'Egen text', siteFacilities: next }
  const saved = offers.normalizeCustomerOffer({ ...offers.emptyCustomerOffer(), terms: 'Behall villkoren', contractDetails: details })
  assert.equal(saved.terms, 'Behall villkoren')
  assert.equal(saved.contractDetails.otherAgreements, 'Egen text')
  assert.deepEqual(saved.contractDetails.fields, details.fields)
  assert.deepEqual(saved.contractDetails.siteFacilities, facilities.normalizeSiteFacilities(next))
  const cleared = facilities.editSiteFacility(saved.contractDetails.siteFacilities, 'electricity', facilities.emptySiteFacilityEntry())
  assert.equal(facilities.siteFacilityUsed(cleared.entries.electricity), false)
  assert.deepEqual(cleared.entries.meals, saved.contractDetails.siteFacilities.entries.meals)
  assert.deepEqual(facilities.siteFacilitiesIssues(cleared), [])
})

test('partial arrangements can autosave but block publication; blank optional rows remain optional', () => {
  for (const patch of [{ providedBy: 'customer' }, { paidBy: 'contractor' }, { details: 'TEST: Toalett i bod.' },
    { providedBy: 'agreed', paidBy: 'agreed', details: ' \n ' }]) {
    const value = facilities.editSiteFacility(undefined, 'toilet', patch)
    const details = contracts.normalizeContractDetails({ ...contracts.emptyContractDetails(), siteFacilities: value })
    assert.equal(facilities.siteFacilitiesIssues(details.siteFacilities).length, 1)
    assert(contracts.contractDetailsIssues(details).some((issue) => issue.includes('toalett')))
  }
  assert.deepEqual(facilities.siteFacilitiesIssues(complete()), [])
  assert.deepEqual(facilities.siteFacilitiesIssues(facilities.editSiteFacility(undefined, 'water', facilities.emptySiteFacilityEntry())), [])
})

test('invalid shapes, unsupported responsibilities and excessive text fail rather than silently dropping data', () => {
  for (const value of [null, [], {}, { version: 2, entries: {} }, { version: 1, entries: [] },
    { version: 1, entries: { unknown: facilities.emptySiteFacilityEntry() } },
    { version: 1, entries: { water: null } },
    { version: 1, entries: { water: { providedBy: 'landlord', paidBy: '', details: '' } } },
    { version: 1, entries: { water: { providedBy: '', paidBy: false, details: '' } } },
    { version: 1, entries: { water: { providedBy: '', paidBy: '', details: 42 } } },
    { version: 1, entries: { water: { providedBy: '', paidBy: '', details: 'a'.repeat(2001) } } }]) {
    assert.throws(() => facilities.normalizeSiteFacilities(value), /INVALID/)
    assert.throws(() => contracts.normalizeContractDetails({ ...contracts.emptyContractDetails(), siteFacilities: value }), /INVALID/)
  }
  assert.equal(facilities.normalizeSiteFacilities(facilities.editSiteFacility(undefined, 'water', { details: 'a'.repeat(2000) })).entries.water.details.length, 2000)
})

function component(file, extra = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../src/components/tasks/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const loaded = { exports: {} }, jsx = (type, props) => ({ type, props })
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useId: () => 'test-id', useState: (value) => [value, () => {}] },
    'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '@/lib/action-cases/contractSiteFacilities': facilities,
    '@/lib/action-cases/customerOffers': offers,
    '@/lib/action-cases/customerPaymentPlan': payments,
    './ProjectEditorRow': { default: ({ children, ...props }) => jsx('section', { ...props, children }) },
    './CustomerContractFields': { CustomerContractDocument: 'contract-details' },
    './CustomerPaymentPlan': { PaymentPlanDocument: 'payment-plan' },
    './CustomerContractPartiesEditor': { ContractPartiesDocument: 'parties' },
    './CustomerContractPricing': { ContractPriceDocument: 'contract-price' },
    './CustomerOfferHourEstimate': { OfferHourEstimateDocument: 'offer-hours' },
    ...extra
  }
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in modules)) throw Error(name)
    return modules[name]
  }, loaded, loaded.exports)
  return loaded.exports
}
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten)
  if (!node || typeof node !== 'object') return [node]
  if (typeof node.type === 'function') return flatten(node.type(node.props))
  return [node, ...flatten(node.props?.children)]
}

test('compact editor offers all eight rows with labeled controls and patches only the edited arrangement', () => {
  const Editor = component('CustomerContractSiteFacilities').default, value = complete(), before = structuredClone(value)
  let changed
  const nodes = flatten(Editor({ value, disabled: false, onChange: (next) => { changed = next } }))
  assert.equal(nodes.filter((n) => n?.type === 'section').length, 8)
  const controls = nodes.filter((n) => n?.props?.['aria-label']?.startsWith('Matplats och pausutrymme:'))
  assert.equal(controls.length, 3)
  for (const n of controls.filter((n) => n.type === 'select')) assert.equal(n.props.value, '')
  controls.find((n) => n.type === 'textarea').props.onChange({ target: { value: 'TEST: Matplats i bod.' } })
  assert.equal(changed.entries.meals.details, 'TEST: Matplats i bod.')
  assert.deepEqual(changed.entries.electricity, value.entries.electricity)
  assert.deepEqual(value, before)
  assert.equal(flatten(Editor({ value, disabled: true, onChange: () => {} })).find((n) => n?.type === 'fieldset').props.disabled, true)
})

test('customer contract includes only agreed facilities once; offer and old signed documents are unchanged', () => {
  const Facilities = component('CustomerContractSiteFacilities')
  const Document = component('CustomerOfferDocument', { './CustomerContractSiteFacilities': Facilities }).default
  const body = { ...offers.emptyCustomerOffer(), contractDetails: { ...contracts.emptyContractDetails(), siteFacilities: complete() } }
  const before = structuredClone(body)
  const view = (snapshot, purpose = 'contract', status = 'published') => flatten(Document({
    offer: { id: 'test', version: 1, status, acceptedOptionIds: [], snapshot, files: [], publishedAt: '' }, selected: [], purpose, fileUrl: () => ''
  }))
  const nodes = view(body)
  assert.equal(nodes.filter((n) => n === 'Arbetsplatsens förutsättningar').length, 1)
  assert.equal(nodes.filter((n) => n === body.contractDetails.siteFacilities.entries.electricity.details).length, 1)
  assert(nodes.includes('Beställaren'))
  assert.equal(nodes.includes('Matplats och pausutrymme'), false)
  assert.equal(nodes.some((n) => ['textarea', 'select'].includes(n?.type)), false)
  assert.equal(view(body, 'offer').includes('Arbetsplatsens förutsättningar'), false)
  const old = structuredClone(body); delete old.contractDetails.siteFacilities
  assert.equal(view(old, 'contract', 'accepted').includes('Arbetsplatsens förutsättningar'), false)
  assert.deepEqual(body, before)
  const frozen = structuredClone(body)
  body.contractDetails.siteFacilities.entries.electricity.details = 'Ny utkasttext'
  assert(view(frozen, 'contract', 'accepted').includes(before.contractDetails.siteFacilities.entries.electricity.details))
})

test('clearing requires confirmation, affects only one row and all edit handlers respect the contract lock', () => {
  const Editor = component('CustomerContractSiteFacilities').default
  const value = facilities.editSiteFacility(complete(), 'meals', { providedBy: 'contractor', paidBy: 'contractor', details: 'TEST: Bod.' })
  const before = structuredClone(value), previousWindow = globalThis.window
  let confirmed = false, asks = 0, changed
  globalThis.window = { confirm: () => { asks++; return confirmed } }
  try {
    const render = (disabled = false) => flatten(Editor({ value, disabled, onChange: (next) => { changed = next } }))
    const clear = (nodes) => nodes.find((n) => n?.type === 'button' && !n.props.disabled)
    clear(render()).props.onClick()
    assert.equal(changed, undefined)
    confirmed = true
    clear(render()).props.onClick()
    assert.deepEqual(changed.entries.electricity, facilities.emptySiteFacilityEntry())
    assert.deepEqual(changed.entries.meals, value.entries.meals)
    changed = undefined
    const locked = render(true)
    locked.find((n) => n?.type === 'textarea').props.onChange({ target: { value: 'Otillaten text' } })
    locked.find((n) => n?.type === 'select').props.onChange({ target: { value: 'customer' } })
    locked.find((n) => n?.type === 'button').props.onClick()
    assert.equal(changed, undefined)
    assert.equal(asks, 2)
    assert.deepEqual(value, before)
  } finally { globalThis.window = previousWindow }
})

test('contract-only integration uses the existing autosave, lock and server/schema preflight', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /contractView && <CustomerContractSiteFacilities/)
  assert.match(editor, /disabled=\{locked \|\| Boolean\(busy\)\}/)
  assert.match(editor, /onChange=\{\(siteFacilities\) => update\(\{ contractDetails:/)
  const server = readFileSync(new URL('../src/lib/action-cases/customerOffersServer.ts', import.meta.url), 'utf8')
  assert.match(server, /rpc\('assert_contract_site_facilities', \{ p_body: draft, p_complete: complete \}\)/)
})
