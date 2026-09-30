import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { parseTuReportCoverageReview } from '../src/lib/tu/reportCoverage.ts'

const writerSnapshot = {
  sourceRegistry: {
    analysisItems: [{ id: 'analysis-1' }],
    observations: [{ id: 'observation-1' }, { id: 'observation-2' }],
    fields: [{ key: 'assignment.scopeDescription' }],
    images: [],
  },
  sections: [
    { section: { id: 'scope' } },
    { section: { id: 'assessment' } },
  ],
}

test('accepts a coverage review only after every source has been reviewed', () => {
  const review = parseTuReportCoverageReview({
    writerSnapshot,
    value: {
      summary: 'Hela källregistret har jämförts med rapporten.',
      reviewedAnalysisItemIds: ['analysis-1'],
      reviewedObservationIds: ['observation-2', 'observation-1'],
      reviewedFieldKeys: ['assignment.scopeDescription'],
      findings: [
        {
          sourceType: 'analysis_item',
          sourceId: 'analysis-1',
          disposition: 'already_covered',
          targetSectionId: 'assessment',
          reason: 'Bedömningen fanns redan i utkastet.',
        },
        {
          sourceType: 'observation',
          sourceId: 'observation-1',
          disposition: 'already_covered',
          targetSectionId: 'assessment',
          reason: 'Observationen fanns redan i utkastet.',
        },
        {
          sourceType: 'observation',
          sourceId: 'observation-2',
          disposition: 'added_to_report',
          targetSectionId: 'assessment',
          reason: 'Observationen var materiell men saknades i första utkastet.',
        },
        {
          sourceType: 'field',
          sourceId: 'assignment.scopeDescription',
          disposition: 'already_covered',
          targetSectionId: 'scope',
          reason: 'Omfattningen fanns redan i rapportdelen.',
        },
      ],
    },
  })

  assert.deepEqual(review.reviewedObservationIds, ['observation-1', 'observation-2'])
  assert.equal(review.findings[2]?.disposition, 'added_to_report')
})

test('rejects a coverage review that silently skips an observation', () => {
  assert.throws(() => parseTuReportCoverageReview({
    writerSnapshot,
    value: {
      summary: 'Granskning klar.',
      reviewedAnalysisItemIds: ['analysis-1'],
      reviewedObservationIds: ['observation-1'],
      reviewedFieldKeys: ['assignment.scopeDescription'],
      findings: [],
    },
  }), /OPENAI_INCOMPLETE_REPORT_COVERAGE/)
})

test('rejects a coverage review that reads every source but omits a source decision', () => {
  assert.throws(() => parseTuReportCoverageReview({
    writerSnapshot,
    value: {
      summary: 'Granskning klar.',
      reviewedAnalysisItemIds: ['analysis-1'],
      reviewedObservationIds: ['observation-1', 'observation-2'],
      reviewedFieldKeys: ['assignment.scopeDescription'],
      findings: [{
        sourceType: 'analysis_item',
        sourceId: 'analysis-1',
        disposition: 'already_covered',
        targetSectionId: 'assessment',
        reason: 'Bedömningen finns i rapporten.',
      }],
    },
  }), /OPENAI_INCOMPLETE_REPORT_COVERAGE/)
})

test('rejects coverage findings that refer to an invented source', () => {
  assert.throws(() => parseTuReportCoverageReview({
    writerSnapshot,
    value: {
      summary: 'Granskning klar.',
      reviewedAnalysisItemIds: ['analysis-1'],
      reviewedObservationIds: ['observation-1', 'observation-2'],
      reviewedFieldKeys: ['assignment.scopeDescription'],
      findings: [{
        sourceType: 'observation',
        sourceId: 'invented-observation',
        disposition: 'needs_user_review',
        targetSectionId: '',
        reason: 'Okänd källa.',
      }],
    },
  }), /OPENAI_INVALID_REPORT_COVERAGE/)
})
