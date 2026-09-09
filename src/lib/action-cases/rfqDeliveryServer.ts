import 'server-only'
import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { quoteId, quoteRequestHtml } from './quotes'
import { mapRfqDelivery, RFQ_FILE_BUCKET, RFQ_FILE_COLUMNS, RFQ_MAX_FILES, type RfqPublicView } from './rfqDelivery'
import type { sendAssignmentEmail } from '@/lib/assignments/mailer'

type Context = { orgId: string; userId: string }
type Email = Parameters<typeof sendAssignmentEmail>[0]
type PreparedFile = { id: string; fileName: string; contentType: string; fileSizeBytes: number; path: string; sourceBucket: string; sourcePath: string }
type Source = { kind: 'request' | 'quote'; id: string; caseId: string; version: string; emailPayload: unknown;
  supplierEmail: string; subject: string; body: string; attachmentIds: string[]; requestOrigin?: string }

function deliveryError(error: { code?: string; message?: string }) {
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(error.code ?? '')) return new Error('ACTION_CASES_SCHEMA_REQUIRED')
  return new Error(error.message?.match(/ACTION_CASE_(?:RFQ_[A-Z_]+|QUOTE_[A-Z_]+|REQUEST_[A-Z_]+|NOT_FOUND|FILE_NOT_FOUND)/)?.[0] ?? 'ACTION_CASE_RFQ_FAILED')
}

function baseUrl(origin?: string) {
  const configured = process.env.APP_BASE_URL?.trim()
  const value = configured || (process.env.NODE_ENV !== 'production' ? origin : '')
  try {
    const url = new URL(value ?? '')
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error()
    return url.origin
  } catch { throw new Error('ACTION_CASE_RFQ_CONFIG') }
}

async function removeCopies(paths: string[]) {
  if (!paths.length) return
  try {
    const { error } = await createSupabaseAdminClient().storage.from(RFQ_FILE_BUCKET).remove(paths)
    if (error) console.error('ACTION_CASE_RFQ_COPY_CLEANUP_FAILED', { paths, code: error.message })
  } catch { console.error('ACTION_CASE_RFQ_COPY_CLEANUP_FAILED', { paths }) }
}

async function prepare(context: Context, source: Source) {
  const admin = createSupabaseAdminClient(), deliveryId = randomUUID(), token = generateAssignmentToken()
  const url = `${baseUrl(source.requestOrigin)}/offertunderlag/${token}`
  const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!from || !process.env.RESEND_API_KEY) throw new Error('ACTION_CASE_QUOTE_MAIL_CONFIG')
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(source.supplierEmail) || !source.subject.trim() || !source.body.trim()) throw new Error('ACTION_CASE_QUOTE_INVALID')
  const { data: profile } = await admin.from('profiles').select('email').eq('id', context.userId).maybeSingle()
  if (!profile?.email) throw new Error('ACTION_CASE_QUOTE_REPLY_REQUIRED')
  const ids = source.attachmentIds.map(quoteId)
  if (ids.length > RFQ_MAX_FILES || new Set(ids).size !== ids.length) throw new Error('ACTION_CASE_REQUEST_INVALID')
  const files: PreparedFile[] = [], copiedPaths: string[] = []
  try {
    if (ids.length) {
      const { data: rows, error } = await admin.from('action_case_attachments').select(RFQ_FILE_COLUMNS).eq('org_id', context.orgId).eq('action_case_id', source.caseId).in('id', ids)
      if (error || rows?.length !== ids.length) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
      const { data: quotes, error: quotesError } = await admin.from('action_case_work_quotes').select('document_id').eq('org_id', context.orgId).eq('action_case_id', source.caseId).in('document_id', ids)
      const { data: requests, error: requestsError } = await admin.from('action_case_quote_requests').select('response_document_id').eq('org_id', context.orgId).eq('action_case_id', source.caseId).in('response_document_id', ids)
      if (quotesError || requestsError) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
      if (quotes?.length || requests?.length) throw new Error('ACTION_CASE_QUOTE_PRIVATE_DOCUMENT')
      for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
        if (row.storage_bucket !== 'action-case-files' || !row.file_path.startsWith(`${context.orgId}/${source.caseId}/`) || row.file_path.includes('..')) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
        const path = `${context.orgId}/${source.caseId}/${deliveryId}/${row.id}`
        // Server-side copy keeps original bytes, without putting image data in the email/DB.
        copiedPaths.push(path)
        const { error: copyError } = await admin.storage.from(row.storage_bucket).copy(row.file_path, path, { destinationBucket: RFQ_FILE_BUCKET })
        if (copyError) throw new Error('ACTION_CASE_RFQ_COPY_FAILED')
        const { data: info, error: infoError } = await admin.storage.from(RFQ_FILE_BUCKET).info(path)
        const size = Number(info?.size ?? info?.metadata?.size)
        if (infoError || size !== Number(row.file_size_bytes) || size <= 0 || size > 25 * 1024 * 1024) throw new Error('ACTION_CASE_RFQ_COPY_FAILED')
        files.push({ id: row.id, fileName: row.file_name, contentType: row.content_type, fileSizeBytes: size, path, sourceBucket: row.storage_bucket, sourcePath: row.file_path })
      }
    }
    const emailPayload: Email = { from, to: source.supplierEmail, replyTo: profile.email, subject: source.subject,
      text: `${source.body}\n\nVisa offertunderlag, bilder och dokument:\n${url}\n\nLänken gäller i 90 dagar och kan återkallas av avsändaren.`,
      html: `${quoteRequestHtml(source.subject, source.body)}<p><a href="${url}" style="display:inline-block;padding:12px 18px;background:#6d28d9;color:#fff;text-decoration:none;border-radius:6px">Visa offertunderlag</a></p><p>Länken gäller i 90 dagar och kan återkallas av avsändaren.</p>`,
      idempotencyKey: `${source.kind === 'request' ? 'action-case-group-rfq' : 'action-case-rfq'}-${source.id}` }
    return { deliveryId, tokenHash: hashAssignmentToken(token), files, emailPayload }
  } catch (error) { await removeCopies(copiedPaths); throw error }
}

export async function claimRfqDelivery(context: Context, source: Source): Promise<{ alreadySent?: boolean; leaseId: string; payload: Email }> {
  const admin = createSupabaseAdminClient()
  const { error: schemaError } = await admin.from('action_case_rfq_deliveries').select('id').eq('org_id', context.orgId).eq('id', source.id).maybeSingle()
  if (schemaError) throw deliveryError(schemaError)
  const prepared = source.emailPayload ? null : await prepare(context, source)
  try {
    const { data, error } = await admin.rpc('claim_action_case_rfq_delivery', {
      p_org_id: context.orgId, p_case_id: source.caseId, p_source_id: source.id, p_user_id: context.userId, p_kind: source.kind,
      p_data: { expectedUpdatedAt: source.version, ...prepared, emailPayload: prepared?.emailPayload ?? null },
    })
    if (error) throw deliveryError(error)
    return data
  } finally {
    if (prepared) {
      // A transport timeout may hide a committed claim. Never remove files unless
      // a successful follow-up read proves this candidate was not committed.
      try {
        const { data, error } = await admin.from('action_case_rfq_deliveries').select('id').eq('org_id', context.orgId).eq('id', prepared.deliveryId).maybeSingle()
        if (!error && !data) await removeCopies(prepared.files.map((file) => file.path))
      } catch { /* Leave uncertain copies private for later cleanup. */ }
    }
  }
}

export async function revokeRfqDelivery(context: Context, payload: Record<string, unknown>) {
  const { error } = await createSupabaseAdminClient().rpc('revoke_action_case_rfq_delivery', {
    p_org_id: context.orgId, p_case_id: quoteId(payload.caseId), p_delivery_id: quoteId(payload.deliveryId), p_user_id: context.userId,
  })
  if (error) throw deliveryError(error)
}

async function resolveDelivery(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const { data, error } = await createSupabaseAdminClient().from('action_case_rfq_deliveries')
    .select('id,org_id,action_case_id,snapshot,files,expires_at,revoked_at,created_at').eq('token_hash', hashAssignmentToken(token)).maybeSingle()
  if (error) throw new Error('ACTION_CASE_RFQ_FAILED')
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return null
  return data
}

export async function getRfqPublicView(token: string): Promise<RfqPublicView | null> {
  const row = await resolveDelivery(token)
  if (!row) return null
  const s = row.snapshot as Record<string, string>
  return { ...mapRfqDelivery(row), subject: s.subject, body: s.body, supplierName: s.supplierName, caseTitle: s.caseTitle, propertyAddress: s.propertyAddress }
}

type DeliveryRow = { id: string; org_id: string; action_case_id: string; files: unknown }
async function signDeliveryFile(row: DeliveryRow, fileId: string, download: boolean) {
  const file = (row.files as (PreparedFile & { type: string })[]).find((file) => file.id === fileId)
  if (!file || file.path !== `${row.org_id}/${row.action_case_id}/${row.id}/${file.id}`) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
  const { data, error } = await createSupabaseAdminClient().storage.from(RFQ_FILE_BUCKET).createSignedUrl(file.path, 60,
    download || !(file.contentType.startsWith('image/') || file.contentType === 'application/pdf') ? { download: file.fileName } : undefined)
  if (error || !data) throw new Error('ACTION_CASE_FILE_SIGN_FAILED')
  return data.signedUrl
}

export async function getRfqPublicFileUrl(token: string, fileId: string, download: boolean) {
  const row = await resolveDelivery(token)
  if (!row) throw new Error('ACTION_CASE_RFQ_ACCESS_CLOSED')
  return signDeliveryFile(row, quoteId(fileId), download)
}

export async function getRfqInternalFileUrl(context: Context, caseId: string, deliveryId: string, fileId: string, download: boolean) {
  const { data, error } = await createSupabaseAdminClient().from('action_case_rfq_deliveries')
    .select('id,org_id,action_case_id,files').eq('org_id', context.orgId).eq('action_case_id', quoteId(caseId)).eq('id', quoteId(deliveryId)).maybeSingle()
  if (error || !data) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
  return signDeliveryFile(data, quoteId(fileId), download)
}
