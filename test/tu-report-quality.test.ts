import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { evaluateTuReportImprovements, evaluateTuReportQuality, isTuSystemGeneratedReportSection } from '../src/lib/tu/reportQuality.ts'
import type { TuObservation } from '../src/lib/tu/evidence.ts'

function observation(overrides: Partial<TuObservation> = {}): TuObservation {
  return {
    id: 'observation-1',
    sourceType: 'measurement',
    location: 'Sovrum, tak',
    buildingComponent: null,
    noteText: '',
    transcriptText: null,
    riskNote: null,
    suggestedFollowUp: null,
    certainty: 'uncertain',
    reviewStatus: 'reviewed',
    targetSectionId: null,
    includeInReport: true,
    imageIds: [],
    measurements: [{
      id: 'measurement-1',
      observationId: 'observation-1',
      location: 'Sovrum, tak',
      measurementType: 'Fuktkvot (FK)',
      valueText: '12',
      unit: '%',
      method: 'Stiftmätning',
      instrument: 'Protimeter',
      note: 'Jämförelse mot dokumenterat gränsvärde; nivån är inte förhöjd.',
      measuredAt: '2026-09-01T08:00:00Z',
      createdAt: '2026-09-01T08:00:00Z',
      updatedAt: '2026-09-01T08:00:00Z',
    }],
    audioStorageBucket: null,
    audioStoragePath: null,
    audioContentType: null,
    audioDurationSeconds: null,
    observedAt: '2026-09-01T08:00:00Z',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-01T08:00:00Z',
    ...overrides,
  }
}

test('accepts a bounded comparative claim with complete measurement context', () => {
  const issues = evaluateTuReportQuality({
    reportText: 'Inga förhöjda fuktvärden noterades i den kontrollerade mätpunkten.',
    observations: [observation()],
    appendixImages: [{ id: 'image-1', caption: 'Missfärgning i sovrummets innertak.' }],
  })
  assert.equal(issues.filter((issue) => issue.severity === 'blocker').length, 0)
})

test('blocks a comparative claim when instrument context is missing', () => {
  const source = observation()
  source.measurements[0] = { ...source.measurements[0], instrument: null, note: null }
  const issues = evaluateTuReportQuality({
    reportText: 'Inga förhöjda fuktvärden noterades.',
    observations: [source],
    appendixImages: [],
  })
  assert.ok(issues.some((issue) => issue.id === 'comparative-moisture-claim-unsupported'))
})

test('warns about generic appendix captions', () => {
  const issues = evaluateTuReportQuality({
    reportText: '',
    observations: [],
    appendixImages: [{ id: 'image-1', caption: 'Bild 1' }],
  })
  assert.ok(issues.some((issue) => issue.id === 'appendix-caption-missing'))
})

test('blocks internal source language in the customer report', () => {
  const issues = evaluateTuReportQuality({
    reportText: 'Den registrerade uppdragsbeskrivningen anger att fläcken ska undersökas.',
    observations: [],
    appendixImages: [],
  })
  assert.ok(issues.some((issue) => issue.id === 'internal-source-language-in-report'))
})

test('blocks an audit-style list of missing measurement metadata', () => {
  const issues = evaluateTuReportQuality({
    reportText: 'För kontrollen redovisas inte instrument, mätmetod, enhet eller jämförelsegrund.',
    observations: [],
    appendixImages: [],
  })
  assert.ok(issues.some((issue) => issue.id === 'measurement-audit-language-in-report'))
})

test('requires the assignment-nature disclaimer for post-damage follow-up reports', () => {
  const issues = evaluateTuReportQuality({
    reportText: 'Uppdraget omfattar en teknisk kontroll av åtkomliga delar.',
    observations: [],
    appendixImages: [],
    reportTemplateKey: 'post_damage_remediation_review',
  })
  assert.ok(issues.some((issue) => issue.id === 'post-damage-assignment-nature-missing'))
})

test('warns when a technical follow-up is described as approved', () => {
  const issues = evaluateTuReportQuality({
    reportText: 'Uppdraget utgör inte en entreprenadbesiktning eller ett godkännande i avtalsrättslig mening. Arbetet är godkänt.',
    observations: [],
    appendixImages: [],
    reportTemplateKey: 'post_damage_remediation_review',
  })
  assert.ok(issues.some((issue) => issue.id === 'post-damage-formal-result-language'))
  assert.ok(!issues.some((issue) => issue.id === 'post-damage-assignment-nature-missing'))
})

test('treats missing measurements as a neutral review question', () => {
  const source = observation({
    sourceType: 'typed',
    noteText: 'En missfärgning noterades i innertaket.',
    measurements: [],
  })
  const review = evaluateTuReportImprovements({
    reportText: 'Uppdraget omfattar missfärgningen och är avgränsat till lokalt åtkomliga delar.',
    observations: [source],
    appendixImages: [{ id: 'image-1', caption: 'Missfärgning i sovrummets innertak.' }],
    qualityIssues: [],
  })
  const measurements = review.categories.find((category) => category.id === 'measurements')
  assert.equal(measurements?.score, null)
  assert.equal(measurements?.applicable, false)
  assert.match(measurements?.summary ?? '', /kan vara korrekt/i)
  assert.ok(measurements?.suggestions.every((suggestion) => !suggestion.requiredBeforeFinalization))
})

test('marks an existing quality blocker as required before finalization', () => {
  const qualityIssues = evaluateTuReportQuality({
    reportText: 'Den registrerade uppdragsbeskrivningen anger vad som ska kontrolleras.',
    observations: [],
    appendixImages: [],
  })
  const review = evaluateTuReportImprovements({
    reportText: 'Den registrerade uppdragsbeskrivningen anger vad som ska kontrolleras.',
    observations: [],
    appendixImages: [],
    qualityIssues,
  })
  const reportText = review.categories.find((category) => category.id === 'report_text')
  assert.ok(reportText?.suggestions.some((suggestion) => suggestion.requiredBeforeFinalization))
  assert.match(review.disclaimer, /bedömer inte juridisk hållbarhet/i)
})

test('does not require editable text in system-generated report sections', () => {
  assert.equal(isTuSystemGeneratedReportSection('signature'), true)
  assert.equal(isTuSystemGeneratedReportSection('assignment_parties'), true)
  assert.equal(isTuSystemGeneratedReportSection('technical_assessment'), false)
})
