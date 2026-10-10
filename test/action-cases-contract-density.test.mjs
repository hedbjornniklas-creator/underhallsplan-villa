import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'
import ts from 'typescript'

const css = postcss.parse(readFileSync(new URL('../src/components/tasks/uppdrag-theme.css', import.meta.url), 'utf8'))
function declarations(selector, media = '') {
  const result = {}
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return
    const condition = rule.parent.type === 'atrule' && rule.parent.name === 'media' ? rule.parent.params : ''
    if (condition !== media) return
    rule.walkDecls((decl) => { result[decl.prop] = decl.value })
  })
  return result
}

test('contract density is opt-in for editing, not preview, offers or other modules', () => {
  const source = ts.createSourceFile('editor.tsx', readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const gates = []
  let editingOnly = false
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'contractView')
      editingOnly = node.initializer.getText(source) === "view === 'contract'"
    if (ts.isConditionalExpression(node) && ts.isStringLiteral(node.whenTrue) && node.whenTrue.text === 'gizmo-contract-editor')
      gates.push([node.condition.getText(source), node.whenFalse.getText(source)])
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(editingOnly, true)
  assert.deepEqual(gates, [['contractView', "''"]])
  const style = declarations('.gizmo-contract-editor')
  assert.equal(style['max-width'], '1080px')
  assert.equal(style['--spacing'], '3px')
  assert.equal(style['font-size'], undefined)
})

test('desktop contract tables and tools have explicit compact dimensions', () => {
  assert.equal(declarations('.gizmo-contract-editor .gizmo-editor-row-toggle')['min-height'], '52px')
  assert.equal(declarations('.gizmo-contract-editor .gizmo-price-row')['min-height'], '44px')
  assert.equal(declarations('.gizmo-contract-editor .gizmo-document-row').height, '48px')
  assert.equal(declarations('.gizmo-contract-editor .gizmo-document-date').width, '132px')
  assert.equal(declarations(".gizmo-contract-editor [data-testid='contract-save-status']").height, '36px')
  const tool = declarations('.uppdrag-scope .gizmo-contract-editor .gizmo-contract-pricing button.gizmo-icon-button', 'screen and (min-width: 768px)')
  assert.equal(tool.width, '32px')
  assert.equal(tool.height, '32px')
  assert.equal(tool['min-height'], '32px')
  assert.equal(declarations('.uppdrag-scope .gizmo-workspace .gizmo-contract-editor.gizmo-editor-scroll-scope button', 'screen and (min-width: 768px)')['min-height'], '36px')
})

test('mobile contract rows can grow and do not inherit fixed desktop document height', () => {
  const media = 'screen and (max-width: 767px)'
  assert.equal(declarations(".gizmo-contract-editor [data-testid='contract-save-status']", media).height, '48px')
  assert.equal(declarations('.uppdrag-scope .gizmo-workspace .gizmo-contract-editor button.gizmo-editor-row-toggle', media)['min-height'], '60px')
  assert.equal(declarations('.uppdrag-scope .gizmo-workspace .gizmo-contract-editor.gizmo-editor-scroll-scope button', media)['min-height'], '48px')
  assert.equal(declarations('.gizmo-contract-editor .gizmo-document-row', media).height, 'auto')
  assert.equal(declarations('.gizmo-contract-editor .gizmo-document-row', media)['min-height'], '60px')
  assert.equal(declarations('.gizmo-contract-editor .gizmo-price-modes label', media)['min-height'], '48px')
  assert.equal(declarations('.gizmo-contract-editor .gizmo-price-modes label', media)['font-size'], '16px')
})

test('desktop fields use readable bounded widths without shrinking mobile inputs', () => {
  const media = 'screen and (min-width: 768px)'
  assert.equal(declarations('.uppdrag-scope .gizmo-contract-editor input[type=\'date\']', media)['max-width'], '220px')
  assert.equal(declarations('.gizmo-contract-editor textarea', media)['max-width'], '832px')
  assert.equal(declarations('.gizmo-contract-editor textarea', media).resize, 'vertical')
  assert.equal(declarations('.gizmo-contract-editor textarea', 'screen and (max-width: 767px)')['max-width'], undefined)
})
