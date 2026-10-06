import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const source = readFileSync(new URL('../src/components/tasks/ActionCaseWorkspace.tsx', import.meta.url), 'utf8')
const css = postcss.parse(readFileSync(new URL('../src/components/tasks/uppdrag-theme.css', import.meta.url), 'utf8'))
function declarations(selector) {
  const rule = css.nodes.find((node) => node.type === 'rule' && node.selectors.includes(selector))
  assert.ok(rule, selector)
  return Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]))
}

test('action rows remain native buttons in a named list and expose the open dialog', () => {
  assert.match(source, /<ul className="gizmo-work-rows" aria-label="Projektets åtgärder">/)
  assert.match(source, /<li key=\{item.id\}><button type="button" onClick=\{\(\) => setSelectedItemId\(item.id\)\}/)
  assert.match(source, /aria-haspopup="dialog" aria-expanded=\{selectedItemId === item.id\}/)
  assert.match(source, /saveIssue \? 'Öppna för att spara'/)
  assert.match(source, /saveIssue \?\? ITEM_STATUS\[item.status\]/)
})

test('table header and rows share aligned tracks while header tone and straight dividers distinguish them', () => {
  const grid = declarations('.gizmo-work-columns')
  assert.equal(grid.display, 'grid')
  assert.ok(grid['grid-template-columns'])
  const header = css.nodes.find((node) => node.type === 'rule' && node.selector === '.gizmo-work-columns')
  const values = Object.fromEntries(header.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]))
  assert.equal(values.background, 'var(--uppdrag-table-head)')
  assert.equal(values['font-weight'], '600')
  const row = declarations('.uppdrag-scope .gizmo-work-row')
  assert.equal(row['border-bottom'], '1px solid var(--uppdrag-line)')
  const sizing = declarations('.uppdrag-scope .gizmo-workspace .gizmo-work-rows button.gizmo-work-row')
  assert.equal(sizing['border-radius'], '0')
  assert.equal(sizing['min-height'], '60px')
  assert.equal(sizing.height, undefined, 'Long text can increase row height')
  assert.equal(declarations('.gizmo-work-row > strong')['overflow-wrap'], 'anywhere')
})

test('hover, keyboard focus and dialog selection use inset marks without shifting row geometry', () => {
  for (const selector of ['.uppdrag-scope .gizmo-work-row:hover', '.uppdrag-scope .gizmo-work-row:focus-visible', ".uppdrag-scope .gizmo-work-row[aria-expanded='true']"]) {
    const values = declarations(selector)
    assert.ok(values.background)
    assert.match(values['box-shadow'], /^inset 3px 0 /)
    for (const property of ['height', 'min-height', 'padding', 'margin', 'border-width', 'transform']) assert.equal(values[property], undefined)
  }
  assert.equal(declarations(".uppdrag-scope .gizmo-work-row[aria-expanded='true']").background, 'var(--uppdrag-selected)')
})

test('narrow screens retain the header band and stack the action details', () => {
  const responsive = css.nodes.find((node) => node.type === 'atrule' && node.params === '(max-width: 1100px)')
  assert.ok(responsive)
  const rule = (selector) => Object.fromEntries(responsive.nodes.find((node) => node.selector === selector).nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]))
  assert.equal(rule('.gizmo-work-columns')['grid-template-columns'], '1fr')
  assert.equal(rule('.gizmo-work-columns > span:not(:first-child)').display, 'none')
  assert.equal(rule('.gizmo-work-row')['grid-template-columns'], 'minmax(0, 1fr) 20px')
})
