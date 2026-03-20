import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createHash } from 'node:crypto'
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

type ReportPdfState = {
  hasStoredPdf: boolean
  latestLinkId: string | null
}

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

function getMailFromAddress() {
  const value = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!value) {
    throw new Error('ASSIGNMENTS_MAIL_FROM saknas. Konfigurera avsandaradress innan utskick.')
  }
  return value
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
    .select('id,pdf_base64,revoked_at,created_at')
    .eq('inspection_id', inspectionId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa PDF-status för utlåtandet.')
  }

  const pdfBase64 = String(data?.pdf_base64 ?? '').trim()
  return {
    hasStoredPdf: pdfBase64.length > 0,
    latestLinkId: (data?.id as string | undefined) ?? null,
  }
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
      canDownloadPdf: inspectionStatus === 'completed' && pdfState.hasStoredPdf,
      history,
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
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()
    const body = (await request.json().catch(() => null)) as
      | {
          primary_recipient?: unknown
          extra_recipients?: unknown
        }
      | null

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
    const reportSpec = buildReportSpec({ inspectionSide: specInspectionSide })
    const snapshotPayload: ReportSnapshotPayloadV1 = createReportSnapshotPayloadV1({
      inspectionId: id,
      propertyId,
      inspectionSide,
      reportData,
      reportSpec,
    })

    const previewReportUrl = `${resolvePublicBaseUrl(request)}/utlatande/${propertyId}/${id}?embed=1&pdf=1`
    let previewPdfBuffer: Buffer
    try {
      const rendered = await renderPreviewPdf({
        url: previewReportUrl,
        cookieHeader: request.headers.get('cookie'),
        timeoutMs: 45000,
      })
      previewPdfBuffer = Buffer.isBuffer(rendered) ? rendered : Buffer.from(rendered)
    } catch (previewError) {
      const previewMessage =
        previewError instanceof Error ? previewError.message : String(previewError)
      console.error('[inspections.report-delivery] preview-pdf failed', {
        inspectionId: id,
        error: previewMessage,
      })
      return jsonError(
        `Kunde inte skapa fullständig PDF-layout för utlåtandet. ${previewMessage}`,
        500
      )
    }

    const previewPdfBase64 = previewPdfBuffer.toString('base64')
    const previewPdfSha256 = createHash('sha256').update(previewPdfBuffer).digest('hex')

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
        pdf_base64: previewPdfBase64,
        pdf_sha256: previewPdfSha256,
        created_by: org.userId,
      })
      .select('id')
      .single()

    if (linkError || !linkData) {
      throw new Error(linkError?.message ?? 'Kunde inte skapa rapportlÃ¤nk.')
    }

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

        sentRecipients.push(recipient)
        if (recipient === primaryRecipient) primarySent = true
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : 'OkÃ¤nt fel vid mejlutskick.'
        failedRecipients.push({ email: recipient, error: message })

        await updateOutboundMessage(admin, messageId, {
          status: 'failed',
          error_message: message,
        })

        if (recipient === primaryRecipient) {
          return jsonError('Kunde inte skicka till huvudmottagaren.', 502, {
            failedRecipients,
            sentRecipients,
          })
        }
      }
    }

    if (primarySent && inspectionStatus !== 'completed') {
      const { error: updateInspectionError } = await admin
        .from('inspections')
        .update({ status: 'completed' })
        .eq('id', id)

      if (updateInspectionError) {
        throw new Error(updateInspectionError.message ?? 'Kunde inte uppdatera besiktningsstatus till klar.')
      }
    }

    const history = assignment ? await getDeliveryHistory(admin, assignment.id) : []
    const finalInspectionStatus = primarySent ? 'completed' : inspectionStatus

    return NextResponse.json({
      inspectionId: id,
      inspectionStatus: finalInspectionStatus,
      deliveryMode: 'link_only',
      publicLink: linkUrl,
      primaryRecipientEmail: primaryRecipient,
      defaultRecipientEmail: fallbackOrdererEmail,
      ordererEmail: fallbackOrdererEmail,
      hasStoredPdf: previewPdfBase64.length > 0,
      canDownloadPdf: finalInspectionStatus === 'completed' && previewPdfBase64.length > 0,
      sentRecipients,
      failedRecipients,
      history,
      linkId: linkData.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel.'
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
    console.error('[inspections.report-delivery] unhandled error', { error: message })
    return jsonError(message || 'Kunde inte skicka utlÃ¥tandet.', 500)
  }
}

