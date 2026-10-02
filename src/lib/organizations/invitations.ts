import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireOrganizationAdmin } from '@/lib/organizations/administration'
import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'

const TABLE = 'organization_invitations'
const SAFE_COLUMNS = 'id,email,full_name,org_id,role,modules,status,expires_at,revision,notification_state,created_at'
const TU = 'technical_investigations'
const DAY = 86400000
type Role = 'admin' | 'inspector'
type InvitationRow = {
  id: string
  email: string
  full_name: string
  org_id: string
  role: Role
  modules: string[]
  status: 'pending' | 'accepted' | 'revoked'
  expires_at: string
  revision: number
  notification_state: 'pending' | 'sending' | 'accepted' | 'failed'
  token_hash?: string
}

function check(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', 'PGRST205', 'PGRST202'].includes(error.code ?? '')) throw new Error('ORG_SCHEMA_REQUIRED')
  // The HTTP boundary only renders its own fixed message allowlist.
  if (/^(?:ORG|INVITE)_[A-Z_]+$/.test(error.message ?? '')) throw new Error(error.message)
  throw new Error('ORG_REQUEST_FAILED')
}

function relation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return relation(value[0])
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function validateModules(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1 || !value.every(key => key === TU)) throw new Error('ORG_REQUEST_INVALID')
  return [...value]
}

function validateRole(value: unknown): Role {
  if (value !== 'admin' && value !== 'inspector') throw new Error('ORG_REQUEST_INVALID')
  return value
}

function validateUuid(value: unknown) {
  if (!isOrganizationUuid(value)) throw new Error('ORG_REQUEST_INVALID')
  return value.toLowerCase()
}

export function parseOrganizationInvitationDraft(value: Record<string, unknown>) {
  const requestId = validateUuid(value.requestId)
  const role = validateRole(value.role)
  const modules = validateModules(value.modules)
  if (typeof value.email !== 'string' || value.email.length > 254 || /[\u0000-\u001f\u007f]/.test(value.email) ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email.trim())) throw new Error('ORG_REQUEST_INVALID')
  if (typeof value.fullName !== 'string' || !value.fullName.trim() || value.fullName.length > 160 || /[\u0000-\u001f\u007f]/.test(value.fullName)) throw new Error('ORG_REQUEST_INVALID')
  if (role === 'inspector' && modules.length === 0) throw new Error('ORG_REQUEST_INVALID')
  return { requestId, role, modules, email: value.email.trim().toLowerCase(), fullName: value.fullName.trim() }
}

export function isOrganizationInviteToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

function safeInvitation(row: InvitationRow) {
  return { id: row.id, email: row.email, fullName: row.full_name, role: row.role, modules: row.modules,
    status: row.status, expiresAt: row.expires_at, revision: row.revision, notificationState: row.notification_state }
}

export async function listOrganizationMembers(orgId: string) {
  const context = await requireOrganizationAdmin(validateUuid(orgId))
  const db = createSupabaseAdminClient()
  const [members, grants] = await Promise.all([
    db.from('org_members').select('profile_id,role,is_active,profile:profiles(full_name,email)')
      .eq('org_id', context.organization.id).order('created_at').limit(1000),
    db.from('platform_access_assignments').select('profile_id,expires_at,product:platform_products(key),module:platform_modules(key)')
      .eq('scope_type', 'organization').eq('scope_id', context.organization.id).eq('is_active', true).limit(5000),
  ])
  check(members.error)
  check(grants.error)
  return (members.data ?? []).map(row => ({
    profileId: row.profile_id as string,
    displayName: relation(row.profile).full_name as string | null,
    email: relation(row.profile).email as string | null,
    role: row.role as Role,
    isActive: row.is_active as boolean,
    modules: row.is_active && (grants.data ?? []).some(grant => grant.profile_id === row.profile_id &&
      relation(grant.product).key === 'dashboard' && relation(grant.module).key === TU &&
      (!grant.expires_at || Date.parse(grant.expires_at) > Date.now())) ? [TU] : [],
  }))
}

export async function listOrganizationInvitations(orgId: string) {
  const context = await requireOrganizationAdmin(validateUuid(orgId))
  const result = await createSupabaseAdminClient().from(TABLE).select(SAFE_COLUMNS)
    .eq('org_id', context.organization.id).order('created_at', { ascending: false }).limit(250)
  check(result.error)
  return ((result.data ?? []) as InvitationRow[]).map(safeInvitation)
}

function mailSettings() {
  const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  const base = process.env.APP_BASE_URL?.trim()
  if (!from || /[\r\n]/.test(from) || !base || !process.env.RESEND_API_KEY) throw new Error('INVITE_MAIL_CONFIG')
  let url: URL
  try { url = new URL(base) } catch { throw new Error('INVITE_MAIL_CONFIG') }
  const local = process.env.NODE_ENV === 'development' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('INVITE_MAIL_CONFIG')
  return { from, origin: url.origin }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

async function deliverInvitation(row: InvitationRow, token: string, organizationName: string) {
  const { from, origin } = mailSettings()
  const db = createSupabaseAdminClient()
  // A repeated request must neither rotate a token nor send another email.
  if (row.token_hash !== hashToken(token)) return { emailAccepted: row.notification_state === 'accepted', message: 'Begäran finns redan. Hämta listan för aktuell status.' }
  const claim = await db.from(TABLE).update({ notification_state: 'sending' })
    .eq('id', row.id).eq('org_id', row.org_id).eq('revision', row.revision)
    .eq('status', 'pending').eq('notification_state', 'pending').eq('token_hash', hashToken(token)).select('id').maybeSingle()
  check(claim.error)
  if (!claim.data) return { emailAccepted: row.notification_state === 'accepted', message: 'Utskicket hanteras redan. Hämta listan för aktuell status.' }

  const link = `${origin}/organisation/inbjudan#invite=${token}`
  const organization = organizationName || 'din organisation'
  const role = row.role === 'admin' ? 'organisationsadministratör' : 'medlem'
  const modules = row.modules.includes(TU) ? 'Tekniska utredningar (TU)' : 'Organisationsadministration'
  let state: 'accepted' | 'failed' = 'failed'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `organization-invite/${row.id}/${row.revision}` },
      body: JSON.stringify({ from, to: [row.email], subject: `Inbjudan till ${organization} i HusHub`,
        text: `Hej ${row.full_name}!\n\nDu är inbjuden som ${role} i ${organization}.\nArbetsområden: ${modules}.\n\nÖppna din personliga inbjudan: ${link}\nLänken gäller till ${row.expires_at.slice(0, 10)}. Dela inte länken med andra.\n\nHar du redan ett HusHub-konto använder du det. Dina andra organisationer påverkas inte.`,
        html: `<p>Hej ${escapeHtml(row.full_name)}!</p><p>Du är inbjuden som ${role} i ${escapeHtml(organization)}.</p><p>Arbetsområden: ${modules}.</p><p><a href="${escapeHtml(link)}">Öppna din inbjudan</a></p><p>Länken gäller till ${row.expires_at.slice(0, 10)}. Dela inte länken med andra.</p><p>Har du redan ett HusHub-konto använder du det. Dina andra organisationer påverkas inte.</p>`,
      }),
    })
    const result: unknown = await response.json()
    if (response.ok && typeof relation(result).id === 'string') state = 'accepted'
  } catch { /* Never log tokens, email addresses, passwords or provider diagnostics. */ }
  finally { clearTimeout(timer) }
  const result = await db.from(TABLE).update({ notification_state: state })
    .eq('id', row.id).eq('org_id', row.org_id).eq('revision', row.revision)
    .eq('token_hash', hashToken(token)).eq('notification_state', 'sending')
  if (result.error) return { emailAccepted: false, message: 'Inbjudan sparades, men mejlstatus kunde inte bekräftas. Hämta listan igen.' }
  return { emailAccepted: state === 'accepted', message: state === 'accepted'
    ? 'Inbjudan skickad. Leverans till inkorgen är ännu inte verifierad.'
    : 'Inbjudan sparades, men utskicket kunde inte bekräftas. Använd Skicka ny länk för att försöka igen.' }
}

export async function createOrganizationInvitation(orgId: string, values: Record<string, unknown>) {
  const context = await requireOrganizationAdmin(validateUuid(orgId))
  const draft = parseOrganizationInvitationDraft(values)
  if (draft.modules.some(module => !context.modules.includes(module))) throw new Error('ORG_MODULE_NOT_ENABLED')
  mailSettings()
  const token = randomBytes(32).toString('hex')
  const result = await createSupabaseAdminClient().rpc('organization_invitation_create', {
    p_actor: context.profileId, p_org: context.organization.id,
    p_values: { ...draft, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * DAY).toISOString() },
  })
  check(result.error)
  if (!result.data?.id) throw new Error('ORG_REQUEST_FAILED')
  return deliverInvitation(result.data as InvitationRow, token, context.organization.name ?? '')
}

export async function changeOrganizationInvitation(orgId: string, values: Record<string, unknown>) {
  const context = await requireOrganizationAdmin(validateUuid(orgId))
  const id = validateUuid(values.id)
  if (!Number.isInteger(values.revision) || Number(values.revision) < 0 || Number(values.revision) >= 2147483647 ||
      (values.action !== 'resend' && values.action !== 'revoke')) throw new Error('ORG_REQUEST_INVALID')
  if (values.action === 'resend') mailSettings()
  const token = randomBytes(32).toString('hex')
  const result = await createSupabaseAdminClient().rpc('organization_invitation_change', {
    p_actor: context.profileId, p_org: context.organization.id, p_id: id, p_revision: values.revision,
    p_action: values.action, p_token_hash: hashToken(token), p_expires_at: new Date(Date.now() + 7 * DAY).toISOString(),
  })
  check(result.error)
  if (!result.data?.id) throw new Error('INVITE_CONFLICT')
  if (values.action === 'revoke') return { message: 'Inbjudan återkallad.' }
  return deliverInvitation(result.data as InvitationRow, token, context.organization.name ?? '')
}

export async function updateOrganizationMember(orgId: string, values: Record<string, unknown>) {
  const context = await requireOrganizationAdmin(validateUuid(orgId))
  const profileId = validateUuid(values.profileId)
  const role = validateRole(values.role)
  const modules = validateModules(values.modules)
  if (typeof values.isActive !== 'boolean') throw new Error('ORG_REQUEST_INVALID')
  if (modules.some(module => !context.modules.includes(module))) throw new Error('ORG_MODULE_NOT_ENABLED')
  const result = await createSupabaseAdminClient().rpc('organization_member_update', {
    p_actor: context.profileId, p_org: context.organization.id, p_profile: profileId,
    p_values: { role, modules, isActive: values.isActive },
  })
  check(result.error)
  if (result.data?.saved !== true) throw new Error('ORG_REQUEST_FAILED')
  return { saved: true }
}

async function readTokenInvitation(token: string) {
  if (!isOrganizationInviteToken(token)) throw new Error('INVITE_INVALID')
  const result = await createSupabaseAdminClient().from(TABLE)
    .select(`${SAFE_COLUMNS},organization:organizations(name)`)
    .eq('token_hash', hashToken(token)).maybeSingle()
  check(result.error)
  const row = result.data as (InvitationRow & { organization: unknown }) | null
  if (!row || row.status === 'revoked' || (row.status !== 'accepted' && Date.parse(row.expires_at) <= Date.now())) throw new Error('INVITE_INVALID')
  return row
}

export async function previewOrganizationInvitation(token: string) {
  const row = await readTokenInvitation(token)
  const { data: { user } } = await createSupabaseServerClient().auth.getUser()
  // The bearer link authorizes this preview. Showing it also lets someone with
  // another active session switch account; acceptance verifies the email again.
  return { invitation: { organizationName: String(relation(row.organization).name ?? ''), email: row.email,
    fullName: row.full_name, role: row.role, modules: row.modules, accepted: row.status === 'accepted' },
    hasSession: Boolean(user), requiresSignIn: !user && row.status === 'accepted' }
}

export async function acceptOrganizationInvitation(token: string, password?: string) {
  const row = await readTokenInvitation(token)
  const { data: { user }, error: sessionError } = await createSupabaseServerClient().auth.getUser()
  // An invalid/expired cookie is anonymous; upstream session outages must not create accounts.
  if (sessionError && sessionError.name !== 'AuthSessionMissingError' && sessionError.status !== 400 && sessionError.status !== 401 && sessionError.status !== 403) throw new Error('ORG_REQUEST_FAILED')
  if (user && user.email?.toLowerCase() !== row.email.toLowerCase()) throw new Error('INVITE_EMAIL_MISMATCH')
  if (user && !user.email_confirmed_at) throw new Error('INVITE_EMAIL_UNVERIFIED')
  const db = createSupabaseAdminClient()
  let actor = user?.id
  let created = false
  if (!actor) {
    if (row.status === 'accepted') throw new Error('EXISTING_USER_LOGIN_REQUIRED')
    if (!password || password.length < 12 || password.length > 128) throw new Error('INVITE_PASSWORD_REQUIRED')
    // Possession of a live high-entropy email invitation verifies this address only.
    // createUser rejects duplicate accounts; existing credentials are never changed.
    const result = await db.auth.admin.createUser({ email: row.email, password, email_confirm: true,
      user_metadata: { full_name: row.full_name } })
    if (result.error) {
      if (['email_exists', 'user_already_exists'].includes(result.error.code ?? '') || /already|registered|exists/i.test(result.error.message)) throw new Error('EXISTING_USER_LOGIN_REQUIRED')
      throw new Error('ORG_REQUEST_FAILED')
    }
    if (!result.data.user) throw new Error('ORG_REQUEST_FAILED')
    actor = result.data.user.id
    created = true
  }
  const result = await db.rpc('organization_invitation_accept', { p_actor: actor, p_token_hash: hashToken(token) })
  if (created && (result.error || result.data?.accepted !== true)) throw new Error('INVITE_ACCOUNT_CREATED')
  check(result.error)
  if (result.data?.accepted !== true) throw new Error('ORG_REQUEST_FAILED')
  return { accepted: true, createdUser: created, email: row.email, organizationId: result.data.organizationId as string }
}
