import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as contract from '../src/lib/action-cases/customerContract.ts'
import * as propertyDomain from '../src/lib/properties/identity.ts'
import { emptyCustomerOffer, normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'

const complete = () => {
  const details = contract.emptyContractDetails()
  details.advice.status = 'none'
  for (const entry of Object.values(details.fields)) Object.assign(entry, { status: 'specified', text: 'Testuppgift' })
  details.fields.controls = { status: 'unreviewed', text: '' }
  return details
}

test('direct editing records actual text without retaining hidden historical status or treating empty text as not applicable', () => {
  assert.deepEqual(contract.editedContractEntry('Anna'), { status: 'specified', text: 'Anna' })
  for (const status of ['specified', 'document', 'not_applicable']) {
    const displayed = contract.contractEntryText({ status, text: 'Old' })
    assert.equal(contract.contractEntryText(contract.editedContractEntry(displayed)), displayed)
    assert.deepEqual(contract.editedContractEntry('New'), { status: 'specified', text: 'New' })
    assert.deepEqual(contract.editedContractEntry('  '), { status: 'unreviewed', text: '  ' })
  }
})

test('the two roles round-trip through the existing offer body with a compatible combined database field', () => {
  let details = contract.editContractParticipants(complete(), { controlOfficer: 'Anna, anna@example.test' })
  assert.match(contract.contractDetailsIssues(details).join(), /Beställarens kontrollant/)
  assert.equal(details.fields.controls.status, 'unreviewed')
  details = contract.editContractParticipants(details, { customerInspector: 'Ingen utsedd' })
  assert.deepEqual(contract.contractDetailsIssues(details), [])
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer(), contractDetails: details })
  assert.deepEqual(draft.contractDetails.controlParticipants, details.controlParticipants)
  assert.match(draft.contractDetails.fields.controls.text, /Kontrollansvarig enligt plan- och bygglagen: Anna/)
  assert.match(draft.contractDetails.fields.controls.text, /Beställarens kontrollant: Ingen utsedd/)
  assert.equal(draft.contractDetails.fields.controls.status, 'specified')
  assert.equal(contract.contractFieldSummary(draft.contractDetails, ['controls']), '2/2 roller angivna')
})

test('clearing a role cannot reuse an earlier complete combined field to bypass the send check', () => {
  let details = contract.editContractParticipants(complete(), { controlOfficer: 'Anna', customerInspector: 'Bo' })
  details = contract.editContractParticipants(details, { controlOfficer: '' })
  assert.match(contract.contractDetailsIssues(details).join(), /Kontrollansvarig/)
  const forged = { ...details, fields: { ...details.fields, controls: { status: 'specified', text: 'Complete' } } }
  assert.equal(contract.normalizeContractDetails(forged).fields.controls.status, 'unreviewed')
  const empty = contract.editContractParticipants(details, { customerInspector: '' })
  assert.equal(contract.contractDetailsIssues(empty).length, 2)
  assert.equal(empty.fields.controls.text, '')
})

test('old common text is removed from editable drafts without assigning roles or modifying the original snapshot', () => {
  const original = complete()
  original.fields.controls = { status: 'document', text: 'Se projektavtal, bilaga 3' }
  assert.deepEqual(contract.normalizeContractDetails(original), original)
  const before = structuredClone(original)
  const draft = contract.contractDetailsForEditing(original)
  assert.deepEqual(draft.controlParticipants, { controlOfficer: '', customerInspector: '' })
  assert.deepEqual(draft.fields.controls, { status: 'unreviewed', text: '' })
  assert.equal(contract.contractDetailsIssues(draft).length, 2)
  const edited = contract.editContractParticipants(original, { controlOfficer: 'Anna' })
  assert.deepEqual(original, before)
  assert.equal(edited.controlParticipants.previousDetails, undefined)
  assert.equal(edited.controlParticipants.customerInspector, '')
  assert.equal(edited.fields.controls.text.includes('bilaga 3'), false)
  assert.deepEqual(contract.normalizeContractDetails(edited), edited)
  assert.match(contract.contractDetailsIssues(edited).join(), /Beställarens kontrollant/)
})

test('previous structured common text cannot bypass role checks or reappear in the draft summary or saved body', () => {
  const original = complete()
  original.controlParticipants = { controlOfficer: 'Anna', customerInspector: '', previousDetails: { status: 'specified', text: 'Gammal testtext' } }
  assert.match(contract.contractDetailsIssues(original).join(), /Beställarens kontrollant/)
  const before = structuredClone(original)
  const details = contract.contractDetailsForEditing(original)
  assert.equal(contract.contractFieldSummary(details, ['controls']), '1/2 roller angivna')
  assert.equal(JSON.stringify(details).includes('Gammal testtext'), false)
  const saved = normalizeCustomerOffer({ ...emptyCustomerOffer(), contractDetails: details })
  assert.deepEqual(saved.contractDetails, details)
  assert.deepEqual(original, before)
})

test('role data rejects invalid shapes, excessive text and malformed legacy data without silent truncation', () => {
  const details = complete()
  for (const participants of [null, [], {}, { controlOfficer: 1, customerInspector: '' },
    { controlOfficer: 'x'.repeat(2001), customerInspector: '' },
    { controlOfficer: '', customerInspector: '', previousDetails: { status: 'assumed', text: 'Old' } },
    { controlOfficer: 'x'.repeat(2000), customerInspector: 'y'.repeat(2000), previousDetails: { status: 'specified', text: 'z'.repeat(3000) } }]) {
    assert.throws(() => contract.normalizeContractDetails({ ...details, controlParticipants: participants }), /INVALID/)
  }
  const normalized = contract.normalizeContractDetails({ ...details, controlParticipants: { controlOfficer: ' Anna ', customerInspector: ' Bo ', ignored: 'secret' } })
  assert.deepEqual(normalized.controlParticipants, { controlOfficer: 'Anna', customerInspector: 'Bo' })
})

function components() {
  const source = readFileSync(new URL('../src/components/tasks/CustomerContractFields.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const loaded = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'lucide-react') return { FileCheck2: 'svg' }
    if (name === '@/lib/action-cases/customerContract') return contract
    if (name === '@/lib/properties/identity') return propertyDomain
    throw new Error('Unexpected dependency: ' + name)
  }, loaded, loaded.exports)
  return loaded.exports
}
const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : !node || typeof node !== 'object' ? [node] : [node, ...flatten(node.props?.children)]

test('the actual editor exposes both roles immediately, no status menus, and edits through the existing onChange callback', () => {
  const view = components(), value = contract.emptyContractDetails()
  let changed
  const nodes = flatten(view.default({ value, fieldKeys: ['controls', 'documents'], showAdvice: false, inline: true, onChange: (next) => { changed = next } }))
  assert.equal(nodes.filter((node) => node?.type === 'select').length, 0)
  const textareas = nodes.filter((node) => node?.type === 'textarea')
  assert.equal(textareas.length, 3)
  textareas.find((node) => node.props.placeholder === 'Namn och kontaktuppgifter').props.onChange({ target: { value: 'Anna' } })
  assert.equal(changed.controlParticipants.controlOfficer, 'Anna')
  assert.equal(changed.controlParticipants.customerInspector, '')
  textareas.find((node) => !node.props.placeholder).props.onChange({ target: { value: 'Ritning A, 2026-10-07' } })
  assert.deepEqual(changed.fields.documents, { status: 'specified', text: 'Ritning A, 2026-10-07' })
  const advice = flatten(view.default({ value, fieldKeys: [], inline: true, onChange: () => {} }))
  assert.equal(advice.filter((node) => node?.type === 'select').length, 1, 'the real advice choice remains')
})

test('editor input limits allow both full role fields without exceeding the compatible database field', () => {
  const details = complete()
  details.fields.controls = { status: 'document', text: 'z'.repeat(5500) }
  const view = components()
  const nodes = flatten(view.default({ value: details, fieldKeys: ['controls'], showAdvice: false, inline: true, onChange: () => {} }))
  const inputs = nodes.filter((node) => node?.type === 'textarea')
  assert.equal(inputs.length, 2)
  assert(inputs.every((input) => input.props.maxLength === 2000))
  let edited = contract.contractDetailsForEditing(details)
  for (const { key } of contract.contractParticipantFields) {
    edited = contract.editContractParticipants(edited, { [key]: 'x'.repeat(2000) })
  }
  assert(edited.fields.controls.text.length <= 6000)
  assert.deepEqual(contract.normalizeContractDetails(edited), edited)
  assert.equal(edited.controlParticipants.previousDetails, undefined)
  assert.equal(nodes.some((node) => node === 'Tidigare gemensamma uppgifter'), false)
})

test('new contract documents display separate roles while old documents preserve their common text', () => {
  const view = components(), legacy = complete()
  legacy.fields.controls = { status: 'document', text: 'Original role information' }
  const legacyNodes = flatten(view.CustomerContractDocument({ value: legacy }))
  assert(legacyNodes.includes('Avtalshandling: Original role information'))
  assert.equal(legacyNodes.includes('Kontrollansvarig enligt plan- och bygglagen'), false)
  const value = contract.editContractParticipants(legacy, { controlOfficer: 'Anna', customerInspector: 'Bo' })
  const nodes = flatten(view.CustomerContractDocument({ value }))
  for (const text of ['Kontrollansvarig enligt plan- och bygglagen', 'Beställarens kontrollant', 'Anna', 'Bo']) assert(nodes.includes(text))
  assert.equal(nodes.includes('Avtalshandling: Original role information'), false)
  const historical = { ...value, controlParticipants: { ...value.controlParticipants, previousDetails: legacy.fields.controls } }
  assert(flatten(view.CustomerContractDocument({ value: historical })).includes('Avtalshandling: Original role information'))
})

test('legacy exclusion and document prefixes are visible and can be removed without affecting the old snapshot', () => {
  const view = components(), value = complete()
  value.fields.insurance = { status: 'not_applicable', text: 'Tidigare skäl' }
  value.fields.documents = { status: 'document', text: 'Bilaga 3' }
  let changed
  const nodes = flatten(view.default({ value, fieldKeys: ['insurance', 'documents'], showAdvice: false, inline: true, onChange: (next) => { changed = next } }))
  const insurance = nodes.find((node) => node?.type === 'textarea' && node.props['aria-label'] === 'Försäkringar och försäkringsbevis')
  const documents = nodes.find((node) => node?.type === 'textarea' && node.props['aria-label'] === 'Avtalshandlingar, datum och inbördes ordning')
  assert.equal(insurance.props.value, 'Ej aktuellt: Tidigare skäl')
  assert.equal(documents.props.value, 'Avtalshandling: Bilaga 3')
  insurance.props.onChange({ target: { value: 'Ansvarsförsäkring hos testbolaget.' } })
  assert.equal(contract.contractEntryText(changed.fields.insurance), 'Ansvarsförsäkring hos testbolaget.')
  assert.deepEqual(value.fields.insurance, { status: 'not_applicable', text: 'Tidigare skäl' })
})
