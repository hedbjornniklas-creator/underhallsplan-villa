import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { findTuMoistureGroundingRisks, sortTuEvidenceChronologically, validateTuGroundedSections } from '../src/lib/tu/grounding.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { isTuAnalysisSourceImage } from '../src/lib/tu/evidence.ts'

test('excludes cover images from the AI source material', () => {
  assert.equal(isTuAnalysisSourceImage({ sectionKey: 'cover' }), false)
  assert.equal(isTuAnalysisSourceImage({ sectionKey: 'bank' }), true)
  assert.equal(isTuAnalysisSourceImage({ sectionKey: 'appendix' }), true)
})

test('sorts field evidence from oldest to newest', () => {
  const sorted = sortTuEvidenceChronologically([
    { id: 'latest', observedAt: '2026-08-28T14:58:00Z' },
    { id: 'first', observedAt: '2026-08-28T14:54:00Z' },
    { id: 'middle', observedAt: '2026-08-28T14:56:00Z' },
  ])
  assert.deepEqual(sorted.map((item) => item.id), ['first', 'middle', 'latest'])
})

test('leaves a report section empty when every paragraph lacks a source', () => {
  const [section] = validateTuGroundedSections({
    expectedSectionIds: ['scope'],
    generatedSections: [{
      sectionId: 'scope',
      paragraphs: [{
        text: 'Åtkomligheten var tillfredsställande och standardmetoder användes.',
        sourceAnalysisItemIds: [],
        sourceObservationIds: [],
        sourceFieldKeys: [],
        warnings: [],
      }],
      warnings: [],
    }],
    validAnalysisItemIds: new Set(),
    validObservationIds: new Set(),
    validFieldKeys: new Set(),
    analysisSourceTextById: new Map(),
    observationSourceTextById: new Map(),
    fieldSourceTextByKey: new Map(),
    currentAssessmentTexts: [],
  })
  assert.equal(section.text, '')
  assert.equal(section.groundingStatus, 'needs_source')
})

test('blocks fuktfläck when the approved current assessment rejects moisture', () => {
  const risks = findTuMoistureGroundingRisks({
    text: 'Den aktuella fuktfläcken bör övervakas.',
    sourceTexts: ['En fläck noterades i innertaket.'],
    currentAssessmentTexts: ['Missfärgningen bedöms sannolikt inte vara fuktrelaterad.'],
  })
  assert.ok(risks.some((risk) => risk.includes('fuktfläck')))
})

test('blocks an invented standard method even when a real source id was cited', () => {
  const risks = findTuMoistureGroundingRisks({
    text: 'Kontrollen utfördes enligt standardmetoder.',
    sourceTexts: ['En fläck noterades i innertaket.'],
    currentAssessmentTexts: [],
  })
  assert.ok(risks.some((risk) => risk.includes('standardmetod')))
})

test('blocks a comparative moisture claim without complete measurement context', () => {
  const risks = findTuMoistureGroundingRisks({
    text: 'Inga förhöjda fuktvärden noterades i taket.',
    sourceTexts: ['Mätvärde: 12', 'Mättyp: Fuktindikering'],
    currentAssessmentTexts: [],
  })
  assert.ok(risks.some((risk) => risk.includes('komplett mätunderlag')))
})

test('allows a comparative moisture claim with instrument, method and comparison basis', () => {
  const risks = findTuMoistureGroundingRisks({
    text: 'Inga förhöjda fuktvärden noterades i den kontrollerade mätpunkten.',
    sourceTexts: [
      'Mätvärde: 12',
      'Enhet: %',
      'Metod: stiftmätning',
      'Instrument: Protimeter',
      'Mätkommentar: jämförelse mot dokumenterat gränsvärde, utan förhöjd nivå',
    ],
    currentAssessmentTexts: [],
  })
  assert.equal(risks.length, 0)
})

test('keeps a grounded paragraph with valid observation sources', () => {
  const [section] = validateTuGroundedSections({
    expectedSectionIds: ['observations'],
    generatedSections: [{
      sectionId: 'observations',
      paragraphs: [{
        text: 'En missfärgning om cirka 30 x 10 cm noterades i innertaket.',
        sourceAnalysisItemIds: [],
        sourceObservationIds: ['observation-1'],
        sourceFieldKeys: [],
        warnings: [],
      }],
      warnings: [],
    }],
    validAnalysisItemIds: new Set(),
    validObservationIds: new Set(['observation-1']),
    validFieldKeys: new Set(),
    analysisSourceTextById: new Map(),
    observationSourceTextById: new Map([
      ['observation-1', 'En mindre fläck, ungefär 30 gånger 10 centimeter, noterades i taket.'],
    ]),
    fieldSourceTextByKey: new Map(),
    currentAssessmentTexts: ['Missfärgningen bedöms sannolikt inte vara fuktrelaterad.'],
  })
  assert.equal(section.groundingStatus, 'grounded')
  assert.match(section.text, /missfärgning/i)
  assert.deepEqual(section.sourceObservationIds, ['observation-1'])
})

test('blocks an earlier contradictory observation without its approved resolution', () => {
  const [section] = validateTuGroundedSections({
    expectedSectionIds: ['assessment'],
    generatedSections: [{
      sectionId: 'assessment',
      paragraphs: [{
        text: 'Fläcken bedöms vara en fuktskada.',
        sourceAnalysisItemIds: [],
        sourceObservationIds: ['early-observation'],
        sourceFieldKeys: [],
        warnings: [],
      }],
      warnings: [],
    }],
    validAnalysisItemIds: new Set(['current-assessment']),
    validObservationIds: new Set(['early-observation']),
    validFieldKeys: new Set(),
    analysisSourceTextById: new Map([['current-assessment', 'Fläcken bedöms inte vara fuktrelaterad.']]),
    observationSourceTextById: new Map([['early-observation', 'Möjlig fuktfläck noterades initialt.']]),
    fieldSourceTextByKey: new Map(),
    currentAssessmentTexts: ['Fläcken bedöms inte vara fuktrelaterad.'],
    conflictResolutionAnalysisIdsByObservation: new Map([
      ['early-observation', new Set(['current-assessment'])],
    ]),
  })
  assert.equal(section.text, '')
  assert.equal(section.groundingStatus, 'needs_source')
  assert.ok(section.warnings.some((warning) => warning.includes('motsagd fältuppgift')))
})

test('allows chronology when the paragraph cites the approved current assessment', () => {
  const [section] = validateTuGroundedSections({
    expectedSectionIds: ['assessment'],
    generatedSections: [{
      sectionId: 'assessment',
      paragraphs: [{
        text: 'Fläcken bedöms efter fortsatt kontroll sannolikt inte vara fuktrelaterad.',
        sourceAnalysisItemIds: ['current-assessment'],
        sourceObservationIds: ['early-observation'],
        sourceFieldKeys: [],
        warnings: [],
      }],
      warnings: [],
    }],
    validAnalysisItemIds: new Set(['current-assessment']),
    validObservationIds: new Set(['early-observation']),
    validFieldKeys: new Set(),
    analysisSourceTextById: new Map([['current-assessment', 'Fläcken bedöms inte vara fuktrelaterad.']]),
    observationSourceTextById: new Map([['early-observation', 'Möjlig fuktfläck noterades initialt.']]),
    fieldSourceTextByKey: new Map(),
    currentAssessmentTexts: ['Fläcken bedöms inte vara fuktrelaterad.'],
    conflictResolutionAnalysisIdsByObservation: new Map([
      ['early-observation', new Set(['current-assessment'])],
    ]),
  })
  assert.equal(section.groundingStatus, 'grounded')
  assert.match(section.text, /inte vara fuktrelaterad/i)
})
