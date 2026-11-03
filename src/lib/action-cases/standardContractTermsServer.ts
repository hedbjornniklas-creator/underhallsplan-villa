import 'server-only'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { standardTermsFor, type StandardContractForm } from './standardContractTerms'
import { offerId, type CustomerOfferFile } from './customerOffers'

type Context = { orgId: string; userId: string }
const bucket = 'action-case-files'
export function standardTermsFileId(orgId: string, caseId: string, form: StandardContractForm = 'abs18') {
  const hash = createHash('sha256').update(`${offerId(orgId)}:${offerId(caseId)}:${standardTermsFor(form)!.version}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
const pathFor = (orgId: string, caseId: string, form: StandardContractForm) => `${orgId}/${caseId}/standard-terms/${standardTermsFor(form)!.version}.pdf`
function mapFile(row: Record<string, unknown>, orgId: string, caseId: string, form: StandardContractForm): CustomerOfferFile {
  const terms = standardTermsFor(form)!
  if (row.storage_bucket !== bucket || row.file_path !== pathFor(orgId, caseId, form) ||
    row.content_type !== 'application/pdf' || Number(row.file_size_bytes) !== terms.size || row.file_name !== terms.fileName)
    throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  return { id: String(row.id), fileName: terms.fileName, contentType: 'application/pdf', fileSizeBytes: terms.size }
}
export async function findStandardTermsFile(orgId: string, caseId: string, form: StandardContractForm = 'abs18'): Promise<CustomerOfferFile | null> {
  const result = await createSupabaseAdminClient().from('action_case_attachments')
    .select('id,file_name,storage_bucket,file_path,content_type,file_size_bytes')
    .eq('id', standardTermsFileId(orgId, caseId, form)).eq('org_id', orgId).eq('action_case_id', caseId).maybeSingle()
  if (result.error) throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  return result.data ? mapFile(result.data, orgId, caseId, form) : null
}
export async function verifyStandardTermsFile(orgId: string, caseId: string, form: StandardContractForm = 'abs18') {
  const stored = await createSupabaseAdminClient().storage.from(bucket).download(pathFor(orgId, caseId, form))
  if (stored.error || !stored.data || createHash('sha256').update(Buffer.from(await stored.data.arrayBuffer())).digest('hex') !== standardTermsFor(form)!.sha256)
    throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
}
// Caller must authorize the case first. Stable identity makes retries and concurrent tabs idempotent.
export async function ensureStandardTermsFile(ctx: Context, caseId: string, form: StandardContractForm = 'abs18'): Promise<CustomerOfferFile> {
  const terms = standardTermsFor(form)!
  const existing = await findStandardTermsFile(ctx.orgId, caseId, form)
  if (existing) return existing
  const bytes = await readFile(join(process.cwd(), terms.assetPath))
  if (bytes.length !== terms.size || createHash('sha256').update(bytes).digest('hex') !== terms.sha256)
    throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  const db = createSupabaseAdminClient(), path = pathFor(ctx.orgId, caseId, form)
  // Never overwrite a stored edition, including during a concurrent upload retry.
  const upload = await db.storage.from(bucket).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
  if (upload.error) await verifyStandardTermsFile(ctx.orgId, caseId, form)
  const insert = await db.from('action_case_attachments').insert({
    id: standardTermsFileId(ctx.orgId, caseId, form), org_id: ctx.orgId, action_case_id: caseId,
    action_case_item_id: null, attachment_type: 'document', title: terms.name,
    file_name: terms.fileName, storage_bucket: bucket, file_path: path,
    content_type: 'application/pdf', file_size_bytes: bytes.length, uploaded_by: ctx.userId,
  })
  if (insert.error && insert.error.code !== '23505') throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  if (!insert.error) await db.from('action_case_events').insert({ org_id: ctx.orgId, action_case_id: caseId,
    event_type: 'attachment_added', message: `${form === 'abs18' ? 'ABS 18:s standardvillkor' : 'Hantverkarformuläret 17 med allmänna bestämmelser'} lades till.`, performed_by: ctx.userId })
  const file = await findStandardTermsFile(ctx.orgId, caseId, form)
  if (!file) throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  return file
}
