import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { costingHelpTopics } from '../src/lib/action-cases/costingHelp.ts'
import { normalizeCostLine } from '../src/lib/action-cases/costing.ts'
import { actionCaseCostCoverage, calculateActionCaseCostTotals } from '../src/lib/action-cases/domain.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const sheet = read('src/components/tasks/ActionCaseItemSheet.tsx')
const help = read('src/components/tasks/ActionCaseCostHelp.tsx')
const line = (patch = {}) => ({ quantity: 10, unitCost: 500, markupPercent: 20, verified: false, ...patch })

test('manual covers the existing calculator with unique navigable chapters and useful content', () => {
  assert.equal(costingHelpTopics.length, 13)
  assert.equal(new Set(costingHelpTopics.map(topic => topic.id)).size, costingHelpTopics.length)
  for (const topic of costingHelpTopics) {
    assert.match(topic.id, /^[a-z]+$/)
    assert.ok(topic.title.length > 5)
    assert.ok(topic.paragraphs.join(' ').length > 150)
  }
  assert.equal(costingHelpTopics[0].steps.length, 4)
  const content = costingHelpTopics.flatMap(topic => topic.paragraphs).join(' ')
  for (const term of ['exklusive moms', 'inte samma sak som marginal', 'Spara rad', 'Klar', 'Markera rader', 'Priskälla', 'Samlat pris', 'Preliminär summa', 'inte en beställning', 'låsta avtalsversioner', 'Beställningslista', 'Listan sparas inte']) assert.ok(content.includes(term), term)
})

test('the manual arithmetic agrees with calculation and a free product is not an unknown price', () => {
  assert.deepEqual(calculateActionCaseCostTotals([line()]), { internalCost: 5000, customerPrice: 6000 })
  const free = normalizeCostLine({ category: 'material', description: 'Befintligt material', unit: 'st', quantity: 1, unitCost: 0, markupPercent: 20 })
  assert.equal(free.unitCost, 0)
  assert.deepEqual(calculateActionCaseCostTotals([free]), { internalCost: 0, customerPrice: 0 })
  assert.deepEqual(calculateActionCaseCostTotals([line(), free]), { internalCost: 5000, customerPrice: 6000 })
  assert.equal(actionCaseCostCoverage([free]).missingPrice, 0)
  assert.equal(actionCaseCostCoverage([line({ unitCost: null })]).missingPrice, 1)
})

test('partial display can use known totals without changing real totals, completion or agreement imports', () => {
  const input = [line(), line({ quantity: null, unitCost: 0 }), line({ unitCost: null }), line({ quantity: 1, unitCost: 0 })]
  const before = JSON.stringify(input), coverage = actionCaseCostCoverage(input)
  assert.deepEqual(calculateActionCaseCostTotals(input), { internalCost: null, customerPrice: null })
  assert.deepEqual(coverage.knownTotals, { internalCost: 5000, customerPrice: 6000 })
  assert.equal(coverage.missingQuantity, 1)
  assert.equal(coverage.missingPrice, 1)
  assert.equal(coverage.complete, false)
  assert.equal(JSON.stringify(input), before)
  assert.match(sheet, /const displayedTotals = incomplete \? \{ internalCost: coverage\.knownTotals\.internalCost \?\? 0, customerPrice: coverage\.knownTotals\.customerPrice \?\? 0 \} : totals/)
  assert.match(sheet, /Preliminär summa hela åtgärden/)
  assert.match(sheet, /Ofullständig kalkyl/)
  assert.match(sheet, /Inga rader kan räknas ut ännu/)
  assert.match(sheet, /aria-describedby=\{incomplete/)
  assert.match(sheet, /amount\(displayedTotals\.customerPrice\)/)
})

test('manual is available beside Add row and for lump sums, including during an unfinished edit', () => {
  assert.equal((sheet.match(/<ActionCaseCostHelp \/>/g) ?? []).length, 2)
  assert.match(sheet, /Lägg till rad<\/button>\s*<ActionCaseCostHelp \/>/)
  assert.match(sheet, /item\.lumpSum && <div className="gizmo-cost-toolbar"/)
  assert.match(help, /aria-label="Hjälp om kalkylen"/)
  assert.match(help, /aria-haspopup="dialog"/)
  assert.doesNotMatch(help, /disabled=|fetch\(|onCostAction|localStorage|sessionStorage/)
})

test('native help modal traps focus, restores the opener and handles Escape without closing the action sheet', () => {
  assert.match(help, /<dialog ref=\{dialog\}/)
  assert.match(help, /node\?\.showModal\(\)/)
  assert.match(help, /heading\.current\?\.focus\(\)/)
  assert.match(help, /previous\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(help, /onKeyDown=\{event => event\.stopPropagation\(\)\}/)
  assert.match(help, /onCancel=\{event => \{ event\.preventDefault\(\); event\.stopPropagation\(\); onClose\(\) \}\}/)
  assert.match(help, /aria-label="Stäng kalkylhjälpen"/)
})

test('saving a new pricing method clears its local edit lock after the editor unmounts', () => {
  assert.match(sheet, /if \(saved\) \{ setSelectedLineIds\(\[\]\); setLumpDirty\(false\) \} return saved/)
})

test('cost fields and table identify VAT treatment and distinguish price markup from VAT', () => {
  for (const text of ['Kostnad/enhet exkl. moms (kr)', 'Prispåslag på kostnaden, %', 'inte moms.', 'Kostnad exkl. moms', 'Kundpris exkl. moms']) assert.ok(sheet.includes(text), text)
  assert.match(read('src/components/tasks/ActionCaseDirectCostFields.tsx'), /Timkostnad exkl\. moms \(kr\)/)
  assert.match(read('src/components/tasks/ActionCaseWorkParts.tsx'), /Timkostnad för valda exkl\. moms \(kr\)/)
  assert.match(read('src/components/tasks/ActionCaseWorkQuotes.tsx'), /Prispåslag, % \(inte moms\)/)
  assert.match(read('src/components/tasks/action-case-costs.css'), /\.uppdrag-scope \.gizmo-cost-help-dialog/)
})
