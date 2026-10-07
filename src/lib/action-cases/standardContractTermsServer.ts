import 'server-only'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ABS18_TERMS } from './standardContractTerms'
import { offerId, type CustomerOfferFile } from './customerOffers'

type Context = { orgId: string; userId: string }
const bucket = 'action-case-files'
export function standardTermsFileId(orgId: string, caseId: string) {
  const hash = createHash('sha256').update(`${offerId(orgId)}:${offerId(caseId)}:${ABS18_TERMS.version}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
const pathFor = (orgId: string, caseId: string) => `${orgId}/${caseId}/standard-terms/${ABS18_TERMS.version}.pdf`
function mapFile(row: Record<string, unknown>, orgId: string, caseId: string): CustomerOfferFile {
  if (row.storage_bucket !== bucket || row.file_path !== pathFor(orgId, caseId) ||
    row.content_type !== 'application/pdf' || Number(row.file_size_bytes) !== ABS18_TERMS.size || row.file_name !== ABS18_TERMS.fileName)
    throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  return { id: String(row.id), fileName: ABS18_TERMS.fileName, contentType: 'application/pdf', fileSizeBytes: ABS18_TERMS.size }
}
export async function findStandardTermsFile(orgId: string, caseId: string): Promise<CustomerOfferFile | null> {
  const result = await createSupabaseAdminClient().from('action_case_attachments')
    .select('id,file_name,storage_bucket,file_path,content_type,file_size_bytes')
    .eq('id', standardTermsFileId(orgId, caseId)).eq('org_id', orgId).eq('action_case_id', caseId).maybeSingle()
  if (result.error) throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  return result.data ? mapFile(result.data, orgId, caseId) : null
}
export async function verifyStandardTermsFile(orgId: string, caseId: string) {
  const stored = await createSupabaseAdminClient().storage.from(bucket).download(pathFor(orgId, caseId))
  if (stored.error || !stored.data || createHash('sha256').update(Buffer.from(await stored.data.arrayBuffer())).digest('hex') !== ABS18_TERMS.sha256)
    throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
}
// Caller must authorize the case first. Stable identity makes retries and concurrent tabs idempotent.
export async function ensureStandardTermsFile(ctx: Context, caseId: string): Promise<CustomerOfferFile> {
  const existing = await findStandardTermsFile(ctx.orgId, caseId)
  if (existing) return existing
  const bytes = await readFile(join(process.cwd(), ABS18_TERMS.assetPath))
  if (bytes.length !== ABS18_TERMS.size || createHash('sha256').update(bytes).digest('hex') !== ABS18_TERMS.sha256)
    throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  const db = createSupabaseAdminClient(), path = pathFor(ctx.orgId, caseId)
  // Never overwrite a stored edition, including during a concurrent upload retry.
  const upload = await db.storage.from(bucket).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
  if (upload.error) await verifyStandardTermsFile(ctx.orgId, caseId)
  const insert = await db.from('action_case_attachments').insert({
    id: standardTermsFileId(ctx.orgId, caseId), org_id: ctx.orgId, action_case_id: caseId,
    action_case_item_id: null, attachment_type: 'document', title: ABS18_TERMS.name,
    file_name: ABS18_TERMS.fileName, storage_bucket: bucket, file_path: path,
    content_type: 'application/pdf', file_size_bytes: bytes.length, uploaded_by: ctx.userId,
  })
  if (insert.error && insert.error.code !== '23505') throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  if (!insert.error) await db.from('action_case_events').insert({ org_id: ctx.orgId, action_case_id: caseId,
    event_type: 'attachment_added', message: 'ABS 18:s standardvillkor lades till.', performed_by: ctx.userId })
  const file = await findStandardTermsFile(ctx.orgId, caseId)
  if (!file) throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  return file
}
