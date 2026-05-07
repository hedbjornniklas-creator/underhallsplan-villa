import { NextResponse, after } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createHash, randomUUID } from 'node:crypto'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { requireOrgContext, getProfileContact } from '@/lib/assignments/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { renderPreviewPdf } from '@/lib/report/pdfV2/renderPreviewPdf'
import {
  createReportSnapshotPayloadV1,
  type ReportSnapshotPayloadV1,
} from '@/lib/report/pdfV2/renderStructuredPdfV2'
import { buildReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'
import { buildReportSpec } from '@/lib/report/reportSpec'
import { buildInspectionReportDeliveryEmail } from '@/lib/inspections/reportEmailTemplates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const PDF_RENDER_TIMEOUT_MS = Number(process.env.REPORT_PDF_RENDER_TIMEOUT_MS ?? 60000)
const REPORT_PDF_STORAGE_BUCKET = process.env.REPORT_PDF_STORAGE_BUCKET?.trim() || 'inspection-reports'
const REPORT_TIMING_LOGS = process.env.REPORT_TIMING_LOGS !== '0'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type DeliveryStatus = 'pending' | 'sent' | 'failed'

type AssignmentForDelivery = {
  id: string
  org_id: string
  inspection_id: string | null
  property_id: string | null
  status: string | null
  customer_email: string | null
  customer_name: string | null
  responsible_profile_id: string
  property_address: string | null
  preliminary_address: string | null
  preferred_date: string | null
}

type InspectionForDelivery = {
  id: string
  property_id: string | null
  status: string | null
  inspection_side: 'buyer' | 'seller' | 'apartment' | null
}

type OutboundMessageRow = {
  id: string
  recipient_email: string
  status: DeliveryStatus
  sent_at: string | null
  created_at: string
  error_message: string | null
  subject: string
}

type ReportLinkLogRow = {
  id: string
  created_at: string
  pdf_status: string | null
  pdf_error: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
  pdf_base64: string | null
}

type InspectionUnlockLogRow = {
  id: string
  reason: string
  performed_by: string
  performed_at: string | null
  created_at: string
}

type DeliveryActivityLogEntry = {
  id: string
  type: 'report_created' | 'report_sent' | 'report_unlocked'
  title: string
  subtitle: string | null
  occurred_at: string
  download_url: string | null
}

type ReportPdfState = {
  hasStoredPdf: boolean
  latestLinkId: string | null
  pdfStatus: 'pending' | 'processing' | 'ready' | 'failed'
  pdfError: string | null
}

type TimingLogger = {
  mark: (step: string, extra?: Record<string, unknown>) => void
  totalMs: () => number
}

type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed'
type DeliveryAction = 'send_and_complete' | 'send_open' | 'complete_only'

function normalizedText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower === '--' || lower === 'ej satt' || lower === 'saknas') return null
  return trimmed
}

function pickStreetAddress(value: string | null | undefined): string | null {
  const normalized = normalizedText(value ?? null)
  if (!normalized) return null
  const firstLine = normalized.split('\n')[0]?.trim() ?? normalized
  const streetOnly = firstLine.split(',')[0]?.trim() ?? firstLine
  return streetOnly || null
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

function createTimingLogger(scope: string, traceId: string): TimingLogger {
  const startedAt = Date.now()
  let lastAt = startedAt
  return {
    mark(step: string, extra?: Record<string, unknown>) {
      if (!REPORT_TIMING_LOGS) return
      const now = Date.now()
      console.info(`[${scope}][timing]`, {
        traceId,
        step,
        stepMs: now - lastAt,
        totalMs: now - startedAt,
        ...(extra ?? {}),
      })
      lastAt = now
    },
    totalMs() {
      return Date.now() - startedAt
    },
  }
}

function normalizePdfStatus(value: unknown): PdfStatus {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

function truncateErrorMessage(input: string, maxLength = 1200) {
  if (input.length <= maxLength) return input
  return `${input.slice(0, maxLength - 3)}...`
}

function isMissingInspectionLockColumnsError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('locked_at') ||
    normalized.includes('locked_by') ||
    normalized.includes('42703') ||
    normalized.includes('column')
  )
}

function buildOrigin(request: Request) {
  const url = new URL(request.url)
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = forwardedHost ?? request.headers.get('host') ?? url.host
  const proto = forwardedProto ?? url.protocol.replace(':', '')
  return `${proto}://${host}`
}

function resolvePublicBaseUrl(request: Request) {
  const fromEnv = process.env.APP_BASE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return buildOrigin(request)
}

function normalizeInspectionStatus(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'klar' || normalized === 'done') return 'completed'
  if (normalized === 'archived' || normalized === 'arkiverad') return 'archived'
  if (normalized === 'draft' || normalized === 'utkast' || normalized === '') return 'draft'
  return 'ongoing'
}

function isValidEmail(value: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(value)
}

function parsePrimaryRecipient(input: unknown, fallbackEmail: string | null) {
  const candidate = typeof input === 'string' ? input.trim().toLowerCase() : ''
  if (candidate && isValidEmail(candidate)) return candidate
  if (fallbackEmail && isValidEmail(fallbackEmail)) return fallbackEmail
  return null
}

function parseExtraRecipients(input: unknown, primaryEmail: string) {
  if (!Array.isArray(input)) return []

  const primaryLower = primaryEmail.toLowerCase()
  const unique = new Set<string>()

  for (const value of input) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase()
    if (!normalized || normalized === primaryLower) continue
    if (!isValidEmail(normalized)) continue
    unique.add(normalized)
  }

  return Array.from(unique)
}

function parseMarkAsCompleted(input: unknown) {
  if (typeof input === 'boolean') return input
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'ja')
      return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'nej')
      return false
  }
  return true
}

function parseDeliveryAction(actionInput: unknown, markAsCompletedInput: unknown): DeliveryAction {
  if (typeof actionInput === 'string') {
    const normalized = actionInput.trim().toLowerCase()
    if (normalized === 'complete_only') return 'complete_only'
    if (normalized === 'send_open') return 'send_open'
    if (normalized === 'send_and_complete') return 'send_and_complete'
  }

  return parseMarkAsCompleted(markAsCompletedInput) ? 'send_and_complete' : 'send_open'
}

async function markInspectionCompletedAndLocked(input: {
  admin: AdminClient
  inspectionId: string
  inspectionStatus: string
  userId: string
}): Promise<string | null> {
  const lockedAt = new Date().toISOString()
  const inspectionPatch =
    input.inspectionStatus !== 'completed'
      ? {
          status: 'completed',
          locked_at: lockedAt,
          locked_by: input.userId,
        }
      : {
          locked_at: lockedAt,
          locked_by: input.userId,
        }

  const { error: updateInspectionError } = await input.admin
    .from('inspections')
    .update(inspectionPatch)
    .eq('id', input.inspectionId)

  if (!updateInspectionError) return lockedAt

  const message = updateInspectionError.message ?? ''
  if (!isMissingInspectionLockColumnsError(message)) {
    throw new Error(message || 'Kunde inte uppdatera låsstatus för besiktningen.')
  }

  if (input.inspectionStatus === 'completed') return null

  const { error: fallbackStatusError } = await input.admin
    .from('inspections')
    .update({ status: 'completed' })
    .eq('id', input.inspectionId)

  if (fallbackStatusError) {
    throw new Error(
      fallbackStatusError.message ?? 'Kunde inte uppdatera besiktningsstatus till klar.'
    )
  }
  return null
}

function getMailFromAddress() {
  const value = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!value) {
    throw new Error('ASSIGNMENTS_MAIL_FROM saknas. Konfigurera avsandaradress innan utskick.')
  }
  return value
}

async function ensureReportPdfBucket(admin: AdminClient) {
  const { error } = await admin.storage.getBucket(REPORT_PDF_STORAGE_BUCKET)
  if (!error) return

  const message = error.message?.toLowerCase() ?? ''
  const isMissingBucket =
    message.includes('not found') ||
    message.includes('does not exist') ||
    message.includes('404')

  if (!isMissingBucket) {
    throw new Error(
      `Kunde inte verifiera storage bucket för PDF (${REPORT_PDF_STORAGE_BUCKET}): ${error.message ?? error}`
    )
  }

  const { error: createError } = await admin.storage.createBucket(REPORT_PDF_STORAGE_BUCKET, {
    public: false,
    allowedMimeTypes: ['application/pdf'],
    fileSizeLimit: '50MB',
  })

  if (createError) {
    const createMessage = createError.message?.toLowerCase() ?? ''
    const alreadyExists =
      createMessage.includes('already exists') || createMessage.includes('duplicate')
    if (!alreadyExists) {
      throw new Error(
        `Kunde inte skapa storage bucket för PDF (${REPORT_PDF_STORAGE_BUCKET}): ${createError.message ?? createError}`
      )
    }
  }
}

async function uploadReportPdfToStorage(
  admin: AdminClient,
  input: {
    orgId: string
    inspectionId: string
    tokenHash: string
    pdfBuffer: Buffer
  }
) {
  await ensureReportPdfBucket(admin)

  const objectPath = `${input.orgId}/${input.inspectionId}/${Date.now()}-${input.tokenHash.slice(0, 16)}.pdf`
  const { error } = await admin.storage
    .from(REPORT_PDF_STORAGE_BUCKET)
    .upload(objectPath, input.pdfBuffer, {
      contentType: 'application/pdf',
      cacheControl: '31536000',
      upsert: false,
    })

  if (error) {
    throw new Error(`Kunde inte spara PDF i Storage: ${error.message ?? error}`)
  }

  return {
    bucket: REPORT_PDF_STORAGE_BUCKET,
    path: objectPath,
    sizeBytes: input.pdfBuffer.length,
  }
}

async function setPdfJobStatus(
  admin: AdminClient,
  linkId: string,
  patch: {
    pdf_status?: PdfStatus
    pdf_error?: string | null
    pdf_attempts?: number
    pdf_started_at?: string | null
    pdf_generated_at?: string | null
    pdf_storage_bucket?: string | null
    pdf_storage_path?: string | null
    pdf_size_bytes?: number | null
    pdf_sha256?: string | null
    pdf_base64?: string | null
  }
) {
  const { error } = await admin
    .from('inspection_report_links')
    .update(patch)
    .eq('id', linkId)
    .is('revoked_at', null)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte uppdatera PDF-status för rapportlänk.')
  }
}

async function revokeOlderReportLinks(
  admin: AdminClient,
  inspectionId: string,
  activeLinkId: string
) {
  const { error } = await admin
    .from('inspection_report_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('inspection_id', inspectionId)
    .is('revoked_at', null)
    .neq('id', activeLinkId)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte spärra äldre rapportlänkar.')
  }
}

async function runReportPdfJobInBackground(input: {
  traceId: string
  linkId: string
  orgId: string
  inspectionId: string
  propertyId: string
  tokenHash: string
  previewReportUrl: string
  cookieHeader: string | null
}) {
  const admin = createSupabaseAdminClient()
  const timing = createTimingLogger('inspections.report-delivery.pdf-job', input.traceId)
  timing.mark('job_start', {
    linkId: input.linkId,
    inspectionId: input.inspectionId,
  })

  try {
    const { data: link, error: linkError } = await admin
      .from('inspection_report_links')
      .select('id,pdf_attempts,revoked_at')
      .eq('id', input.linkId)
      .maybeSingle()

    if (linkError) {
      throw new Error(linkError.message ?? 'Kunde inte läsa rapportlänk för PDF-jobb.')
    }
    if (!link || link.revoked_at) {
      timing.mark('job_aborted_link_missing_or_revoked')
      return
    }

    const nextAttempts = Number((link as Record<string, unknown>).pdf_attempts ?? 0) + 1
    await setPdfJobStatus(admin, input.linkId, {
      pdf_status: 'processing',
      pdf_error: null,
      pdf_attempts: nextAttempts,
      pdf_started_at: new Date().toISOString(),
    })
    timing.mark('job_marked_processing', { attempts: nextAttempts })

    const rendered = await renderPreviewPdf({
      url: input.previewReportUrl,
      cookieHeader: input.cookieHeader,
      timeoutMs: PDF_RENDER_TIMEOUT_MS,
      traceId: `${input.traceId}:render`,
    })
    const pdfBuffer = Buffer.isBuffer(rendered) ? rendered : Buffer.from(rendered)
    timing.mark('pdf_rendered', { pdfBytes: pdfBuffer.length })

    const pdfSha256 = createHash('sha256').update(pdfBuffer).digest('hex')
    const storedPdf = await uploadReportPdfToStorage(admin, {
      orgId: input.orgId,
      inspectionId: input.inspectionId,
      tokenHash: input.tokenHash,
      pdfBuffer,
    })
    timing.mark('pdf_uploaded_to_storage', {
      bucket: storedPdf.bucket,
      path: storedPdf.path,
      sizeBytes: storedPdf.sizeBytes,
    })

    await setPdfJobStatus(admin, input.linkId, {
      pdf_status: 'ready',
      pdf_error: null,
      pdf_generated_at: new Date().toISOString(),
      pdf_storage_bucket: storedPdf.bucket,
      pdf_storage_path: storedPdf.path,
      pdf_size_bytes: storedPdf.sizeBytes,
      pdf_sha256: pdfSha256,
      pdf_base64: null,
    })
    timing.mark('job_completed')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel vid PDF-jobb.'
    console.error('[inspections.report-delivery.pdf-job] failed', {
      linkId: input.linkId,
      inspectionId: input.inspectionId,
      error: message,
    })
    try {
      await setPdfJobStatus(admin, input.linkId, {
        pdf_status: 'failed',
        pdf_error: truncateErrorMessage(message),
      })
    } catch (updateError) {
      console.error('[inspections.report-delivery.pdf-job] failed to mark failed status', {
        linkId: input.linkId,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      })
    }
    timing.mark('job_failed', { error: message })
  }
}

async function getInspectionById(admin: AdminClient, inspectionId: string) {
  const { data, error } = await admin
    .from('inspections')
    .select('id,property_id,status,inspection_side')
    .eq('id', inspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa besiktning.')
  }

  return (data ?? null) as InspectionForDelivery | null
}

async function getAssignmentByInspection(admin: AdminClient, orgId: string, inspectionId: string) {
  const { data, error } = await admin
    .from('assignments')
    .select(
      'id,org_id,inspection_id,property_id,status,customer_email,customer_name,responsible_profile_id,property_address,preliminary_address,preferred_date'
    )
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte lÃ¤sa kopplad uppdragsbekrÃ¤ftelse.')
  }

  return (data ?? null) as AssignmentForDelivery | null
}

async function isInspectionOwnedByUser(
  admin: AdminClient,
  propertyId: string | null,
  userId: string
) {
  if (!propertyId) return false

  const { data, error } = await admin
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .eq('owner', userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte verifiera access till besiktningen.')
  }

  return Boolean(data)
}

async function getDeliveryHistory(admin: AdminClient, assignmentId: string) {
  const { data, error } = await admin
    .from('outbound_messages')
    .select('id,recipient_email,status,sent_at,created_at,error_message,subject')
    .eq('assignment_id', assignmentId)
    .eq('template_key', 'inspection_report_delivery')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hÃ¤mta leveranshistorik.')
  }

  return (data ?? []) as OutboundMessageRow[]
}

async function getReportPdfState(admin: AdminClient, inspectionId: string): Promise<ReportPdfState> {
  const { data, error } = await admin
    .from('inspection_report_links')
    .select('id,pdf_base64,pdf_storage_bucket,pdf_storage_path,pdf_status,pdf_error,revoked_at,created_at')
    .eq('inspection_id', inspectionId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa PDF-status för utlåtandet.')
  }

  const rows = Array.isArray(data) ? data : []
  const latestRow = (rows[0] as Record<string, unknown> | undefined) ?? null
  const readyRow =
    (rows.find((row) => {
      const record = row as Record<string, unknown>
      const pdfBase64 = String(record.pdf_base64 ?? '').trim()
      const pdfStorageBucket = String(record.pdf_storage_bucket ?? '').trim()
      const pdfStoragePath = String(record.pdf_storage_path ?? '').trim()
      return (
        pdfBase64.length > 0 ||
        (pdfStorageBucket.length > 0 &&
          pdfStoragePath.length > 0 &&
          normalizePdfStatus(record.pdf_status) === 'ready')
      )
    }) as Record<string, unknown> | undefined) ?? null

  const hasStoredPdf = Boolean(readyRow)
  const statusFromDb = normalizePdfStatus(latestRow?.pdf_status)
  const pdfStatus: PdfStatus = hasStoredPdf ? 'ready' : statusFromDb
  const pdfError = hasStoredPdf
    ? null
    : String(latestRow?.pdf_error ?? '').trim() || null
  return {
    hasStoredPdf,
    latestLinkId: (readyRow?.id as string | undefined) ?? (latestRow?.id as string | undefined) ?? null,
    pdfStatus,
    pdfError,
  }
}

function pdfStatusLabel(value: unknown) {
  const status = normalizePdfStatus(value)
  if (status === 'ready') return 'Klar'
  if (status === 'processing') return 'Genereras'
  if (status === 'failed') return 'Misslyckades'
  return 'Väntar'
}

function toTimestampValue(value: string | null | undefined) {
  if (!value) return 0
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : 0
}

async function getReportCreatedLog(admin: AdminClient, inspectionId: string) {
  const { data, error } = await admin
    .from('inspection_report_links')
    .select(
      'id,created_at,pdf_status,pdf_error,pdf_storage_bucket,pdf_storage_path,pdf_base64'
    )
    .eq('inspection_id', inspectionId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa rapportlänkar.')
  }

  return (Array.isArray(data) ? data : []) as ReportLinkLogRow[]
}

async function getUnlockHistory(admin: AdminClient, orgId: string, inspectionId: string) {
  const { data, error } = await admin
    .from('inspection_lock_events')
    .select('id,reason,performed_by,performed_at,created_at')
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .eq('action', 'unlock')
    .order('performed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) {
    const message = String(error.message ?? '')
    const normalized = message.toLowerCase()
    if (
      normalized.includes('inspection_lock_events') ||
      normalized.includes('42p01') ||
      normalized.includes('does not exist')
    ) {
      return [] as InspectionUnlockLogRow[]
    }
    throw new Error(message || 'Kunde inte läsa upplåsningslogg.')
  }

  return (Array.isArray(data) ? data : []) as InspectionUnlockLogRow[]
}

async function buildDeliveryActivityLog(input: {
  admin: AdminClient
  orgId: string
  inspectionId: string
  history: OutboundMessageRow[]
}) {
  const [reportRows, unlockRows] = await Promise.all([
    getReportCreatedLog(input.admin, input.inspectionId),
    getUnlockHistory(input.admin, input.orgId, input.inspectionId),
  ])

  const hasDownloadablePdf = reportRows.some(
    (row) =>
      normalizePdfStatus(row.pdf_status) === 'ready' &&
      ((String(row.pdf_storage_bucket ?? '').trim().length > 0 &&
        String(row.pdf_storage_path ?? '').trim().length > 0) ||
        String(row.pdf_base64 ?? '').trim().length > 0)
  )

  const reportEntries: DeliveryActivityLogEntry[] = reportRows.map((row) => {
    const hasReadyPdf =
      normalizePdfStatus(row.pdf_status) === 'ready' &&
      ((String(row.pdf_storage_bucket ?? '').trim().length > 0 &&
        String(row.pdf_storage_path ?? '').trim().length > 0) ||
        String(row.pdf_base64 ?? '').trim().length > 0)
    const pdfError = String(row.pdf_error ?? '').trim()
    const subtitle =
      pdfError.length > 0
        ? `PDF-status: ${pdfStatusLabel(row.pdf_status)} (${pdfError})`
        : `PDF-status: ${pdfStatusLabel(row.pdf_status)}`

    return {
      id: `report_created:${row.id}`,
      type: 'report_created',
      title: 'Skapade utlåtande',
      subtitle,
      occurred_at: row.created_at,
      download_url: hasReadyPdf ? `/api/report-v2/${input.inspectionId}/pdf` : null,
    }
  })

  const sendEntries: DeliveryActivityLogEntry[] = input.history.map((row) => {
    const statusText =
      row.status === 'sent' ? 'Skickade utlåtande' : row.status === 'failed' ? 'Misslyckat utskick' : 'Skickning pågår'
    const errorText = String(row.error_message ?? '').trim()
    const subtitle = errorText
      ? `${row.recipient_email} (${errorText})`
      : row.recipient_email

    return {
      id: `report_sent:${row.id}`,
      type: 'report_sent',
      title: statusText,
      subtitle,
      occurred_at: row.sent_at ?? row.created_at,
      download_url:
        row.status === 'sent' && hasDownloadablePdf ? `/api/report-v2/${input.inspectionId}/pdf` : null,
    }
  })

  const unlockEntries: DeliveryActivityLogEntry[] = unlockRows.map((row) => ({
    id: `report_unlocked:${row.id}`,
    type: 'report_unlocked',
    title: 'Låste upp utlåtande',
    subtitle: row.reason,
    occurred_at: row.performed_at ?? row.created_at,
    download_url: null,
  }))

  return [...reportEntries, ...sendEntries, ...unlockEntries].sort(
    (a, b) => toTimestampValue(b.occurred_at) - toTimestampValue(a.occurred_at)
  )
}

async function createOutboundMessage(
  admin: AdminClient,
  input: {
    orgId: string
    assignmentId: string | null
    createdBy: string
    recipientEmail: string
    subject: string
    replyToEmail: string | null
  }
) {
  const { data, error } = await admin
    .from('outbound_messages')
    .insert({
      org_id: input.orgId,
      assignment_id: input.assignmentId,
      channel: 'email',
      recipient_email: input.recipientEmail,
      subject: input.subject,
      template_key: 'inspection_report_delivery',
      status: 'pending',
      created_by: input.createdBy,
      reply_to_email: input.replyToEmail,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte skapa mejllogg.')
  }

  return data.id as string
}

async function updateOutboundMessage(
  admin: AdminClient,
  id: string,
  patch: {
    status: DeliveryStatus
    provider?: string | null
    provider_message_id?: string | null
    error_message?: string | null
    sent_at?: string | null
  }
) {
  const { error } = await admin.from('outbound_messages').update(patch).eq('id', id)

  if (error) {
    console.error('[inspections.report-delivery] failed to update outbound_messages', {
      id,
      error: error.message ?? error,
    })
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()

    const inspection = await getInspectionById(admin, id)
    if (!inspection) return jsonError('Besiktningen hittades inte.', 404)

    const assignment = await getAssignmentByInspection(admin, org.orgId, id)
    if (!assignment) {
      const ownedByUser = await isInspectionOwnedByUser(admin, inspection.property_id, org.userId)
      if (!ownedByUser) {
        return jsonError('Besiktningen tillhÃ¶r inte din organisation/anvÃ¤ndare.', 403)
      }
    }

    const ordererEmail = assignment?.customer_email?.trim().toLowerCase() ?? null
    const history = assignment ? await getDeliveryHistory(admin, assignment.id) : []
    const inspectionStatus = normalizeInspectionStatus(inspection.status)
    const pdfState = await getReportPdfState(admin, id)
    const activityLog = await buildDeliveryActivityLog({
      admin,
      orgId: org.orgId,
      inspectionId: id,
      history,
    })

    return NextResponse.json({
      inspectionId: id,
      inspectionStatus,
      canSend: inspectionStatus !== 'archived',
      reason:
        inspectionStatus === 'archived'
          ? 'Arkiverad besiktning kan inte skickas.'
          : null,
      defaultRecipientEmail: ordererEmail,
      ordererEmail,
      hasStoredPdf: pdfState.hasStoredPdf,
      pdfStatus: pdfState.pdfStatus,
      pdfError: pdfState.pdfError,
      canDownloadPdf:
        inspectionStatus === 'completed' &&
        pdfState.hasStoredPdf &&
        pdfState.pdfStatus === 'ready',
      history,
      activityLog,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte lÃ¤sa utskicksstatus.', 500)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const traceId = randomUUID()
  const timing = createTimingLogger('inspections.report-delivery', traceId)
  try {
    const { id } = await context.params
    timing.mark('start', { inspectionId: id })
    const org = await requireOrgContext()
    timing.mark('org_context_ready', { orgId: org.orgId })
    const admin = createSupabaseAdminClient()
    timing.mark('admin_client_ready')
    const body = (await request.json().catch(() => null)) as
      | {
          primary_recipient?: unknown
          extra_recipients?: unknown
          mark_as_completed?: unknown
          action?: unknown
        }
      | null
    timing.mark('request_body_parsed')

    const inspection = await getInspectionById(admin, id)
    if (!inspection) return jsonError('Besiktningen hittades inte.', 404)

    const inspectionStatus = normalizeInspectionStatus(inspection.status)
    if (inspectionStatus === 'archived') {
      return jsonError('Arkiverad besiktning kan inte skickas.', 400)
    }

    const assignment = await getAssignmentByInspection(admin, org.orgId, id)
    if (!assignment) {
      const ownedByUser = await isInspectionOwnedByUser(admin, inspection.property_id, org.userId)
      if (!ownedByUser) {
        return jsonError('Besiktningen tillhÃ¶r inte din organisation/anvÃ¤ndare.', 403)
      }
    }

    const fallbackOrdererEmail = assignment?.customer_email?.trim().toLowerCase() ?? null
    const action = parseDeliveryAction(body?.action, body?.mark_as_completed)

    if (action === 'complete_only') {
      const inspectionLockedAt = await markInspectionCompletedAndLocked({
        admin,
        inspectionId: id,
        inspectionStatus,
        userId: org.userId,
      })
      timing.mark('inspection_completed_without_send')

      const history = assignment ? await getDeliveryHistory(admin, assignment.id) : []
      const pdfState = await getReportPdfState(admin, id)
      const activityLog = await buildDeliveryActivityLog({
        admin,
        orgId: org.orgId,
        inspectionId: id,
        history,
      })

      timing.mark('success', { finalInspectionStatus: 'completed', totalMs: timing.totalMs() })
      return NextResponse.json({
        inspectionId: id,
        inspectionStatus: 'completed',
        inspectionLockedAt,
        deliveryMode: 'link_only',
        publicLink: '',
        primaryRecipientEmail: '',
        defaultRecipientEmail: fallbackOrdererEmail,
        ordererEmail: fallbackOrdererEmail,
        hasStoredPdf: pdfState.hasStoredPdf,
        pdfStatus: pdfState.pdfStatus,
        pdfError: pdfState.pdfError,
        canDownloadPdf: pdfState.hasStoredPdf && pdfState.pdfStatus === 'ready',
        sentRecipients: [],
        failedRecipients: [],
        history,
        activityLog,
        linkId: '',
      })
    }

    const primaryRecipient = parsePrimaryRecipient(body?.primary_recipient, fallbackOrdererEmail)
    if (!primaryRecipient) {
      return jsonError('Ange en giltig huvudmottagare.', 400)
    }

    const propertyId = assignment?.property_id ?? inspection.property_id
    if (!propertyId) {
      return jsonError('Besiktningen saknar kopplad fastighet.', 400)
    }

    const extraRecipients = parseExtraRecipients(body?.extra_recipients, primaryRecipient)
    const recipients = [primaryRecipient, ...extraRecipients]
    timing.mark('recipients_ready', { recipientCount: recipients.length })

    const inspectionSide =
      inspection.inspection_side === 'seller'
        ? 'seller'
        : inspection.inspection_side === 'apartment'
          ? 'apartment'
          : 'buyer'
    const specInspectionSide = inspectionSide === 'seller' ? 'seller' : inspectionSide === 'apartment' ? 'apartment' : 'buyer'
    const reportData = await buildReportDataV2({
      inspectionId: id,
      propertyId,
    })
    timing.mark('report_data_built')
    const appendices = (reportData.mock?.appendices as Record<string, any> | undefined) ?? {}
    const reportSpec = buildReportSpec({
      inspectionSide: specInspectionSide,
      dynamicAppendices: {
        includeAreaMeasurement: appendices.area_measurement?.enabled === true,
        includeMoistureControl: appendices.moisture_control?.enabled === true,
      },
    })
    timing.mark('report_spec_built')
    const snapshotPayload: ReportSnapshotPayloadV1 = createReportSnapshotPayloadV1({
      inspectionId: id,
      propertyId,
      inspectionSide,
      reportData,
      reportSpec,
    })
    timing.mark('snapshot_payload_built')

    const token = generateAssignmentToken()
    const tokenHash = hashAssignmentToken(token)

    const { data: linkData, error: linkError } = await admin
      .from('inspection_report_links')
      .insert({
        org_id: org.orgId,
        inspection_id: id,
        assignment_id: assignment?.id ?? null,
        token_hash: tokenHash,
        delivery_mode: 'link_only',
        snapshot_schema_version: 'v1',
        snapshot_payload: snapshotPayload,
        pdf_status: 'pending',
        pdf_error: null,
        pdf_attempts: 0,
        pdf_started_at: null,
        pdf_generated_at: null,
        created_by: org.userId,
      })
      .select('id')
      .single()

    if (linkError || !linkData) {
      throw new Error(linkError?.message ?? 'Kunde inte skapa rapportlÃ¤nk.')
    }
    timing.mark('report_link_created', { linkId: linkData.id })
    await revokeOlderReportLinks(admin, id, linkData.id)
    timing.mark('older_report_links_revoked')

    const previewReportUrl = `${resolvePublicBaseUrl(request)}/utlatande/${propertyId}/${id}?embed=1&pdf=1`
    const requestCookieHeader = request.headers.get('cookie')
    const linkUrl = `${resolvePublicBaseUrl(request)}/rapport/${token}`
    const fromAddress = getMailFromAddress()
    const responsibleProfile = await getProfileContact(
      assignment?.responsible_profile_id ?? org.userId
    )
    const replyToEmail = responsibleProfile?.email?.trim() || null
    const emailContent = buildInspectionReportDeliveryEmail({
      orgName: org.orgName,
      customerName:
        normalizedText(assignment?.customer_name) ??
        normalizedText((reportData.mock?.inspections as Record<string, unknown> | undefined)?.client_name) ??
        null,
      propertyAddress:
        pickStreetAddress(
          normalizedText((reportData.mock?.properties as Record<string, unknown> | undefined)?.address) ?? null
        ) ??
        pickStreetAddress(assignment?.property_address) ??
        pickStreetAddress(assignment?.preliminary_address) ??
        null,
      inspectionDate:
        normalizedText((reportData.mock?.inspections as Record<string, unknown> | undefined)?.date) ??
        normalizedText((reportData.mock?.inspections as Record<string, unknown> | undefined)?.date_time) ??
        normalizedText(assignment?.preferred_date) ??
        null,
      detailsUrl: linkUrl,
    })

    const failedRecipients: Array<{ email: string; error: string }> = []
    const sentRecipients: string[] = []
    let primarySent = false

    for (const recipient of recipients) {
      const messageId = await createOutboundMessage(admin, {
        orgId: org.orgId,
        assignmentId: assignment?.id ?? null,
        createdBy: org.userId,
        recipientEmail: recipient,
        subject: emailContent.subject,
        replyToEmail,
      })
      timing.mark('outbound_message_created', { recipient, messageId })

      try {
        const sendResult = await sendAssignmentEmail({
          to: recipient,
          from: fromAddress,
          replyTo: replyToEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        })

        await updateOutboundMessage(admin, messageId, {
          status: 'sent',
          provider: sendResult.provider,
          provider_message_id: sendResult.providerMessageId,
          sent_at: new Date().toISOString(),
        })
        timing.mark('email_sent', { recipient, provider: sendResult.provider })

        sentRecipients.push(recipient)
        if (recipient === primaryRecipient) primarySent = true
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : 'OkÃ¤nt fel vid mejlutskick.'
        failedRecipients.push({ email: recipient, error: message })

        await updateOutboundMessage(admin, messageId, {
          status: 'failed',
          error_message: message,
        })
        timing.mark('email_failed', { recipient, error: message })

        if (recipient === primaryRecipient) {
          return jsonError('Kunde inte skicka till huvudmottagaren.', 502, {
            failedRecipients,
            sentRecipients,
          })
        }
      }
    }

    let inspectionLockedAt: string | null = null
    if (primarySent && action === 'send_and_complete') {
      inspectionLockedAt = await markInspectionCompletedAndLocked({
        admin,
        inspectionId: id,
        inspectionStatus,
        userId: org.userId,
      })
      timing.mark('inspection_locked_after_send')
    }

    after(async () => {
      await runReportPdfJobInBackground({
        traceId: `${traceId}:link:${linkData.id}`,
        linkId: linkData.id,
        orgId: org.orgId,
        inspectionId: id,
        propertyId,
        tokenHash,
        previewReportUrl,
        cookieHeader: requestCookieHeader,
      })
    })
    timing.mark('pdf_job_scheduled', { linkId: linkData.id })

    const history = assignment ? await getDeliveryHistory(admin, assignment.id) : []
    const activityLog = await buildDeliveryActivityLog({
      admin,
      orgId: org.orgId,
      inspectionId: id,
      history,
    })
    const finalInspectionStatus =
      primarySent && action === 'send_and_complete' ? 'completed' : inspectionStatus
    timing.mark('history_loaded', { historyCount: history.length })
    timing.mark('success', { finalInspectionStatus, totalMs: timing.totalMs() })

    return NextResponse.json({
      inspectionId: id,
      inspectionStatus: finalInspectionStatus,
      inspectionLockedAt,
      deliveryMode: 'link_only',
      publicLink: linkUrl,
      primaryRecipientEmail: primaryRecipient,
      defaultRecipientEmail: fallbackOrdererEmail,
      ordererEmail: fallbackOrdererEmail,
      hasStoredPdf: false,
      pdfStatus: 'pending' as PdfStatus,
      pdfError: null,
      canDownloadPdf: false,
      sentRecipients,
      failedRecipients,
      history,
      activityLog,
      linkId: linkData.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel.'
    timing.mark('failed', { error: message, totalMs: timing.totalMs() })
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return jsonError('Servern saknar SUPABASE_SERVICE_ROLE_KEY i env.', 500)
    }
    if (message.includes('RESEND_API_KEY')) {
      return jsonError('Servern saknar RESEND_API_KEY i env.', 500)
    }
    if (message.includes('ASSIGNMENTS_MAIL_FROM')) {
      return jsonError('Servern saknar ASSIGNMENTS_MAIL_FROM i env.', 500)
    }
    if (message.includes('PDF_RENDER_TIMEOUT')) {
      return jsonError(
        'PDF-genereringen tog för lång tid. Försök igen. Om det fortsätter behöver PDF-jobbet köras asynkront.',
        504
      )
    }
    if (message.includes('EMAIL_SEND_TIMEOUT')) {
      return jsonError('Mejlutskicket tog för lång tid. Försök igen.', 504)
    }
    console.error('[inspections.report-delivery] unhandled error', { error: message })
    return jsonError(message || 'Kunde inte skicka utlÃ¥tandet.', 500)
  }
}


