import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { buildTuReportWriterSnapshot, parseTuReportEditorialPlan } from '../src/lib/tu/reportEditorial.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { buildTuReportScopeAddressReview } from '../src/lib/tu/reportScope.ts'

const snapshot = {
  ruleset: 'test',
  reportTemplate: { key: 'moisture_damage_investigation' },
  sourcePolicy: { reportNature: 'observation_driven' },
  scopeAddressReview: {
    status: 'confirmed',
    canonicalAddress: 'Testgatan 1',
    currentScopeText: 'Kontrollen omfattar Testgatan 1 och 3.',
  },
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
      { id: 'observation-relevant', noteText: 'Fläck i innertak.', imageIds: [], reportInclusion: 'include' },
      { id: 'observation-tangent', noteText: 'Taket lades 2010.', imageIds: [], reportInclusion: 'include' },
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
          selectedAnalysisItemIds: [],
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

test('writer snapshot keeps the full source registry while preserving editorial priorities', () => {
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
  const selectedSections = JSON.stringify(writerSnapshot.sections)
  assert.deepEqual(writerSnapshot.sourcePolicy, snapshot.sourcePolicy)
  assert.deepEqual(writerSnapshot.scopeAddressReview, snapshot.scopeAddressReview)
  assert.match(serialized, /Fläck i innertak/)
  assert.match(serialized, /Taket lades 2010/)
  assert.match(serialized, /"reportInclusion":"include"/)
  assert.doesNotMatch(selectedSections, /Testgatan 1/)
  assert.deepEqual(
    writerSnapshot.sections[1]?.prioritySourceIds,
    {
      analysisItemIds: ['assessment-current'],
      observationIds: ['observation-relevant'],
      fieldKeys: [],
    }
  )
})

test('places every report observation in the observations section regardless of assignment focus', () => {
  const observationSnapshot = {
    ...snapshot,
    sections: [
      { id: 'scope', key: 'assignment_scope', title: 'Uppdrag', currentText: '' },
      { id: 'observations', key: 'observed_execution', title: 'Genomförande och iakttagelser', currentText: '' },
      { id: 'assessment', key: 'technical_assessment', title: 'Bedömning', currentText: '' },
    ],
    evidence: {
      ...snapshot.evidence,
      observations: [
        { id: 'attic-moisture', noteText: 'Missfärgning på vinden.', reportInclusion: 'include' },
        { id: 'loose-stair', noteText: 'Ett trappsteg sitter löst.', reportInclusion: 'include' },
        { id: 'internal-note', noteText: 'Intern påminnelse.', reportInclusion: 'internal' },
      ],
    },
  }
  const plan = parseTuReportEditorialPlan({
    snapshot: observationSnapshot,
    value: {
      focus: 'Bedöm fuktförhållandena på vinden.',
      scopeBoundary: 'Fuktförhållanden på vinden.',
      internalWarnings: [],
      sections: [
        {
          sectionId: 'scope',
          include: true,
          purpose: 'Beskriv uppdraget.',
          selectedAnalysisItemIds: [],
          selectedObservationIds: [],
          selectedFieldKeys: ['assignment.scopeDescription'],
          internalWarnings: [],
        },
        {
          sectionId: 'observations',
          include: false,
          purpose: '',
          selectedAnalysisItemIds: [],
          selectedObservationIds: [],
          selectedFieldKeys: [],
          internalWarnings: [],
        },
        {
          sectionId: 'assessment',
          include: true,
          purpose: 'Besvara huvudfrågan.',
          selectedAnalysisItemIds: ['assessment-current'],
          selectedObservationIds: ['attic-moisture', 'loose-stair', 'internal-note'],
          selectedFieldKeys: [],
          internalWarnings: [],
        },
      ],
    },
  })

  assert.equal(plan.sections[1]?.include, true)
  assert.deepEqual(plan.sections[1]?.selectedObservationIds, ['attic-moisture', 'loose-stair'])
  assert.deepEqual(plan.sections[2]?.selectedObservationIds, ['attic-moisture', 'loose-stair'])
})

test('flags a second street number from field evidence instead of silently excluding it', () => {
  const review = buildTuReportScopeAddressReview({
    canonicalAddress: 'Bokbindarvägen 28, Stockholm',
    currentScopeText: 'Kontroll av vinden på Bokbindarvägen 28.',
    observations: [{
      id: 'observation-26',
      location: 'Vind Bokbindarvägen 26',
      noteText: 'Kontrollen fortsatte på den andra vinden på Bokbindarvägen 26.',
    }],
  })

  assert.equal(review.status, 'review_required')
  assert.deepEqual(review.additionalObservedAddresses, [{
    address: 'Bokbindarvägen 26',
    observationIds: ['observation-26'],
  }])
  assert.match(review.instruction, /Sortera inte bort dem/u)
})

test('treats a manually expanded scope as confirmed for the report writer', () => {
  const review = buildTuReportScopeAddressReview({
    canonicalAddress: 'Bokbindarvägen 28, Stockholm',
    currentScopeText: 'Kontrollen omfattar vindarna på Bokbindarvägen 26-28.',
    observations: [{ id: 'observation-26', noteText: 'Bokbindarvägen 26 kontrollerades.' }],
  })

  assert.equal(review.status, 'confirmed')
  assert.match(review.instruction, /Bevara detta som bekräftad omfattning/u)
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
