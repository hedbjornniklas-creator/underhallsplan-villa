import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { buildInspectionReportDeliveryEmail } from '@/lib/inspections/reportEmailTemplates'
import {
  getTuInvestigationById,
  listTuInvestigationImages,
  requireTuContext,
} from '@/lib/tu/server'
import { createTuReportSnapshotPayloadV1 } from '@/lib/tu/reportSnapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEMPLATE_KEY = 'tu_report_delivery'

type DeliveryAction = 'send_and_lock' | 'send_open' | 'lock_only'

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

function parseAction(value: unknown): DeliveryAction {
  const normalized = normalizeText(value)
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
  admin: ReturnType<typeof createSupabaseAdminClient>,
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
  admin: ReturnType<typeof createSupabaseAdminClient>,
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
    console.error('[tu.report-delivery] failed to update outbound message', {
      id,
      error: error.message ?? error,
    })
  }
}

async function getDeliveryHistory(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inspectionId: string
) {
  const { data, error } = await admin
    .from('outbound_messages')
    .select('id,recipient_email,status,sent_at,created_at,error_message,subject')
    .eq('inspection_id', inspectionId)
    .eq('template_key', TEMPLATE_KEY)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw new Error(error.message ?? 'Kunde inte hämta leveranshistorik.')
  return data ?? []
}

async function getLatestReportLink(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inspectionId: string
) {
  const { data, error } = await admin
    .from('inspection_report_links')
    .select('id,created_at,pdf_status,pdf_error,revoked_at')
    .eq('inspection_id', inspectionId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Kunde inte läsa rapportlänk.')
  return data as
    | {
        id: string
        created_at: string | null
        pdf_status: string | null
        pdf_error: string | null
        revoked_at: string | null
      }
    | null
}

async function lockTuInvestigation(
  admin: ReturnType<typeof createSupabaseAdminClient>,
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

function resolveDefaultRecipient(investigation: Awaited<ReturnType<typeof getTuInvestigationById>>) {
  if (!investigation) return null
  return normalizeEmail(
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

export async function GET(
  _request: Request,
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

    const [history, activeLink] = await Promise.all([
      getDeliveryHistory(admin, inspectionId),
      getLatestReportLink(admin, inspectionId),
    ])
    const ordererEmail = resolveDefaultRecipient(investigation)

    return NextResponse.json({
      inspectionId,
      reportLockedAt: investigation.reportLockedAt,
      inspectionStatus: investigation.status,
      defaultRecipientEmail: ordererEmail,
      ordererEmail,
      hasActiveLink: Boolean(activeLink),
      pdfStatus: activeLink?.pdf_status ?? null,
      pdfError: activeLink?.pdf_error ?? null,
      history,
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

    const primaryRecipient =
      action === 'lock_only'
        ? null
        : normalizeEmail(body?.primary_recipient) ?? resolveDefaultRecipient(investigation)
    if (action !== 'lock_only' && !primaryRecipient) {
      return jsonError('Ange en giltig huvudmottagare.', 400)
    }

    let publicLink = ''
    let linkId = ''
    const sentRecipients: string[] = []
    const failedRecipients: Array<{ email: string; error: string }> = []

      const [coverImages, appendixImages] = await Promise.all([
        listTuInvestigationImages({ orgId: org.orgId, inspectionId, sectionKey: 'cover' }),
        listTuInvestigationImages({ orgId: org.orgId, inspectionId, sectionKey: 'appendix' }),
      ])
      const snapshotPayload = createTuReportSnapshotPayloadV1({
        investigation,
        coverImages,
        appendixImages,
      })
      const token = generateAssignmentToken()
      const tokenHash = hashAssignmentToken(token)

      const { data: linkData, error: linkError } = await admin
        .from('inspection_report_links')
        .insert({
          org_id: org.orgId,
          inspection_id: inspectionId,
          assignment_id: investigation.assignmentId,
          token_hash: tokenHash,
          delivery_mode: 'link_only',
          snapshot_schema_version: 'tu_v1',
          snapshot_payload: snapshotPayload,
          pdf_status: 'pending',
          pdf_error: null,
          pdf_attempts: 0,
          created_by: org.userId,
        })
        .select('id')
        .single()

      if (linkError || !linkData) throw new Error(linkError?.message ?? 'Kunde inte skapa rapportlänk.')
      linkId = linkData.id as string
      await revokeOlderReportLinks(admin, inspectionId, linkId)

      publicLink = `${resolvePublicBaseUrl(request)}/rapport/${encodeURIComponent(token)}`

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
    if (action === 'send_and_lock' || action === 'lock_only') {
      reportLockedAt = reportLockedAt ?? (await lockTuInvestigation(admin, {
        orgId: org.orgId,
        inspectionId,
        userId: org.userId,
      }))
    }

    const [history, activeLink] = await Promise.all([
      getDeliveryHistory(admin, inspectionId),
      getLatestReportLink(admin, inspectionId),
    ])

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
      hasActiveLink: Boolean(activeLink),
      pdfStatus: activeLink?.pdf_status ?? null,
      pdfError: activeLink?.pdf_error ?? null,
      linkId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message.includes('RESEND_API_KEY')) return jsonError('Servern saknar mejlkonfiguration.', 500)
    if (message.includes('ASSIGNMENTS_MAIL_FROM')) {
      return jsonError('Servern saknar avsändaradress för mejl.', 500)
    }
    return jsonError(message || 'Kunde inte skicka TU-utlåtandet.', 500)
  }
}
