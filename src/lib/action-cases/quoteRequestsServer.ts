import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { normalizeQuoteRequest } from './quoteRequests'
import { normalizeQuote, quoteId } from './quotes'
import { prepareRequestEmail } from './quotesServer'
import { normalizePackageAmount } from './quotePackages'

type Context = { orgId: string; userId: string }
type Payload = Record<string, unknown>
type Email = Parameters<typeof sendAssignmentEmail>[0]

export async function writeRequest(context: Context, payload: Payload, operation: string, data: Payload) {
  const { data: result, error } = await createSupabaseAdminClient().rpc('write_action_case_request', {
    p_org_id: context.orgId, p_case_id: quoteId(payload.caseId), p_request_id: quoteId(payload.requestId), p_user_id: context.userId,
    p_operation: operation, p_data: data,
  })
  if (error) {
    if (['PGRST202', '42883', '42P01'].includes(error.code)) throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
    throw new Error(error.message.match(/ACTION_CASE_(?:PACKAGE_[A-Z_]+|REQUEST_[A-Z_]+|QUOTE_[A-Z_]+|NOT_FOUND|FILE_NOT_FOUND)/)?.[0] ?? 'ACTION_CASE_REQUEST_WRITE_FAILED')
  }
  return result as Record<string, unknown>
}

export async function handleRequestAction(context: Context, payload: Payload) {
  if (payload.operation === 'save') {
    let pricePresentation = payload.pricePresentation
    if (pricePresentation == null) {
      const { data: existing, error } = await createSupabaseAdminClient().from('action_case_quote_requests')
        .select('price_presentation').eq('id', quoteId(payload.requestId)).eq('org_id', context.orgId).eq('action_case_id', quoteId(payload.caseId)).maybeSingle()
      if (error) throw new Error(['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code) ? 'ACTION_CASES_SCHEMA_REQUIRED' : 'ACTION_CASE_REQUEST_WRITE_FAILED')
      pricePresentation = existing?.price_presentation ?? 'grouped'
    }
    return writeRequest(context, payload, 'save', normalizeQuoteRequest({ ...payload, pricePresentation }))
  }
  if (payload.operation === 'delete') return writeRequest(context, payload, 'delete', { expectedUpdatedAt: payload.expectedUpdatedAt })
  if (payload.operation === 'response') {
    if (!['pending', 'itemized', 'package'].includes(String(payload.responseMode))) throw new Error('ACTION_CASE_REQUEST_INVALID')
    const amount = normalizeQuote({ quoteId: payload.requestId, supplierName: 'Response', amount: payload.packageAmount }).amount
    if (payload.responseMode === 'package') normalizePackageAmount(payload.packageAmount)
    if (typeof payload.responseNotes !== 'string' || payload.responseNotes.length > 6000) throw new Error('ACTION_CASE_REQUEST_INVALID')
    return writeRequest(context, payload, 'response', {
      responseMode: payload.responseMode, packageAmount: payload.responseMode === 'package' ? amount : null,
      responseNotes: payload.responseNotes.trim(), responseDocumentId: payload.responseDocumentId ? quoteId(payload.responseDocumentId) : null,
      expectedUpdatedAt: payload.expectedUpdatedAt,
    })
  }
  throw new Error('ACTION_CASE_REQUEST_INVALID')
}

export async function sendGroupedRequest(context: Context, payload: Payload) {
  if (payload.confirmSend !== true) throw new Error('ACTION_CASE_QUOTE_CONFIRM_REQUIRED')
  const id = quoteId(payload.requestId), caseId = quoteId(payload.caseId)
  const { data: r, error } = await createSupabaseAdminClient().from('action_case_quote_requests').select('*').eq('id', id).eq('org_id', context.orgId).eq('action_case_id', caseId).maybeSingle()
  if (error || !r) throw new Error('ACTION_CASE_REQUEST_NOT_FOUND')
  if (r.sent_at) return
  let email: Email | null = null
  if (!r.email_payload) {
    if (payload.expectedUpdatedAt !== r.updated_at) throw new Error('ACTION_CASE_QUOTE_STALE')
    email = await prepareRequestEmail(context, caseId, { supplierEmail: r.supplier_email, subject: r.subject, body: r.body, attachmentIds: r.attachment_ids, idempotencyKey: `action-case-group-rfq-${id}` })
  }
  const claim = await writeRequest(context, payload, 'claim_send', { expectedUpdatedAt: r.updated_at, emailPayload: email })
  if (claim.alreadySent) return
  let sent: Awaited<ReturnType<typeof sendAssignmentEmail>>
  try { sent = await sendAssignmentEmail(claim.payload as Email) }
  catch {
    await writeRequest(context, payload, 'finish_send', { leaseId: claim.leaseId, success: false }).catch(() => undefined)
    throw new Error('ACTION_CASE_QUOTE_SEND_FAILED')
  }
  await writeRequest(context, payload, 'finish_send', { leaseId: claim.leaseId, success: true, providerMessageId: sent.providerMessageId })
}
