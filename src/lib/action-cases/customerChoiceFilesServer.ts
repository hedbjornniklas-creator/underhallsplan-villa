import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import { CUSTOMER_OFFER_BUCKET, offerId } from './customerOffers'
import { normalizeChoiceFileRefs, type CustomerPlannedItem } from './customerPlanning'

type Context = { orgId: string; userId: string }
type Manifest = { id: string; optionId: string; sourceId: string; fileName: string; fileSizeBytes: number; sha256: string; path: string }
const missing = (code?: string) => ['42703', '42883', '42P01', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code ?? '')
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  throw new Error(missing(error.code) ? 'CUSTOMER_CHOICE_FILE_SCHEMA' : error.message?.match(/CUSTOMER_(?:OFFER|CHOICE)_[A-Z_]+/)?.[0] ?? 'CUSTOMER_CHOICE_FILES')
}
export async function getCustomerChoiceFiles(orgId: string, caseId: string, items: CustomerPlannedItem[]) {
  const result = await createSupabaseAdminClient().from('action_case_customer_planning')
    .select('option_files,shared_option_files').eq('org_id', orgId).eq('action_case_id', caseId).maybeSingle()
  if (missing(result.error?.code)) return { filesAvailable: false }
  checked(result.error)
  return { filesAvailable: true, optionFiles: normalizeChoiceFileRefs(result.data?.option_files ?? [], items),
    sharedFileRefs: ((result.data?.shared_option_files ?? []) as Manifest[]).map((f) => ({ optionId: f.optionId, fileId: f.sourceId })) }
}
function verifiedPdf(bytes: Buffer, size: number, sha256?: string) {
  if (size < 100 || size > 20_000_000 || bytes.length !== size || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('CUSTOMER_CHOICE_FILES')
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (sha256 && digest !== sha256) throw new Error('CUSTOMER_CHOICE_FILES')
  return digest
}
// The caller authorizes the case before entering this file-only writer.
export async function writeCustomerChoiceFiles(ctx: Context, caseId: string, operation: string, data: Record<string, unknown>, items: CustomerPlannedItem[]) {
  const db = createSupabaseAdminClient(), refs = operation === 'unshare' ? [] : normalizeChoiceFileRefs(data.optionFiles, items)
  const probe = await db.rpc('assert_customer_choice_file_refs', { p_refs: refs, p_items: items })
  checked(probe.error)
  const created: string[] = []
  let attempted = false, cleanupSafe = true
  try {
    const manifests: Manifest[] = []
    if (operation === 'share') {
      const saved = await db.from('action_case_customer_planning').select('revision,option_files,shared_option_files')
        .eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
      checked(saved.error)
      if (!saved.data || saved.data.revision !== data.revision) throw new Error('CUSTOMER_OFFER_STALE')
      if (JSON.stringify(normalizeChoiceFileRefs(saved.data.option_files, items)) !== JSON.stringify(refs)) throw new Error('CUSTOMER_OFFER_CONFIRM')
      if (refs.length) {
        const ids = [...new Set(refs.map((r) => r.fileId))]
        const sources = await db.from('action_case_attachments').select('id,file_name,file_size_bytes,content_type,storage_bucket,file_path')
          .eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('id', ids)
        checked(sources.error)
        const quotes = await db.from('action_case_work_quotes').select('document_id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('document_id', ids)
        const responses = await db.from('action_case_quote_requests').select('response_document_id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('response_document_id', ids)
        checked(quotes.error); checked(responses.error)
        if (quotes.data?.length || responses.data?.length || sources.data?.length !== ids.length) throw new Error('CUSTOMER_CHOICE_FILES')
        let total = 0
        for (const ref of refs) {
          const source = sources.data.find((f) => f.id === ref.fileId)
          if (!source || source.content_type !== 'application/pdf' || source.storage_bucket !== 'action-case-files' || !source.file_path.startsWith(`${ctx.orgId}/${caseId}/`) || source.file_path.includes('..') || !source.file_name.trim() || source.file_name.length > 250) throw new Error('CUSTOMER_CHOICE_FILES')
          total += Number(source.file_size_bytes)
          if (total > 50_000_000 || Number(source.file_size_bytes) > 20_000_000) throw new Error('CUSTOMER_CHOICE_FILES')
          const download = await db.storage.from('action-case-files').download(source.file_path)
          if (download.error || !download.data) throw new Error('CUSTOMER_CHOICE_FILES')
          const bytes = Buffer.from(await download.data.arrayBuffer()), sha256 = verifiedPdf(bytes, Number(source.file_size_bytes))
          const existing = (saved.data.shared_option_files as Manifest[]).find((f) => f.optionId === ref.optionId && f.sourceId === ref.fileId && f.fileName === source.file_name && f.fileSizeBytes === bytes.length && f.sha256 === sha256)
          if (existing) {
            if (existing.path !== `${ctx.orgId}/${caseId}/choices/${existing.id}.pdf`) throw new Error('CUSTOMER_CHOICE_FILES')
            const archived = await db.storage.from(CUSTOMER_OFFER_BUCKET).download(existing.path)
            if (archived.error || !archived.data) throw new Error('CUSTOMER_CHOICE_FILES')
            verifiedPdf(Buffer.from(await archived.data.arrayBuffer()), bytes.length, sha256)
            manifests.push(existing); continue
          }
          const id = randomUUID(), path = `${ctx.orgId}/${caseId}/choices/${id}.pdf`
          // A unique path is never overwritten, including on retries.
          created.push(path)
          const uploaded = await db.storage.from(CUSTOMER_OFFER_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
          if (uploaded.error) throw new Error('CUSTOMER_CHOICE_FILES')
          const copy = await db.storage.from(CUSTOMER_OFFER_BUCKET).download(path)
          if (copy.error || !copy.data) throw new Error('CUSTOMER_CHOICE_FILES')
          verifiedPdf(Buffer.from(await copy.data.arrayBuffer()), bytes.length, sha256)
          manifests.push({ id, optionId: ref.optionId, sourceId: ref.fileId, fileName: source.file_name, fileSizeBytes: bytes.length, sha256, path })
        }
      }
    }
    attempted = true; cleanupSafe = false
    const result = operation === 'save' && data.costing !== undefined
      ? await db.rpc('save_customer_planning_costing', { p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId, p_data: { ...data, optionFiles: refs } })
      : await db.rpc('write_customer_planning', { p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId, p_operation: operation, p_data: { ...data, optionFiles: refs, sharedFiles: manifests } })
    // A transport timeout can leave the transaction running even if a subsequent
    // read still shows the old plan. Only a confirmed commit/SQL rejection is final.
    cleanupSafe = !result.error || result.error.code === 'P0001'
    checked(result.error)
  } finally {
    if (created.length && cleanupSafe) {
      // A timeout may hide a committed share. Delete only proven unreferenced copies.
      try {
        const current = attempted ? await db.from('action_case_customer_planning').select('shared_option_files').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle() : null
        if (!current?.error) {
          const live = ((current?.data?.shared_option_files ?? []) as Manifest[]).map((f) => f.path)
          const orphans = created.filter((p) => !live.includes(p))
          if (orphans.length) await db.storage.from(CUSTOMER_OFFER_BUCKET).remove(orphans)
        }
      } catch { /* Retain copies when the sharing outcome cannot be established. */ }
    }
  }
}

export async function customerChoiceFile(input: { token?: string; ctx?: Context; caseId?: string; fileId: string }) {
  const db = createSupabaseAdminClient(), id = offerId(input.fileId)
  let orgId: string, caseId: string, file: Manifest | undefined
  if (input.token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new Error('CUSTOMER_CHOICE_CLOSED')
    const result = await db.rpc('read_customer_choice_file', { p_token_hash: hashAssignmentToken(input.token), p_file_id: id })
    checked(result.error)
    orgId = result.data?.orgId; caseId = result.data?.caseId; file = result.data?.file
  } else {
    if (!input.ctx || !input.caseId) throw new Error('CUSTOMER_CHOICE_NOT_SHARED')
    orgId = input.ctx.orgId; caseId = offerId(input.caseId)
    const c = await db.from('action_cases').select('id').eq('id', caseId).eq('org_id', orgId).maybeSingle()
    checked(c.error)
    if (!c.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
    const plan = await db.from('action_case_customer_planning').select('shared_option_files,shared_categories,participant_id').eq('org_id', orgId).eq('action_case_id', caseId).maybeSingle()
    checked(plan.error)
    if (plan.data?.shared_categories && plan.data.participant_id) file = (plan.data.shared_option_files as Manifest[]).find((f) => f.id === id)
  }
  if (!file || file.path !== `${orgId}/${caseId}/choices/${id}.pdf`) throw new Error('CUSTOMER_CHOICE_NOT_SHARED')
  if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('CUSTOMER_CHOICE_FILES')
  const download = await db.storage.from(CUSTOMER_OFFER_BUCKET).download(file.path)
  if (download.error || !download.data) throw new Error('CUSTOMER_CHOICE_FILES')
  const bytes = Buffer.from(await download.data.arrayBuffer())
  verifiedPdf(bytes, file.fileSizeBytes, file.sha256)
  return { bytes, fileName: file.fileName }
}
export function customerChoiceFileResponse(file: { bytes: Buffer; fileName: string }, download: boolean) {
  const safe = file.fileName.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 250)
  const ascii = safe.replace(/[^a-zA-Z0-9._ -]/g, '_') || 'bilaga.pdf'
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return new Response(new Uint8Array(file.bytes), { headers: {
    'Content-Type': 'application/pdf', 'Content-Length': String(file.bytes.length), 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
  } })
}
