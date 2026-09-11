import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { parseTuAnalysisBackgroundState, tuAnalysisBackgroundPayload, tuAnalysisFailureMessage, tuImageBatchMaxOutputTokens } from '../src/lib/tu/analysisBackground.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { shouldRejectGeneratedAnalysisItem } from '../src/lib/tu/analysis.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { normalizeTuOrdererRole } from '../src/lib/tu/customerRole.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { normalizeTuReportProviderResponse, parseTuReportBackgroundState, tuReportBackgroundPayload, tuReportProviderFailureMessage } from '../src/lib/tu/reportDraftBackground.ts'

test('keeps image-batch progress in a resumable analysis state', () => {
  const payload = tuAnalysisBackgroundPayload({
    stage: 'image_batch_pending',
    responseId: 'resp_imagebatch1',
    submittedAt: '2026-09-09T15:00:00.000Z',
    nextImageIndex: 8,
    batchImageIds: ['image-1', 'image-2'],
    imageAnalyses: [{ imageId: 'image-0' }],
    analysisDraft: null,
  })

  assert.deepEqual(parseTuAnalysisBackgroundState(payload), {
    version: 1,
    stage: 'image_batch_pending',
    responseId: 'resp_imagebatch1',
    submittedAt: '2026-09-09T15:00:00.000Z',
    nextImageIndex: 8,
    batchImageIds: ['image-1', 'image-2'],
    imageAnalyses: [{ imageId: 'image-0' }],
    analysisDraft: null,
  })
})

test('scales image-analysis output budget with the batch size', () => {
  assert.equal(tuImageBatchMaxOutputTokens(1), 4_000)
  assert.equal(tuImageBatchMaxOutputTokens(4), 4_000)
  assert.equal(tuImageBatchMaxOutputTokens(8), 8_000)
  assert.equal(tuImageBatchMaxOutputTokens(100), 12_000)
  assert.equal(tuImageBatchMaxOutputTokens(Number.NaN), 4_000)
})

test('does not expose technical analysis errors to users', () => {
  assert.equal(
    tuAnalysisFailureMessage(new Error('Unterminated string in JSON at position 4955')),
    'Utlåtandet kunde inte förberedas just nu. Försök igen.'
  )
  assert.equal(
    tuAnalysisFailureMessage(new Error('OPENAI_INCOMPLETE_RESPONSE')),
    'AI-svaret blev ofullständigt. Försök igen.'
  )
})

test('rejects only incomplete internal conflict markers during automatic approval', () => {
  assert.equal(shouldRejectGeneratedAnalysisItem({
    itemType: 'evidence_conflict',
    earlierSourceObservationIds: ['earlier'],
    laterSourceObservationIds: [],
  }), true)
  assert.equal(shouldRejectGeneratedAnalysisItem({
    itemType: 'evidence_conflict',
    earlierSourceObservationIds: ['earlier'],
    laterSourceObservationIds: ['later'],
  }), false)
  assert.equal(shouldRejectGeneratedAnalysisItem({
    itemType: 'current_assessment',
    earlierSourceObservationIds: [],
    laterSourceObservationIds: [],
  }), false)
})

test('accepts persisted pending report jobs with a valid provider id', () => {
  const payload = tuReportBackgroundPayload({
    stage: 'editorial_pending',
    responseId: 'resp_12345678',
    submittedAt: '2026-09-09T15:00:00.000Z',
    editorialPlan: null,
    generatedReport: null,
  })

  assert.deepEqual(parseTuReportBackgroundState(payload), {
    version: 1,
    stage: 'editorial_pending',
    responseId: 'resp_12345678',
    submittedAt: '2026-09-09T15:00:00.000Z',
    editorialPlan: null,
    generatedReport: null,
  })
})

test('rejects pending report jobs without a retrievable provider id', () => {
  assert.equal(parseTuReportBackgroundState({
    backgroundJob: {
      version: 1,
      stage: 'writer_pending',
      responseId: 'invalid',
      submittedAt: '2026-09-09T15:00:00.000Z',
    },
  }), null)
})

test('normalizes supported provider states and rejects unknown ones', () => {
  assert.deepEqual(normalizeTuReportProviderResponse({
    id: 'resp_abcdefgh',
    status: 'in_progress',
  }), {
    responseId: 'resp_abcdefgh',
    status: 'in_progress',
  })

  assert.throws(
    () => normalizeTuReportProviderResponse({ id: 'resp_abcdefgh', status: 'mystery' }),
    /OPENAI_INVALID_RESPONSE/
  )
})

test('turns provider diagnostics into concise user-facing messages', () => {
  assert.equal(tuReportProviderFailureMessage({
    incomplete_details: { reason: 'max_output_tokens' },
  }), 'AI-svaret blev för långt och kunde inte färdigställas. Försök igen.')

  const message = tuReportProviderFailureMessage({
    error: { code: 'internal_provider_code', message: 'secret diagnostic' },
  })
  assert.equal(message, 'AI-tjänsten kunde inte färdigställa utlåtandet. Försök igen.')
  assert.doesNotMatch(message, /internal_provider_code|secret diagnostic/)
})

test('removes legacy TU object labels without hiding an actual orderer role', () => {
  assert.equal(normalizeTuOrdererRole('Teknisk utredning - Villa'), null)
  assert.equal(normalizeTuOrdererRole('Teknisk utredning – Lägenhet'), null)
  assert.equal(normalizeTuOrdererRole('  Fastighetsägare  '), 'Fastighetsägare')
})
