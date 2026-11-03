import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCustomerOfferWorkspace } from './customerOffersServer'
import { mapCustomerOffer, offerId, type CustomerOfferSnapshot } from './customerOffers'
import { renderContractSigningPdf } from './contractSigningPdf'
import { publicContractParties } from './customerContractParties'
import { verifyStandardTermsFile } from './standardContractTermsServer'
import { appendHf17TermsPdf } from './standardContractTermsPdf'
import { appendPdfDocuments } from '../pdf/appendPages'
import { offerDocumentMode } from './offerDocuments'

type Context = { orgId: string; userId: string }
function checked(error: { code?: string } | null) {
  if (!error) return
  throw new Error(['42P01', '42703', 'PGRST202', 'PGRST205'].includes(error.code ?? '') ? 'CUSTOMER_OFFER_SCHEMA' : 'CUSTOMER_OFFER_PDF_FAILED')
}

export async function downloadCurrentOfferPdf(ctx: Context, caseId: string, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('CUSTOMER_OFFER_INVALID')
  offerId(caseId)
  const db = createSupabaseAdminClient()
  const workspace = await getCustomerOfferWorkspace(ctx, caseId, 'offer')
  if (workspace.revision !== revision) throw new Error('CUSTOMER_OFFER_STALE')
  const project = await db.from('action_cases').select('id,title,property_address,customer_name,customer_email')
    .eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle()
  checked(project.error)
  if (!project.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  const draft = workspace.draft, profile = draft.senderProfile
  const organization = profile ? null : await db.from('organizations').select('name').eq('id', ctx.orgId).maybeSingle()
  if (organization) checked(organization.error)
  const user = profile ? null : await db.from('profiles').select('email').eq('id', ctx.userId).maybeSingle()
  if (user) checked(user.error)
  const selected = draft.attachmentIds.length ? await db.from('action_case_attachments').select('id,file_name,content_type,file_size_bytes,storage_bucket,file_path,question_id')
    .eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('id', draft.attachmentIds) : { data: [], error: null }
  checked(selected.error)
  const snapshot: CustomerOfferSnapshot = { ...draft,
    ...(draft.contractParties ? { contractParties: publicContractParties(draft.contractParties) } : {}),
    projectTitle: project.data.title, propertyAddress: project.data.property_address,
    customerName: draft.contractParties?.customers[0]?.name ?? workspace.recipient?.name ?? project.data.customer_name ?? '',
    customerEmail: draft.contractParties?.email ?? workspace.recipient?.email ?? project.data.customer_email ?? '',
    issuerName: profile?.name ?? draft.contractParties?.contractor.companyName ?? organization?.data?.name ?? '',
    replyEmail: profile ? profile.email ?? '' : draft.contractParties?.contractor.email ?? user?.data?.email ?? '' }
  const files = draft.attachmentIds.flatMap(id => {
    const file = selected.data?.find(file => file.id === id)
    return file ? [{ id: file.id, fileName: file.file_name, contentType: file.content_type, fileSizeBytes: Number(file.file_size_bytes) }] : []
  })
  const customerSnapshot = mapCustomerOffer({ id: caseId, version: 0, status: 'published', snapshot, files }).snapshot
  let bytes = await renderContractSigningPdf({ kind: 'offer', id: caseId, version: 0, draftRevision: revision, createdAt: new Date().toISOString(), snapshot: customerSnapshot, files })
  const ids = [...new Set([...(draft.contractDetails?.assignment?.documents.map(document => document.fileId) ?? []), ...draft.attachmentIds])]
    .filter(id => offerDocumentMode(draft, id) === 'pdf' && !(draft.contractForm === 'hf17' && id === workspace.standardTermsFile?.id))
  if (ids.length) {
    const quotes = await db.from('action_case_work_quotes').select('document_id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('document_id', ids)
    const requests = await db.from('action_case_quote_requests').select('response_document_id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('response_document_id', ids)
    checked(quotes.error); checked(requests.error)
    if (quotes.data?.length || requests.data?.length) throw new Error('CUSTOMER_OFFER_PDF_ATTACHMENTS')
    const appendices: { bytes: Buffer }[] = []
    let total = bytes.length
    for (const id of ids) {
      const file = selected.data?.find(file => file.id === id), size = Number(file?.file_size_bytes)
      if (!file || file.question_id || file.content_type !== 'application/pdf' || file.storage_bucket !== 'action-case-files' ||
        typeof file.file_path !== 'string' || !file.file_path.startsWith(`${ctx.orgId}/${caseId}/`) || file.file_path.includes('..') ||
        !Number.isSafeInteger(size) || size <= 0 || size > 20_000_000 || total + size > 50_000_000) throw new Error('CUSTOMER_OFFER_PDF_ATTACHMENTS')
      const stored = await db.storage.from(file.storage_bucket).download(file.file_path)
      if (stored.error || !stored.data) throw new Error('CUSTOMER_OFFER_PDF_ATTACHMENTS')
      const content = Buffer.from(await stored.data.arrayBuffer())
      if (content.length !== size) throw new Error('CUSTOMER_OFFER_PDF_ATTACHMENTS')
      total += content.length
      appendices.push({ bytes: content })
    }
    try { bytes = await appendPdfDocuments(bytes, appendices) } catch { throw new Error('CUSTOMER_OFFER_PDF_ATTACHMENTS') }
  }
  if (draft.contractForm === 'hf17') {
    const terms = workspace.standardTermsFile
    if (!terms || draft.termsAttachmentId !== terms.id || !files.some(file => file.id === terms.id)) throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
    await verifyStandardTermsFile(ctx.orgId, caseId, 'hf17')
    bytes = await appendHf17TermsPdf(bytes)
  }
  if (bytes.length < 100 || bytes.length > 50_000_000) throw new Error('CUSTOMER_OFFER_PDF_LIMIT')
  // Never download a superseded draft if it changed while PDF pagination was running.
  const current = await db.from('action_case_customer_offer_drafts').select('revision').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  checked(current.error)
  if (current.data?.revision !== revision) throw new Error('CUSTOMER_OFFER_STALE')
  return { bytes, fileName: 'Offert.pdf', contentType: 'application/pdf' }
}
