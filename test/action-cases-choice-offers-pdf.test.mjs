import test from 'node:test'
import assert from 'node:assert/strict'
import { renderChoiceOfferPdf } from '../src/lib/action-cases/choiceOfferPdf.ts'
import { choiceOfferForEditing } from '../src/lib/action-cases/choiceOffer.ts'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
test('shared renderer creates a printable choice PDF without modifying its saved inputs', async () => {
  const item = { id: id(1), title: 'Fiktivt fönsteralternativ', scope: 'Leverans och montage av fönster.', budgetOre: 125000, status: 'planned', decisionBy: '' }
  item.offer = choiceOfferForEditing(item)
  const input = { item, category: 'Fönster', specification: 'Vit kulör.', propertyAddress: 'Testgatan 1', issuer: 'Exempelbygg AB', reference: 'TEST-v1', date: '2026-10-22', files: ['Fiktiv leverantörsoffert.pdf'] }
  const before = JSON.stringify(input), bytes = await renderChoiceOfferPdf(input)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(bytes.length > 8000)
  assert.equal(JSON.stringify(input), before)
})
