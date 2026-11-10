import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const editorPath = 'src/components/tu/TuInvestigationEditorClient.tsx'
const ast = ts.createSourceFile(editorPath, read(editorPath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function evaluate<T>(source: string, bindings: Record<string, unknown>): T {
  const context = { exports: {}, require, ...bindings }
  const code = ts.transpileModule(source, { fileName: 'actual-tu-billing-ui.tsx', compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  return new Function(...Object.keys(context), `${code}; return value;`)(...Object.values(context)) as T
}
function initializer(name: string) {
  let found: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `Exercise the actual editor declaration ${name}`)
  return found.getText(ast)
}
function workspaceHandler(workspaceView: string, flush: () => Promise<boolean>) {
  const calls: unknown[] = []
  const callback = evaluate<(view: string) => Promise<void>>(`const value = ${initializer('changeWorkspaceView')};`, {
    useCallback: (fn: unknown) => fn, workspaceView, billingPanelRef: { current: { flush } },
    setEvidenceFocusRequest: (next: unknown) => calls.push(['focus', next]),
    setWorkspaceView: (next: unknown) => calls.push(['view', next]),
  })
  return { callback, calls }
}

test('leaving TU delivery waits for the real billing flush and failed saves keep the current workspace', async () => {
  let release!: (result: boolean) => void
  let writes = 0
  const pending = new Promise<boolean>(resolve => { release = resolve })
  const f = workspaceHandler('delivery', async () => { writes++; return pending })
  const navigating = f.callback('report')
  assert.equal(writes, 1)
  assert.deepEqual(f.calls, [])
  release(true)
  await navigating
  assert.deepEqual(f.calls, [['focus', null], ['view', 'report']])
  const failed = workspaceHandler('delivery', async () => false)
  await failed.callback('evidence')
  assert.deepEqual(failed.calls, [], 'No data, report status or workspace change after failed billing save')
})

test('ordinary TU workflow changes do not request a billing write before the delivery panel was used', async () => {
  const f = workspaceHandler('report', async () => { throw Error('Do not write billing while reviewing the report') })
  await f.callback('delivery')
  assert.deepEqual(f.calls, [['focus', null], ['view', 'delivery']])
})

test('TU billing is hosted beside delivery actions but its state survives leaving that step or locking the report', () => {
  let panel: ts.JsxSelfClosingElement | undefined
  let hostInDelivery = false
  const visit = (node: ts.Node, conditions: string[]) => {
    const nestedConditions = ts.isConditionalExpression(node) ? [...conditions, node.condition.getText(ast)] : conditions
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'TuInvestigationBillingPanel') {
      panel = node
      assert.deepEqual(conditions, ['billingStarted'], 'Panel must not unmount on workspace/locked conditions')
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'div' &&
      node.attributes.getText(ast).includes('registerBillingHost')) {
      hostInDelivery = conditions.some(condition => condition === "workspaceView === 'delivery'")
    }
    ts.forEachChild(node, child => visit(child, nestedConditions))
  }
  visit(ast, [])
  assert.ok(panel)
  assert.equal(hostInDelivery, true)
  const source = panel.getText(ast)
  assert.match(source, /organizationId=\{investigation\.orgId\}/)
  assert.match(source, /inspectionId=\{investigation\.inspectionId\}/)
  assert.match(source, /key=\{`\$\{investigation\.orgId\}:\$\{investigation\.inspectionId\}`\}/)
  assert.match(source, /ref=\{billingPanelRef\}/)
  const editor = read(editorPath)
  assert.match(editor, /onOpenReport=\{\(\) => void changeWorkspaceView\('report'\)\}/)
  assert.match(editor, /onClick=\{\(\) => void changeWorkspaceView\('report'\)\}/)
  for (const path of [
    'src/components/tu/TuPublicReportSnapshotView.tsx', 'src/components/tu/TuPrintPagedDocument.tsx',
    'src/app/(dashboard)/tu/investigations/[inspectionId]/digital/page.tsx',
    'src/app/(dashboard)/tu/investigations/[inspectionId]/print/page.tsx',
  ]) assert.doesNotMatch(read(path), /TuInvestigationBillingPanel/, `${path} must not expose internal accounting controls`)
})

test('TU list billing cell renders only readonly status, never invoice number or accounting audit details', () => {
  const path = 'src/components/tu/TuOverview.tsx'
  const overview = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let label: ts.Expression | undefined
  let cell: ts.JsxElement | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'billingLabel') label = node.initializer
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(overview) === 'td' &&
      node.openingElement.attributes.getText(overview).includes('tu-billing-status')) cell = node
    ts.forEachChild(node, visit)
  }
  visit(overview)
  assert.ok(label); assert.ok(cell)
  for (const [status, expected] of [['invoiced', 'Fakturerad'], ['not_invoiced', 'Ej fakturerad'],
    ['unavailable', 'Ej tillgänglig'], [null, '–']] as const) {
    const value = evaluate<React.ReactElement>(`const billingLabel = ${label.getText(overview)};
      const value = (${cell.getText(overview)});`, { item: {
      billingStatus: status, invoiceNumber: 'PRIVATE-INVOICE', updatedByName: 'PRIVATE-USER', revision: 27,
    } })
    const html = renderToStaticMarkup(value)
    assert.match(html, new RegExp(expected))
    assert.doesNotMatch(html, /PRIVATE|invoiceNumber|updatedByName|revision|<input|<button/)
  }
})
