import 'server-only'
import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCustomerPlanning } from './customerOffersServer'
import { offerId } from './customerOffers'
import { renderChoiceOfferPdf, type ChoicePdfInput } from './choiceOfferPdf'

export async function downloadChoiceOfferPdf(ctx: { orgId: string; userId: string }, caseId: string, optionId: string, revision: number) {
  offerId(caseId); offerId(optionId)
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('CUSTOMER_CHOICE_OFFER_INVALID')
  // getCustomerPlanning authorizes the project before any data is read or rendered.
  const planning = await getCustomerPlanning(ctx, caseId)
  if (!planning.available || planning.revision !== revision) throw new Error('CUSTOMER_CHOICE_PDF_STALE')
  const item = planning.items.find(option => option.id === optionId)
  if (!item) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  const db = createSupabaseAdminClient(), category = planning.categories?.find(c => c.optionIds.includes(optionId))
  const project = await db.from('action_cases').select('property_address').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle()
  const issuer = await db.from('organizations').select('name').eq('id', ctx.orgId).maybeSingle()
  if (project.error || !project.data || issuer.error || !issuer.data) throw new Error('CUSTOMER_CHOICE_PDF_FAILED')
  const ids = (planning.optionFiles ?? []).filter(ref => ref.optionId === optionId).map(ref => ref.fileId)
  const files: string[] = []
  if (ids.length) {
    const selected = await db.from('action_case_attachments').select('id,file_name,content_type').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('id', ids)
    if (selected.error || selected.data?.length !== ids.length) throw new Error('CUSTOMER_CHOICE_FILES')
    for (const id of ids) {
      const file = selected.data.find(file => file.id === id)
      if (!file || file.content_type !== 'application/pdf') throw new Error('CUSTOMER_CHOICE_FILES')
      files.push(file.file_name)
    }
  }
  const content = { item, category: category?.title ?? '', specification: category?.specification ?? '', propertyAddress: project.data.property_address || '', issuer: issuer.data.name || '', files }
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12)
  const reference = `${optionId.slice(0, 8)}-v${revision}-${digest}`
  const input: ChoicePdfInput = { ...content, reference, date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) }
  let bytes: Buffer
  try { bytes = await renderChoiceOfferPdf(input) } catch { throw new Error('CUSTOMER_CHOICE_PDF_FAILED') }
  // A concurrent save must not silently turn the download into an obsolete document.
  const latest = await db.from('action_case_customer_planning').select('revision').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  if (latest.error || latest.data?.revision !== revision) throw new Error('CUSTOMER_CHOICE_PDF_STALE')
  return { bytes, fileName: `Val-tillval-${optionId.slice(0, 8)}-v${revision}.pdf` }
}
