import 'server-only'
import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizeSupplierInvoiceDraft } from './domain'
import type { SupplierInvoice, SupplierInvoiceAttachment, SupplierInvoiceWorkspace } from './contracts'

type Context = { orgId: string; userId: string }
type Row = Record<string, unknown>
const BUCKET = 'supplier-invoice-files'
const FILE_LIMIT = 4 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INVOICE_COLUMNS = 'id,revision,body,source,external_id,created_at,updated_at'
const ATTACHMENT_COLUMNS = 'id,invoice_id,file_name,content_type,file_size_bytes,created_at'

function id(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('INVOICE_INVALID')
  return value.toLowerCase()
}
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) throw new Error('INVOICE_SCHEMA_REQUIRED')
  if (error.code === '23505') throw new Error('INVOICE_DUPLICATE')
  throw new Error(error.message?.match(/\bINVOICE_[A-Z_]+\b/)?.[0] ?? 'INVOICE_FAILED')
}
function mapAttachment(row: Row): SupplierInvoiceAttachment {
  return { id: String(row.id), fileName: String(row.file_name), contentType: String(row.content_type),
    fileSizeBytes: Number(row.file_size_bytes), createdAt: String(row.created_at) }
}

/** Read every page: Supabase's default row limit must not silently drop older costs. */
export async function getSupplierInvoiceWorkspace(ctx: Context): Promise<SupplierInvoiceWorkspace> {
  const db = createSupabaseAdminClient()
  const rows: Row[] = [], files: Row[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const result = await db.from('supplier_invoices').select(INVOICE_COLUMNS).eq('org_id', ctx.orgId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + pageSize - 1)
    checked(result.error)
    const page = (result.data ?? []) as Row[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  if (rows.length) {
    for (let offset = 0; ; offset += pageSize) {
      const result = await db.from('supplier_invoice_attachments').select(ATTACHMENT_COLUMNS).eq('org_id', ctx.orgId)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + pageSize - 1)
      checked(result.error)
      const page = (result.data ?? []) as Row[]
      files.push(...page)
      if (page.length < pageSize) break
    }
  }
  const byInvoice = new Map<string, SupplierInvoiceAttachment[]>()
  for (const file of files) {
    const key = String(file.invoice_id), list = byInvoice.get(key) ?? []
    list.push(mapAttachment(file)); byInvoice.set(key, list)
  }
  const invoices: SupplierInvoice[] = rows.map((row) => ({
    ...normalizeSupplierInvoiceDraft(row.body), id: String(row.id), revision: Number(row.revision),
    source: row.source === 'fortnox' ? 'fortnox' : 'manual', externalId: row.external_id == null ? null : String(row.external_id),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), attachments: byInvoice.get(String(row.id)) ?? [],
  }))
  invoices.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  return { invoices }
}

export async function saveSupplierInvoice(ctx: Context, payload: Row) {
  if (payload.operation !== 'save' || !Number.isSafeInteger(payload.expectedRevision) || Number(payload.expectedRevision) < 0)
    throw new Error('INVOICE_INVALID')
  // normalize builds a whitelist object; API callers cannot set source, externalId or audit fields.
  const invoice = normalizeSupplierInvoiceDraft(payload.invoice)
  const result = await createSupabaseAdminClient().rpc('write_supplier_invoice', {
    p_org_id: ctx.orgId, p_user_id: ctx.userId, p_invoice_id: id(payload.id),
    p_expected_revision: payload.expectedRevision, p_body: invoice,
  })
  checked(result.error)
  return result.data as { id: string; revision: number }
}

async function requireInvoice(ctx: Context, invoiceId: string) {
  const result = await createSupabaseAdminClient().from('supplier_invoices').select('id').eq('org_id', ctx.orgId)
    .eq('id', id(invoiceId)).maybeSingle()
  checked(result.error)
  if (!result.data) throw new Error('INVOICE_NOT_FOUND')
}
function detectedContentType(bytes: Uint8Array) {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return 'application/pdf'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  throw new Error('INVOICE_FILE_INVALID')
}
export async function uploadSupplierInvoiceAttachment(ctx: Context, invoiceId: string, file: File) {
  await requireInvoice(ctx, invoiceId)
  if (!(file instanceof File) || file.size < 1) throw new Error('INVOICE_FILE_INVALID')
  if (file.size > FILE_LIMIT) throw new Error('INVOICE_FILE_TOO_LARGE')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length !== file.size) throw new Error('INVOICE_FILE_INVALID')
  const contentType = detectedContentType(bytes)
  if (file.type && file.type !== 'application/octet-stream' && file.type.toLowerCase() !== contentType) throw new Error('INVOICE_FILE_INVALID')
  const fileName = file.name.replace(/[\u0000-\u001f\u007f/\\]+/g, '_').trim().slice(0, 180)
  if (!fileName) throw new Error('INVOICE_FILE_INVALID')
  const attachmentId = randomUUID(), path = `${ctx.orgId}/${id(invoiceId)}/${attachmentId}`, db = createSupabaseAdminClient()
  const uploaded = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false })
  if (uploaded.error) throw new Error('INVOICE_FILE_UPLOAD_FAILED')
  // Metadata and audit are committed together. Remove the private object if registration fails.
  try {
    const result = await db.rpc('add_supplier_invoice_attachment', {
      p_org_id: ctx.orgId, p_user_id: ctx.userId, p_invoice_id: id(invoiceId), p_attachment_id: attachmentId,
      p_file_name: fileName, p_content_type: contentType, p_file_size_bytes: bytes.length, p_file_path: path,
    })
    checked(result.error)
  } catch (error) {
    // A transport error can follow a committed RPC. Never delete a referenced
    // object (or an uncertain one) while trying to clean up a failed upload.
    const existing = await db.from('supplier_invoice_attachments').select('id').eq('org_id', ctx.orgId)
      .eq('invoice_id', id(invoiceId)).eq('id', attachmentId).maybeSingle()
    if (existing.data) return
    if (!existing.error) {
      const cleanup = await db.storage.from(BUCKET).remove([path])
      if (cleanup.error) console.error('INVOICE_FILE_CLEANUP_FAILED')
    }
    throw error
  }
}

export async function getSupplierInvoiceAttachmentUrl(ctx: Context, invoiceId: string, attachmentId: string) {
  await requireInvoice(ctx, invoiceId)
  const db = createSupabaseAdminClient()
  const result = await db.from('supplier_invoice_attachments').select('file_path,file_name')
    .eq('org_id', ctx.orgId).eq('invoice_id', id(invoiceId)).eq('id', id(attachmentId)).maybeSingle()
  checked(result.error)
  if (!result.data) throw new Error('INVOICE_FILE_NOT_FOUND')
  const signed = await db.storage.from(BUCKET).createSignedUrl(result.data.file_path, 60, { download: result.data.file_name })
  if (signed.error || !signed.data?.signedUrl) throw new Error('INVOICE_FILE_DOWNLOAD_FAILED')
  return signed.data.signedUrl
}
