export const TU_ANALYSIS_BACKGROUND_STATE_VERSION = 1 as const

const TU_IMAGE_BATCH_MIN_OUTPUT_TOKENS = 4_000
const TU_IMAGE_BATCH_MAX_OUTPUT_TOKENS = 12_000
const TU_IMAGE_BATCH_OUTPUT_TOKENS_PER_IMAGE = 1_000

export type TuAnalysisBackgroundStage =
  | 'image_batch_ready'
  | 'image_batch_pending'
  | 'synthesis_pending'
  | 'synthesis_ready'

export type TuAnalysisBackgroundState = {
  version: typeof TU_ANALYSIS_BACKGROUND_STATE_VERSION
  stage: TuAnalysisBackgroundStage
  responseId: string | null
  submittedAt: string | null
  nextImageIndex: number
  batchImageIds: string[]
  imageAnalyses: unknown[]
  analysisDraft: unknown | null
}

export function tuImageBatchMaxOutputTokens(imageCount: number) {
  const normalizedImageCount = Number.isFinite(imageCount)
    ? Math.max(1, Math.floor(imageCount))
    : 1
  return Math.min(
    TU_IMAGE_BATCH_MAX_OUTPUT_TOKENS,
    Math.max(
      TU_IMAGE_BATCH_MIN_OUTPUT_TOKENS,
      normalizedImageCount * TU_IMAGE_BATCH_OUTPUT_TOKENS_PER_IMAGE
    )
  )
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

function snapshotImages(value: unknown, maxImageCount: number) {
  const root = record(value)
  const limit = Number.isFinite(maxImageCount) && maxImageCount > 0
    ? Math.floor(maxImageCount)
    : 0
  return (Array.isArray(root.images) ? root.images : [])
    .slice(0, limit)
    .map(record)
    .map((image) => ({
      id: cleanText(image.id),
      sectionKey: cleanText(image.sectionKey),
      caption: cleanText(image.caption),
      sortOrder: typeof image.sortOrder === 'number' && Number.isFinite(image.sortOrder)
        ? image.sortOrder
        : 0,
      createdAt: cleanText(image.createdAt),
      updatedAt: cleanText(image.updatedAt),
    }))
    .filter((image) => image.id)
}

export function reusableTuImageAnalyses(input: {
  currentSnapshot: unknown
  previousSnapshot: unknown
  previousOutput: unknown
  previousCompletedAt?: unknown
  maxImageCount: number
}) {
  const currentImages = snapshotImages(input.currentSnapshot, input.maxImageCount)
  const previousImages = snapshotImages(input.previousSnapshot, input.maxImageCount)
  const previousCompletedAt = Date.parse(cleanText(input.previousCompletedAt))
  const sameSources = currentImages.length === previousImages.length && currentImages.every((current, index) => {
    const previous = previousImages[index]
    if (!previous) return false
    const sameDescriptor = current.id === previous.id
      && current.sectionKey === previous.sectionKey
      && current.caption === previous.caption
      && current.sortOrder === previous.sortOrder
      && current.createdAt === previous.createdAt
    if (!sameDescriptor) return false
    if (previous.updatedAt) return current.updatedAt === previous.updatedAt

    const currentSourceTime = Date.parse(current.updatedAt || current.createdAt)
    return Number.isFinite(previousCompletedAt)
      && Number.isFinite(currentSourceTime)
      && currentSourceTime <= previousCompletedAt
  })
  if (currentImages.length === 0 || !sameSources) {
    return null
  }

  const output = record(input.previousOutput)
  const analyses = Array.isArray(output.imageAnalyses) ? output.imageAnalyses : []
  const analysisByImageId = new Map(
    analyses
      .map((analysis) => [cleanText(record(analysis).imageId), analysis] as const)
      .filter(([imageId]) => imageId)
  )
  if (currentImages.some((image) => !analysisByImageId.has(image.id))) return null
  return currentImages.map((image) => analysisByImageId.get(image.id) as unknown)
}

function isStage(value: unknown): value is TuAnalysisBackgroundStage {
  return value === 'image_batch_ready'
    || value === 'image_batch_pending'
    || value === 'synthesis_pending'
    || value === 'synthesis_ready'
}

export function parseTuAnalysisBackgroundState(value: unknown): TuAnalysisBackgroundState | null {
  const root = record(value)
  const state = record(root.backgroundJob)
  if (state.version !== TU_ANALYSIS_BACKGROUND_STATE_VERSION || !isStage(state.stage)) return null

  const responseId = cleanText(state.responseId) || null
  const submittedAt = cleanText(state.submittedAt) || null
  const pending = state.stage === 'image_batch_pending' || state.stage === 'synthesis_pending'
  if (pending && (!responseId || !/^resp_[A-Za-z0-9_-]{8,200}$/u.test(responseId) || !submittedAt)) {
    return null
  }

  return {
    version: TU_ANALYSIS_BACKGROUND_STATE_VERSION,
    stage: state.stage,
    responseId,
    submittedAt,
    nextImageIndex: Number.isSafeInteger(state.nextImageIndex) && Number(state.nextImageIndex) >= 0
      ? Number(state.nextImageIndex)
      : 0,
    batchImageIds: Array.isArray(state.batchImageIds)
      ? state.batchImageIds.map(cleanText).filter(Boolean)
      : [],
    imageAnalyses: Array.isArray(state.imageAnalyses) ? state.imageAnalyses : [],
    analysisDraft: state.analysisDraft ?? null,
  }
}

export function tuAnalysisBackgroundPayload(
  state: Omit<TuAnalysisBackgroundState, 'version'>
) {
  return {
    backgroundJob: {
      version: TU_ANALYSIS_BACKGROUND_STATE_VERSION,
      ...state,
    },
  }
}

const SAFE_ANALYSIS_FAILURE_MESSAGES = new Set([
  'AI-svaret blev för långt och kunde inte färdigställas. Försök igen.',
  'AI-svaret stoppades av innehållskontrollen. Försök igen eller justera underlaget.',
  'AI-tjänsten kunde inte färdigställa utlåtandet. Försök igen.',
  'AI-körningen tog för lång tid. Försök igen.',
])

export function tuAnalysisFailureMessage(value: unknown) {
  const code = value instanceof Error ? value.message : cleanText(value)
  if (code === 'OPENAI_ANALYSIS_MISSING_CURRENT_ASSESSMENT') {
    return 'AI:n kunde inte skapa en tydlig samlad bedömning. Försök igen.'
  }
  if (code === 'OPENAI_ANALYSIS_UNGROUNDED_CURRENT_ASSESSMENT') {
    return 'AI:n kunde inte koppla den samlade bedömningen till underlaget. Försök igen.'
  }
  if (code === 'OPENAI_EMPTY_RESPONSE' || code === 'OPENAI_INCOMPLETE_RESPONSE') {
    return 'AI-svaret blev ofullständigt. Försök igen.'
  }
  if (code === 'OPENAI_RESPONSE_NOT_FOUND') {
    return 'AI-körningen kunde inte återupptas. Försök igen.'
  }
  if (code === 'OPENAI_REQUEST_TIMEOUT') {
    return 'AI-körningen kunde inte startas inom tidsgränsen. Försök igen.'
  }
  if (code === 'OPENAI_API_KEY_MISSING') {
    return 'AI-funktionen är inte tillgänglig just nu. Kontakta systemadministratören.'
  }
  if (SAFE_ANALYSIS_FAILURE_MESSAGES.has(code)) return code
  return 'Utlåtandet kunde inte förberedas just nu. Försök igen.'
}
