import assert from 'node:assert/strict'
import test from 'node:test'
import { actionCaseItemCompletion, calculateActionCaseCostTotals, filterActionCasePortalItems } from '../src/lib/action-cases/domain.ts'

test('calculates internal cost and customer price separately', () => {
  assert.deepEqual(calculateActionCaseCostTotals([
    { quantity: 2, unitCost: 100, markupPercent: 25 },
    { quantity: 1.5, unitCost: 200, markupPercent: 10 },
  ]), { internalCost: 500, customerPrice: 580 })
})

test('requires subcontractor pricing only when a subcontractor is used', () => {
  const base = { scope: 'Utför arbetet', ownLaborReady: true, materialPriceReady: true, wasteSolutionReady: true }
  assert.equal(actionCaseItemCompletion({ ...base, requiresSubcontractor: false, subcontractorPriceReady: false }), 100)
  assert.equal(actionCaseItemCompletion({ ...base, requiresSubcontractor: true, subcontractorPriceReady: false }), 80)
  assert.equal(actionCaseItemCompletion({ ...base, requiresSubcontractor: true, subcontractorPriceReady: true }), 100)
})

test('shows a subcontractor only work items connected to granted files', () => {
  const items = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]
  assert.deepEqual(filterActionCasePortalItems('subcontractor', items, ['two', null]), [{ id: 'two' }])
  assert.deepEqual(filterActionCasePortalItems('customer', items, ['two']), items)
})
