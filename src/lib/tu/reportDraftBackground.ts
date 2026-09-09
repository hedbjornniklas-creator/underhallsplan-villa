export const TU_REPORT_BACKGROUND_STATE_VERSION = 1 as const

export type TuReportProviderStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'incomplete'
  | 'cancelled'

export type TuReportBackgroundStage =
  | 'editorial_pending'
  | 'editorial_ready'
  | 'writer_pending'
  | 'writer_ready'

export type TuReportBackgroundState = {
  version: typeof TU_REPORT_BACKGROUND_STATE_VERSION
  stage: TuReportBackgroundStage
  responseId: string | null
  submittedAt: string | null
  editorialPlan: unknown | null
  generatedReport: unknown | null
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isStage(value: unknown): value is TuReportBackgroundStage {
  return value === 'editorial_pending'
    || value === 'editorial_ready'
    || value === 'writer_pending'
    || value === 'writer_ready'
}

export function parseTuReportBackgroundState(value: unknown): TuReportBackgroundState | null {
  const root = record(value)
  const state = record(root.backgroundJob)
  if (state.version !== TU_REPORT_BACKGROUND_STATE_VERSION || !isStage(state.stage)) return null

  const responseId = cleanText(state.responseId) || null
  const submittedAt = cleanText(state.submittedAt) || null
  if (
    (state.stage === 'editorial_pending' || state.stage === 'writer_pending')
    && (!responseId || !/^resp_[A-Za-z0-9_-]{8,200}$/u.test(responseId) || !submittedAt)
  ) return null

  return {
    version: TU_REPORT_BACKGROUND_STATE_VERSION,
    stage: state.stage,
    responseId,
    submittedAt,
    editorialPlan: state.editorialPlan ?? null,
    generatedReport: state.generatedReport ?? null,
  }
}

export function tuReportBackgroundPayload(state: Omit<TuReportBackgroundState, 'version'>) {
  return {
    backgroundJob: {
      version: TU_REPORT_BACKGROUND_STATE_VERSION,
      ...state,
    },
  }
}

export function normalizeTuReportProviderResponse(value: unknown) {
  const payload = record(value)
  const responseId = cleanText(payload.id)
  const status = cleanText(payload.status)
  if (!/^resp_[A-Za-z0-9_-]{8,200}$/u.test(responseId)) {
    throw new Error('OPENAI_INVALID_RESPONSE')
  }
  if (
    status !== 'queued'
    && status !== 'in_progress'
    && status !== 'completed'
    && status !== 'failed'
    && status !== 'incomplete'
    && status !== 'cancelled'
  ) {
    throw new Error('OPENAI_INVALID_RESPONSE')
  }
  return { responseId, status: status as TuReportProviderStatus }
}

export function tuReportProviderFailureMessage(value: unknown) {
  const payload = record(value)
  const incomplete = record(payload.incomplete_details)
  const reason = cleanText(incomplete.reason)
  if (reason === 'max_output_tokens') {
    return 'AI-svaret blev för långt och kunde inte färdigställas. Försök igen.'
  }
  if (reason === 'content_filter') {
    return 'AI-svaret stoppades av innehållskontrollen. Försök igen eller justera underlaget.'
  }
  return 'AI-tjänsten kunde inte färdigställa utlåtandet. Försök igen.'
}
