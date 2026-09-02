import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { buildTuReportWriterSnapshot, parseTuReportEditorialPlan } from '../src/lib/tu/reportEditorial.ts'

const snapshot = {
  ruleset: 'test',
  reportTemplate: { key: 'moisture_damage_investigation' },
  sections: [
    { id: 'scope', title: 'Uppdrag', currentText: '' },
    { id: 'assessment', title: 'Bedömning', currentText: '' },
  ],
  sourceFields: [
    { key: 'assignment.scopeDescription', value: 'Bedöm fläcken i innertaket.' },
    { key: 'object.address', value: 'Testgatan 1' },
  ],
  evidence: {
    observations: [
      { id: 'observation-relevant', noteText: 'Fläck i innertak.', imageIds: [] },
      { id: 'observation-tangent', noteText: 'Taket lades 2010.', imageIds: [] },
    ],
    images: [],
  },
  approvedAnalysis: {
    items: [
      { id: 'assessment-current', item_type: 'current_assessment', summary: 'Ingen fuktindikation noterades.' },
      { id: 'roof-context', item_type: 'party_statement', summary: 'Taket lades 2010.' },
    ],
    resolvedConflicts: [],
  },
}

test('validates and restores the report template section order', () => {
  const plan = parseTuReportEditorialPlan({
    snapshot,
    value: {
      focus: 'Bedöm fläcken i innertaket.',
      scopeBoundary: 'Takets övriga status ingår inte.',
      internalWarnings: [],
      sections: [
        {
          sectionId: 'assessment',
          include: true,
          purpose: 'Besvara huvudfrågan.',
          selectedAnalysisItemIds: ['assessment-current'],
          selectedObservationIds: ['observation-relevant'],
          selectedFieldKeys: [],
          internalWarnings: [],
        },
        {
          sectionId: 'scope',
          include: true,
          purpose: 'Avgränsa uppdraget.',
          selectedAnalysisItemIds: [],
          selectedObservationIds: [],
          selectedFieldKeys: ['assignment.scopeDescription'],
          internalWarnings: [],
        },
      ],
    },
  })
  assert.deepEqual(plan.sections.map((section) => section.sectionId), ['scope', 'assessment'])
})

test('writer snapshot excludes sources rejected by the editorial selection', () => {
  const plan = parseTuReportEditorialPlan({
    snapshot,
    value: {
      focus: 'Bedöm fläcken i innertaket.',
      scopeBoundary: 'Takets övriga status ingår inte.',
      internalWarnings: [],
      sections: [
        {
          sectionId: 'scope',
          include: true,
          purpose: 'Avgränsa uppdraget.',
          selectedAnalysisItemIds: [],
          selectedObservationIds: [],
          selectedFieldKeys: ['assignment.scopeDescription'],
          internalWarnings: [],
        },
        {
          sectionId: 'assessment',
          include: true,
          purpose: 'Besvara huvudfrågan.',
          selectedAnalysisItemIds: ['assessment-current'],
          selectedObservationIds: ['observation-relevant'],
          selectedFieldKeys: [],
          internalWarnings: [],
        },
      ],
    },
  })
  const writerSnapshot = buildTuReportWriterSnapshot({ snapshot, plan })
  const serialized = JSON.stringify(writerSnapshot)
  assert.match(serialized, /Fläck i innertak/)
  assert.doesNotMatch(serialized, /Taket lades 2010/)
  assert.doesNotMatch(serialized, /Testgatan 1/)
})

test('rejects source ids that do not exist in the approved snapshot', () => {
  assert.throws(() => parseTuReportEditorialPlan({
    snapshot,
    value: {
      focus: 'Bedöm fläcken.',
      scopeBoundary: '',
      internalWarnings: [],
      sections: [
        {
          sectionId: 'scope',
          include: true,
          purpose: 'Avgränsa uppdraget.',
          selectedAnalysisItemIds: ['invented-source'],
          selectedObservationIds: [],
          selectedFieldKeys: [],
          internalWarnings: [],
        },
        {
          sectionId: 'assessment',
          include: false,
          purpose: '',
          selectedAnalysisItemIds: [],
          selectedObservationIds: [],
          selectedFieldKeys: [],
          internalWarnings: [],
        },
      ],
    },
  }), /OPENAI_INVALID_REPORT_EDITORIAL_PLAN/)
})
