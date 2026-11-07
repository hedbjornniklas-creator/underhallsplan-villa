import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const path = 'src/components/eb/EbInspectionRoundClient.tsx'
const ast = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let projectLink: ts.JsxElement | undefined
let navigationHandler: ts.Expression | undefined
const visit = (node: ts.Node) => {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Link' &&
    node.openingElement.attributes.getText(ast).includes('projectNavigationKey')) projectLink = node
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleNavigation') {
    navigationHandler = node.initializer
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(projectLink, 'Exercise the actual project link in the Granska header')
assert.ok(navigationHandler, 'Keep the actual existing navigation guard')
const classes = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'navigationLinkClassName')
assert.ok(classes)

function headerLink(pendingNavigationKey: string | null = null) {
  const states: unknown[] = []
  const round = { project: { id: 'project/name' }, inspection: { inspectionId: 'inspection/name' } }
  const before = structuredClone(round)
  const projectNavigationKey = `project:${round.project.id}`
  const code = ts.transpileModule(`${classes.getText(ast)}
    const handleNavigation = ${navigationHandler!.getText(ast)};
    const link = (${projectLink!.getText(ast)});`, { fileName: 'actual-review-navigation.tsx', compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const bindings = {
    exports: {}, require, round, projectNavigationKey, pendingNavigationKey,
    navigationInProgress: Boolean(pendingNavigationKey), isProjectNavigating: pendingNavigationKey === projectNavigationKey,
    setPendingNavigationKey: (next: unknown) => states.push(next),
    Link: (props: React.ComponentProps<'a'>) => React.createElement('a', props),
    ArrowLeft: () => React.createElement('span', { 'aria-hidden': true }),
    Loader2: () => React.createElement('span', { 'aria-hidden': true }),
  }
  const link = new Function(...Object.keys(bindings), `${code}; return link;`)(...Object.values(bindings)) as React.ReactElement<React.ComponentProps<'a'>>
  return { link, states, round, before }
}

test('Granska has an explicitly labelled, visible return button to the current project', () => {
  const f = headerLink()
  assert.equal(f.link.props.href, '/eb/projects/project%2Fname')
  assert.equal(f.link.props['aria-label'], 'Till entreprenaden')
  const html = renderToStaticMarkup(f.link)
  assert.match(html, />Till entreprenaden</)
  assert.doesNotMatch(f.link.props.className!, /\bhidden\b/)
  assert.match(f.link.props.className!, /shrink-0/)
  assert.equal(f.link.props['aria-disabled'], false)
  f.link.props.onClick?.({ preventDefault() { throw Error('Available navigation must not be blocked') } } as unknown as React.MouseEvent<HTMLAnchorElement>)
  assert.deepEqual(f.states, ['project:project/name'])
  assert.deepEqual(f.round, f.before, 'Returning to the project must not edit inspection/report data')
})

test('the project return action preserves the shared pending-navigation guard and waits visually on the right target', () => {
  for (const pending of ['project:project/name', 'report:inspection/name']) {
    const f = headerLink(pending)
    let prevented = false
    f.link.props.onClick?.({ preventDefault() { prevented = true } } as unknown as React.MouseEvent<HTMLAnchorElement>)
    assert.equal(prevented, true)
    assert.deepEqual(f.states, [])
    assert.equal(f.link.props['aria-disabled'], true)
    assert.equal(f.link.props['aria-busy'], pending.startsWith('project:'))
    assert.match(f.link.props.className!, /pointer-events-none/)
  }
})
