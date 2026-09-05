import { createHash } from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { requireOrgContext } from '@/lib/assignments/server'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import {
  createEbReportSnapshotPayloadV1,
  isEbReportSnapshotPayloadV1,
  withEbReportDeliveryTimestamp,
  type EbReportDeliveryDocument,
} from '@/lib/eb/reportSnapshot'
import { getEbInspectionReport, getEbProjectById, type EbProjectListItem } from '@/lib/eb/server'
import { buildInspectionReportDeliveryEmail } from '@/lib/inspections/reportEmailTemplates'
import {
  getPdfRenderDiagnostics,
  renderPreviewPdf,
} from '@/lib/report/pdfV2/renderPreviewPdf'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TEMPLATE_KEY = 'eb_report_delivery'
const PDF_RENDER_TIMEOUT_MS = Number(process.env.REPORT_PDF_RENDER_TIMEOUT_MS ?? 60000)
const REPORT_PDF_STORAGE_BUCKET = process.env.REPORT_PDF_STORAGE_BUCKET?.trim() || 'inspection-reports'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed'
type DeliveryAction = 'lock_only' | 'send_and_lock' | 'resend' | 'regenerate_pdf'

type EbReportLinkRow = {
  id: string
  org_id: string | null
  token_hash: string | null
  created_at: string | null
  snapshot_schema_version: string | null
  snapshot_payload: unknown
  pdf_status: string | null
  pdf_error: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
  pdf_base64: string | null
}

type OutboundMessageRow = {
  id: string
  recipient_email: string | null
  status: string | null
  sent_at: string | null
  created_at: string | null
  error_message: string | null
  subject: string | null
}

type InspectionUnlockLogRow = {
  id: string
  reason: string | null
  performed_at: string | null
  created_at: string | null
}

type DeliveryActivityLogEntry = {
  id: string
  type: 'report_sent' | 'report_unlocked'
  title: string
  subtitle: string | null
  occurred_at: string | null
}

type ReportRecipientOption = {
  email: string
  name: string | null
  roleLabel: string | null
  receivesReport: boolean
}

type ParticipantRecipientRow = {
  role_label: string | null
  company_name: string | null
  person_name: string | null
  email: string | null
  receives_report: boolean | null
  sort_order: number | null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizeEmail(value: unknown) {
  const normalized = normalizeText(value).toLowerCase()
  return normalized && isValidEmail(normalized) ? normalized : null
}

function normalizePdfStatus(value: unknown): PdfStatus {
  const normalized = normalizeText(value).toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

function parseAction(value: unknown): DeliveryAction {
  const normalized = normalizeText(value).toLowerCase()
  if (normalized === 'regenerate_pdf') return 'regenerate_pdf'
  if (normalized === 'resend') return 'resend'
  if (normalized === 'lock_only') return 'lock_only'
  return 'send_and_lock'
}

function parseExtraRecipients(value: unknown, primary: string | null) {
  if (!Array.isArray(value)) return []
  const seen = new Set(primary ? [primary] : [])
  const recipients: string[] = []

  for (const item of value) {
    const email = normalizeEmail(item)
    if (!email || seen.has(email)) continue
    seen.add(email)
    recipients.push(email)
  }

  return recipients
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
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

function getMailFromAddress() {
  const value = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!value) {
    throw new Error('ASSIGNMENTS_MAIL_FROM saknas. Konfigurera avsändaradress innan utskick.')
  }
  return value
}

async function ensureReportPdfStorageBucket(admin: AdminClient) {
  const { error } = await admin.storage.getBucket(REPORT_PDF_STORAGE_BUCKET)
  if (!error) return

  const { error: createError } = await admin.storage.createBucket(REPORT_PDF_STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf'],
  })
  if (createError) {
    throw new Error(`Kunde inte skapa storage bucket för PDF (${REPORT_PDF_STORAGE_BUCKET}).`)
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
  await ensureReportPdfStorageBucket(admin)
  const objectPath = `${input.orgId}/${input.inspectionId}/${Date.now()}-${input.tokenHash.slice(0, 16)}.pdf`
  const { error } = await admin.storage
    .from(REPORT_PDF_STORAGE_BUCKET)
    .upload(objectPath, input.pdfBuffer, {
      contentType: 'application/pdf',
      cacheControl: '31536000',
      upsert: false,
    })

  if (error) throw new Error(`Kunde inte spara PDF i Storage: ${error.message ?? error}`)
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

  if (error) throw new Error(error.message ?? 'Kunde inte uppdatera PDF-status för rapportlänk.')
}

async function runEbReportPdfJobInBackground(input: {
  linkId: string
  orgId: string
  projectId: string
  inspectionId: string
  tokenHash: string
  previewReportUrl: string
  cookieHeader: string | null
}) {
  const admin = createSupabaseAdminClient()

  try {
    const { data: link, error: linkError } = await admin
      .from('inspection_report_links')
      .select('id,pdf_attempts,revoked_at')
      .eq('id', input.linkId)
      .maybeSingle()

    if (linkError) throw new Error(linkError.message ?? 'Kunde inte läsa rapportlänk för PDF-jobb.')
    if (!link || (link as { revoked_at?: string | null }).revoked_at) return

    const nextAttempts = Number((link as Record<string, unknown>).pdf_attempts ?? 0) + 1
    await setPdfJobStatus(admin, input.linkId, {
      pdf_status: 'processing',
      pdf_error: null,
      pdf_attempts: nextAttempts,
      pdf_started_at: new Date().toISOString(),
    })

    const rendered = await renderPreviewPdf({
      url: input.previewReportUrl,
      cookieHeader: input.cookieHeader,
      timeoutMs: PDF_RENDER_TIMEOUT_MS,
      traceId: `eb:${input.projectId}:${input.inspectionId}:link:${input.linkId}`,
    })
    const pdfBuffer = Buffer.isBuffer(rendered) ? rendered : Buffer.from(rendered)
    const pdfSha256 = createHash('sha256').update(pdfBuffer).digest('hex')
    const storedPdf = await uploadReportPdfToStorage(admin, {
      orgId: input.orgId,
      inspectionId: input.inspectionId,
      tokenHash: input.tokenHash,
      pdfBuffer,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel vid PDF-generering.'
    console.error('[eb.report-delivery.pdf-job] failed', {
      linkId: input.linkId,
      projectId: input.projectId,
      inspectionId: input.inspectionId,
      error: message,
      diagnostics: getPdfRenderDiagnostics(error),
    })
    try {
      await setPdfJobStatus(admin, input.linkId, {
        pdf_status: 'failed',
        pdf_error: message.slice(0, 500),
      })
    } catch (updateError) {
      console.error('[eb.report-delivery.pdf-job] failed to mark failed status', {
        linkId: input.linkId,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      })
    }
  }
}

async function revokeOlderReportLinks(
  admin: AdminClient,
  input: { orgId: string; inspectionId: string; activeLinkId: string }
) {
  const { error } = await admin
    .from('inspection_report_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .is('revoked_at', null)
    .neq('id', input.activeLinkId)

  if (error) throw new Error(error.message ?? 'Kunde inte spärra äldre rapportlänkar.')
}

async function revokeReportLink(admin: AdminClient, orgId: string, linkId: string) {
  const { error } = await admin
    .from('inspection_report_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('id', linkId)
    .is('revoked_at', null)
  if (error) throw new Error(error.message ?? 'Kunde inte återkalla rapportlänken.')
}

async function getLatestReportLink(
  admin: AdminClient,
  orgId: string,
  inspectionId: string
) {
  const { data, error } = await admin
    .from('inspection_report_links')
    .select(
      'id,org_id,token_hash,created_at,snapshot_schema_version,snapshot_payload,pdf_status,pdf_error,revoked_at,pdf_storage_bucket,pdf_storage_path,pdf_base64'
    )
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Kunde inte läsa rapportlänk.')
  return data as EbReportLinkRow | null
}

function getPdfDownloadUrl(inspectionId: string, activeLink: EbReportLinkRow | null) {
  if (!activeLink) return null
  const hasStoragePdf =
    normalizeText(activeLink.pdf_storage_bucket).length > 0 &&
    normalizeText(activeLink.pdf_storage_path).length > 0
  const hasLegacyPdf = normalizeText(activeLink.pdf_base64).length > 0
  if (normalizePdfStatus(activeLink.pdf_status) !== 'ready' || (!hasStoragePdf && !hasLegacyPdf)) {
    return null
  }
  return `/api/report-v2/${encodeURIComponent(inspectionId)}/pdf`
}

function getDashboardDigitalReportUrl(
  projectId: string,
  inspectionId: string,
  activeLink: EbReportLinkRow | null
) {
  if (!activeLink) return null
  return `/eb/projects/${encodeURIComponent(projectId)}/inspections/${encodeURIComponent(inspectionId)}/digital`
}

function getDeliveryDocuments(activeLink: EbReportLinkRow | null): EbReportDeliveryDocument[] {
  if (!activeLink || !isEbReportSnapshotPayloadV1(activeLink.snapshot_payload)) return []
  return activeLink.snapshot_payload.deliveryDocuments ?? []
}

async function lockEbInspection(
  admin: AdminClient,
  input: { orgId: string; projectId: string; inspectionId: string; userId: string }
) {
  const { data, error } = await admin.rpc('lock_eb_inspection_report', {
    p_org_id: input.orgId,
    p_project_id: input.projectId,
    p_inspection_id: input.inspectionId,
    p_performed_by: input.userId,
  })

  if (error) throw new Error(error.message ?? 'Kunde inte låsa EB-utlåtandet.')
  return typeof data === 'string' ? data : new Date().toISOString()
}

async function createReportLink(
  admin: AdminClient,
  input: {
    orgId: string
    inspectionId: string
    userId: string
    snapshotSchemaVersion: string
    snapshotPayload: unknown
  }
) {
  const token = generateAssignmentToken()
  const tokenHash = hashAssignmentToken(token)
  const { data, error } = await admin
    .from('inspection_report_links')
    .insert({
      org_id: input.orgId,
      inspection_id: input.inspectionId,
      assignment_id: null,
      token_hash: tokenHash,
      delivery_mode: 'link_only',
      snapshot_schema_version: input.snapshotSchemaVersion,
      snapshot_payload: input.snapshotPayload,
      pdf_status: 'pending',
      pdf_error: null,
      pdf_attempts: 0,
      pdf_started_at: null,
      pdf_generated_at: null,
      created_by: input.userId,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Kunde inte skapa rapportlänk.')
  return { linkId: data.id as string, token, tokenHash }
}

async function recordReportDeliveryMetadata(
  admin: AdminClient,
  input: {
    orgId: string
    projectId: string
    inspectionId: string
    linkId: string
    snapshotPayload: unknown
    sentAt: string
  }
) {
  const snapshotPayload = withEbReportDeliveryTimestamp(input.snapshotPayload, input.sentAt)
  const reportDistributionDate = isEbReportSnapshotPayloadV1(snapshotPayload)
    ? snapshotPayload.meta.reportDate
    : input.sentAt.slice(0, 10)
  const [linkResult, inspectionResult] = await Promise.all([
    admin
      .from('inspection_report_links')
      .update({ snapshot_payload: snapshotPayload })
      .eq('org_id', input.orgId)
      .eq('id', input.linkId),
    admin
      .from('eb_inspection_details')
      .update({ report_distribution_date: reportDistributionDate })
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
      .eq('inspection_id', input.inspectionId),
  ])

  if (linkResult.error) {
    throw new Error(linkResult.error.message ?? 'Kunde inte registrera leveransen i rapportversionen.')
  }
  if (inspectionResult.error) {
    throw new Error(inspectionResult.error.message ?? 'Kunde inte registrera utlåtandets leveransdatum.')
  }

  return snapshotPayload
}

async function createOutboundMessage(
  admin: AdminClient,
  input: {
    orgId: string
    projectId: string
    inspectionId: string
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
      assignment_id: null,
      inspection_id: input.inspectionId,
      eb_project_id: input.projectId,
      channel: 'email',
      recipient_email: input.recipientEmail,
      subject: input.subject,
      template_key: TEMPLATE_KEY,
      status: 'pending',
      created_by: input.createdBy,
      reply_to_email: input.replyToEmail,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Kunde inte skapa mejllogg.')
  return data.id as string
}

async function updateOutboundMessage(
  admin: AdminClient,
  id: string,
  patch: {
    status: 'sent' | 'failed'
    provider?: string | null
    provider_message_id?: string | null
    error_message?: string | null
    sent_at?: string | null
  }
) {
  const { error } = await admin.from('outbound_messages').update(patch).eq('id', id)
  if (error) {
    console.error('[eb.report-delivery] failed to update outbound message', {
      id,
      error: error.message ?? error,
    })
  }
}

async function getDeliveryHistory(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  inspectionId: string
): Promise<OutboundMessageRow[]> {
  const { data, error } = await admin
    .from('outbound_messages')
    .select('id,recipient_email,status,sent_at,created_at,error_message,subject')
    .eq('org_id', orgId)
    .eq('eb_project_id', projectId)
    .eq('inspection_id', inspectionId)
    .eq('template_key', TEMPLATE_KEY)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(error.message ?? 'Kunde inte hämta leveranshistorik.')
  return (Array.isArray(data) ? data : []) as OutboundMessageRow[]
}

async function getUnlockHistory(
  admin: AdminClient,
  orgId: string,
  inspectionId: string
): Promise<InspectionUnlockLogRow[]> {
  const { data, error } = await admin
    .from('inspection_lock_events')
    .select('id,reason,performed_at,created_at')
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .eq('action', 'unlock')
    .order('performed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    const message = String(error.message ?? '')
    const normalized = message.toLowerCase()
    if (
      normalized.includes('inspection_lock_events') ||
      normalized.includes('42p01') ||
      normalized.includes('does not exist')
    ) {
      return []
    }
    throw new Error(message || 'Kunde inte hämta upplåsningshistorik.')
  }

  return (Array.isArray(data) ? data : []) as InspectionUnlockLogRow[]
}

function toTimestampValue(value: string | null | undefined) {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function buildDeliveryActivityLog(input: {
  history: OutboundMessageRow[]
  unlockHistory: InspectionUnlockLogRow[]
}): DeliveryActivityLogEntry[] {
  const sendEntries: DeliveryActivityLogEntry[] = input.history.map((row) => {
    const title =
      row.status === 'sent'
        ? 'Skickade utlåtande'
        : row.status === 'failed'
          ? 'Misslyckat utskick'
          : 'Skickning pågår'
    const errorText = normalizeText(row.error_message)
    const recipient = normalizeText(row.recipient_email)
    return {
      id: `report_sent:${row.id}`,
      type: 'report_sent',
      title,
      subtitle: errorText ? `${recipient || '-'} (${errorText})` : recipient || null,
      occurred_at: row.sent_at ?? row.created_at,
    }
  })

  const unlockEntries: DeliveryActivityLogEntry[] = input.unlockHistory.map((row) => ({
    id: `report_unlocked:${row.id}`,
    type: 'report_unlocked',
    title: 'Låste upp utlåtande',
    subtitle: row.reason,
    occurred_at: row.performed_at ?? row.created_at,
  }))

  return [...sendEntries, ...unlockEntries].sort(
    (a, b) => toTimestampValue(b.occurred_at) - toTimestampValue(a.occurred_at)
  )
}

async function listReportRecipientOptions(
  admin: AdminClient,
  input: { orgId: string; projectId: string; inspectionId: string; project: EbProjectListItem }
): Promise<ReportRecipientOption[]> {
  const { data, error } = await admin
    .from('eb_participants')
    .select('role_label,company_name,person_name,email,receives_report,sort_order')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('inspection_id', input.inspectionId)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message ?? 'Kunde inte läsa utlåtandets mottagare.')

  const options: ReportRecipientOption[] = []
  const seen = new Set<string>()
  const add = (option: ReportRecipientOption) => {
    if (seen.has(option.email)) return
    seen.add(option.email)
    options.push(option)
  }
  const clientEmail = normalizeEmail(input.project.clientEmail)
  if (clientEmail) {
    add({
      email: clientEmail,
      name: normalizeText(input.project.clientName) || null,
      roleLabel: 'Beställare',
      receivesReport: true,
    })
  }

  for (const row of (Array.isArray(data) ? data : []) as ParticipantRecipientRow[]) {
    const email = normalizeEmail(row.email)
    if (!email) continue
    add({
      email,
      name: normalizeText(row.person_name) || normalizeText(row.company_name) || null,
      roleLabel: normalizeText(row.role_label) || null,
      receivesReport: row.receives_report !== false,
    })
  }

  return options
}

async function getReplyToEmail(admin: AdminClient, profileId: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('email')
    .eq('id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte läsa besiktningsmannens e-postadress.')
  return normalizeEmail((data as { email?: string | null } | null)?.email)
}

function resolveDefaultRecipients(
  project: EbProjectListItem,
  recipientOptions: ReportRecipientOption[]
) {
  const clientEmail = normalizeEmail(project.clientEmail)
  const primary = clientEmail ?? recipientOptions.find((option) => option.receivesReport)?.email ?? null
  const extras = recipientOptions
    .filter((option) => option.receivesReport && option.email !== primary)
    .map((option) => option.email)
  return { clientEmail, primary, extras }
}

function getCurrentVersionHistory(
  history: OutboundMessageRow[],
  activeLink: EbReportLinkRow | null
) {
  if (!activeLink?.created_at) return []
  const createdAt = toTimestampValue(activeLink.created_at)
  return history.filter((row) => toTimestampValue(row.created_at) >= createdAt)
}

function buildDeliveryStatus(
  activeLink: EbReportLinkRow | null,
  currentVersionHistory: OutboundMessageRow[]
) {
  if (!activeLink) return 'draft'
  if (currentVersionHistory.some((row) => row.status === 'sent')) return 'sent'
  if (currentVersionHistory.some((row) => row.status === 'pending')) return 'sending'
  if (currentVersionHistory.some((row) => row.status === 'failed')) return 'failed'
  return 'finalized'
}

function buildStatusPayload(input: {
  projectId: string
  inspectionId: string
  project: EbProjectListItem
  activeLink: EbReportLinkRow | null
  history: OutboundMessageRow[]
  unlockHistory: InspectionUnlockLogRow[]
  recipientOptions: ReportRecipientOption[]
}) {
  const inspection = input.project.inspections.find(
    (item) => item.inspectionId === input.inspectionId
  )
  const defaults = resolveDefaultRecipients(input.project, input.recipientOptions)
  const currentVersionHistory = getCurrentVersionHistory(input.history, input.activeLink)
  const deliveryStatus = buildDeliveryStatus(input.activeLink, currentVersionHistory)

  return {
    inspectionId: input.inspectionId,
    reportLockedAt: inspection?.reportLockedAt ?? null,
    inspectionStatus: inspection?.status ?? null,
    defaultRecipientEmail: defaults.primary,
    defaultExtraRecipients: defaults.extras,
    ordererEmail: defaults.clientEmail,
    clientEmail: defaults.clientEmail,
    recipientOptions: input.recipientOptions,
    hasActiveLink: Boolean(input.activeLink),
    hasBeenSent: deliveryStatus === 'sent',
    deliveryStatus,
    lastSentAt: input.history.find((row) => row.status === 'sent')?.sent_at ?? null,
    latestDelivery: input.history[0] ?? null,
    pdfStatus: input.activeLink?.pdf_status ?? null,
    pdfError: input.activeLink?.pdf_error ?? null,
    downloadUrl: getPdfDownloadUrl(input.inspectionId, input.activeLink),
    digitalUrl: getDashboardDigitalReportUrl(
      input.projectId,
      input.inspectionId,
      input.activeLink
    ),
    publicLink: null,
    deliveryDocuments: getDeliveryDocuments(input.activeLink),
    history: input.history,
    activityLog: buildDeliveryActivityLog({
      history: input.history,
      unlockHistory: input.unlockHistory,
    }),
    revisionNumber: null,
    revisionStatus:
      input.activeLink && deliveryStatus === 'sent' ? 'published' : input.activeLink ? 'finalized' : null,
    revisionCreatedAt: input.activeLink?.created_at ?? null,
    project: input.project,
  }
}

async function loadDeliveryStatus(
  admin: AdminClient,
  input: { orgId: string; projectId: string; inspectionId: string }
) {
  const project = await getEbProjectById({ orgId: input.orgId, projectId: input.projectId })
  const inspection = project?.inspections.find((item) => item.inspectionId === input.inspectionId)
  if (!project || !inspection) return null

  const [activeLink, history, unlockHistory, recipientOptions] = await Promise.all([
    getLatestReportLink(admin, input.orgId, input.inspectionId),
    getDeliveryHistory(admin, input.orgId, input.projectId, input.inspectionId),
    getUnlockHistory(admin, input.orgId, input.inspectionId),
    listReportRecipientOptions(admin, { ...input, project }),
  ])

  return buildStatusPayload({
    projectId: input.projectId,
    inspectionId: input.inspectionId,
    project,
    activeLink,
    history,
    unlockHistory,
    recipientOptions,
  })
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const status = await loadDeliveryStatus(createSupabaseAdminClient(), {
      orgId: org.orgId,
      projectId,
      inspectionId,
    })
    if (!status) return jsonError('Besiktningen hittades inte.', 404)
    return NextResponse.json(status)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
    return jsonError(message || 'Kunde inte läsa EB-utlåtandets status.', 500)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const admin = createSupabaseAdminClient()
    const body = (await request.json().catch(() => null)) as
      | {
          action?: unknown
          primary_recipient?: unknown
          extra_recipients?: unknown
          recipientEmail?: unknown
          extraRecipients?: unknown
        }
      | null
    const action = parseAction(body?.action)
    const project = await getEbProjectById({ orgId: org.orgId, projectId })
    const inspection = project?.inspections.find((item) => item.inspectionId === inspectionId)
    if (!project || !inspection) return jsonError('Besiktningen hittades inte.', 404)

    if (action === 'regenerate_pdf') {
      const latestLink = await getLatestReportLink(admin, org.orgId, inspectionId)
      if (!latestLink) {
        return jsonError('Det finns ingen fastställd rapportversion att generera PDF för.', 400)
      }
      const tokenHash = normalizeText(latestLink.token_hash)
      if (!tokenHash) return jsonError('Rapportlänken saknar token för PDF-generering.', 500)

      const latestStatus = normalizePdfStatus(latestLink.pdf_status)
      if (latestStatus !== 'pending' && latestStatus !== 'processing') {
        await setPdfJobStatus(admin, latestLink.id, {
          pdf_status: 'pending',
          pdf_error: null,
          pdf_attempts: 0,
          pdf_started_at: null,
          pdf_generated_at: null,
          pdf_storage_bucket: null,
          pdf_storage_path: null,
          pdf_size_bytes: null,
          pdf_sha256: null,
          pdf_base64: null,
        })
        const publicBaseUrl = resolvePublicBaseUrl(request)
        after(async () => {
          await runEbReportPdfJobInBackground({
            linkId: latestLink.id,
            orgId: org.orgId,
            projectId,
            inspectionId,
            tokenHash,
            previewReportUrl: `${publicBaseUrl}/eb/projects/${encodeURIComponent(projectId)}/inspections/${encodeURIComponent(inspectionId)}/digital?pdf=1`,
            cookieHeader: request.headers.get('cookie'),
          })
        })
      }

      const status = await loadDeliveryStatus(admin, { orgId: org.orgId, projectId, inspectionId })
      if (!status) return jsonError('Besiktningen hittades inte.', 404)
      return NextResponse.json(status)
    }

    if (action === 'lock_only' && inspection.reportLockedAt) {
      return jsonError('Utlåtandet är redan fastställt. Lås upp det för att skapa en ny revision.', 409)
    }
    if (action === 'resend' && !inspection.reportLockedAt) {
      return jsonError('Fastställ utlåtandet innan du skickar det igen.', 409)
    }

    const recipientOptions = await listReportRecipientOptions(admin, {
      orgId: org.orgId,
      projectId,
      inspectionId,
      project,
    })
    const defaultRecipients = resolveDefaultRecipients(project, recipientOptions)
    const primaryRecipient =
      action === 'lock_only'
        ? null
        : normalizeEmail(body?.primary_recipient ?? body?.recipientEmail) ?? defaultRecipients.primary
    if (action !== 'lock_only' && !primaryRecipient) {
      return jsonError('Ange en giltig huvudmottagare.', 400)
    }

    const sendingFrozenRevision = Boolean(inspection.reportLockedAt)
    let snapshotPayload: unknown
    let snapshotSchemaVersion = 'eb_v1'
    if (sendingFrozenRevision) {
      const frozenLink = await getLatestReportLink(admin, org.orgId, inspectionId)
      if (!frozenLink || !isEbReportSnapshotPayloadV1(frozenLink.snapshot_payload)) {
        return jsonError(
          'Den fastställda rapportversionen saknas. Lås upp och fastställ utlåtandet på nytt.',
          409
        )
      }
      snapshotPayload = frozenLink.snapshot_payload
      snapshotSchemaVersion = frozenLink.snapshot_schema_version || 'eb_v1'
    } else {
      const report = await getEbInspectionReport({
        orgId: org.orgId,
        requestedByUserId: org.userId,
        projectId,
        inspectionId,
      })
      snapshotPayload = createEbReportSnapshotPayloadV1(report)
    }

    const createdLink = await createReportLink(admin, {
      orgId: org.orgId,
      inspectionId,
      userId: org.userId,
      snapshotSchemaVersion,
      snapshotPayload,
    })
    const publicBaseUrl = resolvePublicBaseUrl(request)
    const publicLink = `${publicBaseUrl}/rapport/${encodeURIComponent(createdLink.token)}`
    let reportLockedAt = inspection.reportLockedAt

    if (!sendingFrozenRevision) {
      try {
        reportLockedAt = await lockEbInspection(admin, {
          orgId: org.orgId,
          projectId,
          inspectionId,
          userId: org.userId,
        })
        await revokeOlderReportLinks(admin, {
          orgId: org.orgId,
          inspectionId,
          activeLinkId: createdLink.linkId,
        })
      } catch (lockError) {
        await revokeReportLink(admin, org.orgId, createdLink.linkId).catch(() => undefined)
        throw lockError
      }
    }

    const sentRecipients: string[] = []
    const failedRecipients: Array<{ email: string; error: string }> = []
    let lastSuccessfulSentAt: string | null = null
    if (action !== 'lock_only') {
      const recipients = [
        primaryRecipient as string,
        ...parseExtraRecipients(body?.extra_recipients ?? body?.extraRecipients, primaryRecipient),
      ]
      const emailContent = buildInspectionReportDeliveryEmail({
        orgName: org.orgName,
        customerName: project.clientName ?? inspection.clientName,
        propertyAddress:
          [project.address, [project.postalCode, project.city].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(', ') || null,
        inspectionDate: inspection.date,
        detailsUrl: publicLink,
      })
      const replyToEmail = await getReplyToEmail(admin, project.ownerProfileId)

      for (const recipient of recipients) {
        let messageId: string | null = null
        try {
          messageId = await createOutboundMessage(admin, {
            orgId: org.orgId,
            projectId,
            inspectionId,
            createdBy: org.userId,
            recipientEmail: recipient,
            subject: emailContent.subject,
            replyToEmail,
          })
          const sendResult = await sendAssignmentEmail({
            to: recipient,
            from: getMailFromAddress(),
            replyTo: replyToEmail,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          })
          const sentAt = new Date().toISOString()
          await updateOutboundMessage(admin, messageId, {
            status: 'sent',
            provider: sendResult.provider,
            provider_message_id: sendResult.providerMessageId,
            sent_at: sentAt,
          })
          lastSuccessfulSentAt = sentAt
          sentRecipients.push(recipient)
        } catch (sendError) {
          const message =
            sendError instanceof Error ? sendError.message : 'Mejlutskicket misslyckades.'
          if (messageId) {
            await updateOutboundMessage(admin, messageId, {
              status: 'failed',
              error_message: message,
            })
          }
          failedRecipients.push({ email: recipient, error: message })
        }
      }
    }

    if (lastSuccessfulSentAt) {
      snapshotPayload = await recordReportDeliveryMetadata(admin, {
        orgId: org.orgId,
        projectId,
        inspectionId,
        linkId: createdLink.linkId,
        snapshotPayload,
        sentAt: lastSuccessfulSentAt,
      })
    }

    const keepCreatedLink =
      action === 'lock_only' || !sendingFrozenRevision || sentRecipients.length > 0
    if (!keepCreatedLink) {
      await revokeReportLink(admin, org.orgId, createdLink.linkId)
    } else {
      after(async () => {
        await runEbReportPdfJobInBackground({
          linkId: createdLink.linkId,
          orgId: org.orgId,
          projectId,
          inspectionId,
          tokenHash: createdLink.tokenHash,
          previewReportUrl: `${publicLink}?pdf=1`,
          cookieHeader: null,
        })
      })
    }

    const status = await loadDeliveryStatus(admin, { orgId: org.orgId, projectId, inspectionId })
    if (!status) return jsonError('Besiktningen hittades inte.', 404)
    return NextResponse.json({
      ...status,
      reportLockedAt,
      inspectionStatus: 'completed',
      deliveryMode: 'link_only',
      publicLink: keepCreatedLink ? publicLink : null,
      primaryRecipientEmail: primaryRecipient,
      sentRecipients,
      failedRecipients,
      linkId: keepCreatedLink ? createdLink.linkId : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
    if (message === 'EB_PROJECT_NOT_FOUND' || message === 'EB_INSPECTION_NOT_FOUND') {
      return jsonError('Besiktningen hittades inte.', 404)
    }
    if (message.includes('RESEND_API_KEY')) return jsonError('Servern saknar mejlkonfiguration.', 500)
    if (message.includes('ASSIGNMENTS_MAIL_FROM')) {
      return jsonError('Servern saknar avsändaradress för mejl.', 500)
    }
    return jsonError(message || 'Kunde inte leverera EB-utlåtandet.', 500)
  }
}
