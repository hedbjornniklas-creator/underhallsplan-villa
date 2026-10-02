import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import type { ReactElement } from 'react'
import ts from 'typescript'
import type { TuWorkspaceView } from '../src/lib/tu/workflow'

function source(path: string) {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

const printPage = source('src/app/(dashboard)/tu/investigations/[inspectionId]/print/page.tsx')
let backExpression = ''
function findBackLink(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(printPage) === 'backHref' &&
    node.initializer && ts.isJsxExpression(node.initializer)) {
    backExpression = node.initializer.expression?.getText(printPage) ?? ''
  }
  ts.forEachChild(node, findBackLink)
}
findBackLink(printPage)
assert.ok(backExpression, 'Test must use the return link from the real preview page')
const backHref = new Function('inspectionId', 'investigation', `return ${backExpression}`) as (
  inspectionId: string, investigation: { orgId: string }
) => string

const editor = source('src/components/tu/TuInvestigationEditorClient.tsx')
let initialViewExpression = ''
function findInitialView(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) &&
    node.name.elements[0]?.getText(editor) === 'workspaceView' &&
    node.initializer && ts.isCallExpression(node.initializer)) {
    initialViewExpression = node.initializer.arguments[0]?.getText(editor) ?? ''
  }
  ts.forEachChild(node, findInitialView)
}
findInitialView(editor)
assert.ok(initialViewExpression, 'Test must use the actual workspace state initializer')
const initialView = new Function('initialWorkspaceView', 'postDamageWorkflowEnabled', 'aiWorkflowEnabled',
  `return ${initialViewExpression}`) as (
  requested: TuWorkspaceView | undefined, postDamage: boolean, ai: boolean
) => TuWorkspaceView

async function openInvestigation(query: { orgId?: string; view?: string | string[] }) {
  const page = source('src/app/(dashboard)/tu/investigations/[inspectionId]/page.tsx')
  const code = ts.transpileModule(page.text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const contextRequests: unknown[] = []
  const inspectionRequests: unknown[] = []
  const investigation = { inspectionId: 'inspection-1', reportDraft: { sections: [] } }
  const loaded = { exports: {} as { default: (props: object) => Promise<ReactElement<{
    initialInvestigation: object; initialWorkspaceView?: TuWorkspaceView
  }>> } }
  const require = createRequire(import.meta.url)
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === 'next/navigation') return {
      notFound: () => { throw new Error('Unexpected notFound') },
      redirect: () => { throw new Error('Unexpected redirect') },
    }
    if (name === '@/components/tu/TuInvestigationEditorClient') return { default: () => null }
    if (name === '@/lib/tu/server') return {
      requireTuContext: async (orgId: unknown) => { contextRequests.push(orgId); return { orgId: 'resolved-org' } },
      getTuInvestigationById: async (input: unknown) => { inspectionRequests.push(input); return investigation },
      listTuReportSectionTypeOptions: async () => [],
    }
    return require(name)
  }, loaded, loaded.exports)
  const element = await loaded.exports.default({ params: Promise.resolve({ inspectionId: 'inspection-1' }), searchParams: Promise.resolve(query) })
  return { element, investigation, contextRequests, inspectionRequests }
}

test('preview return link opens report review for AI, post-damage and standard investigations', async () => {
  const url = new URL(backHref('inspection-1', { orgId: 'organization-1' }), 'https://example.test')
  assert.equal(url.pathname, '/tu/investigations/inspection-1')
  assert.equal(url.searchParams.get('view'), 'report')
  assert.equal(url.searchParams.get('orgId'), 'organization-1')
  const { element, investigation, contextRequests, inspectionRequests } = await openInvestigation(Object.fromEntries(url.searchParams))
  assert.equal(element.props.initialWorkspaceView, 'report')
  assert.equal(element.props.initialInvestigation, investigation, 'Navigation must leave saved report data unchanged')
  assert.deepEqual(contextRequests, ['organization-1'])
  assert.deepEqual(inspectionRequests, [{ orgId: 'resolved-org', inspectionId: 'inspection-1' }])
  for (const [postDamage, ai] of [[false, true], [true, true], [false, false]]) {
    assert.equal(initialView(element.props.initialWorkspaceView, postDamage, ai), 'report')
  }
})

test('opening an investigation normally keeps the existing starting steps', async () => {
  for (const view of [undefined, 'unknown', 'delivery', ['report', 'field']]) {
    const { element } = await openInvestigation({ view })
    assert.equal(element.props.initialWorkspaceView, undefined)
    assert.equal(initialView(element.props.initialWorkspaceView, false, true), 'field')
    assert.equal(initialView(element.props.initialWorkspaceView, true, true), 'preparation')
    assert.equal(initialView(element.props.initialWorkspaceView, false, false), 'report')
  }
})

test('preview return link safely encodes inspection and organization identifiers', () => {
  const url = new URL(backHref('inspection/1', { orgId: 'org & test' }), 'https://example.test')
  assert.equal(url.pathname, '/tu/investigations/inspection%2F1')
  assert.equal(url.searchParams.get('orgId'), 'org & test')
  assert.equal(url.searchParams.get('view'), 'report')
})
