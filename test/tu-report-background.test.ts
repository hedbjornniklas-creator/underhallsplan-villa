import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { normalizeTuReportProviderResponse, parseTuReportBackgroundState, tuReportBackgroundPayload, tuReportProviderFailureMessage } from '../src/lib/tu/reportDraftBackground.ts'

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
