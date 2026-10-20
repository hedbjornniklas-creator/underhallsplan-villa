import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

const css = readFileSync(new URL('../src/components/eb/eb-overview.css', import.meta.url), 'utf8')
const styles = postcss.parse(css)

test('EB overrides stay module-scoped so the shared OB/TU layout keeps its own brand', () => {
  styles.walkRules(rule => {
    for (const selector of rule.selectors) assert.match(selector.trim(), /^\.eb-/, selector)
  })
})

test('overview accent reuses the established EB report green instead of an OB blue', () => {
  const home = styles.nodes.find(node => node.type === 'rule' && node.selector === '.eb-home')
  assert.ok(home && home.type === 'rule')
  const accent = home.nodes.find(node => node.type === 'decl' && node.prop === '--eb-accent')
  assert.ok(accent && accent.type === 'decl')
  assert.equal(accent.value, '#2f7d55')
  assert.doesNotMatch(css, /#(?:245eb5|1d4890|194b94|edf3fc|f7faff)\b/i)
  const report = readFileSync(new URL('../src/components/eb/EbInspectionReportView.tsx', import.meta.url), 'utf8')
  assert.ok(report.includes(accent.value), 'Use the same green already present in the EB report')
})

test('name links have explicit keyboard focus and touch targets without making the entire row clickable', () => {
  assert.match(css, /\.eb-overview \.eb-name-link\s*\{[^}]*min-height:44px/s)
  assert.match(css, /\.eb-name-link:is\(:hover,:focus-visible\)[^}]*text-decoration:underline/)
  assert.match(css, /\.eb-home :is\(a,button,input,select\):focus-visible[^}]*outline:3px solid var\(--eb-accent\)/)
})
