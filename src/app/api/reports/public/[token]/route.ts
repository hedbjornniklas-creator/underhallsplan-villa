import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { buildInspectionReportShareEmail } from '@/lib/inspections/reportEmailTemplates'
import { getEbInspectionReportFromSnapshot } from '@/lib/eb/reportSnapshot'
import { buildReportPdfFileName } from '@/lib/report/reportFileName'
import {
  getTuSnapshotEmailMeta,
  isTuReportSnapshotPayloadV1,
  type TuReportDeliveryDocument,
} from '@/lib/tu/reportSnapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const REPORT_PDF_SIGNED_URL_TTL_SECONDS = Math.max(
  30,
  Number(process.env.REPORT_PDF_SIGNED_URL_TTL_SECONDS ?? 120)
)
const SHARE_TEMPLATE_KEY = 'inspection_report_share'
const SHARE_MAX_PER_REPORT_WINDOW = 5
const SHARE_REPORT_WINDOW_MS = 10 * 60 * 1000
const SHARE_MAX_PER_RECIPIENT_WINDOW = 3
const SHARE_RECIPIENT_WINDOW_MS = 24 * 60 * 60 * 1000

function notFoundResponse() {
  return new NextResponse('Not found', { status: 404 })
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizePdfStatus(value: unknown): 'pending' | 'processing' | 'ready' | 'failed' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
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

function isValidEmail(value: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(value)
}

function normalizeEmail(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return normalized && isValidEmail(normalized) ? normalized : null
}

const sanitizeFilenamePart = (value: string | null | undefined) => {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

const buildDocumentFileName = (document: TuReportDeliveryDocument) => {
  const fromTitle = sanitizeFilenamePart(document.title)
  const fromFileName = sanitizeFilenamePart(document.fileName)
  return fromTitle || fromFileName || 'Underlag'
}

function getSnapshotMock(snapshotPayload: unknown): Record<string, unknown> {
  if (!snapshotPayload || typeof snapshotPayload !== 'object') return {}
  const reportData = (snapshotPayload as Record<string, unknown>).reportData
  if (!reportData || typeof reportData !== 'object') return {}
  const mock = (reportData as Record<string, unknown>).mock
  return mock && typeof mock === 'object' ? (mock as Record<string, unknown>) : {}
}

function getNestedRecord(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = root[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizedSnapshotText(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized === '--') return null
  return normalized
}

function extractAssignmentNumberFromSnapshot(snapshotPayload: unknown): string | null {
  if (isTuReportSnapshotPayloadV1(snapshotPayload)) {
    return snapshotPayload.meta.assignmentNumber
  }

  if (!snapshotPayload || typeof snapshotPayload !== 'object') return null
  const snapshot = snapshotPayload as Record<string, unknown>
  const reportData = snapshot.reportData
  if (!reportData || typeof reportData !== 'object') return null
  const mock = (reportData as Record<string, unknown>).mock
  if (!mock || typeof mock !== 'object') return null
  const inspections = (mock as Record<string, unknown>).inspections
  if (!inspections || typeof inspections !== 'object') return null
  const assignmentNumber = (inspections as Record<string, unknown>).assignment_number
  const normalized = String(assignmentNumber ?? '').trim()
  return normalized || null
}

async function countShareMessages(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    orgId: string
    inspectionId: string
    recipientEmail?: string | null
    since: string
  }
) {
  let query = admin
    .from('outbound_messages')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('template_key', SHARE_TEMPLATE_KEY)
    .gte('created_at', input.since)

  if (input.recipientEmail) {
    query = query.eq('recipient_email', input.recipientEmail)
  }

  const { count, error } = await query
  if (error) {
    throw new Error(error.message ?? 'Kunde inte kontrollera delningsgräns.')
  }

  return count ?? 0
}

async function createShareOutboundMessage(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    orgId: string
    assignmentId: string | null
    inspectionId: string
    createdBy: string | null
    recipientEmail: string
    subject: string
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
      template_key: SHARE_TEMPLATE_KEY,
      status: 'pending',
      created_by: input.createdBy,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte skapa delningslogg.')
  }

  return data.id as string
}

async function updateShareOutboundMessage(
  admin: ReturnType<typeof createSupabaseAdminClient>,
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
    console.error('[reports.public.share] failed to update outbound_messages', {
      id,
      error: error.message ?? error,
    })
  }
}

function decodeBase64(base64: string, linkId: string): Buffer {
  let pdfBuffer: Buffer
  try {
    pdfBuffer = Buffer.from(base64, 'base64')
  } catch (decodeError) {
    console.error('[reports.public] base64 decode failed', {
      linkId,
      error: decodeError instanceof Error ? decodeError.message : String(decodeError),
    })
    throw new Error('Could not decode report.')
  }

  if (pdfBuffer.length === 0) {
    throw new Error('Report snapshot is empty.')
  }

  return pdfBuffer
}

async function createSignedPdfUrl(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bucket: string,
  path: string,
  asAttachment: boolean,
  fileName: string,
  linkId: string
) {
  try {
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, REPORT_PDF_SIGNED_URL_TTL_SECONDS, {
        download: asAttachment ? fileName : false,
      })

    if (error || !data?.signedUrl) {
      console.error('[reports.public] signed url failed', {
        linkId,
        bucket,
        path,
        error: error?.message ?? error ?? null,
      })
      return null
    }

    return data.signedUrl
  } catch (signedUrlError) {
    console.error('[reports.public] signed url exception', {
      linkId,
      bucket,
      path,
      error: signedUrlError instanceof Error ? signedUrlError.message : String(signedUrlError),
    })
    return null
  }
}

async function createSignedDocumentUrl(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  document: TuReportDeliveryDocument,
  asAttachment: boolean,
  linkId: string
) {
  try {
    const bucket = String(document.storageBucket ?? '').trim()
    const path = String(document.filePath ?? '').trim()
    if (!bucket || !path) return null

    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, REPORT_PDF_SIGNED_URL_TTL_SECONDS, {
        download: asAttachment ? buildDocumentFileName(document) : false,
      })

    if (error || !data?.signedUrl) {
      console.error('[reports.public] document signed url failed', {
        linkId,
        bucket,
        path,
        documentId: document.id,
        error: error?.message ?? error ?? null,
      })
      return null
    }

    return data.signedUrl
  } catch (signedUrlError) {
    console.error('[reports.public] document signed url exception', {
      linkId,
      documentId: document.id,
      error: signedUrlError instanceof Error ? signedUrlError.message : String(signedUrlError),
    })
    return null
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const normalizedToken = token?.trim() ?? ''

    if (normalizedToken.length < 20) {
      return notFoundResponse()
    }

    const body = (await request.json().catch(() => null)) as { email?: unknown } | null
    const recipientEmail = normalizeEmail(body?.email)
    if (!recipientEmail) {
      return jsonError('Ange en giltig e-postadress.', 400)
    }

    const tokenHash = hashAssignmentToken(normalizedToken)
    const admin = createSupabaseAdminClient()

    const { data: linkData, error: linkError } = await admin
      .from('inspection_report_links')
      .select('id,org_id,inspection_id,assignment_id,created_by,revoked_at,snapshot_payload')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (linkError) {
      console.error('[reports.public.share] lookup failed', { error: linkError.message ?? linkError })
      return jsonError('Kunde inte läsa utlåtandelänken.', 500)
    }

    if (!linkData || linkData.revoked_at) {
      return notFoundResponse()
    }

    const link = linkData as {
      id: string
      org_id: string
      inspection_id: string
      assignment_id: string | null
      created_by: string | null
      revoked_at: string | null
      snapshot_payload: unknown
    }

    const reportWindowStart = new Date(Date.now() - SHARE_REPORT_WINDOW_MS).toISOString()
    const recentShareCount = await countShareMessages(admin, {
      orgId: link.org_id,
      inspectionId: link.inspection_id,
      since: reportWindowStart,
    })
    if (recentShareCount >= SHARE_MAX_PER_REPORT_WINDOW) {
      return jsonError('För många delningar på kort tid. Försök igen om en stund.', 429)
    }

    const recipientWindowStart = new Date(Date.now() - SHARE_RECIPIENT_WINDOW_MS).toISOString()
    const recentRecipientShareCount = await countShareMessages(admin, {
      orgId: link.org_id,
      inspectionId: link.inspection_id,
      recipientEmail,
      since: recipientWindowStart,
    })
    if (recentRecipientShareCount >= SHARE_MAX_PER_RECIPIENT_WINDOW) {
      return jsonError('Länken har redan skickats till den här mottagaren flera gånger.', 429)
    }

    const { data: orgData } = await admin
      .from('organizations')
      .select('name')
      .eq('id', link.org_id)
      .maybeSingle()
    const orgName = String((orgData as { name?: string | null } | null)?.name ?? '').trim() || null

    const tuSnapshot = isTuReportSnapshotPayloadV1(link.snapshot_payload)
      ? link.snapshot_payload
      : null
    const ebReport = getEbInspectionReportFromSnapshot(link.snapshot_payload)
    const mock = getSnapshotMock(link.snapshot_payload)
    const properties = getNestedRecord(mock, 'properties')
    const inspections = getNestedRecord(mock, 'inspections')
    const tuMeta = tuSnapshot ? getTuSnapshotEmailMeta(tuSnapshot) : null
    const propertyAddress =
      tuMeta?.propertyAddress ??
      ebReport?.project.address ??
      normalizedSnapshotText(properties.address)
    const inspectionDate =
      tuMeta?.reportDate ??
      ebReport?.inspection.reportDistributionDate ??
      ebReport?.inspection.date ??
      normalizedSnapshotText(inspections.date) ??
      normalizedSnapshotText(inspections.date_time)
    const detailsUrl = `${resolvePublicBaseUrl(request)}/rapport/${encodeURIComponent(normalizedToken)}`
    const emailContent = buildInspectionReportShareEmail({
      orgName,
      propertyAddress,
      inspectionDate,
      detailsUrl,
    })

    const messageId = await createShareOutboundMessage(admin, {
      orgId: link.org_id,
      assignmentId: link.assignment_id,
      inspectionId: link.inspection_id,
      createdBy: link.created_by,
      recipientEmail,
      subject: emailContent.subject,
    })

    try {
      const sendResult = await sendAssignmentEmail({
        to: recipientEmail,
        from: getMailFromAddress(),
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      })

      await updateShareOutboundMessage(admin, messageId, {
        status: 'sent',
        provider: sendResult.provider,
        provider_message_id: sendResult.providerMessageId,
        sent_at: new Date().toISOString(),
      })
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Mejlutskick misslyckades.'
      await updateShareOutboundMessage(admin, messageId, {
        status: 'failed',
        error_message: message,
      })
      console.error('[reports.public.share] send failed', { error: message })
      return jsonError('Kunde inte skicka länken. Försök igen.', 502)
    }

    return NextResponse.json({ ok: true, recipientEmail })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[reports.public.share] unhandled error', { error: message })
    if (message.includes('RESEND_API_KEY')) {
      return jsonError('Servern saknar mejlkonfiguration.', 500)
    }
    if (message.includes('ASSIGNMENTS_MAIL_FROM')) {
      return jsonError('Servern saknar avsändaradress för mejl.', 500)
    }
    return jsonError('Kunde inte dela utlåtandet.', 500)
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const normalizedToken = token?.trim() ?? ''

    if (normalizedToken.length < 20) {
      return notFoundResponse()
    }

    const tokenHash = hashAssignmentToken(normalizedToken)
    const admin = createSupabaseAdminClient()

    const { data, error } = await admin
      .from('inspection_report_links')
      .select(
        'id,inspection_id,snapshot_payload,pdf_base64,pdf_storage_bucket,pdf_storage_path,pdf_status,pdf_error,revoked_at,delivery_mode'
      )
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (error) {
      console.error('[reports.public] lookup failed', { error: error.message ?? error })
      return new NextResponse('Could not load report.', { status: 500 })
    }

    if (!data || data.revoked_at) {
      return notFoundResponse()
    }

    const requestUrl = new URL(request.url)
    const asAttachment = requestUrl.searchParams.get('download') === '1'
    const requestedDocumentId = String(requestUrl.searchParams.get('documentId') ?? '').trim()

    if (requestedDocumentId) {
      const snapshotPayload = (data as Record<string, unknown>).snapshot_payload
      const tuSnapshot = isTuReportSnapshotPayloadV1(snapshotPayload) ? snapshotPayload : null
      const document =
        tuSnapshot?.deliveryDocuments?.find((item) => item.id === requestedDocumentId) ?? null

      if (!document) {
        return notFoundResponse()
      }

      const signedUrl = await createSignedDocumentUrl(
        admin,
        document,
        asAttachment,
        String(data.id)
      )
      if (!signedUrl) {
        return new NextResponse('Kunde inte skapa säker nedladdningslänk för dokumentet.', {
          status: 500,
        })
      }

      return NextResponse.redirect(signedUrl, 302)
    }

    const snapshotPayload = (data as Record<string, unknown>).snapshot_payload
    const ebSnapshotReport = getEbInspectionReportFromSnapshot(snapshotPayload)
    let assignmentNumber =
      ebSnapshotReport?.inspection.assignmentNumber ?? extractAssignmentNumberFromSnapshot(snapshotPayload)
    const inspectionId = String((data as Record<string, unknown>).inspection_id ?? '').trim()
    let inspectionFamily: string | null = ebSnapshotReport ? 'EB' : null
    let inspectionDate: string | null = ebSnapshotReport?.inspection.date ?? null
    let inspectionSequenceNo: number | null = ebSnapshotReport?.inspection.sequenceNo ?? null
    if (inspectionId) {
      const { data: inspection } = await admin
        .from('inspections')
        .select('assignment_number,inspection_family,date')
        .eq('id', inspectionId)
        .maybeSingle()
      const inspectionRow = inspection as
        | { assignment_number?: string | null; inspection_family?: string | null; date?: string | null }
        | null
      assignmentNumber =
        assignmentNumber || String(inspectionRow?.assignment_number ?? '').trim() || null
      inspectionFamily =
        inspectionFamily || String(inspectionRow?.inspection_family ?? '').trim() || null
      inspectionDate = inspectionDate || String(inspectionRow?.date ?? '').trim() || null
      if (String(inspectionFamily ?? '').toUpperCase() === 'EB') {
        const { data: ebDetail } = await admin
          .from('eb_inspection_details')
          .select('sequence_no')
          .eq('inspection_id', inspectionId)
          .maybeSingle()
        inspectionSequenceNo =
          inspectionSequenceNo ??
          Number((ebDetail as { sequence_no?: number | null } | null)?.sequence_no ?? null)
      }
    }
    const fileName = buildReportPdfFileName({
      assignmentNumber,
      inspectionDate,
      inspectionFamily,
      inspectionSequenceNo,
    })
    const pdfBase64 = String(data.pdf_base64 ?? '').trim()
    const pdfStorageBucket = String((data as Record<string, unknown>).pdf_storage_bucket ?? '').trim()
    const pdfStoragePath = String((data as Record<string, unknown>).pdf_storage_path ?? '').trim()
    const hasStorageRef = pdfStorageBucket.length > 0 && pdfStoragePath.length > 0
    const hasLegacyPdf = pdfBase64.length > 0
    const pdfStatus = normalizePdfStatus((data as Record<string, unknown>).pdf_status)
    const pdfError = String((data as Record<string, unknown>).pdf_error ?? '').trim()

    if (hasStorageRef && pdfStatus === 'ready') {
      const signedUrl = await createSignedPdfUrl(
        admin,
        pdfStorageBucket,
        pdfStoragePath,
        asAttachment,
        fileName,
        String(data.id)
      )
      if (signedUrl) {
        return NextResponse.redirect(signedUrl, 302)
      }
    }

    let pdfBuffer: Buffer | null = null
    if (!hasStorageRef && hasLegacyPdf) {
      try {
        pdfBuffer = decodeBase64(pdfBase64, String(data.id))
      } catch (decodeError) {
        console.error('[reports.public] stored pdf decode failed', {
          linkId: data.id,
          error: decodeError instanceof Error ? decodeError.message : String(decodeError),
        })
      }
    }

    if (!pdfBuffer) {
      console.error('[reports.public] stored pdf missing', {
        linkId: data.id,
        deliveryMode: data.delivery_mode ?? null,
        pdfStatus,
      })
      if (pdfStatus === 'pending' || pdfStatus === 'processing') {
        return new NextResponse('PDF genereras fortfarande i bakgrunden. Försök igen om en stund.', {
          status: 409,
        })
      }
      if (pdfStatus === 'failed') {
        const suffix = pdfError ? ` (${pdfError})` : ''
        return new NextResponse(`PDF-generering misslyckades${suffix}.`, { status: 500 })
      }
      if (hasStorageRef && !hasLegacyPdf) {
        return new NextResponse('Kunde inte skapa säker nedladdningslänk för PDF.', { status: 500 })
      }
      return new NextResponse('Stored report PDF is missing.', { status: 500 })
    }

    const encodedFileName = encodeURIComponent(fileName)
    const disposition = asAttachment
      ? `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`
      : `inline; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition,
        'Content-Length': String(pdfBuffer.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[reports.public] unhandled error', { error: message })
    return new NextResponse('Could not load report.', { status: 500 })
  }
}
