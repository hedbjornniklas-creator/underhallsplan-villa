import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node test runner uses explicit extensions.
import { buildReportSpec } from '../src/lib/report/reportSpec.ts'
// @ts-expect-error Node test runner uses explicit extensions.
import { readInspectionReportNote } from '../src/lib/report/inspectionNoteText.ts'
// @ts-expect-error Node test runner uses explicit extensions.
import { buildReportPdfFileName } from '../src/lib/report/reportFileName.ts'

test('status note supplements never inherit risk or FTU, including older saved data', () => {
  const stored = { note: 'Tätskiktsanslutningen kunde inte verifieras.',
    risk_text: 'Sparad ÖB-risk', ftu_text: 'Sparad ÖB-FTU',
    recommendation_text: 'Kontrollera dokumentationen.', comment_text: 'Endast duschutrymmet ingår.' }
  assert.deepEqual(readInspectionReportNote(stored, true), {
    note: stored.note, risk_text: '', ftu_text: '',
    recommendationText: stored.recommendation_text, commentText: stored.comment_text,
  })
  assert.deepEqual(readInspectionReportNote({ note: 'Notering', risk_text: 'Risk', ftu_text: 'FTU' }, true), {
    note: 'Notering', risk_text: '', ftu_text: '', recommendationText: '', commentText: '',
  })
  assert.deepEqual(readInspectionReportNote(stored), {
    note: stored.note, risk_text: stored.risk_text, ftu_text: stored.ftu_text,
  })
})

test('status report selects its own frozen texts and appendix without OB duty or FTU notice', () => {
  const legacy = ['buyer', 'seller', 'apartment'].map(inspectionSide =>
    buildReportSpec({ inspectionSide: inspectionSide as 'buyer' | 'seller' | 'apartment' }))
  const spec = buildReportSpec({ layoutVersion: 2, inspectionSide: 'status', dynamicAppendices: {
    includeAreaMeasurement: true, includeMoistureControl: true,
    buildings: [{ id: 'garage', name: 'Garage' }], environmental: [{ kind: 'radon', title: 'Radon' }],
  } })
  const appendix = spec.find(section => section.id === 'appendix-1')!
  assert.equal(appendix.appendixId, 'APPENDIX_1_VILLKOR_STATUS_SBR')
  assert.equal(appendix.appendixTextPath, 'mock.status_report.terms')
  assert.ok(spec.find(section => section.id === 'assignment')!.blocks.some(block =>
    block.type === 'text' && block.source.kind === 'mock' && block.source.path === 'mock.status_report.assignmentNotice'))
  assert.ok(spec.find(section => section.id === 'appendix-2-area-measurement'))
  assert.ok(spec.find(section => section.id === 'appendix-3-moisture-control'))
  assert.equal(spec.find(section => section.id === 'appendix-environmental-radon')!.title, 'Bilaga 4: Radon')
  assert.doesNotMatch(JSON.stringify(spec), /STD_FTU_GENERAL_NOTICE|STD_ASSIGNMENT_BUYER_NOTICE|STD_ASSIGNMENT_SELLER_NOTICE|STD_ASSIGNMENT_APARTMENT_NOTICE|Tilläggsuppdrag i samband med överlåtelsebesiktning\./)
  assert.deepEqual(spec.filter(section => section.type === 'appendix').map(section => section.id), ['appendix-1'])
  for (const [index, inspectionSide] of (['buyer', 'seller', 'apartment'] as const).entries()) {
    assert.deepEqual(buildReportSpec({ inspectionSide }), legacy[index])
  }
})

test('status filenames identify the frozen status report and keep other module names intact', () => {
  assert.equal(buildReportPdfFileName({ inspectionFamily: 'OB', inspectionSide: 'status', assignmentNumber: '2026-1002-01' }), 'Utlåtande STB 2026-1002-01.pdf')
  assert.equal(buildReportPdfFileName({ inspectionFamily: 'OB', assignmentNumber: '2026-1002-01' }), 'Utlåtande ÖB 2026-1002-01.pdf')
  assert.equal(buildReportPdfFileName({ inspectionFamily: 'EB', inspectionDate: '2026-10-02', inspectionSequenceNo: 1 }), 'Utlåtande EB 2026-1002-01.pdf')
})

test('status apartment identity does not change the status assignment or original terms', () => {
  const spec = buildReportSpec({ layoutVersion: 2, inspectionSide: 'status', objectType: 'apartment' })
  const assignment = spec.find(section => section.id === 'assignment')!
  const objectRows = assignment.blocks.find(block => block.type === 'twoColumn' &&
    block.rows.some(row => row.label === 'Bostadsrättsförening:'))!
  assert.equal(objectRows.type, 'twoColumn')
  if (objectRows.type !== 'twoColumn') throw new Error('Missing apartment object rows')
  assert.deepEqual(objectRows.rows.map(row => row.label), [
    'Bostadsrättsförening:', 'Lägenhetsnummer:', 'Adress:', 'Kommun:', 'Lägenhetsinnehavare:',
  ])
  assert.equal(objectRows.rows[0].hideWhenEmpty, true, 'BRF is not compulsory for rental apartments')
  assert.ok(assignment.blocks.some(block => block.type === 'text' && block.source.kind === 'mock' &&
    block.source.path === 'mock.status_report.assignmentNotice'), 'the assignment still uses the frozen status text')
  const appendix = spec.find(section => section.id === 'appendix-1')!
  assert.equal(appendix.appendixId, 'APPENDIX_1_VILLKOR_STATUS_SBR')
  assert.equal(appendix.appendixTextPath, 'mock.status_report.terms')
  assert.doesNotMatch(JSON.stringify(spec), /STD_ASSIGNMENT_APARTMENT_NOTICE|APPENDIX_1_VILLKOR_APARTMENT_SBR|STD_FTU_GENERAL_NOTICE/)
  assert.deepEqual(buildReportSpec({ inspectionSide: 'status' }), buildReportSpec({ inspectionSide: 'status', objectType: 'property' }), 'legacy status defaults to property')
  for (const inspectionSide of ['buyer', 'seller', 'apartment'] as const) {
    assert.deepEqual(buildReportSpec({ inspectionSide, objectType: inspectionSide === 'apartment' ? 'property' : 'apartment' }),
      buildReportSpec({ inspectionSide }), `independent status field cannot reinterpret ${inspectionSide}`)
  }
})
