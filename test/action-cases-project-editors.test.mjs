import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeScheduleRows, importScheduleRows } from '../src/lib/action-cases/projectSchedule.ts'
import { normalizeLumpSum } from '../src/lib/action-cases/lumpSum.ts'
import { retainNewerDraft } from '../src/lib/action-cases/draftSave.ts'
import { importableCustomerPrice, importOfferItems, scopeNotesDiffer } from '../src/lib/action-cases/offerImport.ts'
import { actionCaseItemCompletion } from '../src/lib/action-cases/domain.ts'
import { isImageAttachment } from '../src/lib/action-cases/attachmentImages.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = { id: id(1), title: 'Grund', phase: 'Mark', startDate: '2027-01-01', endDate: '2027-02-01', status: 'planned', sourceItemId: null }
test('scope-note import copies explicit source notes without replacing edited customer scope or prices', () => {
  const source = { id: id(1), title: 'Grund', scope: 'Arbete', scopeNotesAvailable: true, scopeExclusions: 'Sprängning', scopeAdvice: 'Avråder från utförandet', costLines: [] }
  const imported = importOfferItems([], [source, source], false)
  assert.equal(imported.length, 1)
  assert.equal(imported[0].scopeExclusions, source.scopeExclusions)
  assert.equal(imported[0].scopeAdvice, source.scopeAdvice)
  const edited = { ...imported[0], scope: 'Kundens omfattning', amountOre: 12345 }
  const changed = { ...source, scope: 'Intern ändring', scopeExclusions: '', scopeAdvice: 'Ny avrådan' }
  assert.equal(scopeNotesDiffer(changed, edited), true)
  const result = importOfferItems([edited], [changed], true)[0]
  assert.equal(result.scope, edited.scope); assert.equal(result.amountOre, edited.amountOre)
  assert.equal(result.scopeExclusions, ''); assert.equal(result.scopeAdvice, 'Ny avrådan')
  assert.deepEqual(importOfferItems([edited], [{ ...changed, scopeNotesAvailable: false }], true), [edited])
  assert.equal(edited.scopeAdvice, source.scopeAdvice)
  assert.equal('scopeAdvice' in importOfferItems([], [{ ...source, scopeNotesAvailable: false }], false)[0], false)
})
test('schedule allows incomplete private dates and custom project phases', () => {
  assert.deepEqual(normalizeScheduleRows([row]), [row])
  assert.equal(normalizeScheduleRows([{ ...row, startDate: '', endDate: '', phase: 'Egen etapp' }])[0].phase, 'Egen etapp')
  assert.equal(normalizeScheduleRows([{ ...row, title: '' }]).length, 1)
  assert.throws(() => normalizeScheduleRows([{ ...row, title: '' }], true))
})
test('schedule rejects duplicate IDs, foreign shapes, invalid dates and excessive payloads', () => {
  for (const input of [[row, row], [{}], [null], Array(201).fill(row), [{ ...row, status: 'constructor' }], [{ ...row, endDate: '2026-12-01' }], [{ ...row, startDate: '2027-02-29' }], [{ ...row, startDate: '2027-13-01' }], [{ ...row, sourceItemId: 'other-project' }]]) assert.throws(() => normalizeScheduleRows(input))
  assert.throws(() => normalizeScheduleRows([{ ...row, sourceItemId: id(3) }, { ...row, id: id(2), sourceItemId: id(3) }]))
})
test('importing project moments does not overwrite dates or create repeated sources', () => {
  const existing = { ...row, sourceItemId: id(10) }
  const result = importScheduleRows([existing], [{ id: id(10), title: 'Changed' }, { id: id(11), title: 'Stomme' }], () => id(2))
  assert.equal(result.length, 2); assert.deepEqual(result[0], existing)
  assert.equal(result[1].startDate, ''); assert.equal(result[1].sourceItemId, id(11))
})
test('a late save response cannot overwrite newer typing or a deleted row', () => {
  const submitted = [row], current = [{ ...row, title: 'Nytt' }]
  assert.equal(retainNewerDraft(current, submitted, submitted), current)
  assert.deepEqual(retainNewerDraft([], submitted, submitted), [])
  const normalized = [{ ...row, title: 'Normalized' }]
  assert.equal(retainNewerDraft(submitted, submitted, normalized), normalized)
})
test('lump sum can have a customer price without a fabricated internal cost', () => {
  const lumpSum = normalizeLumpSum({ internalCost: null, customerPrice: 10000, vatRate: 25, verified: true })
  assert.equal(actionCaseItemCompletion({ scope: 'Hela arbetet', lumpSum, costLines: [] }), 100)
  assert.equal(importableCustomerPrice({ lumpSum, costLines: [] }), 1250000)
  assert.equal(importableCustomerPrice({ lumpSum: { ...lumpSum, verified: false }, costLines: [] }), null)
  assert.equal(importableCustomerPrice({ lumpSum, costLines: [{ quantity: 1, unitCost: 900000, verified: true }] }), 1250000)
})
test('invalid lump sums cannot be marked verified or stored', () => {
  const base = { internalCost: null, customerPrice: 10000, vatRate: 25, verified: false }
  for (const patch of [{ customerPrice: -1 }, { customerPrice: Infinity }, { customerPrice: 1.001 }, { customerPrice: null, verified: true }, { vatRate: 11 }, { vatRate: '25' }, { verified: 'yes' }]) assert.throws(() => normalizeLumpSum({ ...base, ...patch }))
  assert.equal(normalizeLumpSum(null), null)
})
test('offer import uses verified selling prices with VAT and excludes covered duplicate lines', () => {
  const line = { quantity: 2, unitCost: 100, markupPercent: 10, vatRate: 25, verified: true }
  assert.equal(importableCustomerPrice({ costLines: [line, { ...line, coveredByQuoteId: id(20) }] }), 27500)
  assert.equal(importableCustomerPrice({ costLines: [{ ...line, verified: false }] }), null)
  assert.equal(importableCustomerPrice({ costLines: [] }), null)
})
test('images can be recognized in old attachments without the correct image flag', () => {
  assert.equal(isImageAttachment({ type: 'document', fileName: 'photo.JPG', contentType: 'application/octet-stream' }), true)
  assert.equal(isImageAttachment({ fileName: 'report.pdf', contentType: 'application/pdf' }), false)
})
