import 'server-only'
import { randomInt, randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  generateAssignmentToken,
  hashAssignmentToken
} from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { quoteRequestHtml } from './quotes'
import { normalizeCustomerOfferCosting } from './customerOfferCosting'
import { normalizePlannedItems, type CustomerPlanning, type CustomerPlannedItem } from './customerPlanning'
import { writeContractCustomer } from './customerRegistryServer'
import { getProjectPropertyLink } from './propertyRegistryServer'
import { withStandardContractTerms } from './standardContractTerms'
import { ensureStandardTermsFile, findStandardTermsFile, standardTermsFileId, verifyStandardTermsFile } from './standardContractTermsServer'
import {
  CUSTOMER_OFFER_BUCKET,
  CUSTOMER_OFFER_COLUMNS,
  customerOfferTotal,
  emptyCustomerOffer,
  mapCustomerOffer,
  normalizeCustomerOffer,
  offerId,
  offerPublishIssues,
  type CustomerOffer,
  type CustomerOfferDraft,
  type CustomerOfferFile,
  type CustomerOfferWorkspace
} from './customerOffers'

type Context = { orgId: string; userId: string }
type Payload = Record<string, unknown>
type Email = Parameters<typeof sendAssignmentEmail>[0]
const schemaMissing = (code?: string) =>
  ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code ?? '')
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (schemaMissing(error.code)) throw new Error('CUSTOMER_OFFER_SCHEMA')
  throw new Error(
    error.message?.match(/CUSTOMER_OFFER_[A-Z_]+/)?.[0] ??
      'CUSTOMER_OFFER_FAILED'
  )
}
async function write(
  ctx: Context,
  caseId: string,
  operation: string,
  data: Payload
) {
  const result = await createSupabaseAdminClient().rpc('write_customer_offer', {
    p_org_id: ctx.orgId,
    p_case_id: offerId(caseId),
    p_user_id: ctx.userId,
    p_operation: operation,
    p_data: data
  })
  checked(result.error)
  return result.data as Payload
}
async function requireCase(ctx: Context, caseId: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from('action_cases')
    .select('*')
    .eq('id', offerId(caseId))
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  checked(error)
  if (!data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  return data
}
export async function getCustomerOfferWorkspace(
  ctx: Context,
  caseId: string
): Promise<CustomerOfferWorkspace> {
  const c = await requireCase(ctx, caseId),
    db = createSupabaseAdminClient()
  const draft = await db
    .from('action_case_customer_offer_drafts')
    .select('body,revision,internal_costing')
    .eq('action_case_id', caseId)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  let costingAvailable = true
  let savedDraft = draft.data
  let draftError = draft.error
  if (draft.error && ['42703', 'PGRST204'].includes(draft.error.code)) {
    // Older deployments retain manual pricing until migration 03 is applied.
    costingAvailable = false
    const legacy = await db.from('action_case_customer_offer_drafts')
      .select('body,revision').eq('action_case_id', caseId).eq('org_id', ctx.orgId).maybeSingle()
    savedDraft = legacy.data ? { ...legacy.data, internal_costing: {} } : null
    draftError = legacy.error
  }
  checked(draftError)
  const offers = await db
    .from('action_case_customer_offers')
    .select(CUSTOMER_OFFER_COLUMNS)
    .eq('action_case_id', caseId)
    .eq('org_id', ctx.orgId)
    .order('version', { ascending: false })
  checked(offers.error)
  const body = savedDraft
      ? normalizeCustomerOffer(savedDraft.body)
      : emptyCustomerOffer(c.title)
  const recipient = await db.from('action_case_participants').select('id,role,name,company_name,email,phone')
    .eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('role', 'customer').maybeSingle()
  checked(recipient.error)
  let customerNumber: string | null = null
  if (c.organization_customer_id) {
    const linked = await db.from('organization_customers').select('customer_number')
      .eq('org_id', ctx.orgId).eq('id', c.organization_customer_id).maybeSingle()
    checked(linked.error)
    customerNumber = linked.data ? String(linked.data.customer_number) : null
  }
  return {
    standardTermsFile: await findStandardTermsFile(ctx.orgId, caseId),
    propertyLink: await getProjectPropertyLink(c.property_id ?? null, 'property_id' in c),
    customerLink: { organizationId: ctx.orgId, available: 'organization_customer_id' in c, customerId: c.organization_customer_id ?? null, customerNumber },
    recipient: recipient.data ? { id: recipient.data.id, role: 'customer', name: recipient.data.name,
      companyName: recipient.data.company_name, email: recipient.data.email, phone: recipient.data.phone } : null,
    draft: body,
    planning: await getCustomerPlanning(ctx, caseId),
    costingAvailable,
    costing: normalizeCustomerOfferCosting(savedDraft?.internal_costing, body.items),
    revision: savedDraft?.revision ?? 0,
    offers: (offers.data ?? []).map(mapCustomerOffer)
  }
}
export async function saveCustomerOffer(
  ctx: Context,
  caseId: string,
  payload: Payload,
  mode: 'manual' | 'autosave' = 'manual'
) {
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0)
    throw new Error('CUSTOMER_OFFER_INVALID')
  let draft = normalizeCustomerOffer(payload.draft)
  await requireCase(ctx, caseId)
  if (draft.contractForm === 'abs18') {
    const file = await findStandardTermsFile(ctx.orgId, caseId) ?? await prepareStandardContractTerms(ctx, caseId)
    let files: CustomerOfferFile[] = []
    if (!draft.contractDetails?.assignment && draft.attachmentIds.length) {
      const selected = await createSupabaseAdminClient().from('action_case_attachments')
        .select('id,file_name,content_type,file_size_bytes').eq('org_id', ctx.orgId)
        .eq('action_case_id', caseId).in('id', draft.attachmentIds)
      checked(selected.error)
      files = (selected.data ?? []).map((row) => ({ id: row.id, fileName: row.file_name,
        contentType: row.content_type, fileSizeBytes: row.file_size_bytes }))
    }
    draft = normalizeCustomerOffer(withStandardContractTerms(draft, file, files))
  } else {
    const file = await findStandardTermsFile(ctx.orgId, caseId)
    if (file) draft = normalizeCustomerOffer(withStandardContractTerms(draft, file))
  }
  const costing = payload.costing === undefined
    ? undefined
    : normalizeCustomerOfferCosting(payload.costing, draft.items)
  await checkPricingSchema(draft)
  if (mode === 'manual' && draft.contractParties && 'organization_customer_id' in await requireCase(ctx, caseId)) {
    await writeContractCustomer(ctx, caseId, { ...payload, draft })
    return
  }
  if (costing !== undefined) {
    const result = await createSupabaseAdminClient().rpc('save_customer_offer_costing', {
      p_org_id: ctx.orgId,
      p_case_id: offerId(caseId),
      p_user_id: ctx.userId,
      p_data: { revision: payload.revision, body: draft, costing }
    })
    checked(result.error)
    return
  }
  await write(ctx, caseId, 'save', {
    revision: payload.revision,
    body: draft
  })
}
export async function prepareStandardContractTerms(ctx: Context, caseId: string) {
  await requireCase(ctx, caseId)
  const result = await createSupabaseAdminClient().from('action_case_customer_offers').select('id')
    .eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('status', 'accepted').maybeSingle()
  checked(result.error)
  if (result.data) throw new Error('CUSTOMER_OFFER_ACCEPTED')
  return ensureStandardTermsFile(ctx, caseId)
}
export async function bindContractCustomer(ctx: Context, caseId: string, payload: Payload) {
  await requireCase(ctx, caseId)
  await checkPricingSchema(normalizeCustomerOffer(payload.draft))
  await writeContractCustomer(ctx, caseId, payload, true)
}
export async function separateCustomerChoices(ctx: Context, caseId: string, payload: Payload) {
  await requireCase(ctx, caseId)
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1 ||
    !Number.isSafeInteger(payload.planningRevision) || Number(payload.planningRevision) < 0)
    throw new Error('CUSTOMER_OFFER_INVALID')
  const result = await createSupabaseAdminClient().rpc('separate_customer_choices', {
    p_org_id: ctx.orgId, p_case_id: offerId(caseId), p_user_id: ctx.userId,
    p_revision: payload.revision, p_planning_revision: payload.planningRevision
  })
  checked(result.error)
}
async function checkPricingSchema(draft: CustomerOfferDraft, complete = false) {
  if (draft.contractDetails?.assignment) {
    const guard = await createSupabaseAdminClient().rpc('assert_contract_assignment', { p_body: draft, p_complete: complete })
    checked(guard.error)
  }
  if (draft.contractDetails?.property) {
    const guard = await createSupabaseAdminClient().rpc('assert_contract_property', { p_body: draft, p_complete: complete })
    checked(guard.error)
  }
  if (draft.items.some((i) => i.scopeConditions !== undefined)) {
    const guard = await createSupabaseAdminClient().rpc('assert_customer_offer_scope_conditions', { p_body: draft })
    checked(guard.error)
  }
  if (draft.items.some((i) => i.scopeExclusions !== undefined || i.scopeAdvice !== undefined)) {
    const guard = await createSupabaseAdminClient().rpc('assert_customer_offer_scope_notes', { p_body: draft, p_complete: complete })
    checked(guard.error)
  }
  if (draft.paymentPlan !== undefined) {
    const guard = await createSupabaseAdminClient().rpc('assert_customer_payment_plan', {
      p_body: draft, p_complete: complete
    })
    checked(guard.error)
  }
  if (draft.contractDetails) {
    const guard = await createSupabaseAdminClient().rpc('assert_customer_contract', {
      p_body: draft, p_complete: complete
    })
    checked(guard.error)
  }
  if (
    draft.pricingMode !== 'itemized' &&
    !draft.items.some((i) => i.optionGroup)
  ) return
  const result = await createSupabaseAdminClient().rpc('assert_customer_offer_pricing', {
    p_body: draft,
    p_selection: null,
    p_complete: complete
  })
  checked(result.error)
}
function mailConfig(origin?: string) {
  const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!from || !process.env.RESEND_API_KEY)
    throw new Error('CUSTOMER_OFFER_MAIL_CONFIG')
  try {
    const u = new URL(
      process.env.APP_BASE_URL?.trim() ||
        (process.env.NODE_ENV !== 'production' ? (origin ?? '') : '')
    )
    if (
      u.username ||
      u.password ||
      (u.protocol !== 'https:' &&
        !(
          u.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(u.hostname)
        ))
    )
      throw new Error()
    return { from, origin: u.origin }
  } catch {
    throw new Error('CUSTOMER_OFFER_MAIL_CONFIG')
  }
}
async function cleanup(paths: string[]) {
  if (!paths.length) return
  const { error } = await createSupabaseAdminClient()
    .storage.from(CUSTOMER_OFFER_BUCKET)
    .remove(paths)
  if (error) console.error('CUSTOMER_OFFER_COPY_CLEANUP_FAILED')
}
export async function publishCustomerOffer(
  ctx: Context,
  caseId: string,
  payload: Payload,
  requestOrigin: string
) {
  if (payload.confirmed !== true) throw new Error('CUSTOMER_OFFER_CONFIRM')
  if (!Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1)
    throw new Error('CUSTOMER_OFFER_INVALID')
  const db = createSupabaseAdminClient(),
    c = await requireCase(ctx, caseId)
  const existing = await db
    .from('action_case_customer_offers')
    .select('id')
    .eq('org_id', ctx.orgId)
    .eq('action_case_id', caseId)
    .eq('draft_revision', payload.revision)
    .maybeSingle()
  checked(existing.error)
  if (existing.data) {
    await sendCustomerOffer(ctx, caseId, existing.data.id)
    return
  }
  const workspace = await getCustomerOfferWorkspace(ctx, caseId)
  if (workspace.revision !== payload.revision || !workspace.revision)
    throw new Error('CUSTOMER_OFFER_STALE')
  const draft = workspace.draft
  if (draft.items.some((i) => i.kind === 'option'))
    throw new Error('CUSTOMER_OFFER_SEPARATE_CHOICES')
  if (offerPublishIssues(draft).length)
    throw new Error('CUSTOMER_OFFER_INCOMPLETE')
  await checkPricingSchema(draft, true)
  if (draft.contractForm === 'abs18') {
    if (draft.termsAttachmentId !== standardTermsFileId(ctx.orgId, caseId)) throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
    await verifyStandardTermsFile(ctx.orgId, caseId)
  }
  const recipient = await db
    .from('action_case_participants')
    .select('id,name,email')
    .eq('action_case_id', caseId)
    .eq('org_id', ctx.orgId)
    .eq('role', 'customer')
    .maybeSingle()
  const org = await db
    .from('organizations')
    .select('name')
    .eq('id', ctx.orgId)
    .single()
  const sender = await db
    .from('profiles')
    .select('email')
    .eq('id', ctx.userId)
    .single()
  checked(recipient.error)
  checked(org.error)
  checked(sender.error)
  const email = recipient.data?.email?.trim().toLowerCase()
  if (draft.contractParties && (draft.contractParties.email.trim().toLowerCase() !== email ||
    draft.contractParties.customers[0].name.trim() !== recipient.data?.name.trim())) throw new Error('CUSTOMER_OFFER_RECIPIENT')
  if (
    !recipient.data ||
    !email ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
    !sender.data?.email ||
    !org.data?.name
  )
    throw new Error('CUSTOMER_OFFER_RECIPIENT')
  const config = mailConfig(requestOrigin),
    id = randomUUID(),
    token = generateAssignmentToken()
  const snapshot = {
    ...draft,
    projectTitle: c.title,
    propertyAddress: c.property_address,
    customerName: recipient.data.name,
    customerEmail: email,
    issuerName: org.data.name,
    replyEmail: sender.data.email
  }
  const url = `${config.origin}/atgardsarende/${token}`
  const subject = `Avtal: ${draft.title}`
  const body = `${org.data.name} har skickat ett grundavtal för ${c.property_address}.\n\nGranska omfattning, pris och villkor under Avtal. Val och tillval hanteras separat och ingår inte i detta godkännande. Godkännande kräver en separat kod till denna e-postadress.\n\n${url}`
  const emailPayload: Email = {
    from: config.from,
    to: email,
    replyTo: sender.data.email,
    subject,
    text: body,
    html: quoteRequestHtml(subject, body),
    idempotencyKey: `customer-offer-${id}`
  }
  const paths: string[] = [],
    files: Payload[] = []
  let attempted = false
  try {
    if (draft.attachmentIds.length) {
      const sources = await db
        .from('action_case_attachments')
        .select(
          'id,file_name,content_type,file_size_bytes,storage_bucket,file_path'
        )
        .eq('org_id', ctx.orgId)
        .eq('action_case_id', caseId)
        .in('id', draft.attachmentIds)
      checked(sources.error)
      if (sources.data?.length !== draft.attachmentIds.length)
        throw new Error('CUSTOMER_OFFER_FILES')
      if (
        draft.termsAttachmentId &&
        !sources.data.some(
          (f) =>
            f.id === draft.termsAttachmentId &&
            f.content_type === 'application/pdf'
        )
      )
        throw new Error('CUSTOMER_OFFER_FILES')
      for (const f of sources.data) {
        if (
          f.storage_bucket !== 'action-case-files' ||
          !f.file_path.startsWith(`${ctx.orgId}/${caseId}/`) ||
          f.file_path.includes('..')
        )
          throw new Error('CUSTOMER_OFFER_FILES')
        const path = `${ctx.orgId}/${caseId}/${id}/${f.id}`
        paths.push(path)
        const copy = await db.storage
          .from(f.storage_bucket)
          .copy(f.file_path, path, { destinationBucket: CUSTOMER_OFFER_BUCKET })
        if (copy.error) throw new Error('CUSTOMER_OFFER_FILES')
        const info = await db.storage.from(CUSTOMER_OFFER_BUCKET).info(path)
        if (
          info.error ||
          Number(info.data?.size ?? info.data?.metadata?.size) !==
            Number(f.file_size_bytes)
        )
          throw new Error('CUSTOMER_OFFER_FILES')
        files.push({
          id: f.id,
          fileName: f.file_name,
          contentType: f.content_type,
          fileSizeBytes: Number(f.file_size_bytes),
          path,
          sourcePath: f.file_path
        })
      }
    }
    attempted = true
    const result = await write(ctx, caseId, 'publish', {
      id,
      revision: workspace.revision,
      participantId: recipient.data.id,
      email,
      issuerName: org.data.name,
      replyEmail: sender.data.email,
      snapshot,
      files,
      emailPayload,
      tokenHash: hashAssignmentToken(token),
      confirmed: true
    })
    await sendCustomerOffer(ctx, caseId, String(result.id))
  } finally {
    if (!attempted) await cleanup(paths).catch(() => undefined)
    else {
      // A timeout can hide a committed publication. Only remove proven orphans.
      try {
        const result = await db
          .from('action_case_customer_offers')
          .select('id')
          .eq('id', id)
          .eq('org_id', ctx.orgId)
          .maybeSingle()
        if (!result.error && !result.data) await cleanup(paths)
      } catch {
        /* Keep copies when the publication outcome is unknown. */
      }
    }
  }
}
export async function sendCustomerOffer(
  ctx: Context,
  caseId: string,
  id: string
) {
  const claim = await write(ctx, caseId, 'claim_send', { id: offerId(id) })
  if (claim.sent) return
  let result: Awaited<ReturnType<typeof sendAssignmentEmail>>
  try {
    result = await sendAssignmentEmail(claim.payload as Email)
  } catch {
    await write(ctx, caseId, 'finish_send', {
      id,
      leaseId: claim.leaseId,
      success: false
    }).catch(() => undefined)
    throw new Error('CUSTOMER_OFFER_SEND_FAILED')
  }
  await write(ctx, caseId, 'finish_send', {
    id,
    leaseId: claim.leaseId,
    success: true,
    providerMessageId: result.providerMessageId
  })
}
export async function withdrawCustomerOffer(
  ctx: Context,
  caseId: string,
  id: string
) {
  await write(ctx, caseId, 'withdraw', { id: offerId(id) })
}

export async function getSharedCustomerOffers(
  orgId: string,
  caseId: string,
  participantId: string
): Promise<{ enabled: boolean; offers: CustomerOffer[]; plannedItems?: CustomerPlannedItem[] }> {
  const db = createSupabaseAdminClient()
  const rows = await db
    .from('action_case_customer_offers')
    .select(CUSTOMER_OFFER_COLUMNS)
    .eq('org_id', orgId)
    .eq('action_case_id', caseId)
    .eq('participant_id', participantId)
    .order('version', { ascending: false })
  if (schemaMissing(rows.error?.code)) return { enabled: false, offers: [] }
  checked(rows.error)
  const planning = await db.from('action_case_customer_planning').select('shared_items')
    .eq('org_id', orgId).eq('action_case_id', caseId).eq('participant_id', participantId).maybeSingle()
  if (!schemaMissing(planning.error?.code)) checked(planning.error)
  const plannedItems = normalizePlannedItems(planning.data?.shared_items ?? [])
  return {
    enabled: Boolean(rows.data?.length || plannedItems.length),
    ...(plannedItems.length ? { plannedItems } : {}),
    offers: (rows.data ?? []).map(mapCustomerOffer)
  }
}
export async function getCustomerPlanning(ctx: Context, caseId: string): Promise<CustomerPlanning> {
  await requireCase(ctx, caseId)
  const db = createSupabaseAdminClient()
  const result = await db.from('action_case_customer_planning')
    .select('revision,items,shared_items,internal_costing').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  let saved = result.data, error = result.error
  let costingAvailable = true
  if (result.error && ['42703', 'PGRST204'].includes(result.error.code)) {
    costingAvailable = false
    const legacy = await db.from('action_case_customer_planning')
      .select('revision,items,shared_items').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
    saved = legacy.data ? { ...legacy.data, internal_costing: {} } : null
    error = legacy.error
  }
  if (schemaMissing(error?.code)) return { available: false, revision: 0, items: [], sharedItems: [] }
  checked(error)
  const items = normalizePlannedItems(saved?.items ?? [])
  return { available: true, revision: saved?.revision ?? 0, costingAvailable,
    costing: normalizeCustomerOfferCosting(saved?.internal_costing, items),
    items, sharedItems: normalizePlannedItems(saved?.shared_items ?? []) }
}
export async function writeCustomerPlanning(ctx: Context, caseId: string, payload: Payload) {
  await requireCase(ctx, caseId)
  if (!['save', 'share', 'unshare'].includes(String(payload.operation)) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0)
    throw new Error('CUSTOMER_OFFER_INVALID')
  if (payload.operation === 'share' && payload.confirmed !== true) throw new Error('CUSTOMER_OFFER_CONFIRM')
  const items = payload.operation === 'unshare' ? [] : normalizePlannedItems(payload.items, payload.operation === 'share')
  if (payload.operation === 'save' && payload.costing !== undefined) {
    const result = await createSupabaseAdminClient().rpc('save_customer_planning_costing', {
      p_org_id: ctx.orgId, p_case_id: offerId(caseId), p_user_id: ctx.userId,
      p_data: { revision: payload.revision, items, costing: normalizeCustomerOfferCosting(payload.costing, items) }
    })
    checked(result.error)
    return
  }
  const result = await createSupabaseAdminClient().rpc('write_customer_planning', {
    p_org_id: ctx.orgId, p_case_id: offerId(caseId), p_user_id: ctx.userId,
    p_operation: payload.operation,
    p_data: { revision: payload.revision, confirmed: payload.confirmed === true,
      items }
  })
  checked(result.error)
}
async function resolveOffer(token: string, id: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error('CUSTOMER_OFFER_CLOSED')
  const db = createSupabaseAdminClient()
  const access = await db
    .from('action_case_access_links')
    .select('id,org_id,action_case_id,participant_id,revoked_at,expires_at')
    .eq('token_hash', hashAssignmentToken(token))
    .maybeSingle()
  checked(access.error)
  const l = access.data
  if (!l || l.revoked_at || Date.parse(l.expires_at) <= Date.now())
    throw new Error('CUSTOMER_OFFER_CLOSED')
  const participant = await db
    .from('action_case_participants')
    .select('role,email')
    .eq('id', l.participant_id)
    .eq('org_id', l.org_id)
    .eq('action_case_id', l.action_case_id)
    .maybeSingle()
  checked(participant.error)
  if (participant.data?.role !== 'customer')
    throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  const row = await db
    .from('action_case_customer_offers')
    .select(`${CUSTOMER_OFFER_COLUMNS},org_id,action_case_id,participant_id`)
    .eq('id', offerId(id))
    .eq('org_id', l.org_id)
    .eq('action_case_id', l.action_case_id)
    .eq('participant_id', l.participant_id)
    .maybeSingle()
  checked(row.error)
  if (!row.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  return { row: row.data, participant: participant.data }
}
export async function respondCustomerOffer(
  token: string,
  id: string,
  payload: Payload,
  origin: string
) {
  const { row, participant } = await resolveOffer(token, id),
    offer = mapCustomerOffer(row)
  if (participant.email?.trim().toLowerCase() !== offer.snapshot.customerEmail)
    throw new Error('CUSTOMER_OFFER_RECIPIENT')
  const db = createSupabaseAdminClient()
  let data: Payload,
    operation: string,
    code = ''
  if (payload.operation === 'challenge') {
    if (
      payload.confirmed !== true ||
      typeof payload.signerName !== 'string' ||
      !Array.isArray(payload.selection) ||
      !payload.selection.every((v) => typeof v === 'string')
    )
      throw new Error('CUSTOMER_OFFER_INVALID')
    customerOfferTotal(offer.snapshot, payload.selection)
    mailConfig(origin)
    code = String(randomInt(100000, 1000000))
    const challengeId = randomUUID()
    data = {
      challengeId,
      codeHash: hashAssignmentToken(`${challengeId}:${code}`),
      selection: payload.selection,
      signerName: payload.signerName,
      confirmed: true
    }
    operation = 'challenge'
  } else if (payload.operation === 'accept') {
    const challengeId = offerId(payload.challengeId)
    if (typeof payload.code !== 'string' || !/^\d{6}$/.test(payload.code))
      throw new Error('CUSTOMER_OFFER_CODE_INVALID')
    data = {
      challengeId,
      codeHash: hashAssignmentToken(`${challengeId}:${payload.code}`)
    }
    operation = 'accept'
  } else throw new Error('CUSTOMER_OFFER_INVALID')
  const result = await db.rpc('respond_customer_offer', {
    p_token_hash: hashAssignmentToken(token),
    p_offer_id: id,
    p_operation: operation,
    p_data: data
  })
  checked(result.error)
  if (result.data?.error) throw new Error(result.data.error)
  if (operation === 'challenge') {
    const config = mailConfig(origin),
      subject = 'Din kod för att godkänna avtalet'
    const body = `Kod: ${code}\n\nAvtal: ${offer.snapshot.title}, version ${offer.version}.\nAnvänd koden bara om du själv vill godkänna detta avtal. Koden gäller i 10 minuter. Dela den inte med någon annan.`
    try {
      await sendAssignmentEmail({
        from: config.from,
        to: offer.snapshot.customerEmail,
        replyTo: offer.snapshot.replyEmail,
        subject,
        text: body,
        html: quoteRequestHtml(subject, body),
        idempotencyKey: `customer-offer-code-${data.challengeId}`
      })
    } catch {
      throw new Error('CUSTOMER_OFFER_CODE_SEND_FAILED')
    }
  }
  if (operation === 'accept') {
    const saved = await resolveOffer(token, id)
    return { ...result.data, offer: mapCustomerOffer(saved.row) }
  }
  return result.data
}
export async function customerOfferFileUrl(input: {
  token?: string
  ctx?: Context
  caseId?: string
  offerId: string
  fileId: string
}) {
  let row: Record<string, unknown>
  if (input.token) row = (await resolveOffer(input.token, input.offerId)).row
  else {
    if (!input.ctx || !input.caseId) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
    const result = await createSupabaseAdminClient()
      .from('action_case_customer_offers')
      .select('id,org_id,action_case_id,files')
      .eq('id', offerId(input.offerId))
      .eq('org_id', input.ctx.orgId)
      .eq('action_case_id', offerId(input.caseId))
      .maybeSingle()
    checked(result.error)
    if (!result.data) throw new Error('CUSTOMER_OFFER_NOT_FOUND')
    row = result.data
  }
  const file = (row.files as Array<Record<string, unknown>>).find(
    (f) => f.id === offerId(input.fileId)
  )
  if (
    !file ||
    file.path !== `${row.org_id}/${row.action_case_id}/${row.id}/${file.id}`
  )
    throw new Error('CUSTOMER_OFFER_NOT_FOUND')
  const result = await createSupabaseAdminClient()
    .storage.from(CUSTOMER_OFFER_BUCKET)
    .createSignedUrl(
      String(file.path),
      60,
      String(file.contentType).startsWith('image/') ||
        file.contentType === 'application/pdf'
        ? undefined
        : { download: String(file.fileName) }
    )
  checked(result.error)
  if (!result.data) throw new Error('CUSTOMER_OFFER_FAILED')
  return result.data.signedUrl
}
