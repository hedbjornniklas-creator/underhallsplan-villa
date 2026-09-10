import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { buildTuAppendixSuggestions, isGenericTuImageCaption } from '../src/lib/tu/imageAppendix.ts'
import type { TuAnalysisItem } from '../src/lib/tu/analysis.ts'

function analysisItem(overrides: Partial<TuAnalysisItem> = {}): TuAnalysisItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    itemType: 'report_image',
    title: 'Missfärgning i tak',
    summary: 'Missfärgning i innertaket vid kontorets norra vägg.',
    certainty: 'confirmed',
    reviewStatus: 'accepted',
    targetSectionId: null,
    includeInReport: true,
    sourceObservationIds: ['observation-1'],
    sourceImageIds: ['image-1'],
    sourceMeasurementIds: [],
    earlierSourceObservationIds: [],
    laterSourceObservationIds: [],
    sourceObservations: [{
      id: 'observation-1',
      sequence: 1,
      observedAt: '2026-09-01T08:00:00Z',
      sourceType: 'field_note',
      location: 'Kontor',
      buildingComponent: 'Innertak',
      text: 'Missfärgning i taket.',
    }],
    supportingReasons: [],
    contradictingReasons: [],
    warnings: [],
    sortOrder: 10,
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-01T08:00:00Z',
    ...overrides,
  }
}

const images = [
  { id: 'image-1', sectionKey: 'bank' as const, caption: 'Bild 1', reportCaption: null },
  { id: 'image-2', sectionKey: 'bank' as const, caption: 'Översikt av kontorets innertak.', reportCaption: null },
  { id: 'image-3', sectionKey: 'cover' as const, caption: 'Fasad', reportCaption: null },
]

test('uses explicit report-image items and keeps AI order and grouping', () => {
  const suggestions = buildTuAppendixSuggestions({
    images,
    items: [
      analysisItem({ id: 'fallback', itemType: 'image_observation', sourceImageIds: ['image-2'], sortOrder: 1 }),
      analysisItem({ id: 'second', sourceImageIds: ['image-2'], summary: 'Översikt av innertaket.', sortOrder: 20 }),
      analysisItem({ id: 'first', sourceImageIds: ['image-1'], sortOrder: 10 }),
    ],
  })

  assert.deepEqual(suggestions.map((suggestion) => suggestion.imageId), ['image-1', 'image-2'])
  assert.equal(suggestions[0]?.caption, 'Missfärgning i innertaket vid kontorets norra vägg.')
  assert.equal(suggestions[0]?.groupLabel, 'Kontor · Innertak')
})

test('falls back to accepted report-relevant image observations', () => {
  const suggestions = buildTuAppendixSuggestions({
    images,
    items: [analysisItem({
      itemType: 'image_observation',
      sourceImageIds: ['image-2'],
      summary: 'AI-sammanfattning som inte ska ersätta en befintlig saklig bildtext.',
    })],
  })

  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0]?.caption, 'Översikt av kontorets innertak.')
})

test('excludes covers, rejected items and duplicate image references', () => {
  const suggestions = buildTuAppendixSuggestions({
    images,
    items: [
      analysisItem({ id: 'cover', sourceImageIds: ['image-3'] }),
      analysisItem({ id: 'rejected', sourceImageIds: ['image-2'], reviewStatus: 'rejected' }),
      analysisItem({ id: 'first', sourceImageIds: ['image-1'] }),
      analysisItem({ id: 'duplicate', sourceImageIds: ['image-1'] }),
    ],
  })

  assert.deepEqual(suggestions.map((suggestion) => suggestion.imageId), ['image-1'])
})

test('recognizes empty and generic captions', () => {
  assert.equal(isGenericTuImageCaption(null), true)
  assert.equal(isGenericTuImageCaption('Foto 3'), true)
  assert.equal(isGenericTuImageCaption('Missfärgning i innertak.'), false)
})
