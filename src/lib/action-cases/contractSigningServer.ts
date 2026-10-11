import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { CUSTOMER_OFFER_BUCKET, normalizeCustomerOffer, offerId, type ContractSigningVersion, type CustomerOfferSnapshot } from './customerOffers'
import { contractSigningIssues, signingPdfFilename } from './contractSigning'
import { standardTermsFileId, verifyStandardTermsFile } from './standardContractTermsServer'

type Context = { orgId: string; userId: string }
type FrozenFile = { id: string; fileName: string; contentType: string; fileSizeBytes: number; path: string; sourcePath: string; sha256: string }
type StoredVersion = { id: string; org_id: string; action_case_id: string; version: number; draft_revision: number; snapshot: CustomerOfferSnapshot;
  files: FrozenFile[]; pdf_path: string; pdf_sha256: string; pdf_size: number; created_at: string; released_at: string | null }
const table = 'action_case_contract_signing_documents'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')) throw new Error('CUSTOMER_OFFER_SIGNING_SCHEMA')
  throw new Error(error.message?.match(/CUSTOMER_OFFER_[A-Z_]+/)?.[0] || 'CUSTOMER_OFFER_PDF_FAILED')
}
async function requireProject(ctx: Context, caseId: string) {
  const result = await createSupabaseAdminClient().from('action_cases').select('id,title,property_address').eq('org_id', ctx.orgId).eq('id', offerId(caseId)).maybeSingle()
  checked(result.error)
  if (!result.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  return result.data
}
export async function getContractSigningVersions(ctx: Context, caseId: string): Promise<{ signingAvailable: boolean; signingVersions: ContractSigningVersion[] }> {
  const result = await createSupabaseAdminClient().from(table).select('*').eq('org_id', ctx.orgId).eq('action_case_id', caseId).order('version', { ascending: false }).limit(100)
  if (result.error && ['42P01', 'PGRST205'].includes(result.error.code)) return { signingAvailable: false, signingVersions: [] }
  checked(result.error)
  return { signingAvailable: true, signingVersions: ((result.data || []) as StoredVersion[]).map((row) => ({
    id: row.id, version: row.version, revision: row.draft_revision, createdAt: row.created_at, releasedAt: row.released_at,
    snapshot: row.snapshot, pdfSha256: row.pdf_sha256, fileSizeBytes: Number(row.pdf_size),
    files: row.files.map(({ id, fileName, contentType, fileSizeBytes }) => ({ id, fileName, contentType, fileSizeBytes })) })) }
}
export async function freezeContractForSigning(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  if (payload.confirmed !== true) throw new Error('CUSTOMER_OFFER_CONFIRM')
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) throw new Error('CUSTOMER_OFFER_INVALID')
  const project = await requireProject(ctx, caseId), db = createSupabaseAdminClient()
  const versions = await getContractSigningVersions(ctx, caseId)
  if (!versions.signingAvailable) throw new Error('CUSTOMER_OFFER_SIGNING_SCHEMA')
  const prior = versions.signingVersions.find((s) => s.revision === payload.revision)
  if (prior) { if (prior.releasedAt) throw new Error('CUSTOMER_OFFER_STALE'); return }
  const result = await db.from('action_case_customer_contract_drafts').select('body,revision').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  checked(result.error)
  if (!result.data || result.data.revision !== payload.revision) throw new Error('CUSTOMER_OFFER_STALE')
  const draft = normalizeCustomerOffer(result.data.body)
  if (contractSigningIssues(draft).length) throw new Error('CUSTOMER_OFFER_INCOMPLETE')
  if (draft.contractForm === 'abs18') {
    if (draft.termsAttachmentId !== standardTermsFileId(ctx.orgId, caseId)) throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
    await verifyStandardTermsFile(ctx.orgId, caseId)
  }
  const state = await db.from('action_case_customer_offers').select('status').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('status', ['accepted', 'published'])
  checked(state.error)
  if (state.data?.some((s) => s.status === 'accepted')) throw new Error('CUSTOMER_OFFER_ACCEPTED')
  if (state.data?.length) throw new Error('CUSTOMER_OFFER_WITHDRAW_FIRST')
  if (versions.signingVersions.some((s) => !s.releasedAt)) throw new Error('CUSTOMER_OFFER_LOCKED')
  const id = randomUUID(), version = (versions.signingVersions[0]?.version || 0) + 1, createdAt = new Date().toISOString()
  const parties = draft.contractParties!
  const snapshot: CustomerOfferSnapshot = { ...draft, projectTitle: project.title, propertyAddress: project.property_address,
    customerName: parties.customers[0].name, customerEmail: parties.email, issuerName: parties.contractor.companyName, replyEmail: parties.contractor.email }
  const selected = draft.attachmentIds.length ? await db.from('action_case_attachments').select('id,file_name,content_type,file_size_bytes,storage_bucket,file_path')
    .eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('id', draft.attachmentIds) : { data: [], error: null }
  checked(selected.error)
  if (selected.data?.length !== draft.attachmentIds.length) throw new Error('CUSTOMER_OFFER_FILES')
  const sources = draft.attachmentIds.map((id) => selected.data!.find((f) => f.id === id)!)
  if (sources.reduce((sum, f) => sum + Number(f.file_size_bytes), 0) > 100_000_000) throw new Error('CUSTOMER_OFFER_PDF_LIMIT')
  const prefix = `${ctx.orgId}/${caseId}/signing/${id}`, files: FrozenFile[] = [], paths: string[] = []
  let attempted = false
  try {
    for (const file of sources) {
      if (file.storage_bucket !== 'action-case-files' || !file.file_path.startsWith(`${ctx.orgId}/${caseId}/`) || file.file_path.includes('..')) throw new Error('CUSTOMER_OFFER_FILES')
      const path = `${prefix}/${file.id}`
      const copy = await db.storage.from(file.storage_bucket).copy(file.file_path, path, { destinationBucket: CUSTOMER_OFFER_BUCKET })
      checked(copy.error); paths.push(path)
      const downloaded = await db.storage.from(CUSTOMER_OFFER_BUCKET).download(path)
      checked(downloaded.error)
      if (!downloaded.data || downloaded.data.size !== Number(file.file_size_bytes)) throw new Error('CUSTOMER_OFFER_FILES')
      files.push({ id: file.id, fileName: file.file_name, contentType: file.content_type, fileSizeBytes: Number(file.file_size_bytes), path, sourcePath: file.file_path, sha256: hash(Buffer.from(await downloaded.data.arrayBuffer())) })
    }
    const { renderContractSigningPdf } = await import('./contractSigningPdf')
    const pdf = await renderContractSigningPdf({ id, version, createdAt, snapshot, files })
    if (pdf.length > 50_000_000 || pdf.length < 100) throw new Error('CUSTOMER_OFFER_PDF_LIMIT')
    const pdfPath = `${prefix}/contract.pdf`
    const uploaded = await db.storage.from(CUSTOMER_OFFER_BUCKET).upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: false })
    checked(uploaded.error); paths.push(pdfPath)
    attempted = true
    const written = await db.rpc('write_contract_signing_document', { p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId, p_operation: 'freeze',
      p_data: { id, version, revision: payload.revision, confirmed: true, createdAt, snapshot, files, pdfPath, pdfSha256: hash(pdf), pdfSize: pdf.length } })
    checked(written.error)
    if (written.data?.id !== id) { await db.storage.from(CUSTOMER_OFFER_BUCKET).remove(paths); paths.length = 0 }
  } catch (error) {
    // After an uncertain response, only remove our random-path copies if absence is confirmed.
    const persisted = attempted ? await db.from(table).select('id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('id', id).maybeSingle() : null
    if ((!attempted || (persisted && !persisted.error && !persisted.data)) && paths.length) await db.storage.from(CUSTOMER_OFFER_BUCKET).remove(paths)
    throw error
  }
}
export async function createNewContractDraft(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  await requireProject(ctx, caseId)
  if (payload.confirmed !== true || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) throw new Error('CUSTOMER_OFFER_INVALID')
  const result = await createSupabaseAdminClient().rpc('write_contract_signing_document', { p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId,
    p_operation: 'new_draft', p_data: { id: offerId(payload.id), revision: payload.revision, confirmed: true } })
  checked(result.error)
}
export async function downloadContractSigningFile(ctx: Context, caseId: string, documentId: string, fileId: string) {
  await requireProject(ctx, caseId)
  const db = createSupabaseAdminClient(), result = await db.from(table).select('*').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('id', offerId(documentId)).maybeSingle()
  checked(result.error)
  if (!result.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  const row = result.data as StoredVersion, file = fileId === 'pdf' ? null : row.files.find((f) => f.id === offerId(fileId))
  if (fileId !== 'pdf' && !file) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  const path = file?.path ?? row.pdf_path, prefix = `${ctx.orgId}/${caseId}/signing/${row.id}/`
  if (!path.startsWith(prefix) || path.includes('..')) throw new Error('CUSTOMER_OFFER_FILES')
  const downloaded = await db.storage.from(CUSTOMER_OFFER_BUCKET).download(path)
  checked(downloaded.error)
  if (!downloaded.data) throw new Error('CUSTOMER_OFFER_FILES')
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  if (bytes.length !== Number(file?.fileSizeBytes ?? row.pdf_size) || hash(bytes) !== (file?.sha256 ?? row.pdf_sha256)) throw new Error('CUSTOMER_OFFER_FILES')
  return { bytes, fileName: file?.fileName ?? signingPdfFilename(row), contentType: file?.contentType ?? 'application/pdf' }
}
