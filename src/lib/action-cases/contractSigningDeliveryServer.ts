import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { CUSTOMER_OFFER_BUCKET, mapCustomerOffer, offerId, type CustomerOfferSnapshot, type SharedSigningContract } from './customerOffers'
import { publicContractParties } from './customerContractParties'
import { downloadContractSigningFile } from './contractSigningServer'

type Context = { orgId: string; userId: string }
type StoredFile = { path: string; sha256: string; fileSizeBytes: number; fileName?: string }
type Delivery = { document_id: string; participant_id: string | null; shared_at: string | null; withdrawn_at: string | null; customer_pdf: StoredFile | null; signed_copy: StoredFile | null; signed_at: string | null }
const table = 'action_case_contract_signing_delivery'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')) throw new Error('CUSTOMER_OFFER_DELIVERY_SCHEMA')
  throw new Error(error.message?.match(/(?:CUSTOMER_OFFER|CUSTOMER_REGISTRY)_[A-Z_]+/)?.[0] || 'CUSTOMER_OFFER_FILES')
}
async function version(ctx: Context, caseId: string, id: string, revision?: unknown) {
  const result = await createSupabaseAdminClient().from('action_case_contract_signing_documents').select('*')
    .eq('org_id', ctx.orgId).eq('action_case_id', offerId(caseId)).eq('id', offerId(id)).maybeSingle()
  checked(result.error)
  if (!result.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision !== result.data.draft_revision)) throw new Error('CUSTOMER_OFFER_STALE')
  return result.data
}
async function delivery(ctx: Context, caseId: string, id: string): Promise<Delivery | null> {
  const result = await createSupabaseAdminClient().from(table).select('*').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('document_id', id).maybeSingle()
  checked(result.error)
  return result.data
}
async function write(ctx: Context, caseId: string, operation: string, data: Record<string, unknown>) {
  const result = await createSupabaseAdminClient().rpc('write_contract_signing_delivery', {
    p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId, p_operation: operation, p_data: data,
  })
  checked(result.error)
  return result.data
}
async function readBytes(path: string, manifest: StoredFile, prefix: string) {
  if (!path.startsWith(prefix) || path.includes('..')) throw new Error('CUSTOMER_OFFER_FILES')
  const downloaded = await createSupabaseAdminClient().storage.from(CUSTOMER_OFFER_BUCKET).download(path)
  checked(downloaded.error)
  if (!downloaded.data) throw new Error('CUSTOMER_OFFER_FILES')
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  if (bytes.length !== Number(manifest.fileSizeBytes) || hash(bytes) !== manifest.sha256) throw new Error('CUSTOMER_OFFER_FILES')
  return { bytes, fileName: manifest.fileName || 'Avtal.pdf', contentType: 'application/pdf' }
}
export async function shareSigningContract(ctx: Context, caseId: string, payload: Record<string, unknown>, origin: string) {
  if (payload.confirmed !== true) throw new Error('CUSTOMER_OFFER_CONFIRM')
  const id = offerId(payload.id), row = await version(ctx, caseId, id, payload.revision)
  if (row.released_at) throw new Error('CUSTOMER_OFFER_STALE')
  const existing = await delivery(ctx, caseId, id)
  const db = createSupabaseAdminClient(), recipient = await db.from('action_case_participants').select('id,name,email')
    .eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('id', offerId(payload.participantId)).eq('role', 'customer').maybeSingle()
  checked(recipient.error)
  if (!recipient.data?.name || !recipient.data.email || recipient.data.name !== payload.recipientName ||
    recipient.data.email.trim().toLowerCase() !== payload.recipientEmail || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.data.email)) throw new Error('CUSTOMER_OFFER_RECIPIENT')
  let pdf = existing?.customer_pdf
  let candidate: StoredFile | null = null
  if (!pdf) {
    // The bearer portal gets an immutable, identity-redacted copy, never the private original.
    const { renderContractSigningPdf } = await import('./contractSigningPdf')
    const snapshot = row.snapshot as CustomerOfferSnapshot
    const bytes = await renderContractSigningPdf({ id, version: row.version, createdAt: row.created_at, files: row.files,
      snapshot: { ...snapshot, ...(snapshot.contractParties ? { contractParties: publicContractParties(snapshot.contractParties) } : {}) } })
    if (bytes.length < 100 || bytes.length > 50_000_000) throw new Error('CUSTOMER_OFFER_PDF_LIMIT')
    pdf = { path: `${ctx.orgId}/${caseId}/signing/${id}/customer/${randomUUID()}.pdf`, fileSizeBytes: bytes.length, sha256: hash(bytes) }
    const upload = await db.storage.from(CUSTOMER_OFFER_BUCKET).upload(pdf.path, bytes, { contentType: 'application/pdf', upsert: false })
    checked(upload.error)
    candidate = pdf
  }
  const token = generateAssignmentToken()
  try { await write(ctx, caseId, 'share', { ...payload, id, tokenHash: hashAssignmentToken(token), customerPdf: pdf }) }
  finally {
    if (candidate) {
      const current = await delivery(ctx, caseId, id).catch(() => undefined)
      if (current !== undefined && current?.customer_pdf?.path !== candidate.path) await db.storage.from(CUSTOMER_OFFER_BUCKET).remove([candidate.path])
    }
  }
  return `${new URL(origin).origin}/atgardsarende/${token}`
}
export async function withdrawSigningContract(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  await version(ctx, caseId, offerId(payload.id), payload.revision)
  await write(ctx, caseId, 'withdraw', payload)
}
export async function registerSignedContract(ctx: Context, caseId: string, payload: Record<string, unknown>, file: File) {
  if (payload.confirmed !== true || file.type !== 'application/pdf' || file.size < 100 || file.size > 20_000_000 || !file.name || file.name.length > 250)
    throw new Error('CUSTOMER_OFFER_SIGNED_COPY')
  const id = offerId(payload.id), row = await version(ctx, caseId, id, payload.revision)
  if (row.released_at) throw new Error('CUSTOMER_OFFER_STALE')
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('CUSTOMER_OFFER_SIGNED_COPY')
  const existing = await delivery(ctx, caseId, id)
  if (existing?.signed_copy) {
    if (existing.signed_copy.sha256 !== hash(bytes)) throw new Error('CUSTOMER_OFFER_IMMUTABLE')
    return
  }
  const signedCopy = { path: `${ctx.orgId}/${caseId}/signing/${id}/signed/${randomUUID()}.pdf`, sha256: hash(bytes), fileSizeBytes: bytes.length, fileName: file.name }
  const db = createSupabaseAdminClient(), uploaded = await db.storage.from(CUSTOMER_OFFER_BUCKET).upload(signedCopy.path, bytes, { contentType: 'application/pdf', upsert: false })
  checked(uploaded.error)
  try { await write(ctx, caseId, 'register_signed', { ...payload, id, signedCopy }) }
  finally {
    // Retain a possibly committed receipt on uncertain database outcomes.
    const current = await delivery(ctx, caseId, id).catch(() => undefined)
    if (current !== undefined && current?.signed_copy?.path !== signedCopy.path) await db.storage.from(CUSTOMER_OFFER_BUCKET).remove([signedCopy.path])
  }
}
export async function downloadSignedContract(ctx: Context, caseId: string, id: string) {
  await version(ctx, caseId, id)
  const entry = await delivery(ctx, caseId, id)
  if (!entry?.signed_copy) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  return readBytes(entry.signed_copy.path, entry.signed_copy, `${ctx.orgId}/${caseId}/signing/${id}/signed/`)
}
export async function downloadCustomerSigningPdf(ctx: Context, caseId: string, id: string) {
  const row = await version(ctx, caseId, offerId(id))
  const entry = await delivery(ctx, caseId, id)
  if (!entry?.customer_pdf) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  return readBytes(entry.customer_pdf.path, { ...entry.customer_pdf, fileName: `Avtal-v${row.version}.pdf` }, `${ctx.orgId}/${caseId}/signing/${id}/customer/`)
}
export async function getSharedSigningContracts(orgId: string, caseId: string, participantId: string): Promise<SharedSigningContract[]> {
  const db = createSupabaseAdminClient(), grants = await db.from(table).select('document_id,shared_at,signed_at')
    .eq('org_id', orgId).eq('action_case_id', caseId).eq('participant_id', participantId).is('withdrawn_at', null)
  if (grants.error && ['42P01', 'PGRST205'].includes(grants.error.code)) return []
  checked(grants.error)
  if (!grants.data?.length) return []
  const rows = await db.from('action_case_contract_signing_documents').select('id,version,snapshot,files,created_at,released_at')
    .eq('org_id', orgId).eq('action_case_id', caseId).in('id', grants.data.map((g) => g.document_id)).order('version', { ascending: false })
  checked(rows.error)
  return (rows.data || []).map((r) => {
    const grant = grants.data!.find((g) => g.document_id === r.id)!
    return { createdAt: r.created_at, releasedAt: r.released_at, sharedAt: grant.shared_at, signedCopyRegisteredAt: grant.signed_at,
      document: mapCustomerOffer({ ...r, status: 'published', published_at: grant.shared_at, accepted_option_ids: [] }) }
  })
}
export async function downloadSharedSigningFile(token: string, id: string, fileId: string) {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) throw new Error('CUSTOMER_OFFER_CLOSED')
  const db = createSupabaseAdminClient(), access = await db.from('action_case_access_links').select('org_id,action_case_id,participant_id,expires_at,revoked_at')
    .eq('token_hash', hashAssignmentToken(token)).maybeSingle()
  checked(access.error)
  if (!access.data || access.data.revoked_at || new Date(access.data.expires_at).getTime() <= Date.now()) throw new Error('CUSTOMER_OFFER_CLOSED')
  const a = access.data, ctx = { orgId: a.org_id, userId: '' }
  const recipient = await db.from('action_case_participants').select('id').eq('org_id', a.org_id).eq('action_case_id', a.action_case_id).eq('id', a.participant_id).eq('role', 'customer').maybeSingle()
  checked(recipient.error)
  if (!recipient.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  const grant = await delivery(ctx, a.action_case_id, offerId(id))
  if (!grant?.shared_at || grant.withdrawn_at || grant.participant_id !== a.participant_id) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  if (fileId !== 'pdf') return downloadContractSigningFile(ctx, a.action_case_id, id, offerId(fileId))
  if (!grant.customer_pdf) throw new Error('CUSTOMER_OFFER_FILES')
  return readBytes(grant.customer_pdf.path, { ...grant.customer_pdf, fileName: `Avtal-v${(await version(ctx, a.action_case_id, id)).version}.pdf` }, `${a.org_id}/${a.action_case_id}/signing/${id}/`)
}
