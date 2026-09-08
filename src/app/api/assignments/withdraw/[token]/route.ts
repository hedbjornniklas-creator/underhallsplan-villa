import { isIP } from 'node:net'
import { NextResponse } from 'next/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import {
  getProfileContact,
  resolvePublicAssignmentByToken,
  type AssignmentDetails,
} from '@/lib/assignments/server'
import {
  getConsumerWithdrawalDeadline,
  resolveAssignmentCustomerType,
} from '@/lib/assignments/consumer'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type PublicAssignmentLink = {
  id: string
  assignment_id: string
  org_id: string
  used_at: string | null
  revoked_at: string | null
  assignments: AssignmentDetails | AssignmentDetails[] | null
}

type WithdrawalRow = {
  id: string
  customer_name: string
  requested_at: string
  receipt_email: string
  receipt_sent_at: string | null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeAssignment(link: PublicAssignmentLink) {
  if (!link.assignments) return null
  return Array.isArray(link.assignments) ? link.assignments[0] ?? null : link.assignments
}

function normalizeClientIp(value: string | null) {
  if (!value) return null
  let candidate = value.trim()
  if (!candidate) return null
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.split(':')[0] ?? candidate
  }
  const bracketedIpv6 = candidate.match(/^\[([0-9a-fA-F:]+)\]:(\d+)$/)
  if (bracketedIpv6?.[1]) candidate = bracketedIpv6[1]
  return isIP(candidate) ? candidate : null
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const normalized = normalizeClientIp(forwarded.split(',')[0] ?? null)
    if (normalized) return normalized
  }
  return normalizeClientIp(request.headers.get('x-real-ip'))
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function responseWithdrawal(row: WithdrawalRow, acceptedAt: string) {
  return {
    requestedAt: row.requested_at,
    receiptEmail: row.receipt_email,
    receiptSentAt: row.receipt_sent_at,
    withdrawalDeadline: getConsumerWithdrawalDeadline(acceptedAt)?.toISOString() ?? null,
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    if (!token || token.length < 20) return jsonError('Ogiltig länk.', 400)

    const linkValue = await resolvePublicAssignmentByToken(token)
    if (!linkValue) return jsonError('Länken är ogiltig eller borttagen.', 404)
    const link = linkValue as PublicAssignmentLink
    const assignment = normalizeAssignment(link)
    if (!assignment) return jsonError('Uppdraget kunde inte hittas.', 404)

    if (
      assignment.assignment_type !== 'TU' ||
      resolveAssignmentCustomerType('TU', assignment.assignment_details) !== 'consumer'
    ) {
      return jsonError('Den digitala ångerfunktionen gäller TU-avtal med privatperson.', 403)
    }
    if (!link.used_at || !assignment.accepted_at) {
      return jsonError('Uppdraget måste vara godkänt innan avtalet kan frånträdas.', 409)
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : ''
    const receiptEmail =
      typeof body.receiptEmail === 'string' ? body.receiptEmail.trim().toLowerCase() : ''
    if (body.confirmed !== true) return jsonError('Bekräfta att du vill frånträda avtalet.', 400)
    if (!customerName) return jsonError('Ange ditt namn.', 400)
    if (!EMAIL_REGEX.test(receiptEmail)) {
      return jsonError('Ange en giltig e-postadress för mottagningsbekräftelsen.', 400)
    }

    const admin = createSupabaseAdminClient()
    const { data: existing, error: existingError } = await admin
      .from('assignment_withdrawal_requests')
      .select('id,customer_name,requested_at,receipt_email,receipt_sent_at')
      .eq('assignment_id', assignment.id)
      .maybeSingle()
    if (existingError) throw new Error(existingError.message)

    let withdrawal = existing as WithdrawalRow | null
    if (!withdrawal) {
      const { data: inserted, error: insertError } = await admin
        .from('assignment_withdrawal_requests')
        .insert({
          org_id: link.org_id,
          assignment_id: assignment.id,
          assignment_link_id: link.id,
          customer_name: customerName,
          receipt_email: receiptEmail,
          requested_ip: getClientIp(request),
          user_agent: request.headers.get('user-agent'),
        })
        .select('id,customer_name,requested_at,receipt_email,receipt_sent_at')
        .single()

      if (insertError || !inserted) {
        const duplicate = insertError?.code === '23505'
        if (!duplicate) throw new Error(insertError?.message ?? 'Kunde inte registrera begäran.')
        const { data: raced, error: racedError } = await admin
          .from('assignment_withdrawal_requests')
          .select('id,customer_name,requested_at,receipt_email,receipt_sent_at')
          .eq('assignment_id', assignment.id)
          .single()
        if (racedError || !raced) throw new Error(racedError?.message ?? 'Kunde inte läsa begäran.')
        withdrawal = raced as WithdrawalRow
      } else {
        withdrawal = inserted as WithdrawalRow
      }
    }

    if (withdrawal.receipt_sent_at) {
      return NextResponse.json({
        ok: true,
        receiptSent: true,
        withdrawal: responseWithdrawal(withdrawal, assignment.accepted_at),
      })
    }

    const objectAddress =
      assignment.property_address ?? assignment.preliminary_address ?? 'Adress saknas'
    const requestedAt = new Date(withdrawal.requested_at).toLocaleString('sv-SE', {
      timeZone: 'Europe/Stockholm',
    })
    const subject = 'Mottagningsbekräftelse - begäran att frånträda TU-avtal'
    const plainText = [
      'Vi bekräftar att din begäran att frånträda avtalet har tagits emot.',
      '',
      `Beställare: ${withdrawal.customer_name}`,
      `Uppdrag: ${assignment.id}`,
      `Objekt: ${objectAddress}`,
      `Mottagen: ${requestedAt}`,
      `Mottagningsbekräftelse: ${withdrawal.receipt_email}`,
      '',
      'Begäran är registrerad för handläggning. Bekräftelsen innebär inte i sig ett ställningstagande till eventuell ersättning för redan utfört arbete eller återbetalning.',
    ].join('\n')
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a"><h1 style="font-size:20px">Begäran mottagen</h1><p>Vi bekräftar att din begäran att frånträda avtalet har tagits emot.</p><dl><dt><strong>Beställare</strong></dt><dd>${escapeHtml(withdrawal.customer_name)}</dd><dt><strong>Uppdrag</strong></dt><dd>${escapeHtml(assignment.id)}</dd><dt><strong>Objekt</strong></dt><dd>${escapeHtml(objectAddress)}</dd><dt><strong>Mottagen</strong></dt><dd>${escapeHtml(requestedAt)}</dd></dl><p>Begäran är registrerad för handläggning. Bekräftelsen innebär inte i sig ett ställningstagande till eventuell ersättning för redan utfört arbete eller återbetalning.</p></div>`

    let messageId: string | null = null
    try {
      const responsibleProfile = assignment.responsible_profile_id
        ? await getProfileContact(assignment.responsible_profile_id)
        : null
      const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
      if (!from) throw new Error('ASSIGNMENTS_MAIL_FROM saknas.')

      const { data: message, error: messageError } = await admin
        .from('outbound_messages')
        .insert({
          org_id: link.org_id,
          assignment_id: assignment.id,
          channel: 'email',
          recipient_email: withdrawal.receipt_email,
          subject,
          template_key: 'tu_assignment_withdrawal_receipt',
          status: 'pending',
          created_by: assignment.responsible_profile_id,
          reply_to_email: responsibleProfile?.email ?? null,
        })
        .select('id')
        .single()
      if (messageError || !message) {
        throw new Error(messageError?.message ?? 'Kunde inte skapa mejllogg.')
      }
      messageId = message.id

      const sent = await sendAssignmentEmail({
        to: withdrawal.receipt_email,
        from,
        replyTo: responsibleProfile?.email ?? null,
        subject,
        html,
        text: plainText,
        idempotencyKey: `tu-withdrawal-${withdrawal.id}`,
      })
      const sentAt = new Date().toISOString()
      await Promise.all([
        admin
          .from('outbound_messages')
          .update({
            status: 'sent',
            provider: sent.provider,
            provider_message_id: sent.providerMessageId,
            sent_at: sentAt,
          })
          .eq('id', messageId),
        admin
          .from('assignment_withdrawal_requests')
          .update({ receipt_sent_at: sentAt })
          .eq('id', withdrawal.id),
      ])
      withdrawal = { ...withdrawal, receipt_sent_at: sentAt }
    } catch (mailError) {
      const mailMessage = mailError instanceof Error ? mailError.message : 'Okänt mejlfel.'
      if (messageId) {
        await admin
          .from('outbound_messages')
          .update({ status: 'failed', error_message: mailMessage })
          .eq('id', messageId)
      }
      console.error('[assignments.withdraw] receipt email failed', {
        assignmentId: assignment.id,
        error: mailMessage,
      })
    }

    return NextResponse.json(
      {
        ok: true,
        receiptSent: Boolean(withdrawal.receipt_sent_at),
        withdrawal: responseWithdrawal(withdrawal, assignment.accepted_at),
      },
      { status: withdrawal.receipt_sent_at ? 200 : 202 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    console.error('[assignments.withdraw] failed', { message })
    if (message.includes('assignment_withdrawal_requests')) {
      return jsonError('Servern saknar databastabellen för digital ångerrätt.', 503)
    }
    return jsonError('Kunde inte registrera begäran. Försök igen.', 500)
  }
}
