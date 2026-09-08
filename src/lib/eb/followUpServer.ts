import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getEbInspectionReportFromSnapshot } from '@/lib/eb/reportSnapshot'
import {
  EB_FOLLOW_UP_NET_PRICE_ORE, EB_FOLLOW_UP_PRICE_ORE, EB_FOLLOW_UP_SERVICE_DESCRIPTION,
  EB_FOLLOW_UP_TERMS_VERSION, EB_FOLLOW_UP_VAT_ORE, EB_FOLLOW_UP_VAT_RATE, EB_FOLLOW_UP_ADMIN_EMAIL,
  normalizeEbFollowUpEmail, validateEbFollowUpBuyer,
  type EbFollowUpBuyer, type EbFollowUpOffer, type EbFollowUpSeller,
} from '@/lib/eb/followUp'
import {
  decryptEbFollowUpPayload, encryptEbFollowUpPayload, escapeEbFollowUpHtml,
  type EbFollowUpEmail,
} from '@/lib/eb/followUpDelivery'
import { resolveEbFollowUpCustomer } from '@/lib/eb/followUpCustomer'
import { getEbFollowUpPlatformSeller } from '@/lib/eb/followUpSeller'
import { readEbCustomerSession, setEbCustomerSession, type EbCustomerSession } from '@/lib/eb/customerSession'

const ORIGINALS_BUCKET = 'eb-follow-up-originals'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GENERIC_CODE_MESSAGE = 'Om adressen tillhör beställaren skickas en engångskod. Kontrollera även skräpposten. Koden gäller i 15 minuter.'
type OrderRow = {
  id: string; org_id: string; eb_project_id: string; inspection_id: string; report_link_id: string;
  buyer_snapshot: EbFollowUpBuyer; seller_snapshot: EbFollowUpSeller; withdrawal_requested_at: string | null;
}

export function ebFollowUpBaseUrl(requestOrigin?: string): string {
  const raw = process.env.APP_BASE_URL?.trim() || requestOrigin
  if (!raw) throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  const url = new URL(raw)
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) {
    throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  }
  return url.origin
}

async function loadContext(token: string) {
  if (token.length < 20 || token.length > 200) throw new Error('EB_FOLLOW_UP_REPORT_UNAVAILABLE')
  return loadContextForLink({ tokenHash: hashAssignmentToken(token) })
}

type InspectionOfferScope = { orgId: string; inspectionId: string; reportLinkId: string }

function createFollowUpAdminClient() {
  try {
    return createSupabaseAdminClient()
  } catch {
    // Client construction fails on absent/invalid server configuration, not a
    // network request. Do not turn an unconfigured service into a retry prompt.
    throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  }
}

function throwOfferReadError(error: { code?: string }) {
  const configurationCodes = ['42P01', '42703', '42883', '42501', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', 'PGRST301', 'PGRST302', 'PGRST303']
  throw new Error(configurationCodes.includes(error.code ?? '') ? 'EB_FOLLOW_UP_CONFIGURATION' : 'EB_FOLLOW_UP_UNAVAILABLE')
}

async function loadContextForLink(selector: { tokenHash: string } | InspectionOfferScope) {
  const admin = createFollowUpAdminClient()
  let query = admin.from('inspection_report_links')
    .select('id,org_id,inspection_id,created_at,revoked_at,snapshot_payload')
    .is('revoked_at', null)
  if ('tokenHash' in selector) {
    query = query.eq('token_hash', selector.tokenHash)
  } else {
    if (!selector.orgId || !selector.inspectionId || !selector.reportLinkId) throw new Error('EB_FOLLOW_UP_REPORT_UNAVAILABLE')
    query = query.eq('id', selector.reportLinkId).eq('org_id', selector.orgId).eq('inspection_id', selector.inspectionId)
  }
  const { data: link, error } = await query.maybeSingle()
  if (error) throwOfferReadError(error)
  if (!link) throw new Error('EB_FOLLOW_UP_REPORT_UNAVAILABLE')
  const report = getEbInspectionReportFromSnapshot(link.snapshot_payload)
  if (!report || report.inspection.inspectionId !== link.inspection_id) {
    throw new Error('EB_FOLLOW_UP_REPORT_UNAVAILABLE')
  }
  const [projectResult, detailResult, latestResult, orderResult] = await Promise.all([
    admin.from('eb_projects').select('id,org_id,client_email').eq('id', report.project.id).eq('org_id', link.org_id).maybeSingle(),
    admin.from('eb_inspection_details').select('eb_project_id,report_locked_at').eq('inspection_id', link.inspection_id).eq('org_id', link.org_id).maybeSingle(),
    admin.from('inspection_report_links').select('id').eq('inspection_id', link.inspection_id).eq('org_id', link.org_id)
      .is('revoked_at', null).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
    admin.from('eb_follow_up_orders').select('id,org_id,eb_project_id,inspection_id,report_link_id,buyer_snapshot,seller_snapshot,withdrawal_requested_at')
      .eq('inspection_id', link.inspection_id).eq('org_id', link.org_id).maybeSingle(),
  ])
  for (const result of [orderResult, projectResult, detailResult, latestResult]) {
    if (result.error) throwOfferReadError(result.error)
  }
  if (!projectResult.data || detailResult.data?.eb_project_id !== report.project.id) {
    throw new Error('EB_FOLLOW_UP_REPORT_UNAVAILABLE')
  }
  if (!orderResult.data && !Number.isFinite(Date.parse(report.inspection.reportLockedAt ?? ''))) {
    // Older deliveries saved the snapshot immediately BEFORE locking the
    // inspection. Verify that same lock cycle without rewriting the report.
    // A resend's link.created_at is not evidence: it can refer to an older copy.
    const snapshotCreatedAt = link.snapshot_payload?.createdAt
    const snapshotTime = typeof snapshotCreatedAt === 'string' ? Date.parse(snapshotCreatedAt) : NaN
    const lockedAt = detailResult.data?.report_locked_at
    const lockTime = typeof lockedAt === 'string' ? Date.parse(lockedAt) : NaN
    if (!Number.isFinite(snapshotTime) || !Number.isFinite(lockTime) || snapshotTime > lockTime) {
      throw new Error('EB_FOLLOW_UP_REPORT_NOT_FINALIZED')
    }
    const { data: unlock, error: unlockError } = await admin.from('inspection_lock_events')
      .select('id').eq('org_id', link.org_id).eq('inspection_id', link.inspection_id)
      .eq('action', 'unlock').gte('performed_at', snapshotCreatedAt).limit(1).maybeSingle()
    if (unlockError) throwOfferReadError(unlockError)
    if (unlock) throw new Error('EB_FOLLOW_UP_REPORT_NOT_FINALIZED')
  }
  return { admin, link, report, project: projectResult.data, latest: latestResult.data?.id === link.id,
    order: orderResult.data as OrderRow | null }
}

export async function getEbFollowUpOffer(token: string): Promise<EbFollowUpOffer> {
  return evaluateOffer(() => loadContext(token))
}

/** Server-only preview: the caller must authenticate and validate organisation/inspection access first. */
export async function getEbFollowUpOfferForInspection(scope: InspectionOfferScope): Promise<EbFollowUpOffer> {
  return evaluateOffer(() => loadContextForLink(scope))
}

async function evaluateOffer(load: () => ReturnType<typeof loadContext>): Promise<EbFollowUpOffer> {
  const base: EbFollowUpOffer = {
    available: false, retryable: false, reason: null, priceOre: EB_FOLLOW_UP_PRICE_ORE, netPriceOre: EB_FOLLOW_UP_NET_PRICE_ORE,
    vatOre: EB_FOLLOW_UP_VAT_ORE, vatRate: EB_FOLLOW_UP_VAT_RATE, termsVersion: EB_FOLLOW_UP_TERMS_VERSION,
    serviceDescription: EB_FOLLOW_UP_SERVICE_DESCRIPTION, alreadyActive: false, seller: null,
  }
  try {
    const context = await load()
    base.alreadyActive = Boolean(context.order)
    if (context.order) return { ...base, available: true, seller: context.order.seller_snapshot }
    if (process.env.EB_FOLLOW_UP_ENABLED !== 'true') return { ...base, reason: 'Tjänsten är inte aktiverad för nya beställningar.' }
    if (!context.latest) return { ...base, reason: 'Öppna den senast publicerade versionen av utlåtandet för att beställa.' }
    if (!followUpNotes(context).length) return { ...base, reason: 'Utlåtandet innehåller inga noteringar att följa upp.' }
    base.seller = getEbFollowUpPlatformSeller()
    if (!base.seller) return { ...base, reason: 'Säljaruppgifterna behöver kompletteras innan tjänsten kan beställas.' }
    if (!process.env.ASSIGNMENTS_MAIL_FROM?.trim() || !process.env.RESEND_API_KEY?.trim()) {
      return { ...base, reason: 'E-postutskicken för tjänsten är inte konfigurerade.' }
    }
    if (!(await eligibleCustomerEmails(context)).size) {
      return { ...base, reason: 'Beställarens e-postadress registreras när utlåtandet levereras.' }
    }
    return { ...base, available: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'EB_FOLLOW_UP_REPORT_NOT_FINALIZED') {
      return { ...base, reason: 'Den här rapportversionens fastställande kunde inte bekräftas. Kontakta besiktningsmannen för att få den senast fastställda versionen.' }
    }
    if (error instanceof Error && error.message === 'EB_FOLLOW_UP_CONFIGURATION') {
      return { ...base, reason: 'Tjänstens databas- eller serverkonfiguration behöver kompletteras.' }
    }
    if (error instanceof Error && error.message === 'EB_FOLLOW_UP_REPORT_UNAVAILABLE') {
      return { ...base, reason: 'Åtgärdsuppföljning är inte tillgänglig för detta utlåtande.' }
    }
    return { ...base, retryable: true, reason: 'Tillgängligheten kunde inte kontrolleras just nu. Försök igen om en stund.' }
  }
}

async function eligibleCustomerEmails(context: Awaited<ReturnType<typeof loadContext>>): Promise<Set<string>> {
  // An existing purchase belongs to its verified buyer, not to a later replacement project contact.
  if (context.order) return new Set([context.order.buyer_snapshot.email.toLowerCase()])
  const customer = await resolveEbFollowUpCustomer({ admin: context.admin, orgId: context.link.org_id,
    inspectionId: context.link.inspection_id, projectId: context.project.id })
  return new Set(customer.email ? [customer.email] : [])
}

async function customerSessionFor(context: Awaited<ReturnType<typeof loadContext>>): Promise<EbCustomerSession | null> {
  const session = await readEbCustomerSession(context.link.inspection_id)
  if (!session || session.orgId !== context.link.org_id || session.inspectionId !== context.link.inspection_id
    || (session.kind === 'report' && session.reportLinkId !== context.link.id)
    || (session.kind === 'owner' && (!context.order || !session.portalPath))
    || !(await eligibleCustomerEmails(context)).has(session.email)) return null
  return session
}

/** Public recipients see only a neutral entry. Price, purchase state and seller details require verified identity. */
export async function getEbFollowUpCustomerState(token: string) {
  let context: Awaited<ReturnType<typeof loadContext>>
  try { context = await loadContext(token) }
  catch {
    const unavailable = await getEbFollowUpOffer(token)
    return { verified: false, offer: null, accessAvailable: false, retryable: unavailable.retryable === true }
  }
  const offer = await evaluateOffer(async () => context)
  let session: EbCustomerSession | null
  try { session = await customerSessionFor(context) }
  catch { return { verified: false, offer: null, accessAvailable: false, retryable: true } }
  if (session) return { verified: true, offer: { ...offer, reason: offer.available ? null : 'Tjänsten kan inte beställas just nu. Försök igen senare.' } }
  return { verified: false, offer: null, accessAvailable: offer.available || offer.alreadyActive, retryable: offer.retryable === true }
}

export async function verifyEbFollowUpCustomerCode(input: { token: string; challengeId: unknown; code: unknown }) {
  const challengeId = typeof input.challengeId === 'string' ? input.challengeId : ''
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!UUID.test(challengeId) || !/^\d{6}$/.test(code)) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  const context = await loadContext(input.token)
  const { data: challenge, error } = await context.admin.from('eb_follow_up_challenges')
    .select('expires_at').eq('id', challengeId).eq('org_id', context.link.org_id)
    .eq('inspection_id', context.link.inspection_id).eq('report_link_id', context.link.id)
    .eq('purpose', 'report').maybeSingle()
  if (error || !challenge) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  const { data, error: verifyError } = await context.admin.rpc('eb_verify_follow_up_challenge', {
    p_id: challengeId, p_report_link_id: context.link.id, p_code_hash: challengeHash(challengeId, code),
  })
  const email = normalizeEbFollowUpEmail(data?.email)
  if (verifyError || !data?.verified || !email || !(await eligibleCustomerEmails(context)).has(email)) {
    throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  }
  const expiresAt = Math.min(Date.parse(challenge.expires_at), Date.now() + 15 * 60_000)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  await setEbCustomerSession({ kind: 'report', orgId: context.link.org_id, inspectionId: context.link.inspection_id,
    email, reportLinkId: context.link.id, challengeId, code, expiresAt })
  return { verified: true, offer: await evaluateOffer(async () => context) }
}

function challengeHash(challengeId: string, code: string): string {
  const pepper = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!pepper) throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  // A server-side pepper also prevents offline guessing of a six-digit code
  // from a leaked read-only database snapshot.
  return createHmac('sha256', pepper).update(`eb-follow-up-code-v1:${challengeId}:${code}`).digest('hex')
}

export async function requestEbFollowUpCode(input: { token: string; email: unknown; baseUrl?: string }) {
  const email = normalizeEbFollowUpEmail(input.email)
  if (!email) throw new Error('EB_FOLLOW_UP_EMAIL_INVALID')
  const context = await loadContext(input.token)
  const offer = await getEbFollowUpOffer(input.token)
  if (!offer.available) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  const eligible = (await eligibleCustomerEmails(context)).has(email)
  const id = randomUUID()
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const emailText = `Din engångskod är ${code}. Koden gäller i 15 minuter och används för att verifiera beställaren av digital åtgärdsuppföljning. Ingen beställning görs när du begär en kod. Om du inte begärt koden kan du bortse från detta mejl.`
  const mail: EbFollowUpEmail = {
    to: email, replyTo: offer.seller?.email, subject: 'Verifiera din e-post för åtgärdsuppföljning',
    text: emailText, html: `<p>${escapeEbFollowUpHtml(emailText)}</p>`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  }
  const { data, error } = await context.admin.rpc('eb_request_follow_up_challenge', {
    p_id: id, p_org_id: context.link.org_id, p_inspection_id: context.link.inspection_id,
    p_report_link_id: context.link.id, p_email: email, p_code_hash: challengeHash(id, code),
    p_eligible: eligible, p_mail_ciphertext: eligible ? encryptEbFollowUpPayload(mail) : null,
  })
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (data?.limited) throw new Error('EB_FOLLOW_UP_RATE_LIMITED')
  // Same shape and wording for a wrong address; never disclose the stored customer address.
  return { challengeId: id, message: GENERIC_CODE_MESSAGE }
}

function followUpNotes(context: Awaited<ReturnType<typeof loadContext>>) {
  return context.report.notes.filter(item => (!item.inspectionId || item.inspectionId === context.link.inspection_id)
    && UUID.test(item.id) && Boolean(item.noteText?.trim()))
}

async function createFrozenTasks(context: Awaited<ReturnType<typeof loadContext>>, candidateId: string) {
  const tasks: Array<{ noteId: string; snapshot: Record<string, unknown>; images: Array<Record<string, unknown>> }> = []
  const copies: Array<() => Promise<void>> = []
  for (const note of followUpNotes(context)) {
    const images: Array<Record<string, unknown>> = []
    for (const image of context.report.images.filter(item => item.noteId === note.id)) {
      const originalPath = image.filePath
      if (!originalPath || originalPath.includes('..')) throw new Error('EB_FOLLOW_UP_ORIGINAL_IMAGE_FAILED')
      const extension = originalPath.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'jpg'
      const destination = `${context.link.org_id}/${candidateId}/${image.id}.${extension}`
      copies.push(async () => {
        const { error } = await context.admin.storage.from('inspection-images').copy(originalPath, destination, { destinationBucket: ORIGINALS_BUCKET })
        const statusCode = error && 'statusCode' in error ? String(error.statusCode) : null
        if (error && statusCode !== '409' && statusCode !== '400') throw new Error('EB_FOLLOW_UP_ORIGINAL_IMAGE_FAILED')
        if (error) {
          // A retry may have copied this exact immutable object before the order transaction committed.
          const { data: found, error: lookupError } = await context.admin.storage.from(ORIGINALS_BUCKET)
            .list(`${context.link.org_id}/${candidateId}`, { search: `${image.id}.${extension}`, limit: 1 })
          if (lookupError || !found?.some(item => item.name === `${image.id}.${extension}`)) throw new Error('EB_FOLLOW_UP_ORIGINAL_IMAGE_FAILED')
        }
      })
      images.push({ id: image.id, storageBucket: ORIGINALS_BUCKET, filePath: destination,
        thumbnailFilePath: null, fileName: null, label: image.label })
    }
    tasks.push({ noteId: note.id, images, snapshot: {
      originalNoteId: note.id, noteNumber: note.noteNumber, noteText: note.noteText, location: note.location,
      room: note.room, placeDetail: note.placeDetail, markerKey: note.markerKey, statusKey: note.statusKey,
      disciplineLabel: note.disciplineLabel, disciplineLittera: note.disciplineLittera,
      inspectionVariant: context.report.inspection.variant, inspectionVariantLabel: context.report.inspection.variantLabel,
      inspectionSequenceNo: context.report.inspection.sequenceNo, inspectionDate: context.report.inspection.date,
    } })
  }
  for (let offset = 0; offset < copies.length; offset += 4) await Promise.all(copies.slice(offset, offset + 4).map(copy => copy()))
  return tasks
}

function orderEmails(orderId: string, challengeId: string, buyer: EbFollowUpBuyer, seller: EbFollowUpSeller, portalUrl: string, inspectionSummary = '') {
  const terms = `${EB_FOLLOW_UP_SERVICE_DESCRIPTION}\nPris 599 kr inklusive 25 % moms (479,20 kr exklusive moms och 119,80 kr moms). Fakturering sker manuellt; detta är inte en faktura. Du har uttryckligen godkänt villkoren version ${EB_FOLLOW_UP_TERMS_VERSION}, begärt omedelbar start och accepterat betalning via faktura. Du har som konsument normalt 14 dagars ångerrätt. Omedelbar start innebär inte att all ångerrätt försvinner. Du kan meddela att du vill frånträda beställningen med knappen i din personliga portal eller via ${seller.email}. Ingen efterbesiktning ingår.`
  const sellerText = `${seller.name}, org.nr ${seller.orgNumber}, ${seller.address}, ${seller.email}${seller.phone ? `, ${seller.phone}` : ''}`
  const receipt = `Beställning ${orderId} är mottagen och din digitala åtgärdsuppföljning är aktiverad.\n\n${terms}\n\nSäljare: ${sellerText}\n\nFakturamottagare: ${buyer.invoiceName}\n${buyer.invoiceAddress}\n${buyer.invoicePostalCode} ${buyer.invoiceCity}${buyer.invoiceOrgNo ? `\nOrg.nr: ${buyer.invoiceOrgNo}` : ''}\n\nDin personliga portal: ${portalUrl}\nDela inte denna länk. Entreprenörer bjuds in med egna begränsade länkar från portalen.`
  const invoice = `Ett köp av digital åtgärdsuppföljning har skett.\nManuellt fakturaunderlag för beställning ${orderId}.\nBeställt: ${new Date().toISOString()}\n${inspectionSummary}\n599,00 SEK inklusive moms; netto 479,20 SEK; moms 25 % 119,80 SEK.\nSäljare: ${sellerText}\nBeställare: ${buyer.name}, ${buyer.email}.\nFakturamottagare: ${buyer.invoiceName}, ${buyer.invoiceAddress}, ${buyer.invoicePostalCode} ${buyer.invoiceCity}${buyer.invoiceOrgNo ? `, org.nr ${buyer.invoiceOrgNo}` : ''}.\nE-post för fakturakontakt: ${buyer.email}.\nTjänsten har aktiverats automatiskt. Ingen faktura har skapats eller skickats av systemet. Fakturering hanteras manuellt av Admin. Kontrollera orderns billing_status och eventuell begäran att frånträda beställningen innan fakturering.\nVillkor ${EB_FOLLOW_UP_TERMS_VERSION}; beställaren har accepterat villkor, omedelbar start och betalning via faktura.`
  const access = `Här är din personliga länk till din redan beställda åtgärdsuppföljning:\n${portalUrl}\nIngen ny beställning eller avgift har skapats. Dela inte denna länk. Entreprenörer bjuds in separat från portalen.`
  return [
    { kind: 'receipt', dedupeKey: `receipt:${orderId}`, to: buyer.email, subject: 'Beställningsbekräftelse – digital åtgärdsuppföljning', text: receipt },
    { kind: 'invoice', dedupeKey: `invoice:${orderId}`, to: EB_FOLLOW_UP_ADMIN_EMAIL, subject: 'Nytt köp – fakturaunderlag för EB åtgärdsuppföljning', text: invoice },
    { kind: 'access', dedupeKey: `access:${challengeId}`, to: buyer.email, subject: 'Din personliga åtgärdsportal', text: access },
  ].map(mail => ({ kind: mail.kind, dedupeKey: mail.dedupeKey, ciphertext: encryptEbFollowUpPayload({
    to: mail.to, replyTo: seller.email, subject: mail.subject, text: mail.text,
    html: `<div style="white-space:pre-line">${escapeEbFollowUpHtml(mail.text)}</div>`,
  } satisfies EbFollowUpEmail) }))
}

export async function completeEbFollowUpOrder(input: { token: string; input: Record<string, unknown>; baseUrl?: string }) {
  const payload = input.input
  const context = await loadContext(input.token)
  const session = await customerSessionFor(context)
  if (!session) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  // Return verified existing access without creating an order, a new invoice or another access email.
  if (session.kind === 'owner' && context.order && session.portalPath && ['access', 'order'].includes(String(payload.action))) {
    const accessToken = session.portalPath.split('/').pop() ?? ''
    const { data: access, error: accessError } = await context.admin.from('eb_remediation_access_links')
      .select('id,expires_at').eq('token_hash', hashAssignmentToken(accessToken)).eq('role', 'customer_owner')
      .eq('org_id', context.link.org_id).eq('inspection_id', context.link.inspection_id)
      .eq('follow_up_order_id', context.order.id).eq('email', session.email).is('revoked_at', null).maybeSingle()
    if (accessError || !access || !(Date.parse(access.expires_at) > Date.now())) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
    return { orderId: context.order.id, portalUrl: session.portalPath, message: 'Din åtgärdsportal är klar. Ingen ny beställning eller avgift har skapats.' }
  }
  const challengeId = session.challengeId ?? ''
  const code = session.code ?? ''
  if (!UUID.test(challengeId) || !/^\d{6}$/.test(code) || !['order', 'access'].includes(String(payload.action))) {
    throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  }
  const { data: verification, error: verificationError } = await context.admin.rpc('eb_verify_follow_up_challenge', {
    p_id: challengeId, p_report_link_id: context.link.id, p_code_hash: challengeHash(challengeId, code),
  })
  if (verificationError || verification?.verified !== true) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  const email = normalizeEbFollowUpEmail(verification.email)
  if (!email || !(await eligibleCustomerEmails(context)).has(email)) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  let buyer = context.order?.buyer_snapshot
  let seller = context.order?.seller_snapshot
  if (!context.order) {
    if (payload.action !== 'order') throw new Error('EB_FOLLOW_UP_ORDER_REQUIRED')
    if (process.env.EB_FOLLOW_UP_ENABLED !== 'true' || !context.latest) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
    if (!followUpNotes(context).length) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
    buyer = validateEbFollowUpBuyer(payload, email)
    seller = getEbFollowUpPlatformSeller() ?? undefined
    if (!seller || !process.env.ASSIGNMENTS_MAIL_FROM?.trim() || !process.env.RESEND_API_KEY?.trim()) throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  }
  if (!buyer || !seller || buyer.email.toLowerCase() !== email) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  const candidateId = challengeId
  const accessToken = generateAssignmentToken()
  const portalUrl = `${ebFollowUpBaseUrl(input.baseUrl)}/atgarder/${accessToken}`
  const tasks = context.order ? [] : await createFrozenTasks(context, candidateId)
  const { data, error } = await context.admin.rpc('eb_complete_follow_up_order', {
    p_challenge_id: challengeId, p_report_link_id: context.link.id, p_candidate_order_id: candidateId,
    p_project_id: context.project.id, p_buyer: buyer, p_seller: seller, p_tasks: tasks,
    p_access: { id: randomUUID(), tokenHash: hashAssignmentToken(accessToken),
      expiresAt: new Date(Date.now() + 180 * 86400_000).toISOString(), encryptedResult: encryptEbFollowUpPayload({ portalUrl }) },
    p_emails: orderEmails(context.order?.id ?? candidateId, challengeId, buyer, seller, portalUrl,
      `Entreprenad: ${context.report.project.title || context.project.id}\nObjekt: ${context.report.project.propertyDesignation || '-'}\nAdress: ${[context.report.project.address, context.report.project.postalCode, context.report.project.city].filter(Boolean).join(', ')}\nBesiktning: ${context.report.inspection.variantLabel || ''} ${context.report.inspection.sequenceNo || ''}, ${context.report.inspection.date || '-'}\nBesiktnings-ID: ${context.link.inspection_id}\nIntern besiktningsvy: ${ebFollowUpBaseUrl(input.baseUrl)}/eb/projects/${context.project.id}`),
    p_create: !context.order && payload.action === 'order', p_terms_version: EB_FOLLOW_UP_TERMS_VERSION,
  })
  if (error || !data?.orderId || !data?.encryptedResult) throw new Error('EB_FOLLOW_UP_ORDER_FAILED')
  const result = decryptEbFollowUpPayload<{ portalUrl: string }>(data.encryptedResult)
  const portalPath = new URL(result.portalUrl).pathname
  if (!/^\/atgarder\/[A-Za-z0-9_-]{20,200}$/.test(portalPath)) throw new Error('EB_FOLLOW_UP_ORDER_FAILED')
  await setEbCustomerSession({ kind: 'owner', orgId: context.link.org_id, inspectionId: context.link.inspection_id,
    email, portalPath, expiresAt: Date.now() + 8 * 60 * 60_000 })
  return { orderId: String(data.orderId), portalUrl: portalPath,
    message: data.created ? 'Beställningen är mottagen och åtgärdsuppföljningen är aktiverad. Bekräftelse och fakturaunderlag ligger i e-postkön.' : 'Din åtgärdsportal är klar. Ingen ny beställning eller avgift har skapats.' }
}

export async function withdrawEbFollowUpOrder(input: { orderId: string; actorEmail: string; baseUrl?: string }) {
  const { data, error } = await createSupabaseAdminClient().rpc('eb_withdraw_follow_up_order', {
    p_order_id: input.orderId, p_actor_email: input.actorEmail,
  })
  if (error) throw new Error('EB_FOLLOW_UP_WITHDRAWAL_FAILED')
  return data as { id: string; withdrawalRequestedAt: string; billingStatus: string }
}

/** Expired bearer possession can only request mail to the already verified buyer, never return a new bearer. */
export async function requestEbFollowUpOwnerRenewal(input: { accessToken: string; baseUrl?: string }) {
  const message = 'Om länken hör till en beställarportal skickas en ny personlig länk till beställarens verifierade e-postadress.'
  if (input.accessToken.length < 20 || input.accessToken.length > 200) return { message }
  const admin = createSupabaseAdminClient()
  const { data: access, error } = await admin.from('eb_remediation_access_links')
    .select('id,follow_up_order_id,email').eq('token_hash', hashAssignmentToken(input.accessToken))
    .eq('role', 'customer_owner').is('revoked_at', null).maybeSingle()
  if (error || !access?.follow_up_order_id) return { message }
  const { data: order } = await admin.from('eb_follow_up_orders').select('buyer_snapshot,seller_snapshot')
    .eq('id', access.follow_up_order_id).maybeSingle()
  const buyer = order?.buyer_snapshot as EbFollowUpBuyer | undefined
  const seller = order?.seller_snapshot as EbFollowUpSeller | undefined
  if (!buyer || !seller || buyer.email.toLowerCase() !== access.email.toLowerCase()) return { message }
  const token = generateAssignmentToken()
  const url = `${ebFollowUpBaseUrl(input.baseUrl)}/atgarder/${token}`
  const content = `Här är en ny personlig länk till din redan beställda åtgärdsuppföljning: ${url}\nIngen ny avgift har tillkommit. Dela inte länken. Om du inte begärt en ny länk kan du bortse från detta mejl.`
  const { error: renewError } = await admin.rpc('eb_renew_follow_up_owner_access', {
    p_previous_id: access.id, p_new_id: randomUUID(), p_token_hash: hashAssignmentToken(token),
    p_expires_at: new Date(Date.now() + 180 * 86400_000).toISOString(),
    p_mail_ciphertext: encryptEbFollowUpPayload({ to: buyer.email, replyTo: seller.email,
      subject: 'Ny personlig länk till din åtgärdsportal', text: content, html: `<p>${escapeEbFollowUpHtml(content)}</p>` } satisfies EbFollowUpEmail),
  })
  if (renewError) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  return { message }
}
