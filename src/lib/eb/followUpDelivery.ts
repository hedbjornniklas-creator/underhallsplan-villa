import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { EB_FOLLOW_UP_ADMIN_EMAIL, normalizeEbFollowUpEmail } from '@/lib/eb/followUp'
import type { EbFollowUpConfirmation } from '@/lib/eb/followUpConfirmation'

export type EbFollowUpEmail = {
  to: string
  from?: string
  replyTo?: string | null
  subject: string
  html: string
  text: string
  expiresAt?: string
  /** Frozen at purchase; only new receipts carry this private PDF source. */
  confirmationPdf?: EbFollowUpConfirmation
  attachments?: Array<{ filename: string; contentBase64: string; contentType: string }>
}

function encryptionKey() {
  const secret = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('EB_FOLLOW_UP_MAIL_CONFIGURATION')
  return createHash('sha256').update(`eb-follow-up-outbox-v1:${secret}`).digest()
}

/** Codes and private owner URLs must not be stored as readable outbox JSON. */
export function encryptEbFollowUpPayload(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptEbFollowUpPayload<T>(value: string): T {
  const [version, iv, tag, payload] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !payload) throw new Error('EB_FOLLOW_UP_MAIL_PAYLOAD')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8')) as T
}

export function escapeEbFollowUpHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export async function queueEbFollowUpEmail(input: EbFollowUpEmail & { orderId: string; dedupeKey: string }) {
  const { orderId, dedupeKey, ...email } = input
  const { error } = await createSupabaseAdminClient().from('eb_follow_up_email_outbox').upsert({
    order_id: orderId, dedupe_key: dedupeKey, kind: 'email', payload_ciphertext: encryptEbFollowUpPayload(email),
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  if (error) throw new Error('EB_FOLLOW_UP_MAIL_QUEUE_FAILED')
}

type OutboxRow = {
  id: string; order_id: string | null; event_id: string | null; kind: string;
  payload_ciphertext: string | null; lease_id: string; attempts: number; dedupe_key?: string
}

async function expandNotification(row: OutboxRow) {
  // Activity stays in the portal. Only the explicit invitation sends the list.
  // Keep the historical task_event jobs consumable without sending any mail.
  if (row.kind !== 'withdrawal') return
  const admin = createSupabaseAdminClient()
  const { data: order, error } = await admin.from('eb_follow_up_orders')
    .select('id,buyer_snapshot,seller_snapshot,withdrawal_requested_at').eq('id', row.order_id).single()
  if (error || !order) throw new Error('EB_FOLLOW_UP_NOTIFICATION_ORDER')
  const buyer = order.buyer_snapshot as Record<string, string>
  const seller = order.seller_snapshot as Record<string, string>
  const buyerEmail = normalizeEbFollowUpEmail(buyer.email)
  const sellerEmail = normalizeEbFollowUpEmail(seller.email)
  if (!buyerEmail || !sellerEmail) throw new Error('EB_FOLLOW_UP_NOTIFICATION_RECIPIENT')
  const recipients = [buyerEmail, sellerEmail, EB_FOLLOW_UP_ADMIN_EMAIL]
  const subject = `Mottagningsbekräftelse – frånträde av beställning ${order.id}`
  const text = [
    'Vi har tagit emot din begäran att frånträda beställningen av digital åtgärdsuppföljning.',
    `Beställare: ${buyer.name || 'Beställaren'}`,
    `Beställningsnummer: ${order.id}`,
    `Registrerad tidpunkt: ${order.withdrawal_requested_at}`,
    `Bekräftelse till: ${buyerEmail}`,
    '',
    'Fakturaunderlaget och nya åtgärdssvar är pausade för manuell hantering. Tidigare underlag och historik finns kvar i portalen.',
    'Detta är en mottagningsbekräftelse, inte ett beslut om betalning eller återbetalning. Begäran bedöms enligt avtalsvillkoren och tillämpliga regler.',
    `Kontakta ${seller.email} vid frågor.`,
  ].join('\n')
  for (const to of new Set(recipients)) {
    const recipientKey = createHash('sha256').update(to).digest('hex').slice(0, 24)
    await queueEbFollowUpEmail({
      orderId: order.id, dedupeKey: `notification:${row.id}:${recipientKey}`,
      to, replyTo: seller.email, subject, text, html: `<p style="white-space:pre-line">${escapeEbFollowUpHtml(text)}</p>`,
    })
  }
}

/** Old workers may already have expanded activity jobs into encrypted emails.
 * Withdrawal confirmations use the same notification prefix, so classify by
 * the source job, never by recipient, subject text or the prefix alone. */
async function isRetiredActivityEmail(row: OutboxRow): Promise<boolean> {
  if (row.kind !== 'email' || !row.dedupe_key?.startsWith('notification:')) return false
  const sourceId = row.dedupe_key.split(':')[1]
  if (!sourceId || !row.order_id) throw new Error('EB_FOLLOW_UP_NOTIFICATION_SOURCE')
  const { data: source, error } = await createSupabaseAdminClient().from('eb_follow_up_email_outbox')
    .select('kind,order_id').eq('id', sourceId).maybeSingle()
  if (error || !source || source.order_id !== row.order_id || !['task_event', 'withdrawal'].includes(source.kind)) {
    // Do not send an unclassified notification or silently discard a receipt.
    throw new Error('EB_FOLLOW_UP_NOTIFICATION_SOURCE')
  }
  return source.kind === 'task_event'
}

/** Durable retry worker. Called only by a protected scheduler, never by an anonymous GET. */
export async function processEbFollowUpEmails(limit = 10) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('eb_claim_follow_up_emails', { p_limit: Math.max(1, Math.min(limit, 20)) })
  if (error) throw new Error('EB_FOLLOW_UP_MAIL_CLAIM_FAILED')
  const rows = (data ?? []) as OutboxRow[]
  let sent = 0
  let skipped = 0
  let expanded = 0
  let failed = 0
  // Small batches keep the worker within serverless limits; leases recover interrupted runs.
  for (let offset = 0; offset < rows.length; offset += 3) {
    await Promise.all(rows.slice(offset, offset + 3).map(async row => {
      try {
        let outcome: 'sent' | 'skipped' | 'expanded'
        if (row.kind === 'task_event' || await isRetiredActivityEmail(row)) {
          outcome = 'skipped'
        } else if (row.kind === 'withdrawal') {
          await expandNotification(row)
          outcome = 'expanded'
        } else {
          if (!row.payload_ciphertext) throw new Error('EB_FOLLOW_UP_MAIL_PAYLOAD')
          let email = decryptEbFollowUpPayload<EbFollowUpEmail>(row.payload_ciphertext)
          const from = email.from?.trim() || process.env.ASSIGNMENTS_MAIL_FROM?.trim()
          if (!from) throw new Error('EB_FOLLOW_UP_MAIL_CONFIGURATION')
          if (!email.expiresAt || new Date(email.expiresAt).getTime() > Date.now()) {
            if (email.confirmationPdf && !email.attachments?.length) {
              const { renderEbFollowUpConfirmationPdf, buildEbFollowUpConfirmationFilename } = await import('@/lib/eb/followUpConfirmationPdf')
              const pdf = await renderEbFollowUpConfirmationPdf(email.confirmationPdf)
              email = { ...email, from, attachments: [{
                filename: buildEbFollowUpConfirmationFilename(email.confirmationPdf),
                contentBase64: pdf.toString('base64'), contentType: 'application/pdf',
              }] }
              // Persist exact bytes before contacting the provider. Retries keep
              // an identical request body even if the renderer later changes.
              const { data: saved, error: saveError } = await admin.from('eb_follow_up_email_outbox')
                .update({ payload_ciphertext: encryptEbFollowUpPayload(email) })
                .eq('id', row.id).eq('lease_id', row.lease_id).select('id').maybeSingle()
              if (saveError || !saved) throw new Error('EB_FOLLOW_UP_CONFIRMATION_SAVE_FAILED')
            }
            const { confirmationPdf: _confirmationPdf, ...mail } = email
            void _confirmationPdf
            await sendAssignmentEmail({ ...mail, from, idempotencyKey: `eb-follow-up-${row.id}` })
            outcome = 'sent'
          } else {
            outcome = 'skipped'
          }
        }
        const { error: finishError } = await admin.rpc('eb_finish_follow_up_email', {
          p_id: row.id, p_lease_id: row.lease_id, p_success: true, p_error: null,
        })
        if (finishError) throw new Error('EB_FOLLOW_UP_MAIL_FINISH_FAILED')
        if (outcome === 'sent') sent += 1
        else if (outcome === 'skipped') skipped += 1
        else expanded += 1
      } catch {
        failed += 1
        // Do not persist provider errors containing private addresses, codes or links.
        await admin.rpc('eb_finish_follow_up_email', {
          p_id: row.id, p_lease_id: row.lease_id, p_success: false, p_error: 'E-postleveransen misslyckades. Automatiskt nytt försök.',
        })
      }
    }))
  }
  return { claimed: rows.length, sent, skipped, expanded, failed }
}
