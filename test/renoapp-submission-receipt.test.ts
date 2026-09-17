import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/app/renoapp/brf/[slug]/apply/page.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let receipt = ''
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.attributes.getText(ast).includes('aria-labelledby="application-sent-heading"')) receipt = node.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(receipt)
function render(kind: string, emailSent: boolean, emailError: string | null = null) {
  const js = ts.transpileModule(`return (${receipt})`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const element = new Function('require', 'exports', 'sentSubmission', 'submitResult', 'form', 'submissionReceiptRef', 'CheckCircle2', js)(
    require, {}, kind, { caseNumber: 'RA-TEST', emailSent, emailError }, { applicantEmail: 'test@example.test' }, null, () => null,
  )
  return renderToStaticMarkup(element)
}
test('successful application gives an explicit confirmation, next step and case number', () => {
  const html = render('application', true)
  assert.match(html, /Din ansökan är skickad/)
  assert.match(html, /RA-TEST/)
  assert.match(html, /Du kan stänga sidan nu/)
  assert.match(html, /test@example.test/)
  assert.match(html, /tabindex="-1"/)
})
test('completion confirms the completion, not a new application', () => {
  const html = render('completion', true)
  assert.match(html, /Din komplettering är skickad/)
  assert.match(html, /granska dina kompletteringar/)
  assert.doesNotMatch(html, /Din ansökan är skickad/)
})
test('email failure does not claim an email was sent or conceal the successful submission', () => {
  const html = render('application', false, 'Bekräftelsemejlet kunde inte skickas.')
  assert.match(html, /Din ansökan är skickad/)
  assert.match(html, /role="alert"/)
  assert.match(html, /Bekräftelsemejlet kunde inte skickas/)
  assert.doesNotMatch(html, /har skickats till/)
})
