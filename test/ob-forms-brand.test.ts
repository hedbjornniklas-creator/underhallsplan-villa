import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
test('OB form styling remains scoped and uses the existing profile tokens', () => {
  const css = postcss.parse(read('src/components/ob/ob-forms.css'))
  css.walkRules(rule => {
    for (const selector of rule.selectors) assert.match(selector, /^\.(?:ob-form-|ob-property-|ob-building-overview-compact(?:\s|$))/, selector)
  })
  css.walkDecls(declaration => assert.ok(!declaration.prop.startsWith('--obm-'), 'Do not fork profile tokens'))
  assert.match(css.toString(), /min-height: 48px/)
  assert.match(css.toString(), /font: inherit/)
  assert.match(css.toString(), /var\(--obm-control\)/)
})

test('compact property workspace is opt-in and leaves the review inspector display intact', () => {
  const source = read('src/components/ob/ObStepGrunddata.tsx')
  assert.match(source, /workspace = false/)
  assert.match(source, /workspace && <ObBuildingOverview locked=\{isInspectionLocked\} compact/)
  assert.match(source, /const inspectorSection = \(/)
  assert.match(source, /\{inspectorSection\}/)
  assert.match(read('src/components/ob/ObWizard.tsx'), /<ObStepGrunddata\s+workspace/)
  assert.doesNotMatch(read('src/components/ob/ObStepGranska.tsx'), /<ObStepGrunddata[^>]*\bworkspace/)
  const styles = read('src/components/ob/ob-forms.css')
  assert.match(styles, /@media \(min-width: 768px\) and \(pointer: fine\)/)
  assert.match(styles, /@container ob-property \(min-width: 64rem\)/)
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

test('background save feedback reserves its geometry on all three OB forms', () => {
  const indicator = read('src/components/ob/ObFormSaveStatus.tsx')
  assert.match(indicator, /h-6 w-20 shrink-0 whitespace-nowrap/)
  assert.match(indicator, /role="status"/)
  assert.doesNotMatch(indicator, /return null|setTimeout|useToast/)
  for (const name of ['ObStepHandlingar', 'ObStepForutsattningar', 'ObStepGrunddata']) {
    const source = read(`src/components/ob/${name}.tsx`)
    assert.match(source, /<ObFormSaveStatus saving=/)
    assert.doesNotMatch(source, /saving\w* && <(?:p|span|div)/)
  }
  const documents = read('src/components/ob/ObStepHandlingar.tsx')
  assert.doesNotMatch(documents, /savedDisclosure|savedDefect|setTimeout/)
  const drafts = read('src/components/ob/ObLocalDraftStatus.tsx')
  assert.doesNotMatch(drafts, /if \(!entries.length.*return null/)
  assert.match(drafts, /Visa lokala textutkast/)
})

test('building cover is opened through the shared conditions panel, not displayed above the list', () => {
  const source = read('src/components/ob/ObStepForutsattningar.tsx')
  assert.match(source, /key: BUILDING_COVER_PANEL_KEY/)
  assert.match(source, /useState<string \| null>\(null\)/)
  assert.match(source, /panelEntry.key === BUILDING_COVER_PANEL_KEY/)
  assert.match(source, /locked=\{isInspectionLocked\} embedded/)
  const panelLayout = source.slice(source.indexOf('if (usePanelLayout)'))
  const list = panelLayout.slice(panelLayout.indexOf('return ('), panelLayout.indexOf('{panelContent}'))
  assert.doesNotMatch(list, /<ObBuildingCover/)
})
