import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { BESIKT_INVITE_MODULES, isInviteToken, type BesiktInvitation, type InvitationDraft } from './invitationContracts'

const TABLE = 'besiktapp_invitations'
const COLUMNS = 'id,email,full_name,organization_id,organization_name,modules,status,expires_at,notification_state,revision,created_at'
export function assertInvitesEnabled() { if (process.env.BESIKTAPP_INVITATIONS !== '1') throw new Error('INVITES_DISABLED') }
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
function check(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', 'PGRST205', 'PGRST202'].includes(error.code ?? '')) throw new Error('INVITE_STORAGE_REQUIRED')
  if (/^INVITE_[A-Z_]+$/.test(error.message ?? '')) throw new Error(error.message)
  throw new Error('INVITE_FAILED')
}
function mailSettings() {
  const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  const base = process.env.APP_BASE_URL?.trim()
  if (!from || /[\r\n]/.test(from) || !base || !process.env.RESEND_API_KEY) throw new Error('INVITE_MAIL_CONFIG')
  let url: URL
  try { url = new URL(base) } catch { throw new Error('INVITE_MAIL_CONFIG') }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('INVITE_MAIL_CONFIG')
  return { from, origin: url.origin }
}
function escape(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!) }
async function deliver(invite: BesiktInvitation, token: string) {
  const { from, origin } = mailSettings()
  // Fragment stays out of server URLs/access logs and referrers.
  const link = `${origin}/besiktapp/aktivera#invite=${token}`
  const modules = invite.modules.map(key => BESIKT_INVITE_MODULES[key]).join(', ')
  let state: 'accepted' | 'failed' = 'failed'
  try {
    const result = await sendAssignmentEmail({ to: invite.email, from, subject: 'Din inbjudan till BesiktApp',
      text: `Hej ${invite.full_name}!\n\nDu är inbjuden till BesiktApp för ${invite.organization_name}.\nArbetsområden: ${modules}.\n\nÖppna din personliga inbjudan: ${link}\nLänken gäller till ${invite.expires_at.slice(0, 10)}. Dela inte länken med andra.\n\nEtt befintligt HusHub-konto används utan att lösenordet ändras.`,
      html: `<p>Hej ${escape(invite.full_name)}!</p><p>Du är inbjuden till BesiktApp för ${escape(invite.organization_name)}.</p><p>Arbetsområden: ${escape(modules)}.</p><p><a href="${escape(link)}">Öppna din inbjudan</a></p><p>Länken gäller till ${invite.expires_at.slice(0, 10)}. Dela inte länken med andra.</p><p>Ett befintligt HusHub-konto används utan att lösenordet ändras.</p>`,
      idempotencyKey: `besiktapp-invite/${invite.id}/${hash(token)}`,
    })
    if (result.providerMessageId) state = 'accepted'
  } catch { /* Status is visible to the authorized administrator; no credentials are logged. */ }
  const result = await createSupabaseAdminClient().from(TABLE).update({ notification_state: state })
    .eq('id', invite.id).eq('token_hash', hash(token)).eq('status', 'pending')
  if (result.error) return { emailAccepted: false, message: 'Inbjudan skapades, men mejlstatus kunde inte bekräftas. Hämta listan igen.' }
  return { emailAccepted: state === 'accepted', message: state === 'accepted' ? 'Inbjudan skickad. Leverans till inkorgen är ännu inte verifierad.' : 'Inbjudan sparades, men mejlet kunde inte bekräftas. Använd Skicka ny länk för att försöka igen.' }
}
export async function listInvitations(page: number) {
  assertInvitesEnabled()
  const db = createSupabaseAdminClient()
  const [invites, orgs] = await Promise.all([
    db.from(TABLE).select(COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }).order('id').range(page * 30, page * 30 + 29),
    db.from('organizations').select('id,name').order('name').limit(200),
  ])
  check(invites.error); check(orgs.error)
  return { items: invites.data as BesiktInvitation[], total: invites.count ?? 0, organizations: orgs.data as { id: string; name: string }[] }
}
export async function createInvitation(draft: InvitationDraft, actor: string) {
  assertInvitesEnabled(); mailSettings()
  const db = createSupabaseAdminClient()
  let orgName = draft.organization_name
  if (draft.organization_id) {
    const org = await db.from('organizations').select('name').eq('id', draft.organization_id).single()
    check(org.error); orgName = org.data!.name
  }
  const token = randomBytes(32).toString('hex')
  const result = await db.from(TABLE).insert({ ...draft, organization_name: orgName, created_by: actor,
    token_hash: hash(token), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }).select(COLUMNS).single()
  if (result.error?.code === '23505') return { emailAccepted: false, message: 'Begäran finns redan. Hämta listan och använd Skicka ny länk om mejlet saknas.' }
  check(result.error)
  return deliver(result.data as BesiktInvitation, token)
}
export async function changeInvitation(id: string, revision: number, action: 'resend' | 'revoke') {
  assertInvitesEnabled()
  if (action === 'resend') mailSettings()
  const token = randomBytes(32).toString('hex')
  const changes = action === 'revoke' ? { status: 'revoked', revision: revision + 1 } : {
    token_hash: hash(token), expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), notification_state: 'pending', revision: revision + 1,
  }
  const result = await createSupabaseAdminClient().from(TABLE).update(changes).eq('id', id).eq('revision', revision).eq('status', 'pending').select(COLUMNS).maybeSingle()
  check(result.error)
  if (!result.data) throw new Error('INVITE_CONFLICT')
  if (action === 'revoke') return { message: 'Inbjudan återkallad. Redan aktiverade konton påverkas inte.' }
  return deliver(result.data as BesiktInvitation, token)
}
export async function previewInvitation(token: string) {
  assertInvitesEnabled()
  if (!isInviteToken(token)) throw new Error('INVITE_INVALID')
  const result = await createSupabaseAdminClient().from(TABLE).select(COLUMNS).eq('token_hash', hash(token)).maybeSingle()
  check(result.error)
  const invite = result.data as BesiktInvitation | null
  if (!invite || invite.status === 'revoked' || (invite.status !== 'accepted' && Date.parse(invite.expires_at) <= Date.now())) throw new Error('INVITE_INVALID')
  return { email: invite.email, fullName: invite.full_name, organization: invite.organization_name, modules: invite.modules, accepted: invite.status === 'accepted' }
}
export async function acceptInvitation(token: string, password?: string) {
  const preview = await previewInvitation(token)
  const db = createSupabaseAdminClient()
  const { data: { user } } = await createSupabaseServerClient().auth.getUser()
  if (user && user.email?.toLowerCase() !== preview.email.toLowerCase()) throw new Error('INVITE_EMAIL_MISMATCH')
  let actor = user?.id
  let created = false
  if (!actor) {
    if (preview.accepted) throw new Error('EXISTING_USER_LOGIN_REQUIRED')
    if (!password || password.length < 12 || password.length > 128) throw new Error('INVITE_PASSWORD_REQUIRED')
    // The high-entropy invitation is delivered only to this address. Never update an existing account's password.
    const result = await db.auth.admin.createUser({ email: preview.email, password, email_confirm: true, user_metadata: { full_name: preview.fullName } })
    if (result.error) {
      if (/already|registered|exists/i.test(result.error.code + ' ' + result.error.message)) throw new Error('EXISTING_USER_LOGIN_REQUIRED')
      throw new Error('INVITE_FAILED')
    }
    if (!result.data.user) throw new Error('INVITE_FAILED')
    actor = result.data.user.id; created = true
  }
  const result = await db.rpc('besiktapp_accept_invitation', { p_actor: actor, p_token_hash: hash(token) })
  if (result.error && created) throw new Error('INVITE_ACCOUNT_CREATED')
  check(result.error)
  if (result.data?.accepted !== true) throw new Error(created ? 'INVITE_ACCOUNT_CREATED' : 'INVITE_FAILED')
  return { accepted: true, createdUser: created, email: preview.email }
}
