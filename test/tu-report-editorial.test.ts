import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import * as measurementVerification from '../src/lib/tu/measurementVerification.ts'
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

const measurementEvidence = {
  observations: [{
    id: 'observation-measurement', location: 'Vind', imageIds: ['image-1'],
    measurements: [{ id: 'measurement-1', type: 'Fuktindikering', value: '45,1', unit: 'indikationsvärde', method: 'Indikering', instrument: 'Instrument A' }],
  }],
}

function confirmedVerifications() {
  return measurementVerification.deriveTuMeasurementImageVerifications(measurementEvidence,
    [{ imageId: 'image-1', displayReadings: ['95,1'] }])
    .map((reading) => ({ ...reading, resolution: 'recorded_confirmed' }))
}

test('confirmed instrument reading survives editorial selection and is a resolved decision', () => {
  const measurementReview = measurementVerification.buildTuMeasurementReview({
    evidence: measurementEvidence, verifications: confirmedVerifications(),
  })
  assert.equal(measurementReview.confirmedReadings[0].status, 'resolved')
  assert.equal(measurementReview.confirmedReadings[0].recordedValue, '45,1')
  assert.deepEqual(measurementReview.unresolvedMeasurementIds, [])
  const input = { ...snapshot, evidence: measurementEvidence, measurementReview }
  const writer = buildTuReportWriterSnapshot({ snapshot: input, plan: { focus: 'Test', scopeBoundary: '', internalWarnings: [], sections: [] } })
  assert.deepEqual(writer.measurementReview, measurementReview)
})

test('confirmation cannot erase other conflicts or apply to edited values, metadata or photos', () => {
  const verifications = confirmedVerifications()
  const other = { ...verifications[0], measurementId: 'measurement-2', resolution: null }
  assert.deepEqual(measurementVerification.buildTuMeasurementReview({
    evidence: measurementEvidence, verifications: [...verifications, other],
  }).unresolvedMeasurementIds, ['measurement-2'])
  for (const change of [
    { value: '45' }, { type: 'Fuktkvot' }, { instrument: 'Instrument B' }, { method: 'Annan metod' }, { unit: '%' }, { location: 'Kök' },
  ]) {
    const evidence = structuredClone(measurementEvidence)
    Object.assign(evidence.observations[0].measurements[0], change)
    assert.equal(measurementVerification.buildTuMeasurementReview({ evidence, verifications }).confirmedReadings.length, 0)
  }
  const evidence = structuredClone(measurementEvidence)
  evidence.observations[0].imageIds.push('image-2')
  assert.equal(measurementVerification.buildTuMeasurementReview({ evidence, verifications }).confirmedReadings.length, 0)
  assert.equal(measurementVerification.buildTuMeasurementReview({ evidence: measurementEvidence,
    verifications: [{ ...verifications[0], resolution: null }],
  }).confirmedReadings.length, 0)
  assert.equal(measurementVerification.buildTuMeasurementReview({ evidence: {}, verifications }).confirmedReadings.length, 0)
})

test('report snapshot carries confirmation and citable source through all generation stages', async () => {
  const source = readFileSync(new URL('../src/lib/tu/reportDraftServer.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(`${source}\nexport { editorialRequestBody, reportRequestBody, coverageRequestBody };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const measurement = measurementEvidence.observations[0].measurements[0]
  const rows: Record<string, unknown> = {
    tu_analysis_workflows: { status: 'analysis_approved', current_analysis_run_id: 'run-1', analysis_approved_at: '2026-10-02', analysis_stale_at: null },
    tu_ai_runs: { output_payload: { measurementVerifications: confirmedVerifications(), warnings: ['Unrelated limitation'] } },
    tu_ai_analysis_items: [{ id: 'assessment-1', item_type: 'current_assessment' }],
  }
  const db = { from: (table: string) => {
    const query = new Proxy({}, { get: (_, key) => key === 'then'
      ? (resolve: (value: unknown) => void) => resolve({ data: rows[table], error: null })
      : () => query })
    return query
  } }
  const dependencies: Record<string, unknown> = {
    '@/lib/tu/measurementVerification': measurementVerification,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/tu/authoring': { usesTuAiAssistedWorkflow: () => true },
    '@/lib/tu/evidence': { isTuAnalysisSourceImage: () => true },
    '@/lib/tu/evidenceServer': { listTuObservations: async () => [{
      ...measurementEvidence.observations[0], noteText: 'Mätning', measurements: [{ ...measurement, measurementType: measurement.type, valueText: measurement.value }],
    }] },
    '@/lib/tu/server': {
      getTuInvestigationById: async () => ({ reportDraft: { sections: [{ id: 'results', key: 'observed_execution', title: 'Resultat', text: 'Manuellt skriven text' }] } }),
      listTuInvestigationImages: async () => [{ id: 'image-1' }],
    },
    '@/lib/tu/grounding': { sortTuEvidenceChronologically: (value: unknown) => value },
    '@/lib/tu/measurementConfig': { formatTuMeasurementAssessment: () => 'Ej bedömt' },
    '@/lib/tu/reportTemplates': { isTuPostDamageReport: () => false, resolveTuReportSectionPolicy: () => null },
    '@/lib/tu/reportScope': { buildTuReportScopeAddressReview: () => ({}) },
  }
  type Request = { instructions: string; input: unknown }
  const moduleRecord = { exports: {} as {
    buildTuReportSnapshot: typeof import('../src/lib/tu/reportDraftServer').buildTuReportSnapshot
    editorialRequestBody: (snapshot: unknown) => Request
    reportRequestBody: (snapshot: unknown) => Request
    coverageRequestBody: (input: unknown) => Request
  } }
  new Function('require', 'module', 'exports', code)((id: string) => dependencies[id] ?? {}, moduleRecord, moduleRecord.exports)
  const built = await moduleRecord.exports.buildTuReportSnapshot({ orgId: 'org-1', inspectionId: 'inspection-1' })
  assert.equal(built.snapshot.measurementReview.confirmedReadings.length, 1)
  assert.equal(built.snapshot.sections[0].currentText, 'Manuellt skriven text')
  const fieldKey = built.snapshot.measurementReview.confirmedReadings[0].sourceFieldKey
  assert.ok(built.snapshot.sourceFields.some((field: { key: string; sourceRole: string }) => field.key === fieldKey && field.sourceRole === 'current_evidence'))
  const writer = buildTuReportWriterSnapshot({ snapshot: built.snapshot, plan: { focus: 'Test', scopeBoundary: '', internalWarnings: [], sections: [] } })
  for (const request of [
    moduleRecord.exports.editorialRequestBody(built.snapshot), moduleRecord.exports.reportRequestBody(writer),
    moduleRecord.exports.coverageRequestBody({ writerSnapshot: writer, generated: { sections: [] } }),
  ]) {
    assert.ok(request.instructions.includes(measurementVerification.TU_MEASUREMENT_REVIEW_INSTRUCTION))
    assert.ok(JSON.stringify(request.input).includes('recorded_confirmed'))
  }
  const reviewSource = readFileSync(new URL('../src/lib/tu/reportReviewServer.ts', import.meta.url), 'utf8')
  assert.match(reviewSource, /instructions: \[\s*TU_MEASUREMENT_REVIEW_INSTRUCTION/)
  assert.match(reviewSource, /const reviewSnapshot = \{\s*\.\.\.snapshot/)
})

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
