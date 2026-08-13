import { NextResponse, after } from 'next/server'
import { createHash } from 'node:crypto'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { getEbInspectionReport, getEbProjectById, type EbInspectionReport } from '@/lib/eb/server'
import {
  getPdfRenderDiagnostics,
  renderPreviewPdf,
} from '@/lib/report/pdfV2/renderPreviewPdf'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PDF_RENDER_TIMEOUT_MS = Number(process.env.REPORT_PDF_RENDER_TIMEOUT_MS ?? 60000)
const REPORT_PDF_STORAGE_BUCKET = process.env.REPORT_PDF_STORAGE_BUCKET?.trim() || 'inspection-reports'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed'

type EbReportLinkRow = {
  id: string
  created_at: string | null
  pdf_status: string | null
  pdf_error: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
  pdf_base64: string | null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizePdfStatus(value: unknown): PdfStatus {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
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

async function getLatestReportLink(admin: AdminClient, inspectionId: string) {
  const { data, error } = await admin
    .from('inspection_report_links')
    .select('id,created_at,pdf_status,pdf_error,revoked_at,pdf_storage_bucket,pdf_storage_path,pdf_base64')
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
    String(activeLink.pdf_storage_bucket ?? '').trim().length > 0 &&
    String(activeLink.pdf_storage_path ?? '').trim().length > 0
  const hasLegacyPdf = String(activeLink.pdf_base64 ?? '').trim().length > 0
  if (normalizePdfStatus(activeLink.pdf_status) !== 'ready' || (!hasStoragePdf && !hasLegacyPdf)) return null
  return `/api/report-v2/${encodeURIComponent(inspectionId)}/pdf`
}

function createEbSnapshotPayload(report: EbInspectionReport) {
  return JSON.parse(JSON.stringify({
    schemaVersion: 'eb_v1',
    createdAt: new Date().toISOString(),
    project: report.project,
    inspection: report.inspection,
    participants: report.participants,
    inspectionDocuments: report.inspectionDocuments,
    reportDraft: report.reportDraft,
    disciplines: report.disciplines,
    markers: report.markers,
    statuses: report.statuses,
    notes: report.notes,
    images: report.images,
    branding: report.branding,
  }))
}

async function lockEbInspection(admin: AdminClient, input: {
  orgId: string
  projectId: string
  inspectionId: string
  userId: string
}) {
  const { data, error } = await admin.rpc('lock_eb_inspection_report', {
    p_org_id: input.orgId,
    p_project_id: input.projectId,
    p_inspection_id: input.inspectionId,
    p_performed_by: input.userId,
  })

  if (error) throw new Error(error.message ?? 'Kunde inte låsa EB-utlåtandet.')
  return typeof data === 'string' ? data : new Date().toISOString()
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const admin = createSupabaseAdminClient()
    const project = await getEbProjectById({ orgId: org.orgId, projectId })
    const inspection = project?.inspections.find((item) => item.inspectionId === inspectionId) ?? null
    if (!project || !inspection) return jsonError('Besiktningen hittades inte.', 404)

    const activeLink = await getLatestReportLink(admin, inspectionId)

    return NextResponse.json({
      inspectionId,
      reportLockedAt: inspection.reportLockedAt,
      inspectionStatus: inspection.status,
      hasActiveLink: Boolean(activeLink),
      pdfStatus: activeLink?.pdf_status ?? null,
      pdfError: activeLink?.pdf_error ?? null,
      downloadUrl: getPdfDownloadUrl(inspectionId, activeLink),
      project,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
    return jsonError('Kunde inte läsa EB-utlåtandets status.', 500)
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
    const report = await getEbInspectionReport({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
    })

    if (report.inspection.reportLockedAt) {
      return jsonError('Utlåtandet är redan låst.', 409)
    }

    const token = generateAssignmentToken()
    const tokenHash = hashAssignmentToken(token)
    const snapshotPayload = createEbSnapshotPayload(report)

    const { data: linkData, error: linkError } = await admin
      .from('inspection_report_links')
      .insert({
        org_id: org.orgId,
        inspection_id: inspectionId,
        assignment_id: null,
        token_hash: tokenHash,
        delivery_mode: 'link_only',
        snapshot_schema_version: 'eb_v1',
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
    const linkId = linkData.id as string
    await revokeOlderReportLinks(admin, inspectionId, linkId)

    const reportLockedAt = await lockEbInspection(admin, {
      orgId: org.orgId,
      projectId,
      inspectionId,
      userId: org.userId,
    })

    const publicBaseUrl = resolvePublicBaseUrl(request)
    after(async () => {
      await runEbReportPdfJobInBackground({
        linkId,
        orgId: org.orgId,
        projectId,
        inspectionId,
        tokenHash,
        previewReportUrl: `${publicBaseUrl}/eb/projects/${encodeURIComponent(projectId)}/inspections/${encodeURIComponent(inspectionId)}/report?pdf=1`,
        cookieHeader: request.headers.get('cookie'),
      })
    })

    const [activeLink, project] = await Promise.all([
      getLatestReportLink(admin, inspectionId),
      getEbProjectById({ orgId: org.orgId, projectId }),
    ])

    return NextResponse.json({
      inspectionId,
      reportLockedAt,
      inspectionStatus: 'completed',
      hasActiveLink: Boolean(activeLink),
      pdfStatus: activeLink?.pdf_status ?? null,
      pdfError: activeLink?.pdf_error ?? null,
      downloadUrl: getPdfDownloadUrl(inspectionId, activeLink),
      linkId,
      project,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
    if (message === 'EB_PROJECT_NOT_FOUND' || message === 'EB_INSPECTION_NOT_FOUND') {
      return jsonError('Besiktningen hittades inte.', 404)
    }
    return jsonError('Kunde inte låsa EB-utlåtandet.', 500)
  }
}
