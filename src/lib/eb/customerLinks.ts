import 'server-only'

import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { decryptEbFollowUpPayload, encryptEbFollowUpPayload, escapeEbFollowUpHtml } from '@/lib/eb/followUpDelivery'
import { normalizeEbFollowUpEmail } from '@/lib/eb/followUp'
import { readEbCustomerSession, setEbCustomerSession, type EbCustomerSession } from '@/lib/eb/customerSession'

const TOKEN = /^[A-Za-z0-9_-]{32,200}$/
export const EB_CUSTOMER_LINK_MESSAGE = 'Om adressen tillhör beställaren skickas en personlig beställarlänk. Kontrollera även skräpposten. Ingen beställning görs när du begär länken.'

export type EbCustomerReportLink = {
  publicToken: string
  personalLinkId: string
  orgId: string
  inspectionId: string
  reportLinkId: string
  email: string
  expired: boolean
}

/** Reads only. Even an expired customer credential can retain the active public
 * report, but a revoked credential/report or mismatched scope never does. */
export async function resolveEbCustomerReportLink(token: string): Promise<EbCustomerReportLink | null> {
  if (!TOKEN.test(token)) return null
  const admin = createSupabaseAdminClient()
  const { data: link, error } = await admin.from('eb_follow_up_customer_links')
    .select('id,org_id,inspection_id,report_link_id,email,report_token_ciphertext,expires_at,revoked_at')
    .eq('token_hash', hashAssignmentToken(token)).maybeSingle()
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (!link || link.revoked_at || !Number.isFinite(Date.parse(link.expires_at))) return null
  const payload = decryptEbFollowUpPayload<{ publicToken: string }>(link.report_token_ciphertext)
  if (!TOKEN.test(payload.publicToken)) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  const { data: report, error: reportError } = await admin.from('inspection_report_links')
    .select('id').eq('id', link.report_link_id).eq('org_id', link.org_id)
    .eq('inspection_id', link.inspection_id).eq('token_hash', hashAssignmentToken(payload.publicToken))
    .is('revoked_at', null).maybeSingle()
  if (reportError) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (!report) return null
  const context = { publicToken: payload.publicToken, personalLinkId: link.id, orgId: link.org_id,
    inspectionId: link.inspection_id, reportLinkId: link.report_link_id, email: link.email,
    expired: Date.parse(link.expires_at) <= Date.now() }
  if (!context.expired) {
    const { data: valid, error: validationError } = await admin.rpc('eb_validate_follow_up_customer_link', {
      p_id: context.personalLinkId, p_org_id: context.orgId, p_inspection_id: context.inspectionId,
      p_report_link_id: context.reportLinkId, p_email: context.email,
    })
    if (validationError) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
    if (valid !== true) return null
  }
  return context
}

/** Only the registered/frozen buyer receives this separate secret, never another report recipient. */
export async function issueEbCustomerLink(input: {
  publicToken: string; email: string; baseUrl: string; sendEmail?: boolean
}): Promise<string | null> {
  const email = normalizeEbFollowUpEmail(input.email)
  if (!email || !TOKEN.test(input.publicToken)) throw new Error('EB_FOLLOW_UP_EMAIL_INVALID')
  const token = generateAssignmentToken()
  const url = `${new URL(input.baseUrl).origin}/rapport/bestallare/${token}`
  const text = `Här är din personliga beställarlänk till digital åtgärdsuppföljning:\n${url}\n\nDu kan läsa villkoren och beställa tjänsten från länken. Att öppna länken skapar ingen beställning. Dela inte denna länk. Använd Dela utlåtande när du vill dela själva rapporten.`
  const { data, error } = await createSupabaseAdminClient().rpc('eb_issue_follow_up_customer_link', {
    p_id: randomUUID(), p_public_token_hash: hashAssignmentToken(input.publicToken), p_email: email,
    p_token_hash: hashAssignmentToken(token), p_report_token_ciphertext: encryptEbFollowUpPayload({ publicToken: input.publicToken }),
    p_mail_ciphertext: input.sendEmail ? encryptEbFollowUpPayload({ to: email,
      subject: 'Din personliga beställarlänk – digital åtgärdsuppföljning', text,
      html: `<p>Här är din personliga beställarlänk till digital åtgärdsuppföljning:</p><p><a href="${escapeEbFollowUpHtml(url)}">Öppna min beställarlänk</a></p><p>Du kan läsa villkoren och beställa tjänsten från länken. Att öppna länken skapar ingen beställning.</p><p>Dela inte denna länk. Använd Dela utlåtande när du vill dela själva rapporten.</p>`,
    }) : null,
  })
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (data?.limited) throw new Error('EB_FOLLOW_UP_RATE_LIMITED')
  return data?.issued === true ? url : null
}

/** Called only by the private bearer endpoint. Renew short checkout sessions
 * from the still-valid link so reading a long report never requires another email. */
export async function ensureEbCustomerReportSession(token: string, context: EbCustomerReportLink): Promise<EbCustomerSession> {
  if (!TOKEN.test(token) || context.expired) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  const current = await readEbCustomerSession(context.inspectionId)
  if (current && current.orgId === context.orgId && current.inspectionId === context.inspectionId
    && current.email === context.email && current.expiresAt > Date.now() + 60_000
    && ((current.kind === 'report' && current.reportLinkId === context.reportLinkId && current.personalLinkId === context.personalLinkId)
      || (current.kind === 'owner' && await isCurrentOwnerPortalActive(current, context)))
    && await isEbCustomerLinkSessionActive(current)) return current
  const challengeId = randomUUID()
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const secret = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  // The existing order transaction uses an authorization intent. This random value
  // stays in the encrypted server cookie; it is not an emailed or user-entered OTP.
  const codeHash = createHmac('sha256', secret).update(`eb-follow-up-code-v1:${challengeId}:${code}`).digest('hex')
  const { data, error } = await createSupabaseAdminClient().rpc('eb_open_follow_up_customer_link', {
    p_token_hash: hashAssignmentToken(token), p_challenge_id: challengeId, p_code_hash: codeHash,
  })
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (!data?.authorized) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  const payload = decryptEbFollowUpPayload<{ publicToken: string }>(data.reportTokenCiphertext)
  if (!TOKEN.test(payload.publicToken) || payload.publicToken !== context.publicToken || data.personalLinkId !== context.personalLinkId
    || data.orgId !== context.orgId || data.inspectionId !== context.inspectionId || data.reportLinkId !== context.reportLinkId
    || data.email !== context.email) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  const session: EbCustomerSession = {
    kind: 'report', orgId: data.orgId, inspectionId: data.inspectionId, email: data.email,
    reportLinkId: data.reportLinkId, personalLinkId: data.personalLinkId,
    challengeId, code, expiresAt: Date.parse(data.expiresAt),
  }
  await setEbCustomerSession(session)
  return session
}

/** An expired/revoked owner cookie must not strand a still-valid buyer link.
 * Reuse existing access only while the exact portal and its frozen order remain active. */
async function isCurrentOwnerPortalActive(session: EbCustomerSession, context: EbCustomerReportLink): Promise<boolean> {
  if (!/^\/atgarder\/[A-Za-z0-9_-]{32,200}$/.test(session.portalPath ?? '')) return false
  const token = session.portalPath!.split('/').pop()!
  const admin = createSupabaseAdminClient()
  const { data: access, error } = await admin.from('eb_remediation_access_links')
    .select('id,expires_at,follow_up_order_id').eq('token_hash', hashAssignmentToken(token))
    .eq('role', 'customer_owner').eq('org_id', context.orgId).eq('inspection_id', context.inspectionId)
    .eq('email', context.email).is('revoked_at', null).maybeSingle()
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (!access?.follow_up_order_id || !(Date.parse(access.expires_at) > Date.now())) return false
  const { data: order, error: orderError } = await admin.from('eb_follow_up_orders')
    .select('id,status,buyer_snapshot').eq('id', access.follow_up_order_id)
    .eq('org_id', context.orgId).eq('inspection_id', context.inspectionId).maybeSingle()
  if (orderError) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  return order?.status === 'active' && normalizeEbFollowUpEmail(order.buyer_snapshot?.email) === context.email
}

/** Compatibility for already delivered /api/eb/customer links. No order/mail/session
 * is created by the redirect; the private report endpoint handles buyer access. */
export async function openEbCustomerLink(token: string): Promise<string | null> {
  return await resolveEbCustomerReportLink(token) ? `/rapport/bestallare/${token}` : null
}

export async function isEbCustomerLinkSessionActive(session: EbCustomerSession): Promise<boolean> {
  if (!session.personalLinkId) return true // Existing, already verified short-lived sessions remain valid.
  const { data, error } = await createSupabaseAdminClient().rpc('eb_validate_follow_up_customer_link', {
    p_id: session.personalLinkId, p_org_id: session.orgId, p_inspection_id: session.inspectionId,
    p_report_link_id: session.reportLinkId, p_email: session.email,
  })
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  return data === true
}
