import 'server-only'

import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { decryptEbFollowUpPayload, encryptEbFollowUpPayload, escapeEbFollowUpHtml } from '@/lib/eb/followUpDelivery'
import { normalizeEbFollowUpEmail } from '@/lib/eb/followUp'
import { setEbCustomerSession, type EbCustomerSession } from '@/lib/eb/customerSession'

const TOKEN = /^[A-Za-z0-9_-]{32,200}$/
export const EB_CUSTOMER_LINK_MESSAGE = 'Om adressen tillhör beställaren skickas en personlig beställarlänk. Kontrollera även skräpposten. Ingen beställning görs när du begär länken.'

/** Only the registered/frozen buyer receives this separate secret, never another report recipient. */
export async function issueEbCustomerLink(input: {
  publicToken: string; email: string; baseUrl: string; sendEmail?: boolean
}): Promise<string | null> {
  const email = normalizeEbFollowUpEmail(input.email)
  if (!email || !TOKEN.test(input.publicToken)) throw new Error('EB_FOLLOW_UP_EMAIL_INVALID')
  const token = generateAssignmentToken()
  const url = `${new URL(input.baseUrl).origin}/api/eb/customer/${token}`
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

/** A bearer link opens a short-lived, HttpOnly checkout session; it never orders or sends mail. */
export async function openEbCustomerLink(token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null
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
  if (!data?.authorized) return null
  const payload = decryptEbFollowUpPayload<{ publicToken: string }>(data.reportTokenCiphertext)
  if (!TOKEN.test(payload.publicToken)) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  await setEbCustomerSession({
    kind: 'report', orgId: data.orgId, inspectionId: data.inspectionId, email: data.email,
    reportLinkId: data.reportLinkId, personalLinkId: data.personalLinkId,
    challengeId, code, expiresAt: Date.parse(data.expiresAt),
  })
  // Only the ordinary public token remains in the report URL. Sharing it does not
  // copy the private link or this browser's HttpOnly authorization cookie.
  return `/rapport/${payload.publicToken}?customer=1`
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
