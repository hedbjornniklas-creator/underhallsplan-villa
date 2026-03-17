import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { requireOrgContext, getProfileContact } from '@/lib/assignments/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { renderPreviewPdf } from '@/lib/report/pdfV2/renderPreviewPdf'
import { buildInspectionReportDeliveryEmail } from '@/lib/inspections/reportEmailTemplates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

function parseExtraRecipients(input: unknown, requiredEmail: string) {
  const requiredLower = requiredEmail.toLowerCase()
  if (!Array.isArray(input)) return []

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const unique = new Set<string>()

  for (const value of input) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase()
    if (!normalized || normalized === requiredLower) continue
    if (!emailRegex.test(normalized)) continue
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
    .select('id,property_id,status')
    .eq('id', inspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa besiktning.')
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
    throw new Error(error.message ?? 'Kunde inte läsa kopplad uppdragsbekräftelse.')
  }

  return (data ?? null) as AssignmentForDelivery | null
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
    throw new Error(error.message ?? 'Kunde inte hämta leveranshistorik.')
  }

  return (data ?? []) as OutboundMessageRow[]
}

async function createOutboundMessage(
  admin: AdminClient,
  input: {
    orgId: string
    assignmentId: string
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
  const { error } = await admin
    .from('outbound_messages')
    .update(patch)
    .eq('id', id)

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
    const ordererEmail = assignment?.customer_email?.trim().toLowerCase() ?? null

    if (!assignment || !ordererEmail) {
      return NextResponse.json({
        inspectionId: id,
        inspectionStatus: normalizeInspectionStatus(inspection.status),
        canSend: false,
        reason: 'Mottagare saknas. Besiktningen måste vara kopplad till en godkänd uppdragsbekräftelse.',
        ordererEmail: null,
        history: [],
      })
    }

    const history = await getDeliveryHistory(admin, assignment.id)

    return NextResponse.json({
      inspectionId: id,
      inspectionStatus: normalizeInspectionStatus(inspection.status),
      canSend: normalizeInspectionStatus(inspection.status) !== 'archived',
      reason:
        normalizeInspectionStatus(inspection.status) === 'archived'
          ? 'Arkiverad besiktning kan inte skickas.'
          : null,
      ordererEmail,
      history,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte läsa utskicksstatus.', 500)
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
      return jsonError(
        'Besiktningen saknar kopplad uppdragsbekräftelse. Beställare måste finnas innan utskick.',
        400
      )
    }

    const ordererEmail = assignment.customer_email?.trim().toLowerCase() ?? ''
    if (!ordererEmail) {
      return jsonError('Beställarens e-post saknas i uppdragsbekräftelsen.', 400)
    }

    const propertyId = assignment.property_id ?? inspection.property_id
    if (!propertyId) {
      return jsonError('Besiktningen saknar kopplad fastighet.', 400)
    }

    const extraRecipients = parseExtraRecipients(body?.extra_recipients, ordererEmail)
    const recipients = [ordererEmail, ...extraRecipients]

    const reportUrl = `${buildOrigin(request)}/utlatande/${propertyId}/${id}?embed=1&pdf=1`
    const pdfBuffer = await renderPreviewPdf({
      url: reportUrl,
      cookieHeader: request.headers.get('cookie'),
    })
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64')
    const pdfSha256 = createHash('sha256').update(pdfBuffer).digest('hex')

    const token = generateAssignmentToken()
    const tokenHash = hashAssignmentToken(token)

    const { data: linkData, error: linkError } = await admin
      .from('inspection_report_links')
      .insert({
        org_id: org.orgId,
        inspection_id: id,
        assignment_id: assignment.id,
        token_hash: tokenHash,
        pdf_base64: pdfBase64,
        pdf_sha256: pdfSha256,
        created_by: org.userId,
      })
      .select('id')
      .single()

    if (linkError || !linkData) {
      throw new Error(linkError?.message ?? 'Kunde inte skapa rapportlänk.')
    }

    const linkUrl = `${resolvePublicBaseUrl(request)}/api/reports/public/${token}`
    const fromAddress = getMailFromAddress()
    const responsibleProfile = await getProfileContact(assignment.responsible_profile_id)
    const replyToEmail = responsibleProfile?.email?.trim() || null
    const emailContent = buildInspectionReportDeliveryEmail({
      orgName: org.orgName,
      customerName: assignment.customer_name,
      propertyAddress: assignment.property_address ?? assignment.preliminary_address,
      inspectionDate: assignment.preferred_date,
      detailsUrl: linkUrl,
    })

    const failedRecipients: Array<{ email: string; error: string }> = []
    const sentRecipients: string[] = []
    let ordererSent = false

    for (const recipient of recipients) {
      const messageId = await createOutboundMessage(admin, {
        orgId: org.orgId,
        assignmentId: assignment.id,
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
          attachments: [
            {
              filename: `besiktningsutlatande-${id.slice(0, 8)}.pdf`,
              contentBase64: pdfBase64,
              contentType: 'application/pdf',
            },
          ],
        })

        await updateOutboundMessage(admin, messageId, {
          status: 'sent',
          provider: sendResult.provider,
          provider_message_id: sendResult.providerMessageId,
          sent_at: new Date().toISOString(),
        })

        sentRecipients.push(recipient)
        if (recipient === ordererEmail) ordererSent = true
      } catch (sendError) {
        const message =
          sendError instanceof Error ? sendError.message : 'Okänt fel vid mejlutskick.'
        failedRecipients.push({ email: recipient, error: message })

        await updateOutboundMessage(admin, messageId, {
          status: 'failed',
          error_message: message,
        })

        if (recipient === ordererEmail) {
          return jsonError('Kunde inte skicka till beställaren.', 502, {
            failedRecipients,
            sentRecipients,
          })
        }
      }
    }

    if (ordererSent && inspectionStatus !== 'completed') {
      const { error: updateInspectionError } = await admin
        .from('inspections')
        .update({ status: 'completed' })
        .eq('id', id)

      if (updateInspectionError) {
        throw new Error(updateInspectionError.message ?? 'Kunde inte uppdatera besiktningsstatus till klar.')
      }
    }

    const history = await getDeliveryHistory(admin, assignment.id)

    return NextResponse.json({
      inspectionId: id,
      inspectionStatus: ordererSent ? 'completed' : inspectionStatus,
      deliveryMode: 'link_pdf',
      publicLink: linkUrl,
      ordererEmail,
      sentRecipients,
      failedRecipients,
      history,
      linkId: linkData.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
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
    return jsonError(message || 'Kunde inte skicka utlåtandet.', 500)
  }
}
