import 'server-only'
import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireRenoAppViewerContext } from '@/lib/renoapp/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { buildRenoAppEmailButton, buildRenoAppEmailHtml } from '@/lib/renoapp/emailTemplate'
import { CONSULTANT_REVIEW_MAX_MESSAGE, CONSULTANT_REVIEW_PRICE_LABEL, CONSULTANT_REVIEW_PRICE_ORE, type ConsultantReviewOrder } from './consultantReview'

type EmailPayload = Parameters<typeof sendAssignmentEmail>[0]
type ReviewRow = {
  id: string; case_id: string; created_at: string; message: string | null; requester_name: string
  price_ore: number; delivery_status: ConsultantReviewOrder['deliveryStatus']; email_payload: EmailPayload
}
const toOrder = (row: ReviewRow): ConsultantReviewOrder => ({
  id: row.id, createdAt: row.created_at, message: row.message, requesterName: row.requester_name,
  priceOre: row.price_ore, deliveryStatus: row.delivery_status,
})
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

async function boardCase(caseId: string) {
  const viewer = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('renovation_cases').select('id,brf_id,case_number,title,status').eq('id', caseId).maybeSingle()
  if (error) throw new Error('REVIEW_LOOKUP_FAILED')
  if (!data || !viewer.authorizedBrfIds?.includes(data.brf_id)) throw new Error('CASE_NOT_FOUND')
  return { viewer, admin, item: data }
}

async function readOrder(caseId: string) {
  const { data, error } = await createSupabaseAdminClient().from('renoapp_consultant_reviews').select('*').eq('case_id', caseId).maybeSingle()
  if (error) throw new Error('REVIEW_LOOKUP_FAILED')
  return data as ReviewRow | null
}

export async function getBoardConsultantReview(caseId: string) {
  await boardCase(caseId)
  const row = await readOrder(caseId)
  return row ? toOrder(row) : null
}

async function deliver(row: ReviewRow) {
  if (row.delivery_status === 'sent') return toOrder(row)
  const admin = createSupabaseAdminClient(), attempt = randomUUID()
  const claimed = await admin.rpc('renoapp_claim_review_email', { p_id: row.id, p_attempt: attempt })
  if (claimed.error) throw new Error('REVIEW_DELIVERY_FAILED')
  if (claimed.data) {
    let deliveryStatus: ConsultantReviewOrder['deliveryStatus'] = 'sent'
    let providerMessageId: string | null = null
    try {
      const result = await sendAssignmentEmail({ ...row.email_payload, idempotencyKey: `renoapp-consultant-review-${row.id}` })
      providerMessageId = result.providerMessageId
    } catch {
      deliveryStatus = 'failed'
      console.error('[renoapp.consultant-review] notification failed', { orderId: row.id })
    }
    const saved = await admin.from('renoapp_consultant_reviews').update({
      delivery_status: deliveryStatus, provider_message_id: providerMessageId,
      ...(deliveryStatus === 'failed' ? { delivery_attempt_at: null } : {}),
    }).eq('id', row.id).eq('delivery_attempt_id', attempt)
    if (saved.error) return { ...toOrder(row), deliveryStatus: 'pending' as const }
  }
  return toOrder((await readOrder(row.case_id)) ?? row)
}

export async function orderConsultantReview(caseId: string, input: { message?: unknown; confirmedPriceOre?: unknown; retry?: unknown }) {
  const { viewer, admin, item } = await boardCase(caseId)
  if (input.retry !== true && input.confirmedPriceOre !== CONSULTANT_REVIEW_PRICE_ORE) throw new Error('REVIEW_PRICE_REQUIRED')
  if (input.message != null && (typeof input.message !== 'string' || input.message.length > CONSULTANT_REVIEW_MAX_MESSAGE)) {
    throw new Error('REVIEW_MESSAGE_INVALID')
  }
  const existing = await readOrder(caseId)
  if (existing) return deliver(existing)
  if (input.retry === true) throw new Error('REVIEW_NOT_FOUND')
  if (item.status === 'draft') throw new Error('REVIEW_DRAFT')
  const { data: brf, error } = await admin.from('brf_associations').select('name').eq('id', item.brf_id).single()
  if (error || !brf) throw new Error('REVIEW_LOOKUP_FAILED')
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://hushub.se').origin
  const url = `${origin}/renoapp/review/${encodeURIComponent(caseId)}`
  const name = viewer.profile.full_name || viewer.profile.email || 'Styrelsemedlem'
  const email = viewer.profile.email || ''
  const lines = [
    ['BRF', String(brf.name)], ['Ärende', String(item.case_number)], ['Renovering', String(item.title)],
    ['Beställt av', name], ['E-post', email], ['Fast pris', CONSULTANT_REVIEW_PRICE_LABEL],
  ]
  const emailPayload: EmailPayload = {
    to: 'jn@hedbjorn.se', from: process.env.ASSIGNMENTS_MAIL_FROM?.trim() || 'Hushub <noreply@hushub.se>',
    replyTo: email || undefined,
    subject: `RenoApp: beställd konsultgranskning - ${item.case_number}`,
    html: buildRenoAppEmailHtml({ origin, preheader: `Beställd granskning för ${brf.name}. ${CONSULTANT_REVIEW_PRICE_LABEL}.`,
      bodyHtml: `<h1 style="font-size:24px;line-height:32px;">Beställd granskning av byggkonsult</h1>
        ${lines.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join('')}
        <p><strong>Meddelande från styrelsen:</strong></p><p style="white-space:pre-wrap;">${escapeHtml(message || 'Inget meddelande lämnades.')}</p>
        ${buildRenoAppEmailButton(url, 'Öppna ärendet')}
        <p>Logga in med ditt HusHub-administratörskonto för att läsa ansökan och underlagen.</p>`,
    }),
    text: ['Beställd granskning av byggkonsult', ...lines.map(([label, value]) => `${label}: ${value}`), '',
      message || 'Inget meddelande lämnades.', '', `Öppna ärendet: ${url}`, 'HusHub-administratörsinloggning krävs.'].join('\n'),
  }
  const result = await admin.rpc('renoapp_order_consultant_review', {
    p_case_id: caseId, p_actor: viewer.profile.id, p_name: name, p_email: email,
    p_message: message, p_email_payload: emailPayload,
  })
  if (result.error) throw new Error(result.error.message)
  return deliver(result.data as ReviewRow)
}
