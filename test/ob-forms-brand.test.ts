import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
test('OB form styling remains scoped and uses the existing profile tokens', () => {
  const css = postcss.parse(read('src/components/ob/ob-forms.css'))
  css.walkRules(rule => {
    for (const selector of rule.selectors) assert.match(selector, /^\.ob-form-/, selector)
  })
  css.walkDecls(declaration => assert.ok(!declaration.prop.startsWith('--obm-'), 'Do not fork profile tokens'))
  assert.match(css.toString(), /min-height: 48px/)
  assert.match(css.toString(), /font: inherit/)
  assert.match(css.toString(), /var\(--obm-control\)/)
})
test('form migration keeps snapshots, draft scope and locks rather than importing preview data', () => {
  for (const name of ['ObStepGrunddata', 'ObStepForutsattningar']) {
    const source = read(`src/components/ob/${name}.tsx`)
    assert.match(source, /isInspectionLocked/)
    assert.match(source, /draftKey=/)
    assert.doesNotMatch(source, /test\/fixtures|ob-forms-client|ob-forms-preview/)
  }
  const source = read('src/components/ob/ObStepGrunddata.tsx')
  assert.match(source, /from\('ob_property_snapshot'\)/)
  assert.match(source, /hasFrozenInspectorSnapshot/)
  assert.match(source, /htmlFor=\{id\}/)
  assert.match(read('src/components/ob/ObStepForutsattningar.tsx'), /buildingDraftScope\(inspection.id, building\?\.part\?\.id\)/)
})
test('conditions mount one shared sheet with back navigation and preserve text blur on Escape', () => {
  const source = read('src/components/ob/ObStepForutsattningar.tsx')
  assert.match(source, /<Sheet title=\{panelEntry.label\}/)
  assert.equal(source.split('{panelContent}').length - 1, 1)
  assert.match(source, /document.activeElement.blur\(\)/)
  assert.match(source, /key=\{panelEntry.key\}/)
  assert.match(source, /onSave=\{note => updateSelectionNote/)
})
