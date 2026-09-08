import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizeEbFollowUpEmail } from '@/lib/eb/followUp'
import { encryptEbFollowUpPayload, escapeEbFollowUpHtml, type EbFollowUpEmail } from '@/lib/eb/followUpDelivery'
import { readEbCustomerSession, setEbCustomerSession } from '@/lib/eb/customerSession'

const GENERIC_CODE_MESSAGE = 'Om länken hör till en beställarportal skickas en engångskod till beställarens verifierade e-postadress. Kontrollera även skräpposten. Koden gäller i 15 minuter.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type OwnerAccess = {
  id: string
  role: string
  follow_up_order_id: string | null
  org_id: string
  eb_project_id: string
  inspection_id: string | null
  email: string
  revoked_at: string | null
  expires_at: string
}

async function loadOwnerOrder(access: OwnerAccess) {
  if (!access.follow_up_order_id || !access.inspection_id) return null
  const { data, error } = await createSupabaseAdminClient().from('eb_follow_up_orders')
    .select('id,org_id,eb_project_id,inspection_id,report_link_id,buyer_snapshot,seller_snapshot,status')
    .eq('id', access.follow_up_order_id).eq('org_id', access.org_id)
    .eq('eb_project_id', access.eb_project_id).eq('inspection_id', access.inspection_id).maybeSingle()
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  const email = normalizeEbFollowUpEmail(data?.buyer_snapshot?.email)
  if (!data || data.status !== 'active' || !email || email !== normalizeEbFollowUpEmail(access.email)) return null
  return { ...data, email }
}

/** Enforced before loading any owner workspace, signing images or performing writes. */
export async function assertEbRemediationOwnerSession(access: OwnerAccess): Promise<void> {
  if (access.role !== 'customer_owner') return
  if (access.revoked_at) throw new Error('EB_REMEDIATION_ACCESS_REVOKED')
  if (!Number.isFinite(Date.parse(access.expires_at)) || Date.parse(access.expires_at) <= Date.now()) {
    throw new Error('EB_REMEDIATION_OWNER_LINK_EXPIRED')
  }
  const order = await loadOwnerOrder(access)
  if (!order || !access.inspection_id) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
  const session = await readEbCustomerSession(access.inspection_id)
  if (!session || session.orgId !== access.org_id || session.inspectionId !== access.inspection_id ||
      !['report', 'owner'].includes(session.kind) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() ||
      normalizeEbFollowUpEmail(session.email) !== order.email) {
    throw new Error('EB_REMEDIATION_OWNER_VERIFICATION_REQUIRED')
  }
}

async function loadOwnerContext(token: string) {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) return null
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('eb_remediation_access_links')
    .select('id,role,follow_up_order_id,org_id,eb_project_id,inspection_id,email,revoked_at,expires_at')
    .eq('token_hash', hashAssignmentToken(token)).eq('role', 'customer_owner').is('revoked_at', null).maybeSingle()
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (!data || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) return null
  const access = data as OwnerAccess
  const order = await loadOwnerOrder(access)
  if (!order) return null
  return { admin, access, order }
}

function challengeHash(challengeId: string, code: string) {
  const secret = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  return createHmac('sha256', secret).update(`eb-follow-up-code-v1:${challengeId}:${code}`).digest('hex')
}

/** The browser never selects a recipient or receives the buyer's address. */
export async function requestEbOwnerAccessCode(input: { token: string }) {
  const id = randomUUID()
  const result = { challengeId: id, message: GENERIC_CODE_MESSAGE }
  const context = await loadOwnerContext(input.token)
  if (!context) return result
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const content = `Din engångskod är ${code}. Den gäller i 15 minuter och låser upp din personliga åtgärdsportal i den webbläsare där koden anges. Dela inte koden med någon annan. Ingen ny beställning eller avgift skapas. Om du inte begärt koden kan du bortse från detta mejl.`
  const mail: EbFollowUpEmail = {
    to: context.order.email, replyTo: normalizeEbFollowUpEmail(context.order.seller_snapshot?.email),
    subject: 'Engångskod till din personliga åtgärdsportal', text: content,
    html: `<p>${escapeEbFollowUpHtml(content)}</p>`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  }
  const { data, error } = await context.admin.rpc('eb_request_follow_up_owner_challenge', {
    p_id: id, p_access_link_id: context.access.id, p_email: context.order.email,
    p_code_hash: challengeHash(id, code), p_mail_ciphertext: encryptEbFollowUpPayload(mail),
  })
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (data?.limited) throw new Error('EB_FOLLOW_UP_RATE_LIMITED')
  return result
}

export async function verifyEbOwnerAccessCode(input: { token: string; challengeId: unknown; code: unknown }) {
  const failed = { verified: false }
  if (typeof input.challengeId !== 'string' || !UUID.test(input.challengeId) ||
      typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) return failed
  const context = await loadOwnerContext(input.token)
  if (!context) return failed
  const { data: challenge, error: challengeError } = await context.admin.from('eb_follow_up_challenges')
    .select('id').eq('id', input.challengeId).eq('purpose', 'owner')
    .eq('owner_access_link_id', context.access.id).eq('org_id', context.access.org_id)
    .eq('inspection_id', context.access.inspection_id).eq('report_link_id', context.order.report_link_id)
    .eq('email', context.order.email).maybeSingle()
  if (challengeError) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (!challenge) return failed
  const { data, error } = await context.admin.rpc('eb_verify_follow_up_challenge', {
    p_id: input.challengeId, p_report_link_id: context.order.report_link_id,
    p_code_hash: challengeHash(input.challengeId, input.code),
  })
  if (error) throw new Error('EB_FOLLOW_UP_UNAVAILABLE')
  if (!data?.verified || normalizeEbFollowUpEmail(data.email) !== context.order.email) return failed
  await setEbCustomerSession({
    orgId: context.access.org_id, inspectionId: context.access.inspection_id!, email: context.order.email,
    kind: 'owner', expiresAt: Date.now() + 8 * 60 * 60_000, portalPath: `/atgarder/${input.token}`,
  })
  return { verified: true }
}
