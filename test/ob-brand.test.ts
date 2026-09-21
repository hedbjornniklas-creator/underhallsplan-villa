import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import test from 'node:test'
import postcss from 'postcss'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const css = postcss.parse(read('src/components/ob/mobile-round.css'))
const tokens = new Map<string, string>()
css.walkDecls(declaration => { if (declaration.prop.startsWith('--obm-')) tokens.set(declaration.prop, declaration.value) })
function luminance(hex: string) {
  const rgb = hex.replace('#', '').match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}
test('OB profile retains blue, readable semantic pairs and an identifiable field border', () => {
  assert.equal(tokens.get('--obm-blue'), '#245eb5')
  for (const [text, background] of [['blue', null], ['hover', null], ['ink', null], ['muted', null],
    ['success', 'success-bg'], ['warning', 'warning-bg'], ['error', 'error-bg'], ['info', 'info-bg']]) {
    assert.ok(contrast(tokens.get(`--obm-${text}`)!, background ? tokens.get(`--obm-${background}`)! : '#ffffff') >= 4.5, `${text} contrast`)
  }
  assert.ok(contrast(tokens.get('--obm-control')!, '#ffffff') >= 3)
})
test('font is local, licensed and isolated; no production preview dependencies', () => {
  assert.equal(tokens.get('--obm-font'), "'OB Manrope', Arial, sans-serif")
  const hash = (path: string) => createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')
  assert.equal(hash('public/ob/brand/manrope.ttf'), hash('public/renoapp/brand/manrope.ttf'))
  assert.match(read('public/ob/brand/OFL.txt'), /SIL OPEN FONT LICENSE/)
  for (const path of ['src/components/ob/ObMobileRound.tsx', 'src/components/ob/ObStepMenu.tsx', 'src/components/ob/ObRoundSheet.tsx']) {
    assert.doesNotMatch(read(path), /test\/fixtures|ob-brand-preview|synthetic-mobile/)
  }
})
test('risk and investigation keep distinct text and style hooks', () => {
  const editor = read('src/components/ob/ObMobileRound.tsx')
  assert.match(editor, /className="obm-risk">Risk/)
  assert.match(editor, /className="obm-investigation">Utredning/)
  assert.match(css.toString(), /\.obm-meta \.obm-investigation\s*\{[^}]*var\(--obm-info\)/)
})
test('step menu allows returning to drafts; leaving the inspection retains its guard', () => {
  const page = read('src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx')
  assert.match(page, /<ObStepMenu sections=\{visibleSections\}/)
  const selection = page.slice(page.indexOf('onSelect={section => {'))
  assert.doesNotMatch(selection, /confirmLeaveIfTextDrafts/)
  assert.match(page, /const handleBackToInspections = useCallback\(\(\) => \{\s*if \(!confirmLeaveIfTextDrafts\(\)\) return/)
  assert.match(page, /if \(section.partId\) setSelectedBuildingId\(section.partId\)/)
  const menu = read('src/components/ob/ObStepMenu.tsx')
  assert.match(menu, /onClick=\{\(\) => onSelect\(section\)\}/)
  assert.match(menu, /aria-current=\{activeIndex === index \? 'step'/)
})
