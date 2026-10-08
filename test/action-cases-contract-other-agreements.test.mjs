import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import * as contracts from '../src/lib/action-cases/customerContract.ts'
import * as assignment from '../src/lib/action-cases/contractAssignment.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import * as standard from '../src/lib/action-cases/standardContractTerms.ts'
import * as properties from '../src/lib/properties/identity.ts'

function legacy() {
  const details = contracts.emptyContractDetails()
  for (const { key } of contracts.contractFields) details.fields[key] = { status: 'specified', text: `Fiktiv ${key}` }
  details.controlParticipants = { controlOfficer: 'Test KA', customerInspector: 'Test kontrollant' }
  details.advice.status = 'none'
  details.fields.customerWork = { status: 'document', text: 'Beställaren ordnar en egen elektriker. Samordna eldragningen.' }
  return { ...offers.emptyCustomerOffer(), terms: 'Behåll mina egna villkor.', contractDetails: details }
}
const editable = (draft = legacy()) => standard.withAbs18AssignmentConditions({ ...draft,
  contractDetails: contracts.contractDetailsForEditing(draft.contractDetails) })

test('legacy customer work moves once into editable Other without guessing exclusions or overwriting other terms', () => {
  const draft = legacy(), original = structuredClone(draft), next = editable(draft)
  assert.equal(next.contractDetails.otherAgreements, 'Avtalshandling: ' + draft.contractDetails.fields.customerWork.text)
  assert.deepEqual(next.contractDetails.fields.customerWork, { status: 'unreviewed', text: '' })
  assert.equal(next.terms, draft.terms)
  assert.equal(next.contractDetails.assignment.exclusions, '')
  assert.deepEqual(draft, original)
  assert.deepEqual(offers.normalizeCustomerOffer(next), next)
  assert.deepEqual(editable(next), next)
  next.contractDetails.otherAgreements = 'Egen redigerad överenskommelse.'
  assert.equal(editable(next).contractDetails.otherAgreements, next.contractDetails.otherAgreements)
  next.contractDetails.otherAgreements = ''
  assert.equal(editable(next).contractDetails.otherAgreements, '')
})

test('even the longest legacy text is retained with its original status prefix and no truncation', () => {
  const draft = legacy()
  draft.contractDetails.fields.customerWork = { status: 'not_applicable', text: 'a'.repeat(6000) }
  const next = editable(draft)
  assert.equal(offers.normalizeCustomerOffer(next).contractDetails.otherAgreements, 'Ej aktuellt: ' + 'a'.repeat(6000))
})

test('new contracts have no invisible customer-work requirement while old snapshots keep their old validation', () => {
  assert.equal(contracts.contractDetailsIssues(editable().contractDetails).some((issue) => issue.includes('Beställarens arbeten')), false)
  const old = legacy()
  old.contractDetails.fields.customerWork = { status: 'unreviewed', text: '' }
  assert(contracts.contractDetailsIssues(old.contractDetails).some((issue) => issue.includes('Beställarens arbeten')))
  const next = editable(old)
  assert.equal(next.contractDetails.otherAgreements, '')
  assert.equal(contracts.contractDetailsIssues(next.contractDetails).some((issue) => issue.includes('Beställarens arbeten')), false)
  next.contractDetails.fields.insurance = { status: 'unreviewed', text: '' }
  assert(contracts.contractDetailsIssues(next.contractDetails).some((issue) => issue.includes('Försäkringar')))
})

test('invalid Other metadata and hidden legacy text fail closed', () => {
  for (const patch of [{ otherAgreements: null }, { otherAgreements: 42 }, { otherAgreements: 'a'.repeat(6201) },
    { fields: legacy().contractDetails.fields }]) {
    assert.throws(() => contracts.normalizeContractDetails({ ...editable().contractDetails, ...patch }), /INVALID/)
  }
})

test('ABS18 supplies the two requested page-2 paragraphs only for a new editable draft', () => {
  const draft = legacy(), original = structuredClone(draft), next = editable(draft)
  const conditions = next.contractDetails.assignment.standardConditions
  assert.equal(conditions.version, 'abs18-2018-06')
  assert.equal(conditions.text, standard.ABS18_ASSIGNMENT_CONDITIONS.text)
  assert.match(conditions.text, /om inte annat framgår av ovanstående handlingar/)
  assert.match(conditions.text, /Beställaren betalar statliga och kommunala avgifter inklusive anslutningsavgifter\.$/)
  assert.equal(conditions.text.split('\n\n').length, 2)
  assert.deepEqual(draft, original)
  conditions.text = 'Egen justerad standardtext.'
  assert.equal(editable(next).contractDetails.assignment.standardConditions.text, conditions.text)
  assert.equal(offers.normalizeCustomerOffer(next).contractDetails.assignment.standardConditions.text, conditions.text)
  conditions.text = ''
  assert.equal(editable(next).contractDetails.assignment.standardConditions.text, '')
})

test('custom contracts remove only ABS18 standard text and preserve project-specific agreements and exclusions', () => {
  const draft = editable()
  draft.contractDetails.assignment.exclusions = 'Beställaren utför målningen.'
  const next = standard.withAbs18AssignmentConditions({ ...draft, contractForm: 'custom' })
  assert.equal(next.contractDetails.assignment.standardConditions, undefined)
  assert.equal(next.contractDetails.assignment.exclusions, draft.contractDetails.assignment.exclusions)
  assert.equal(next.contractDetails.otherAgreements, draft.contractDetails.otherAgreements)
  assert.equal(next.terms, draft.terms)
  assert.deepEqual(offers.normalizeCustomerOffer(next), next)
  assert.equal(standard.withAbs18AssignmentConditions({ ...next, contractForm: 'abs18' }).contractDetails.assignment.standardConditions.text,
    standard.ABS18_ASSIGNMENT_CONDITIONS.text)
  assert.throws(() => offers.normalizeCustomerOffer({ ...draft, contractForm: 'custom' }), /INVALID/)
  for (const standardConditions of [null, { version: 'unknown', text: '' }, { version: 'abs18-2018-06', text: 1 },
    { version: 'abs18-2018-06', text: 'a'.repeat(6001) }])
    assert.throws(() => assignment.normalizeAssignment({ ...draft.contractDetails.assignment, standardConditions }), /INVALID/)
})

test('ABS18 initializes an empty work-environment entry once and stores the source version without mutating the draft', () => {
  const draft = editable()
  draft.contractDetails.fields.workEnvironment = { status: 'unreviewed', text: '' }
  const original = structuredClone(draft), next = standard.withAbs18ContractDefaults(draft)
  assert.deepEqual(draft, original)
  assert.equal(next.contractDetails.workEnvironmentDefaultVersion, 'abs18-2018-06')
  assert.deepEqual(next.contractDetails.fields.workEnvironment, contracts.editedContractEntry(standard.ABS18_WORK_ENVIRONMENT.text))
  assert.match(next.contractDetails.fields.workEnvironment.text, /BAS-U/)
  assert.match(next.contractDetails.fields.workEnvironment.text, /BAS-P/)
  assert.match(next.contractDetails.fields.workEnvironment.text, /flera entreprenörer/)
  assert.match(next.contractDetails.fields.workEnvironment.text, /under Övrigt/)
  assert.deepEqual(offers.normalizeCustomerOffer(next), next)
  assert.deepEqual(standard.withAbs18ContractDefaults(next), next)
})

test('work-environment defaults never overwrite existing text, decisions, edits or intentional clearing', () => {
  for (const entry of [
    { status: 'specified', text: 'Egen avtalad ansvarsfördelning.' },
    { status: 'unreviewed', text: 'Ansvar ska kompletteras.' },
    { status: 'document', text: 'Arbetsmiljöbilaga revision B.' },
    { status: 'not_applicable', text: '' }
  ]) {
    const draft = editable()
    draft.contractDetails.fields.workEnvironment = entry
    let next = standard.withAbs18ContractDefaults(draft)
    assert.deepEqual(next.contractDetails.fields.workEnvironment, entry)
    next.contractDetails.fields.workEnvironment = contracts.editedContractEntry('Min justerade text.')
    next = standard.withAbs18ContractDefaults(offers.normalizeCustomerOffer(next))
    assert.equal(next.contractDetails.fields.workEnvironment.text, 'Min justerade text.')
    next.contractDetails.fields.workEnvironment = contracts.editedContractEntry('')
    next = standard.withAbs18ContractDefaults(offers.normalizeCustomerOffer(next))
    assert.deepEqual(next.contractDetails.fields.workEnvironment, { status: 'unreviewed', text: '' })
    assert(contracts.contractDetailsIssues(next.contractDetails).some((issue) => issue.includes('Arbetsmiljö')))
  }
})

test('custom and legacy snapshots are not initialized at display time; changing form preserves edited work-environment text', () => {
  const custom = { ...editable(), contractForm: 'custom' }
  delete custom.contractDetails.assignment.standardConditions
  custom.contractDetails.fields.workEnvironment = { status: 'unreviewed', text: '' }
  assert.deepEqual(standard.withAbs18ContractDefaults(custom), custom)
  assert.deepEqual(standard.withAbs18ContractDefaults(offers.emptyCustomerOffer()), offers.emptyCustomerOffer())
  const next = standard.withAbs18ContractDefaults({ ...custom, contractForm: 'abs18' })
  next.contractDetails.fields.workEnvironment = contracts.editedContractEntry('BAS-P och BAS-U: Testperson.')
  const changed = standard.withAbs18ContractDefaults({ ...next, contractForm: 'custom' })
  assert.equal(changed.contractDetails.fields.workEnvironment.text, next.contractDetails.fields.workEnvironment.text)
  assert.deepEqual(offers.normalizeCustomerOffer(changed), changed)
  assert.deepEqual(standard.withAbs18ContractDefaults({ ...changed, contractForm: 'abs18' }).contractDetails.fields.workEnvironment,
    next.contractDetails.fields.workEnvironment)
  for (const version of [null, true, 42, '', 'unknown'])
    assert.throws(() => offers.normalizeCustomerOffer({ ...next, contractDetails: {
      ...next.contractDetails, workEnvironmentDefaultVersion: version
    } }), /INVALID/)
})

function component(file, extra = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../src/components/tasks/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const module = { exports: {} }, jsx = (type, props) => ({ type, props })
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { Fragment: 'fragment', useId: () => 'test-id', useLayoutEffect: () => {}, useRef: (current) => ({ current }), useState: (v) => [v, () => {}] },
    'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '@/lib/action-cases/contractAssignment': assignment,
    '@/lib/action-cases/standardContractTerms': standard,
    '@/lib/action-cases/customerContract': contracts,
    '@/lib/properties/identity': properties,
    '@/lib/action-cases/customerOffers': offers,
    './CustomerPaymentPlan': { PaymentPlanDocument: 'payment-plan' },
    './CustomerContractPartiesEditor': { ContractPartiesDocument: 'parties' },
    ...extra
  }
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in modules)) throw Error(name)
    return modules[name]
  }, module, module.exports)
  return module.exports
}
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten)
  if (!node || typeof node !== 'object') return [node]
  if (typeof node.type === 'function') return flatten(node.type(node.props))
  return [node, ...flatten(node.props?.children)]
}

test('the normal work-environment field edits the stored default and renders the actual saved text in contracts', () => {
  const draft = editable()
  draft.contractDetails.fields.workEnvironment = { status: 'unreviewed', text: '' }
  const next = standard.withAbs18ContractDefaults(draft)
  const Fields = component('CustomerContractFields')
  let changed
  const nodes = flatten(Fields.default({ value: next.contractDetails, fieldKeys: ['workEnvironment'],
    showAdvice: false, inline: true, onChange: (value) => { changed = value } }))
  const field = nodes.find((n) => n?.props?.['aria-label'] === 'Arbetsmiljö, BAS-P och BAS-U')
  assert.equal(field.props.value, standard.ABS18_WORK_ENVIRONMENT.text)
  assert.equal(field.props.rows, 7)
  field.props.onChange({ target: { value: 'Projektspecifik arbetsmiljötext.' } })
  assert.equal(changed.fields.workEnvironment.text, 'Projektspecifik arbetsmiljötext.')
  assert.equal(changed.workEnvironmentDefaultVersion, 'abs18-2018-06')
  const rendered = flatten(Fields.CustomerContractDocument({ value: changed }))
  assert.equal(rendered.filter((node) => node === changed.fields.workEnvironment.text).length, 1)
  assert.equal(rendered.includes(standard.ABS18_WORK_ENVIRONMENT.text), false)
  const legacyDetails = contracts.emptyContractDetails(), original = structuredClone(legacyDetails)
  assert.equal(flatten(Fields.CustomerContractDocument({ value: legacyDetails })).includes(standard.ABS18_WORK_ENVIRONMENT.text), false)
  assert.deepEqual(legacyDetails, original)
})

test('assignment editor allows editing the default paragraphs and keeps them out of custom contracts', () => {
  const Editor = component('CustomerContractAssignmentEditor').default, draft = editable()
  let patch
  const nodes = flatten(Editor({ draft, files: [], caseId: 'test', onChange: (value) => { patch = value } }))
  const field = nodes.find((n) => n?.props?.['aria-label'] === 'Standardtexter för uppdraget, ABS 18')
  assert.equal(field.props.value, standard.ABS18_ASSIGNMENT_CONDITIONS.text)
  field.props.onChange({ target: { value: 'Egen ändring.' } })
  assert.equal(patch.contractDetails.assignment.standardConditions.text, 'Egen ändring.')
  assert.equal(draft.contractDetails.assignment.standardConditions.text, standard.ABS18_ASSIGNMENT_CONDITIONS.text)
  const custom = flatten(Editor({ draft: { ...draft, contractForm: 'custom' }, files: [], caseId: 'test', onChange: () => {} }))
  assert.equal(custom.some((n) => n?.props?.['aria-label'] === field.props['aria-label']), false)
})

test('contract review includes stored defaults and Other once; old signed rendering and offer preview remain unchanged', () => {
  const Document = component('CustomerOfferDocument', { './CustomerContractFields': component('CustomerContractFields') }).default
  const view = (snapshot, purpose = 'contract', status = 'published') => flatten(Document({
    offer: { id: 'test', version: 1, status, snapshot, files: [], publishedAt: '' }, selected: [], purpose, fileUrl: () => ''
  }))
  const old = legacy(), original = structuredClone(old), next = editable(old)
  const rendered = view(next)
  assert.equal(rendered.filter((n) => n === standard.ABS18_ASSIGNMENT_CONDITIONS.text).length, 1)
  assert.equal(rendered.filter((n) => n === next.contractDetails.otherAgreements).length, 1)
  assert.equal(rendered.includes('Beställarens arbeten och samordning'), false)
  assert.equal(view(old, 'contract', 'accepted').includes('Beställarens arbeten och samordning'), true)
  assert.equal(view(old, 'contract', 'accepted').includes(standard.ABS18_ASSIGNMENT_CONDITIONS.text), false)
  assert.equal(view(next, 'offer').includes(standard.ABS18_ASSIGNMENT_CONDITIONS.text), false)
  assert.equal(view(next, 'offer').includes(next.contractDetails.otherAgreements), false)
  assert.deepEqual(old, original)
})

const db = new PGlite()
const migration = readFileSync(new URL('../docs/db/2026-10-08_02_contract_other_agreements.sql', import.meta.url), 'utf8')
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role; create table saved_versions(snapshot jsonb);')
  await db.query('insert into saved_versions values($1)', [JSON.stringify(legacy())])
  await db.exec(migration)
  await db.exec(migration)
})
after(() => db.close())
const guard = (draft, complete = true) => db.query('select assert_customer_contract($1::jsonb,$2)', [JSON.stringify(draft), complete])

test('SQL removes only the obsolete requirement, validates new texts, and never rewrites historical snapshots', async () => {
  const old = legacy(), next = editable(old)
  await guard(old)
  await guard(next)
  await guard({ ...next, contractDetails: { ...next.contractDetails, otherAgreements: '' } })
  const noLegacyText = structuredClone(old)
  noLegacyText.contractDetails.fields.customerWork = { status: 'unreviewed', text: '' }
  await guard(noLegacyText, false)
  await assert.rejects(guard(noLegacyText), /INCOMPLETE/)
  const noInsurance = structuredClone(next)
  noInsurance.contractDetails.fields.insurance = { status: 'unreviewed', text: '' }
  await assert.rejects(guard(noInsurance), /INCOMPLETE/)
  for (const bad of [
    { ...next, contractDetails: { ...next.contractDetails, otherAgreements: null } },
    { ...next, contractDetails: { ...next.contractDetails, otherAgreements: 'a'.repeat(6201) } },
    { ...next, contractDetails: { ...next.contractDetails, fields: old.contractDetails.fields } },
    { ...next, contractDetails: { ...next.contractDetails, assignment: { ...next.contractDetails.assignment,
      standardConditions: { version: 'unknown', text: '' } } } },
    { ...next, contractForm: 'custom' }
  ]) await assert.rejects(guard(bad, false), /INVALID/)
  assert.deepEqual((await db.query('select snapshot from saved_versions')).rows[0].snapshot, old)
  assert.equal((await db.query("select has_function_privilege('authenticated','assert_customer_contract(jsonb,boolean)','execute') allowed")).rows[0].allowed, false)
})

test('SQL round-trips valid work-environment initialization without weakening completeness or accepting malformed versions', async () => {
  const draft = standard.withAbs18ContractDefaults(editable())
  await guard(draft)
  const changed = structuredClone(draft)
  changed.contractDetails.fields.workEnvironment = contracts.editedContractEntry('Egen text.')
  await guard(changed)
  changed.contractDetails.fields.workEnvironment = contracts.editedContractEntry('')
  await guard(changed, false)
  await assert.rejects(guard(changed), /INCOMPLETE/)
  for (const version of [null, true, 42, '', 'unknown']) {
    const malformed = structuredClone(draft)
    malformed.contractDetails.workEnvironmentDefaultVersion = version
    await assert.rejects(guard(malformed, false), /INVALID/)
  }
})

test('editor no longer contains the customer-work section and locks still guard draft upgrades', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  assert.equal(editor.includes("contractSection('customer-work'"), false)
  assert(editor.includes('Övriga överenskommelser'))
  assert.match(editor, /workspace\.offers\.some\(\(offer\) => offer\.status === 'accepted'\)\) return/)
  assert.match(editor, /draftTarget !== 'contract' \|\| locked/)
  assert.match(editor, /applyDraftUpgrade\.current = \(\) => update\(currentSnapshot\.current\.draft\)/)
})
