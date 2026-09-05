import { NextResponse, after } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { buildInspectionReportDeliveryEmail } from '@/lib/inspections/reportEmailTemplates'
import { runInspectionReportPdfBatch } from '@/lib/report/pdfJobs'
import {
  getTuInvestigationById,
  listTuInvestigationImages,
  requireTuContext,
} from '@/lib/tu/server'
import {
  createTuReportSnapshotPayloadV1,
  type TuReportDeliveryDocument,
} from '@/lib/tu/reportSnapshot'
import { usesTuAiAssistedWorkflow } from '@/lib/tu/authoring'
import { TU_MOISTURE_DAMAGE_TEMPLATE_KEY } from '@/lib/tu/evidence'
import { listTuObservations } from '@/lib/tu/evidenceServer'
import {
  evaluateTuReportImprovements,
  evaluateTuReportQuality,
  isTuSystemGeneratedReportSection,
} from '@/lib/tu/reportQuality'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TEMPLATE_KEY = 'tu_report_delivery'

type DeliveryAction = 'send_and_lock' | 'send_open' | 'lock_only'
type ReportDeliveryPostAction = DeliveryAction | 'regenerate_pdf'
type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed'
type AdminClient = ReturnType<typeof createSupabaseAdminClient>

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
  performed_by: string | null
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

type TuDeliveryDocumentRow = {
  id: string
  storage_bucket: string | null
  file_path: string
  file_name: string | null
  title: string | null
  content_type: string | null
  file_size_bytes: number | null
  created_at: string | null
}

type TuReportRevisionRow = {
  id: string
  revision_number: number
  snapshot_link_id: string
  published_link_id: string | null
  status: 'finalized' | 'published' | 'superseded'
  finalized_at: string
  published_at: string | null
}

type ReportSnapshotLinkRow = {
  id: string
  org_id: string | null
  assignment_id: string | null
  snapshot_schema_version: string | null
  snapshot_payload: unknown
}

function normalizePdfStatus(value: unknown): PdfStatus {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
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

function resolveReportDraftRecipientEmail(
  investigation: NonNullable<Awaited<ReturnType<typeof getTuInvestigationById>>>
) {
  const assignmentPartiesText =
    investigation.reportDraft.sections.find((section) => section.key === 'assignment_parties')?.text ?? ''
  let activeBlock: 'customer' | 'inspector' | null = null

  for (const rawLine of assignmentPartiesText.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const heading = line.toLowerCase()
    if (heading === 'uppdragsgivare') {
      activeBlock = 'customer'
      continue
    }
    if (heading === 'besiktningsman') {
      activeBlock = 'inspector'
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (activeBlock !== 'customer' || separatorIndex < 0) continue

    const label = line.slice(0, separatorIndex).trim().toLowerCase()
    if (label !== 'e-post' && label !== 'e.post' && label !== 'e-mail' && label !== 'email') continue

    return normalizeEmail(line.slice(separatorIndex + 1))
  }

  return null
}

function parseAction(value: unknown): ReportDeliveryPostAction {
  const normalized = normalizeText(value)
  if (normalized === 'regenerate_pdf') return 'regenerate_pdf'
  if (normalized === 'send_open') return 'send_open'
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

  if (error) throw new Error(error.message ?? 'Kunde inte spärra äldre rapportlänkar.')
}

async function createOutboundMessage(
  admin: AdminClient,
  input: {
    orgId: string
    assignmentId: string | null
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
      assignment_id: input.assignmentId,
      inspection_id: input.inspectionId,
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
    console.error('[tu.report-delivery] failed to update outbound message', {
      id,
      error: error.message ?? error,
    })
  }
}

async function getDeliveryHistory(
  admin: AdminClient,
  inspectionId: string
): Promise<OutboundMessageRow[]> {
  const { data, error } = await admin
    .from('outbound_messages')
    .select('id,recipient_email,status,sent_at,created_at,error_message,subject')
    .eq('inspection_id', inspectionId)
    .eq('template_key', TEMPLATE_KEY)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw new Error(error.message ?? 'Kunde inte hämta leveranshistorik.')
  return (Array.isArray(data) ? data : []) as OutboundMessageRow[]
}

function toTimestampValue(value: string | null | undefined) {
  if (!value) return 0
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : 0
}

async function getUnlockHistory(
  admin: AdminClient,
  orgId: string,
  inspectionId: string
): Promise<InspectionUnlockLogRow[]> {
  const { data, error } = await admin
    .from('inspection_lock_events')
    .select('id,reason,performed_by,performed_at,created_at')
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .eq('action', 'unlock')
    .order('performed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(10)

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
    const errorText = String(row.error_message ?? '').trim()
    const recipient = String(row.recipient_email ?? '').trim()
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

async function getLatestReportLink(
  admin: AdminClient,
  inspectionId: string
) {
  const { data, error } = await admin
    .from('inspection_report_links')
    .select('id,org_id,token_hash,created_at,pdf_status,pdf_error,revoked_at,pdf_storage_bucket,pdf_storage_path,pdf_base64')
    .eq('inspection_id', inspectionId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Kunde inte läsa rapportlänk.')
  return data as
    | {
        id: string
        org_id: string | null
        token_hash: string | null
        created_at: string | null
        pdf_status: string | null
        pdf_error: string | null
        revoked_at: string | null
        pdf_storage_bucket: string | null
        pdf_storage_path: string | null
        pdf_base64: string | null
      }
    | null
}

function isMissingRevisionTable(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '').toLowerCase()
  return message.includes('tu_report_revisions') || message.includes('42p01') || message.includes('does not exist')
}

async function getCurrentTuRevision(
  admin: AdminClient,
  orgId: string,
  inspectionId: string
): Promise<TuReportRevisionRow | null> {
  const { data, error } = await admin
    .from('tu_report_revisions')
    .select('id,revision_number,snapshot_link_id,published_link_id,status,finalized_at,published_at')
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .in('status', ['finalized', 'published'])
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (isMissingRevisionTable(error)) return null
    throw new Error(error.message ?? 'Kunde inte läsa TU-revisionen.')
  }
  return (data as TuReportRevisionRow | null) ?? null
}

async function getReportSnapshotLink(admin: AdminClient, linkId: string) {
  const { data, error } = await admin
    .from('inspection_report_links')
    .select('id,org_id,assignment_id,snapshot_schema_version,snapshot_payload')
    .eq('id', linkId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte läsa den fastställda rapportversionen.')
  if (!data) throw new Error('Den fastställda rapportversionen saknas.')
  return data as ReportSnapshotLinkRow
}

async function createTuRevision(
  admin: AdminClient,
  input: {
    orgId: string
    inspectionId: string
    snapshotLinkId: string
    userId: string
    publishedLinkId?: string | null
  }
) {
  const { data: latest, error: latestError } = await admin
    .from('tu_report_revisions')
    .select('revision_number')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    if (isMissingRevisionTable(latestError)) {
      throw new Error('TU_REVISIONS_NOT_ACTIVATED')
    }
    throw new Error(latestError.message ?? 'Kunde inte beräkna nästa TU-revision.')
  }
  const revisionNumber = Math.max(1, Number((latest as { revision_number?: unknown } | null)?.revision_number ?? 0) + 1)
  const published = Boolean(input.publishedLinkId)
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('tu_report_revisions')
    .insert({
      org_id: input.orgId,
      inspection_id: input.inspectionId,
      revision_number: revisionNumber,
      snapshot_link_id: input.snapshotLinkId,
      published_link_id: input.publishedLinkId ?? null,
      status: published ? 'published' : 'finalized',
      finalized_at: now,
      finalized_by: input.userId,
      published_at: published ? now : null,
      published_by: published ? input.userId : null,
    })
    .select('id,revision_number,snapshot_link_id,published_link_id,status,finalized_at,published_at')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Kunde inte skapa TU-revisionen.')
  return data as TuReportRevisionRow
}

async function publishTuRevision(
  admin: AdminClient,
  input: {
    orgId: string
    inspectionId: string
    revisionId: string
    publishedLinkId: string
    userId: string
  }
) {
  const now = new Date().toISOString()
  const { error: supersedeError } = await admin
    .from('tu_report_revisions')
    .update({ status: 'superseded' })
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('status', 'published')
    .neq('id', input.revisionId)
  if (supersedeError) throw new Error(supersedeError.message ?? 'Kunde inte avsluta föregående TU-revision.')

  const { data, error } = await admin
    .from('tu_report_revisions')
    .update({
      status: 'published',
      published_link_id: input.publishedLinkId,
      published_at: now,
      published_by: input.userId,
    })
    .eq('id', input.revisionId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .in('status', ['finalized', 'published'])
    .select('id')
    .maybeSingle()
  if (error || !data) throw new Error(error?.message ?? 'Kunde inte publicera den fastställda TU-revisionen.')
}

async function lockTuInvestigation(
  admin: AdminClient,
  input: {
    orgId: string
    inspectionId: string
    userId: string
  }
) {
  const lockedAt = new Date().toISOString()

  const { error: detailsError } = await admin
    .from('technical_investigation_details')
    .update({
      report_locked_at: lockedAt,
      report_locked_by: input.userId,
    })
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .is('report_locked_at', null)

  if (detailsError) throw new Error(detailsError.message ?? 'Kunde inte låsa TU-utlåtandet.')

  const { error: inspectionError } = await admin
    .from('inspections')
    .update({
      status: 'completed',
      locked_at: lockedAt,
      locked_by: input.userId,
    })
    .eq('id', input.inspectionId)
    .is('locked_at', null)

  if (inspectionError) throw new Error(inspectionError.message ?? 'Kunde inte låsa besiktningen.')
  return lockedAt
}

function getPdfDownloadUrl(inspectionId: string, activeLink: Awaited<ReturnType<typeof getLatestReportLink>>) {
  if (!activeLink) return null
  const hasStoragePdf =
    String(activeLink.pdf_storage_bucket ?? '').trim().length > 0 &&
    String(activeLink.pdf_storage_path ?? '').trim().length > 0
  const hasLegacyPdf = String(activeLink.pdf_base64 ?? '').trim().length > 0
  if (normalizePdfStatus(activeLink.pdf_status) !== 'ready' || (!hasStoragePdf && !hasLegacyPdf)) return null
  return `/api/report-v2/${encodeURIComponent(inspectionId)}/pdf`
}

async function listTuDeliveryDocuments(
  admin: AdminClient,
  input: {
    orgId: string
    inspectionId: string
  }
): Promise<TuReportDeliveryDocument[]> {
  const { data, error } = await admin
    .from('technical_investigation_documents')
    .select('id,storage_bucket,file_path,file_name,title,content_type,file_size_bytes,created_at')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('include_in_delivery', true)
    .order('created_at', { ascending: false })

  if (error) {
    const message = String(error.message ?? '')
    if (message.includes('include_in_delivery')) return []
    throw new Error(error.message ?? 'Kunde inte hämta markerade TU-dokument.')
  }

  return ((data ?? []) as TuDeliveryDocumentRow[])
    .map((row) => ({
      id: row.id,
      storageBucket: row.storage_bucket?.trim() || 'tu-investigation-documents',
      filePath: row.file_path,
      fileName: row.file_name,
      title: row.title,
      contentType: row.content_type,
      fileSizeBytes: row.file_size_bytes,
      createdAt: row.created_at,
    }))
    .filter((document) => document.filePath.trim().length > 0)
}

function getDashboardDigitalReportUrl(
  inspectionId: string,
  activeLink: Awaited<ReturnType<typeof getLatestReportLink>>
) {
  if (!activeLink) return null
  return `/tu/investigations/${encodeURIComponent(inspectionId)}/digital`
}

function resolveDefaultRecipient(investigation: Awaited<ReturnType<typeof getTuInvestigationById>>) {
  if (!investigation) return null
  return normalizeEmail(
    resolveReportDraftRecipientEmail(investigation) ??
      investigation.assignment?.customer_email ??
      investigation.inspection.customer_email ??
      investigation.customerEmail
  )
}

function resolvePropertyAddress(investigation: NonNullable<Awaited<ReturnType<typeof getTuInvestigationById>>>) {
  return (
    investigation.property?.address ??
    investigation.propertyAddress ??
    investigation.assignment?.property_address ??
    null
  )
}

function resolveInspectionDate(investigation: NonNullable<Awaited<ReturnType<typeof getTuInvestigationById>>>) {
  return investigation.date ?? investigation.assignment?.preferred_date ?? null
}

async function getReportQualityIssues(
  investigation: NonNullable<Awaited<ReturnType<typeof getTuInvestigationById>>>
) {
  if (investigation.reportTemplateKey !== TU_MOISTURE_DAMAGE_TEMPLATE_KEY) return []
  const [observations, appendixImages] = await Promise.all([
    listTuObservations({
      orgId: investigation.orgId,
      inspectionId: investigation.inspectionId,
    }),
    listTuInvestigationImages({
      orgId: investigation.orgId,
      inspectionId: investigation.inspectionId,
      sectionKey: 'appendix',
    }),
  ])
  const reportText = investigation.reportDraft.sections
    .flatMap((section) => [
      section.text,
      ...(section.subsections?.map((subsection) => subsection.text) ?? []),
    ])
    .join('\n\n')
  return evaluateTuReportQuality({
    reportText,
    observations,
    appendixImages,
  })
}

async function getReportImprovementReview(
  investigation: NonNullable<Awaited<ReturnType<typeof getTuInvestigationById>>>
) {
  if (investigation.reportTemplateKey !== TU_MOISTURE_DAMAGE_TEMPLATE_KEY) return null
  const [observations, appendixImages] = await Promise.all([
    listTuObservations({
      orgId: investigation.orgId,
      inspectionId: investigation.inspectionId,
    }),
    listTuInvestigationImages({
      orgId: investigation.orgId,
      inspectionId: investigation.inspectionId,
      sectionKey: 'appendix',
    }),
  ])
  const reportText = investigation.reportDraft.sections
    .flatMap((section) => [
      section.title,
      section.text,
      ...(section.subsections?.flatMap((subsection) => [subsection.title, subsection.text]) ?? []),
    ])
    .join('\n\n')
  const qualityIssues = evaluateTuReportQuality({ reportText, observations, appendixImages })
  return evaluateTuReportImprovements({ reportText, observations, appendixImages, qualityIssues })
}

async function getFinalizationBlocker(
  admin: AdminClient,
  investigation: NonNullable<Awaited<ReturnType<typeof getTuInvestigationById>>>
) {
  if (!usesTuAiAssistedWorkflow(investigation.reportAuthoringMode, investigation.reportTemplateKey)) return null

  const { data, error } = await admin
    .from('tu_analysis_workflows')
    .select('status,analysis_stale_at')
    .eq('org_id', investigation.orgId)
    .eq('inspection_id', investigation.inspectionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const workflow = data as { status?: string | null; analysis_stale_at?: string | null } | null
  if (workflow?.analysis_stale_at || workflow?.status !== 'analysis_approved') {
    return 'Den samlade bedömningen måste vara aktuell och godkänd innan utlåtandet kan fastställas.'
  }

  const missingSections = investigation.reportDraft.sections.filter((section) => {
    if (isTuSystemGeneratedReportSection(section.key)) return false
    if (!section.isRequired) return false
    return !section.text.trim() && !section.subsections?.some((subsection) => subsection.text.trim())
  })
  if (missingSections.length > 0) {
    const titles = missingSections.slice(0, 3).map((section) => section.title).join(', ')
    const suffix = missingSections.length > 3 ? ` och ${missingSections.length - 3} till` : ''
    return `Fyll i obligatoriska rapportdelar: ${titles}${suffix}.`
  }
  const qualityIssues = await getReportQualityIssues(investigation)
  const qualityBlocker = qualityIssues.find((issue) => issue.severity === 'blocker')
  if (qualityBlocker) return qualityBlocker.message
  return null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const org = await requireTuContext()
    const admin = createSupabaseAdminClient()
    const investigation = await getTuInvestigationById({
      orgId: org.orgId,
      inspectionId,
      inspectorProfileId: org.userId,
    })
    if (!investigation) return jsonError('TU-utredningen hittades inte.', 404)

    if (new URL(request.url).searchParams.get('status') === '1') {
      const activeLink = await getLatestReportLink(admin, inspectionId)
      if (!activeLink || activeLink.org_id !== org.orgId) {
        return jsonError('Det finns inget fastställt TU-utlåtande.', 404)
      }

      return NextResponse.json(
        { status: normalizePdfStatus(activeLink.pdf_status) },
        {
          headers: {
            'Cache-Control': 'private, no-store, max-age=0',
            'X-Content-Type-Options': 'nosniff',
          },
        }
      )
    }

    const [history, unlockHistory, activeLink, deliveryDocuments, revision, qualityIssues, improvementReview] = await Promise.all([
      getDeliveryHistory(admin, inspectionId),
      getUnlockHistory(admin, org.orgId, inspectionId),
      getLatestReportLink(admin, inspectionId),
      listTuDeliveryDocuments(admin, { orgId: org.orgId, inspectionId }),
      getCurrentTuRevision(admin, org.orgId, inspectionId),
      getReportQualityIssues(investigation),
      getReportImprovementReview(investigation),
    ])
    const ordererEmail = resolveDefaultRecipient(investigation)
    const activityLog = buildDeliveryActivityLog({ history, unlockHistory })

    return NextResponse.json({
      inspectionId,
      reportLockedAt: investigation.reportLockedAt,
      inspectionStatus: investigation.status,
      defaultRecipientEmail: ordererEmail,
      ordererEmail,
      hasActiveLink: Boolean(activeLink),
      pdfStatus: activeLink?.pdf_status ?? null,
      pdfError: activeLink?.pdf_error ?? null,
      downloadUrl: getPdfDownloadUrl(inspectionId, activeLink),
      digitalUrl: getDashboardDigitalReportUrl(inspectionId, activeLink),
      publicLink: null,
      deliveryDocuments,
      history,
      activityLog,
      revisionNumber: revision?.revision_number ?? null,
      revisionStatus: revision?.status ?? null,
      revisionFinalizedAt: revision?.finalized_at ?? null,
      revisionPublishedAt: revision?.published_at ?? null,
      qualityIssues,
      improvementReview,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte läsa TU-utskicksstatus.', 500)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const org = await requireTuContext()
    const admin = createSupabaseAdminClient()
    const body = (await request.json().catch(() => null)) as
      | {
          action?: unknown
          primary_recipient?: unknown
          extra_recipients?: unknown
        }
      | null
    const action = parseAction(body?.action)
    const investigation = await getTuInvestigationById({
      orgId: org.orgId,
      inspectionId,
      inspectorProfileId: org.userId,
    })
    if (!investigation) return jsonError('TU-utredningen hittades inte.', 404)

    if (action === 'regenerate_pdf') {
      const latestLink = await getLatestReportLink(admin, inspectionId)
      if (!latestLink) {
        return jsonError('Det finns ingen publicerad rapportlänk att generera PDF för.', 400)
      }
      if (latestLink.org_id !== org.orgId) {
        return jsonError('Rapportlänken tillhör inte din organisation.', 403)
      }

      const latestStatus = normalizePdfStatus(latestLink.pdf_status)
      const shouldSchedulePdfJob = latestStatus !== 'pending' && latestStatus !== 'processing'
      if (shouldSchedulePdfJob) {
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

      }

      const publicBaseUrl = resolvePublicBaseUrl(request)
      after(async () => {
        await runInspectionReportPdfBatch({
          origin: publicBaseUrl,
          linkId: latestLink.id,
          limit: 1,
        })
      })

      const [history, unlockHistory, activeLink, deliveryDocuments] = await Promise.all([
        getDeliveryHistory(admin, inspectionId),
        getUnlockHistory(admin, org.orgId, inspectionId),
        getLatestReportLink(admin, inspectionId),
        listTuDeliveryDocuments(admin, { orgId: org.orgId, inspectionId }),
      ])
      const ordererEmail = resolveDefaultRecipient(investigation)
      const activityLog = buildDeliveryActivityLog({ history, unlockHistory })

      return NextResponse.json({
        inspectionId,
        reportLockedAt: investigation.reportLockedAt,
        inspectionStatus: investigation.status,
        defaultRecipientEmail: ordererEmail,
        ordererEmail,
        hasActiveLink: Boolean(activeLink),
        pdfStatus: activeLink?.pdf_status ?? null,
        pdfError: activeLink?.pdf_error ?? null,
        downloadUrl: getPdfDownloadUrl(inspectionId, activeLink),
        digitalUrl: getDashboardDigitalReportUrl(inspectionId, activeLink),
        publicLink: null,
        deliveryDocuments,
        history,
        activityLog,
      })
    }

    if ((action === 'lock_only' || action === 'send_and_lock') && !investigation.reportLockedAt) {
      const finalizationBlocker = await getFinalizationBlocker(admin, investigation)
      if (finalizationBlocker) return jsonError(finalizationBlocker, 409)
    }

    const primaryRecipient =
      action === 'lock_only'
        ? null
        : normalizeEmail(body?.primary_recipient) ?? resolveDefaultRecipient(investigation)
    if (action !== 'lock_only' && !primaryRecipient) {
      return jsonError('Ange en giltig huvudmottagare.', 400)
    }
    if (action === 'lock_only' && investigation.reportLockedAt) {
      return jsonError('Utlåtandet är redan fastställt. Lås upp det för att skapa en ny revision.', 409)
    }

    let publicLink = ''
    let linkId = ''
    let currentRevision = await getCurrentTuRevision(admin, org.orgId, inspectionId)
    const sentRecipients: string[] = []
    const failedRecipients: Array<{ email: string; error: string }> = []

    const deliveryDocuments = await listTuDeliveryDocuments(admin, { orgId: org.orgId, inspectionId })
    const sendingFinalizedRevision = action === 'send_and_lock' && Boolean(investigation.reportLockedAt)
    let snapshotPayload: unknown
    let snapshotSchemaVersion = 'tu_v1'
    let snapshotAssignmentId = investigation.assignmentId

    if (sendingFinalizedRevision) {
      if (!currentRevision) {
        const latestFrozenLink = await getLatestReportLink(admin, inspectionId)
        if (!latestFrozenLink) {
          return jsonError('Den fastställda rapportversionen saknas. Lås upp och fastställ utlåtandet på nytt.', 409)
        }
        currentRevision = await createTuRevision(admin, {
          orgId: org.orgId,
          inspectionId,
          snapshotLinkId: latestFrozenLink.id,
          userId: org.userId,
        })
      }
      const frozenLink = await getReportSnapshotLink(admin, currentRevision.snapshot_link_id)
      if (frozenLink.org_id !== org.orgId) {
        return jsonError('Den fastställda rapportversionen tillhör inte din organisation.', 403)
      }
      snapshotPayload = frozenLink.snapshot_payload
      snapshotSchemaVersion = frozenLink.snapshot_schema_version || 'tu_v1'
      snapshotAssignmentId = frozenLink.assignment_id
    } else {
      const [coverImages, appendixImages] = await Promise.all([
        listTuInvestigationImages({ orgId: org.orgId, inspectionId, sectionKey: 'cover' }),
        listTuInvestigationImages({ orgId: org.orgId, inspectionId, sectionKey: 'appendix' }),
      ])
      snapshotPayload = createTuReportSnapshotPayloadV1({
        investigation,
        coverImages,
        appendixImages,
        deliveryDocuments,
      })
    }
    const token = generateAssignmentToken()
    const tokenHash = hashAssignmentToken(token)

    const { data: linkData, error: linkError } = await admin
      .from('inspection_report_links')
      .insert({
        org_id: org.orgId,
        inspection_id: inspectionId,
        assignment_id: snapshotAssignmentId,
        token_hash: tokenHash,
        delivery_mode: 'link_only',
        snapshot_schema_version: snapshotSchemaVersion,
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

    if (linkError || !linkData) throw new Error(linkError?.message ?? 'Kunde inte skapa rapportlänk.')
    linkId = linkData.id as string

    const publicBaseUrl = resolvePublicBaseUrl(request)
    publicLink = `${publicBaseUrl}/rapport/${encodeURIComponent(token)}`
    after(async () => {
      await runInspectionReportPdfBatch({
        origin: publicBaseUrl,
        linkId,
        limit: 1,
      })
    })

    if (action !== 'lock_only') {
      const recipients = [
        primaryRecipient as string,
        ...parseExtraRecipients(body?.extra_recipients, primaryRecipient),
      ]
      const emailContent = buildInspectionReportDeliveryEmail({
        orgName: org.orgName,
        customerName: investigation.assignment?.customer_name ?? investigation.inspection.customer_name,
        propertyAddress: resolvePropertyAddress(investigation),
        inspectionDate: resolveInspectionDate(investigation),
        detailsUrl: publicLink,
      })
      const replyToEmail = investigation.inspector?.email?.trim() || null

      for (const recipient of recipients) {
        const messageId = await createOutboundMessage(admin, {
          orgId: org.orgId,
          assignmentId: investigation.assignmentId,
          inspectionId,
          createdBy: org.userId,
          recipientEmail: recipient,
          subject: emailContent.subject,
          replyToEmail,
        })

        try {
          const sendResult = await sendAssignmentEmail({
            to: recipient,
            from: getMailFromAddress(),
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
          sentRecipients.push(recipient)
        } catch (sendError) {
          const message = sendError instanceof Error ? sendError.message : 'Mejlutskick misslyckades.'
          await updateOutboundMessage(admin, messageId, {
            status: 'failed',
            error_message: message,
          })
          failedRecipients.push({ email: recipient, error: message })
        }
      }
    }

    let reportLockedAt = investigation.reportLockedAt
    if (action === 'lock_only') {
      currentRevision = await createTuRevision(admin, {
        orgId: org.orgId,
        inspectionId,
        snapshotLinkId: linkId,
        userId: org.userId,
      })
      try {
        reportLockedAt = await lockTuInvestigation(admin, {
          orgId: org.orgId,
          inspectionId,
          userId: org.userId,
        })
      } catch (lockError) {
        await Promise.allSettled([
          admin
            .from('tu_report_revisions')
            .update({ status: 'withdrawn' })
            .eq('id', currentRevision.id)
            .eq('org_id', org.orgId),
          admin
            .from('inspection_report_links')
            .update({ revoked_at: new Date().toISOString() })
            .eq('id', linkId),
        ])
        throw lockError
      }
    } else if (sentRecipients.length > 0) {
      if (action === 'send_and_lock') {
        if (!sendingFinalizedRevision) {
          currentRevision = await createTuRevision(admin, {
            orgId: org.orgId,
            inspectionId,
            snapshotLinkId: linkId,
            userId: org.userId,
          })
        }
        if (!currentRevision) throw new Error('Den fastställda TU-revisionen saknas.')
        await publishTuRevision(admin, {
          orgId: org.orgId,
          inspectionId,
          revisionId: currentRevision.id,
          publishedLinkId: linkId,
          userId: org.userId,
        })
        reportLockedAt = reportLockedAt ?? (await lockTuInvestigation(admin, {
          orgId: org.orgId,
          inspectionId,
          userId: org.userId,
        }))
      }
      await revokeOlderReportLinks(admin, inspectionId, linkId)
    } else {
      await admin
        .from('inspection_report_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', linkId)
    }

    const [history, unlockHistory, activeLink] = await Promise.all([
      getDeliveryHistory(admin, inspectionId),
      getUnlockHistory(admin, org.orgId, inspectionId),
      getLatestReportLink(admin, inspectionId),
    ])
    const activityLog = buildDeliveryActivityLog({ history, unlockHistory })

    return NextResponse.json({
      inspectionId,
      reportLockedAt,
      inspectionStatus: action === 'send_and_lock' || action === 'lock_only' ? 'completed' : investigation.status,
      deliveryMode: 'link_only',
      publicLink,
      primaryRecipientEmail: primaryRecipient,
      defaultRecipientEmail: resolveDefaultRecipient(investigation),
      ordererEmail: resolveDefaultRecipient(investigation),
      sentRecipients,
      failedRecipients,
      history,
      activityLog,
      hasActiveLink: Boolean(activeLink),
      pdfStatus: activeLink?.pdf_status ?? null,
      pdfError: activeLink?.pdf_error ?? null,
      downloadUrl: getPdfDownloadUrl(inspectionId, activeLink),
      digitalUrl: getDashboardDigitalReportUrl(inspectionId, activeLink),
      deliveryDocuments,
      linkId,
      revisionNumber: currentRevision?.revision_number ?? null,
      revisionStatus:
        action === 'send_and_lock' && sentRecipients.length > 0
          ? 'published'
          : currentRevision?.status ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'TU_REVISIONS_NOT_ACTIVATED') {
      return jsonError('TU-revisioner är inte aktiverade i databasen ännu.', 409)
    }
    if (message.includes('RESEND_API_KEY')) return jsonError('Servern saknar mejlkonfiguration.', 500)
    if (message.includes('ASSIGNMENTS_MAIL_FROM')) {
      return jsonError('Servern saknar avsändaradress för mejl.', 500)
    }
    return jsonError(message || 'Kunde inte skicka TU-utlåtandet.', 500)
  }
}
