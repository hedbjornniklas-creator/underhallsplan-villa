import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { ebReviewChildSectionKeys, ebReviewSectionKeys } from '../src/lib/eb/reviewSections.ts'

test('review keeps report order while grouping repeated note and signature controls under their parent sections', () => {
  const sections = [
    'inspection_time', 'summons', 'defects_appendices', 'marker_legend', 'deduction', 'notes',
    'approval_decision', 'warranty_end', 'after_inspection', 'other_notes', 'distribution_list', 'signature_certificate',
  ].map(key => Object.freeze({ key }))
  Object.freeze(sections)
  assert.deepEqual(ebReviewSectionKeys(sections), [
    'inspection_time', 'summons', 'defects_appendices', 'approval_decision', 'other_notes', 'distribution_list',
  ])
  assert.deepEqual(ebReviewChildSectionKeys('defects_appendices', sections), ['marker_legend', 'deduction', 'notes'])
  assert.deepEqual(ebReviewChildSectionKeys('distribution_list', sections), ['signature_certificate'])
  assert.deepEqual(ebReviewChildSectionKeys('summons', sections), [])
  assert.deepEqual(ebReviewChildSectionKeys('defects_appendices', [
    { key: 'notes' }, { key: 'defects_appendices' }, { key: 'deduction' }, { key: 'marker_legend' },
  ]), ['notes', 'deduction', 'marker_legend'])
})

test('legacy reports without a grouping parent retain their otherwise editable sections', () => {
  const sections = [
    { key: 'marker_legend' }, { key: 'scope' }, { key: 'signature_certificate' }, { key: 'notes' }, { key: 'deduction' },
  ]
  assert.deepEqual(ebReviewSectionKeys(sections), sections.map(section => section.key))
  assert.deepEqual(ebReviewSectionKeys([]), [])
  assert.deepEqual(ebReviewChildSectionKeys('distribution_list', []), [])
})

test('excluded report sections remain visible in the editor so their inclusion can be changed again', () => {
  const sections = [
    { key: 'scope', isRelevant: false },
    { key: 'defects_appendices', isRelevant: false },
    { key: 'marker_legend', isRelevant: false },
    { key: 'distribution_list', isRelevant: false },
    { key: 'signature_certificate', isRelevant: false },
  ]
  assert.deepEqual(ebReviewSectionKeys(sections), ['scope', 'defects_appendices', 'distribution_list'])
  assert.deepEqual(ebReviewChildSectionKeys('defects_appendices', sections), ['marker_legend'])
  assert.deepEqual(ebReviewChildSectionKeys('distribution_list', sections), ['signature_certificate'])
  assert.ok(sections.every(section => section.isRelevant === false))
})
