import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { normalizeQuote, quoteId } from './quotes'
import { normalizeCostLine } from './costing'
import { claimRfqDelivery } from './rfqDeliveryServer'

type Context = { orgId: string; userId: string }
type Payload = Record<string, unknown>
type EmailPayload = Parameters<typeof sendAssignmentEmail>[0]

export async function writeQuote(context: Context, payload: Payload, operation: string, data: Payload) {
  const { data: result, error } = await createSupabaseAdminClient().rpc('write_action_case_quote', {
    p_org_id: context.orgId, p_case_id: quoteId(payload.caseId), p_item_id: quoteId(payload.itemId),
    p_line_id: quoteId(payload.costLineId), p_user_id: context.userId, p_operation: operation, p_data: data,
  })
  if (error) {
    if (['PGRST202', '42883', '42P01'].includes(error.code)) throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
    const match = error.message.match(/ACTION_CASE_(?:QUOTE_[A-Z_]+|REQUEST_[A-Z_]+|NOT_FOUND|FILE_NOT_FOUND|COST_LINE_INVALID)/)
    throw new Error(match?.[0] ?? 'ACTION_CASE_QUOTE_WRITE_FAILED')
  }
  return result as Record<string, unknown>
}

export async function createQuoteWorkLine(context: Context, payload: Payload) {
  const line = normalizeCostLine(payload)
  if (!['own_labor', 'subcontractor'].includes(line.category)) throw new Error('ACTION_CASE_QUOTE_WORK_REQUIRED')
  await writeQuote(context, payload, 'create_work', line)
}

export async function handleQuoteAction(context: Context, payload: Payload) {
  const operation = payload.operation
  if (operation === 'save') return writeQuote(context, payload, 'save', normalizeQuote(payload))
  if (operation === 'method') {
    if (!['direct', 'quotes'].includes(String(payload.method))) throw new Error('ACTION_CASE_QUOTE_INVALID')
    return writeQuote(context, payload, 'method', { method: payload.method, expectedLineUpdatedAt: payload.expectedLineUpdatedAt })
  }
  if (operation === 'markup') {
    const value = Number(payload.markupPercent)
    if (!Number.isFinite(value) || value < -100 || value > 1000) throw new Error('ACTION_CASE_QUOTE_INVALID')
    return writeQuote(context, payload, 'markup', { markupPercent: value, expectedLineUpdatedAt: payload.expectedLineUpdatedAt })
  }
  if (['select', 'unselect', 'delete'].includes(String(operation))) return writeQuote(context, payload, String(operation), {
    id: quoteId(payload.quoteId), expectedQuoteUpdatedAt: payload.expectedQuoteUpdatedAt, expectedLineUpdatedAt: payload.expectedLineUpdatedAt,
  })
  throw new Error('ACTION_CASE_QUOTE_INVALID')
}

// Keep the exact email payload for bounded, idempotent retries after an uncertain response.
export async function sendQuoteRequest(context: Context, payload: Payload, requestOrigin?: string) {
  if (payload.confirmSend !== true) throw new Error('ACTION_CASE_QUOTE_CONFIRM_REQUIRED')
  const admin = createSupabaseAdminClient()
  const id = quoteId(payload.quoteId)
  const { data: q, error } = await admin.from('action_case_work_quotes').select('*').eq('id', id)
    .eq('cost_line_id', quoteId(payload.costLineId)).eq('action_case_id', quoteId(payload.caseId)).eq('action_case_item_id', quoteId(payload.itemId)).eq('org_id', context.orgId).maybeSingle()
  if (error || !q) throw new Error('ACTION_CASE_QUOTE_NOT_FOUND')
  if (q.request_id) throw new Error('ACTION_CASE_REQUEST_USE_GROUP')
  if (q.sent_at) return
  if (!q.email_payload && payload.expectedQuoteUpdatedAt !== q.updated_at) throw new Error('ACTION_CASE_QUOTE_STALE')
  const claim = await claimRfqDelivery(context, { kind: 'quote', id, caseId: String(payload.caseId), version: q.updated_at, emailPayload: q.email_payload,
    supplierEmail: q.supplier_email, subject: q.request_subject, body: q.request_body, attachmentIds: q.request_attachment_ids ?? [], requestOrigin })
  if (claim.alreadySent) return
  let sent: Awaited<ReturnType<typeof sendAssignmentEmail>>
  try { sent = await sendAssignmentEmail(claim.payload as EmailPayload) }
  catch {
    await writeQuote(context, payload, 'finish_send', { id, leaseId: claim.leaseId, success: false }).catch(() => undefined)
    throw new Error('ACTION_CASE_QUOTE_SEND_FAILED')
  }
  await writeQuote(context, payload, 'finish_send', { id, leaseId: claim.leaseId, success: true, providerMessageId: sent.providerMessageId })
}
