import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { normalizeQuote, quoteId, quoteRequestHtml } from './quotes'
import { normalizeCostLine } from './costing'

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
export async function sendQuoteRequest(context: Context, payload: Payload) {
  if (payload.confirmSend !== true) throw new Error('ACTION_CASE_QUOTE_CONFIRM_REQUIRED')
  const admin = createSupabaseAdminClient()
  const id = quoteId(payload.quoteId)
  const { data: q, error } = await admin.from('action_case_work_quotes').select('*').eq('id', id)
    .eq('cost_line_id', quoteId(payload.costLineId)).eq('action_case_id', quoteId(payload.caseId)).eq('action_case_item_id', quoteId(payload.itemId)).eq('org_id', context.orgId).maybeSingle()
  if (error || !q) throw new Error('ACTION_CASE_QUOTE_NOT_FOUND')
  if (q.request_id) throw new Error('ACTION_CASE_REQUEST_USE_GROUP')
  if (q.sent_at) return
  let email: EmailPayload | null = null
  if (!q.email_payload) {
    if (payload.expectedQuoteUpdatedAt !== q.updated_at) throw new Error('ACTION_CASE_QUOTE_STALE')
    email = await prepareRequestEmail(context, String(payload.caseId), {
      supplierEmail: q.supplier_email, subject: q.request_subject, body: q.request_body,
      attachmentIds: q.request_attachment_ids ?? [], idempotencyKey: `action-case-rfq-${id}`,
    })
  }
  const claim = await writeQuote(context, payload, 'claim_send', { id, emailPayload: email, expectedUpdatedAt: q.updated_at })
  if (claim.alreadySent) return
  let sent: Awaited<ReturnType<typeof sendAssignmentEmail>>
  try { sent = await sendAssignmentEmail(claim.payload as EmailPayload) }
  catch {
    await writeQuote(context, payload, 'finish_send', { id, leaseId: claim.leaseId, success: false }).catch(() => undefined)
    throw new Error('ACTION_CASE_QUOTE_SEND_FAILED')
  }
  await writeQuote(context, payload, 'finish_send', { id, leaseId: claim.leaseId, success: true, providerMessageId: sent.providerMessageId })
}

export async function prepareRequestEmail(context: Context, caseId: string, source: {
  supplierEmail: string; subject: string; body: string; attachmentIds: string[]; idempotencyKey: string
}): Promise<EmailPayload> {
  const admin = createSupabaseAdminClient()
  const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!from || !process.env.RESEND_API_KEY) throw new Error('ACTION_CASE_QUOTE_MAIL_CONFIG')
  if (!source.supplierEmail || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(source.supplierEmail) || !source.subject.trim() || !source.body.trim()) throw new Error('ACTION_CASE_QUOTE_INVALID')
  const { data: profile } = await admin.from('profiles').select('email').eq('id', context.userId).maybeSingle()
  if (!profile?.email) throw new Error('ACTION_CASE_QUOTE_REPLY_REQUIRED')
  const ids: string[] = source.attachmentIds ?? []
  const attachments: NonNullable<EmailPayload['attachments']> = []
  if (ids.length) {
    const { data: files, error: fileError } = await admin.from('action_case_attachments')
      .select('id,file_name,content_type,file_size_bytes,storage_bucket,file_path').in('id', ids).eq('action_case_id', caseId).eq('org_id', context.orgId)
    const { data: quoteDocuments, error: documentError } = await admin.from('action_case_work_quotes').select('document_id').eq('org_id', context.orgId).eq('action_case_id', caseId).in('document_id', ids)
    if (documentError || fileError || files?.length !== ids.length) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
    const { data: responseDocs, error: responseError } = await admin.from('action_case_quote_requests').select('response_document_id').eq('org_id', context.orgId).eq('action_case_id', caseId).in('response_document_id', ids)
    if (responseError && !['42P01', 'PGRST205'].includes(responseError.code)) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
    if (quoteDocuments?.length || responseDocs?.length) throw new Error('ACTION_CASE_QUOTE_PRIVATE_DOCUMENT')
    if (files.reduce((sum, f) => sum + Number(f.file_size_bytes), 0) > 5 * 1024 * 1024) throw new Error('ACTION_CASE_QUOTE_FILES_TOO_LARGE')
    let bytes = 0
    for (const file of files.sort((a, b) => a.id.localeCompare(b.id))) {
      const { data, error: downloadError } = await admin.storage.from(file.storage_bucket).download(file.file_path)
      if (downloadError || !data) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
      bytes += data.size
      if (bytes > 5 * 1024 * 1024) throw new Error('ACTION_CASE_QUOTE_FILES_TOO_LARGE')
      attachments.push({ filename: file.file_name, contentType: file.content_type, contentBase64: Buffer.from(await data.arrayBuffer()).toString('base64') })
    }
  }
  return { from, to: source.supplierEmail, replyTo: profile.email, subject: source.subject,
    text: source.body, html: quoteRequestHtml(source.subject, source.body), attachments,
    idempotencyKey: source.idempotencyKey }
}
