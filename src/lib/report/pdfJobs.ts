import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import { createInternalReportRenderHeaders } from '@/lib/report/internalRenderAuth'
import {
  getPdfRenderDiagnostics,
  REPORT_PDF_RENDER_TIMEOUT_MAX_MS,
  renderPreviewPdf,
} from '@/lib/report/pdfV2/renderPreviewPdf'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

const REPORT_PDF_STORAGE_BUCKET =
  process.env.REPORT_PDF_STORAGE_BUCKET?.trim() || 'inspection-reports'
const PDF_RENDER_TIMEOUT_MS = readIntegerEnv(
  'REPORT_PDF_RENDER_TIMEOUT_MS',
  60_000,
  10_000,
  REPORT_PDF_RENDER_TIMEOUT_MAX_MS
)
const PDF_JOB_STALE_AFTER_MINUTES = readIntegerEnv(
  'REPORT_PDF_STALE_AFTER_MINUTES',
  10,
  6,
  24 * 60
)
const LEGACY_MAX_ATTEMPTS = readIntegerEnv('REPORT_PDF_MAX_ATTEMPTS', 3, 1, 20)
const LEGACY_PENDING_GRACE_MS = readIntegerEnv(
  'REPORT_PDF_PENDING_GRACE_MS',
  90_000,
  10_000,
  10 * 60_000
)

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed'

type ClaimedPdfJob = {
  id: string
  orgId: string
  inspectionId: string
  attempts: number
  maxAttempts: number
  workerId: string
  claimMode: 'rpc' | 'legacy'
  startedAt: string | null
}

type PdfJobOutcome = {
  linkId: string
  status: 'ready' | 'retry_scheduled' | 'failed' | 'claim_lost'
  attempts: number
}

export type ReportPdfBatchResult = {
  claimed: number
  ready: number
  retryScheduled: number
  failed: number
  claimLost: number
  outcomes: PdfJobOutcome[]
}

function readIntegerEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim()
  const parsed = raw ? Number(raw) : fallback
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeInteger(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback
}

function normalizePdfStatus(value: unknown): PdfStatus {
  const status = normalizeText(value).toLowerCase()
  if (status === 'processing') return 'processing'
  if (status === 'ready') return 'ready'
  if (status === 'failed') return 'failed'
  return 'pending'
}

function parseClaimedJob(value: unknown, workerId: string): ClaimedPdfJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = normalizeText(row.id)
  const orgId = normalizeText(row.org_id)
  const inspectionId = normalizeText(row.inspection_id)
  if (!id || !orgId || !inspectionId) return null

  return {
    id,
    orgId,
    inspectionId,
    attempts: normalizeInteger(row.pdf_attempts),
    maxAttempts: Math.max(1, normalizeInteger(row.pdf_max_attempts, LEGACY_MAX_ATTEMPTS)),
    workerId,
    claimMode: 'rpc',
    startedAt: null,
  }
}

function isMissingQueueRpc(error: unknown) {
  const row = error as { code?: unknown; message?: unknown; details?: unknown } | null
  const code = normalizeText(row?.code).toUpperCase()
  const message = `${normalizeText(row?.message)} ${normalizeText(row?.details)}`.toLowerCase()
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    message.includes('claim_inspection_report_pdf_jobs') ||
    message.includes('could not find the function')
  )
}

function truncateError(value: unknown, maxLength = 1200) {
  const message = value instanceof Error ? value.message : String(value ?? 'Okänt PDF-fel.')
  return message.length <= maxLength ? message : `${message.slice(0, maxLength - 3)}...`
}

function retryDelayMs(attempts: number) {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1))
}

function timestamp(value: unknown) {
  const parsed = Date.parse(normalizeText(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function isLegacyCandidate(
  row: Record<string, unknown>,
  input: { now: number; specificLink: boolean }
) {
  const status = normalizePdfStatus(row.pdf_status)
  const attempts = normalizeInteger(row.pdf_attempts)
  if (status === 'ready') return false

  const startedAt = timestamp(row.pdf_started_at)
  const createdAt = timestamp(row.created_at)
  if (status === 'processing') {
    const claimAt = startedAt || createdAt
    return claimAt > 0 && input.now - claimAt >= PDF_JOB_STALE_AFTER_MINUTES * 60_000
  }

  if (attempts >= LEGACY_MAX_ATTEMPTS) return false
  if (input.specificLink && status === 'pending' && attempts === 0) return true
  const lastAttemptAt = startedAt || createdAt
  const requiredDelay = attempts > 0 ? retryDelayMs(attempts) : LEGACY_PENDING_GRACE_MS
  return lastAttemptAt > 0 && input.now - lastAttemptAt >= requiredDelay
}

async function claimLegacyJob(
  admin: AdminClient,
  row: Record<string, unknown>,
  workerId: string
): Promise<ClaimedPdfJob | null> {
  const id = normalizeText(row.id)
  const orgId = normalizeText(row.org_id)
  const inspectionId = normalizeText(row.inspection_id)
  const currentStatus = normalizePdfStatus(row.pdf_status)
  const currentAttempts = normalizeInteger(row.pdf_attempts)
  if (!id || !orgId || !inspectionId) return null

  if (currentStatus === 'processing' && currentAttempts >= LEGACY_MAX_ATTEMPTS) {
    const previousStartedAt = normalizeText(row.pdf_started_at)
    let finalQuery = admin
      .from('inspection_report_links')
      .update({
        pdf_status: 'failed',
        pdf_error: 'REPORT_PDF_STALE_AFTER_FINAL_ATTEMPT',
      })
      .eq('id', id)
      .is('revoked_at', null)
      .eq('pdf_status', 'processing')
      .eq('pdf_attempts', currentAttempts)

    finalQuery = previousStartedAt
      ? finalQuery.eq('pdf_started_at', previousStartedAt)
      : finalQuery.is('pdf_started_at', null)

    const { error } = await finalQuery
    if (error) throw new Error(error.message ?? 'Kunde inte avsluta inaktuellt PDF-jobb.')
    return null
  }

  const startedAt = new Date().toISOString()
  let query = admin
    .from('inspection_report_links')
    .update({
      pdf_status: 'processing',
      pdf_error: null,
      pdf_attempts: currentAttempts + 1,
      pdf_started_at: startedAt,
    })
    .eq('id', id)
    .is('revoked_at', null)
    .eq('pdf_status', currentStatus)
    .eq('pdf_attempts', currentAttempts)

  if (currentStatus === 'processing') {
    const previousStartedAt = normalizeText(row.pdf_started_at)
    query = previousStartedAt
      ? query.eq('pdf_started_at', previousStartedAt)
      : query.is('pdf_started_at', null)
  }

  const { data, error } = await query
    .select('id,org_id,inspection_id,pdf_attempts,pdf_started_at')
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte reservera PDF-jobbet.')
  if (!data) return null

  return {
    id,
    orgId,
    inspectionId,
    attempts: currentAttempts + 1,
    maxAttempts: LEGACY_MAX_ATTEMPTS,
    workerId,
    claimMode: 'legacy',
    startedAt,
  }
}

async function claimLegacyJobs(input: {
  admin: AdminClient
  workerId: string
  limit: number
  linkId?: string | null
}) {
  let query = input.admin
    .from('inspection_report_links')
    .select(
      'id,org_id,inspection_id,created_at,revoked_at,pdf_status,pdf_attempts,pdf_started_at,pdf_storage_bucket,pdf_storage_path,pdf_base64'
    )
    .is('revoked_at', null)
    .not('snapshot_payload', 'is', null)
    .in('pdf_status', ['pending', 'processing', 'failed'])

  query = input.linkId
    ? query.eq('id', input.linkId).limit(1)
    : query.order('created_at', { ascending: true }).limit(Math.max(20, input.limit * 20))

  const { data, error } = await query
  if (error) throw new Error(error.message ?? 'Kunde inte läsa väntande PDF-jobb.')

  const now = Date.now()
  const candidates = (Array.isArray(data) ? data : [])
    .map((value) => value as Record<string, unknown>)
    .filter((row) => {
      const hasPdf =
        normalizeText(row.pdf_base64).length > 0 ||
        (normalizeText(row.pdf_storage_bucket).length > 0 &&
          normalizeText(row.pdf_storage_path).length > 0)
      return (
        !hasPdf &&
        isLegacyCandidate(row, { now, specificLink: Boolean(input.linkId) })
      )
    })

  const claimed: ClaimedPdfJob[] = []
  for (const candidate of candidates) {
    if (claimed.length >= input.limit) break
    const job = await claimLegacyJob(input.admin, candidate, input.workerId)
    if (job) claimed.push(job)
  }
  return claimed
}

async function claimPdfJobs(input: {
  admin: AdminClient
  workerId: string
  limit: number
  linkId?: string | null
}) {
  const { data, error } = await input.admin.rpc('claim_inspection_report_pdf_jobs', {
    p_worker_id: input.workerId,
    p_limit: input.limit,
    p_stale_after: `${PDF_JOB_STALE_AFTER_MINUTES} minutes`,
    p_link_id: input.linkId ?? null,
  })
  if (!error) {
    return (Array.isArray(data) ? data : [])
      .map((value) => parseClaimedJob(value, input.workerId))
      .filter((job): job is ClaimedPdfJob => Boolean(job))
  }
  if (!isMissingQueueRpc(error)) {
    throw new Error(error.message ?? 'Kunde inte reservera PDF-jobb.')
  }

  console.warn('[report.pdf-jobs] durable queue RPC unavailable; using rollout-safe claim')
  return claimLegacyJobs(input)
}

function resolveRenderOrigin(origin: string | null | undefined) {
  const configured = process.env.APP_BASE_URL?.trim()
  const candidate = configured || normalizeText(origin)
  if (!candidate) throw new Error('REPORT_PDF_APP_BASE_URL_MISSING')

  const parsed = new URL(candidate)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('REPORT_PDF_APP_BASE_URL_INVALID')
  }
  if (parsed.username || parsed.password) {
    throw new Error('REPORT_PDF_APP_BASE_URL_INVALID')
  }
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('REPORT_PDF_APP_BASE_URL_MISSING')
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('REPORT_PDF_APP_BASE_URL_HTTPS_REQUIRED')
  }
  return parsed.origin
}

async function ensureReportPdfStorageBucket(admin: AdminClient) {
  const { error } = await admin.storage.getBucket(REPORT_PDF_STORAGE_BUCKET)
  if (!error) return

  const message = normalizeText(error.message).toLowerCase()
  const isMissing =
    message.includes('not found') ||
    message.includes('does not exist') ||
    message.includes('404')
  if (!isMissing) {
    throw new Error(`Kunde inte verifiera PDF-lagringen: ${error.message ?? error}`)
  }

  const { error: createError } = await admin.storage.createBucket(REPORT_PDF_STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf'],
  })
  const createMessage = normalizeText(createError?.message).toLowerCase()
  if (
    createError &&
    !createMessage.includes('already exists') &&
    !createMessage.includes('duplicate')
  ) {
    throw new Error(`Kunde inte skapa PDF-lagringen: ${createError.message ?? createError}`)
  }
}

async function uploadPdf(admin: AdminClient, job: ClaimedPdfJob, pdfBuffer: Buffer) {
  await ensureReportPdfStorageBucket(admin)
  const attemptId = randomUUID()
  const path = `${job.orgId}/${job.inspectionId}/${job.id}/${job.attempts}-${attemptId}.pdf`
  const { error } = await admin.storage.from(REPORT_PDF_STORAGE_BUCKET).upload(path, pdfBuffer, {
    contentType: 'application/pdf',
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw new Error(`Kunde inte spara PDF-filen: ${error.message ?? error}`)
  return { bucket: REPORT_PDF_STORAGE_BUCKET, path }
}

async function removeUploadedPdf(admin: AdminClient, bucket: string, path: string) {
  const { error } = await admin.storage.from(bucket).remove([path])
  if (error) {
    console.error('[report.pdf-jobs] orphan PDF cleanup failed', {
      bucket,
      path,
      error: error.message ?? error,
    })
  }
}

async function finishLegacyJob(input: {
  admin: AdminClient
  job: ClaimedPdfJob
  success: boolean
  error?: string | null
  storage?: { bucket: string; path: string; sizeBytes: number; sha256: string } | null
}) {
  if (!input.job.startedAt) return null
  const nextStatus: PdfStatus = input.success
    ? 'ready'
    : input.job.attempts >= input.job.maxAttempts
      ? 'failed'
      : 'pending'
  const patch = input.success && input.storage
    ? {
        pdf_status: nextStatus,
        pdf_error: null,
        pdf_generated_at: new Date().toISOString(),
        pdf_storage_bucket: input.storage.bucket,
        pdf_storage_path: input.storage.path,
        pdf_size_bytes: input.storage.sizeBytes,
        pdf_sha256: input.storage.sha256,
        pdf_base64: null,
      }
    : {
        pdf_status: nextStatus,
        pdf_error: truncateError(input.error),
      }

  const { data, error } = await input.admin
    .from('inspection_report_links')
    .update(patch)
    .eq('id', input.job.id)
    .is('revoked_at', null)
    .eq('pdf_status', 'processing')
    .eq('pdf_attempts', input.job.attempts)
    .eq('pdf_started_at', input.job.startedAt)
    .select('id,pdf_status')
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte slutföra PDF-jobbet.')
  return data as { id: string; pdf_status: string } | null
}

async function finishPdfJob(input: {
  admin: AdminClient
  job: ClaimedPdfJob
  success: boolean
  error?: string | null
  storage?: { bucket: string; path: string; sizeBytes: number; sha256: string } | null
}) {
  if (input.job.claimMode === 'legacy') return finishLegacyJob(input)

  const { data, error } = await input.admin.rpc('finish_inspection_report_pdf_job', {
    p_link_id: input.job.id,
    p_worker_id: input.job.workerId,
    p_success: input.success,
    p_error: input.success ? null : truncateError(input.error),
    p_storage_bucket: input.storage?.bucket ?? null,
    p_storage_path: input.storage?.path ?? null,
    p_size_bytes: input.storage?.sizeBytes ?? null,
    p_sha256: input.storage?.sha256 ?? null,
  })
  if (error) throw new Error(error.message ?? 'Kunde inte slutföra PDF-jobbet.')
  return data as Record<string, unknown> | null
}

function assertPdfBuffer(buffer: Buffer) {
  if (buffer.length < 1024 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('REPORT_PDF_RENDER_OUTPUT_INVALID')
  }
}

async function processClaimedJob(
  admin: AdminClient,
  job: ClaimedPdfJob,
  renderOrigin: string
): Promise<PdfJobOutcome> {
  let uploaded: { bucket: string; path: string } | null = null
  let finishingUploadedPdf = false
  try {
    const rendered = await renderPreviewPdf({
      url: `${renderOrigin}/internal/report-render/${encodeURIComponent(job.id)}`,
      mainDocumentHeaders: createInternalReportRenderHeaders({
        linkId: job.id,
        ttlMs: Math.min(10 * 60_000, PDF_RENDER_TIMEOUT_MS + 60_000),
      }),
      timeoutMs: PDF_RENDER_TIMEOUT_MS,
      traceId: `report-pdf:${job.id}:attempt:${job.attempts}`,
    })
    const pdfBuffer = Buffer.isBuffer(rendered) ? rendered : Buffer.from(rendered)
    assertPdfBuffer(pdfBuffer)
    const sha256 = createHash('sha256').update(pdfBuffer).digest('hex')
    uploaded = await uploadPdf(admin, job, pdfBuffer)

    finishingUploadedPdf = true
    const finished = await finishPdfJob({
      admin,
      job,
      success: true,
      storage: {
        ...uploaded,
        sizeBytes: pdfBuffer.length,
        sha256,
      },
    })
    if (!finished) {
      await removeUploadedPdf(admin, uploaded.bucket, uploaded.path)
      return { linkId: job.id, status: 'claim_lost', attempts: job.attempts }
    }
    return { linkId: job.id, status: 'ready', attempts: job.attempts }
  } catch (error) {
    const message = truncateError(error)
    console.error('[report.pdf-jobs] job failed', {
      linkId: job.id,
      inspectionId: job.inspectionId,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      error: message,
      diagnostics: getPdfRenderDiagnostics(error),
    })

    // A lost/ambiguous response from the success finish call may mean the DB
    // already points at this object. Never delete it or overwrite the result
    // with a failure. A stale claim will be recovered by the scheduled worker.
    if (finishingUploadedPdf) {
      return { linkId: job.id, status: 'claim_lost', attempts: job.attempts }
    }

    try {
      const finished = await finishPdfJob({
        admin,
        job,
        success: false,
        error: message,
      })
      if (!finished) {
        return { linkId: job.id, status: 'claim_lost', attempts: job.attempts }
      }
    } catch (finishError) {
      console.error('[report.pdf-jobs] failed to release claim', {
        linkId: job.id,
        error: truncateError(finishError),
      })
      return { linkId: job.id, status: 'claim_lost', attempts: job.attempts }
    }

    return {
      linkId: job.id,
      status: job.attempts >= job.maxAttempts ? 'failed' : 'retry_scheduled',
      attempts: job.attempts,
    }
  }
}

/**
 * Claims and renders frozen report snapshots for every report family (OB, TU and EB).
 * Supplying linkId is the low-latency fast path; omitting it drains due queue work.
 */
export async function runInspectionReportPdfBatch(input?: {
  origin?: string | null
  linkId?: string | null
  limit?: number
  workerId?: string
}): Promise<ReportPdfBatchResult> {
  const admin = createSupabaseAdminClient()
  const renderOrigin = resolveRenderOrigin(input?.origin)
  const limit = Math.max(1, Math.min(3, Math.round(input?.limit ?? 1)))
  const workerId =
    normalizeText(input?.workerId) || `report-pdf-${randomUUID()}`
  const jobs = await claimPdfJobs({
    admin,
    workerId,
    limit,
    linkId: normalizeText(input?.linkId) || null,
  })

  const outcomes: PdfJobOutcome[] = []
  for (const job of jobs) {
    outcomes.push(await processClaimedJob(admin, job, renderOrigin))
  }

  return {
    claimed: jobs.length,
    ready: outcomes.filter((outcome) => outcome.status === 'ready').length,
    retryScheduled: outcomes.filter((outcome) => outcome.status === 'retry_scheduled').length,
    failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
    claimLost: outcomes.filter((outcome) => outcome.status === 'claim_lost').length,
    outcomes,
  }
}
