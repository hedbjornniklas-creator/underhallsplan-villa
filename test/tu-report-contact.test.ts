import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { normalizeTuOrdererRole } from '../src/lib/tu/customerRole.ts'

const source = readFileSync(new URL('../src/components/tu/TuInvestigationEditorClient.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const required = new Set([
  'EMPTY_ASSIGNMENT_PARTIES_FORM', 'INSPECTOR_PARTY_FIELDS',
  'cleanFieldValue', 'compactAddress', 'getSectionText', 'assignIfPresent',
  'parseAssignmentPartiesText', 'mergeNonEmptyFields', 'buildAssignmentPartiesForm',
  'buildLine', 'buildAssignmentPartiesText', 'joinDisplay',
])
const declarations = ast.statements.filter((statement) => {
  if (ts.isFunctionDeclaration(statement)) return required.has(statement.name?.text ?? '')
  return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
    (declaration) => ts.isIdentifier(declaration.name) && required.has(declaration.name.text)
  )
})
let contactExpression = ''
function findContact(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'customerContact') {
    contactExpression = node.initializer?.getText(ast) ?? ''
  }
  ts.forEachChild(node, findContact)
}
findContact(ast)
assert.ok(contactExpression, 'Test must execute the contact expression used by the editor')
assert.equal(declarations.length, required.size)
const code = ts.transpileModule(declarations.map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
type Form = Record<string, string>
const helpers = new Function('normalizeTuOrdererRole', `${code}
  return {
    form: buildAssignmentPartiesForm,
    serialize: buildAssignmentPartiesText,
    contact(assignmentParties, investigation) { return ${contactExpression}; }
  };
`)(normalizeTuOrdererRole) as {
  form: (investigation: ReturnType<typeof fixture>) => Form
  serialize: (form: Form) => string
  contact: (form: Form, investigation: ReturnType<typeof fixture>) => string
}

function fixture(text = '', withAssignment = false) {
  return {
    assignment: withAssignment ? { customer_email: 'assignment@example.test', customer_phone: '0701111111' } : null,
    inspection: { customer_name: 'Bestallare', customer_email: 'original@example.test', customer_phone: '0700000000' },
    inspector: null,
    reportDraft: { sections: [{ key: 'assignment_parties', text }] },
  }
}

test('contact summary shows the same prefilled contact fields as the editor', () => {
  for (const withAssignment of [false, true]) {
    const investigation = fixture('', withAssignment)
    const form = helpers.form(investigation)
    assert.equal(helpers.contact(form, investigation), withAssignment
      ? '0701111111, assignment@example.test'
      : '0700000000, original@example.test')
  }
  assert.match(source, /<ReadOnlyInfoRow label="Kontakt" value=\{customerContact\}/u)
})

test('contact summary uses saved report edits instead of the original creation details', () => {
  const investigation = fixture('Uppdragsgivare\nTelefon: 0702222222\nE-post: edited@example.test\n\nBesiktningsman\nE-post: inspector@example.test', true)
  const form = helpers.form(investigation)
  assert.equal(form.customerEmail, 'edited@example.test')
  assert.equal(helpers.contact(form, investigation), '0702222222, edited@example.test')
})

test('contact changes remain consistent before saving and after reloading the report draft', () => {
  const investigation = fixture()
  const form = { ...helpers.form(investigation), customerPhone: '0703333333', customerEmail: 'new@example.test' }
  assert.equal(helpers.contact(form, investigation), '0703333333, new@example.test')
  const reloaded = fixture(helpers.serialize(form))
  assert.equal(helpers.contact(helpers.form(reloaded), reloaded), '0703333333, new@example.test')
  assert.equal(reloaded.inspection.customer_email, 'original@example.test')
})
