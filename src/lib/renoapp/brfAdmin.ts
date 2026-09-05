import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireBrfAdminContext } from './brfAdminAccess'
import { getBrfInviteState, normalizeBrfOrgNumber } from './brfLifecycle'
import { BRF_ADMIN_FIELDS, type BrfAdminDetail, type BrfAdminRecord } from './brfAdminTypes'
import { issueBrfInviteForAuthorizedUser } from './onboarding'
import { removeRenoAppUserMember, revokeRenoAppUserInvite } from './server'

const BRF_COLUMNS = ['id', 'slug', ...BRF_ADMIN_FIELDS.map(([key]) => key), 'internal_note',
  'is_public_apply_enabled', 'is_public_apply_listed', 'onboarding_completed_at', 'onboarding_source',
  'created_at', 'onboarding_terms_version', 'onboarding_terms_accepted_at'].join(',')
function relation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return relation(value[0])
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export async function getBrfAdminDetail(brfId: string): Promise<BrfAdminDetail> {
  const context = await requireBrfAdminContext()
  const admin = createSupabaseAdminClient()
  const [brfResult, members, grants, invites, events, requests, cases] = await Promise.all([
    admin.from('brf_associations').select(BRF_COLUMNS).eq('id', brfId).maybeSingle(),
    admin.from('brf_members').select('profile_id,role,profile:profiles(full_name,email)').eq('brf_id', brfId).eq('is_active', true),
    admin.from('platform_access_assignments').select('profile_id,expires_at,product:platform_products(key),module:platform_modules(key),role:platform_roles(key)').eq('scope_type', 'brf').eq('scope_id', brfId).eq('is_active', true),
    admin.from('brf_member_invites').select('id,email,full_name,expires_at,accepted_at,revoked_at,delivery_status,delivery_error,sent_at').eq('brf_id', brfId).order('created_at', { ascending: false }),
    admin.from('renoapp_brf_events').select('id,kind,details,created_at,actor:profiles(full_name,email)').eq('brf_id', brfId).order('created_at', { ascending: false }).limit(200),
    admin.from('brf_requests').select('id,status,created_at,reviewed_at').eq('approved_brf_id', brfId),
    admin.from('renovation_cases').select('id', { count: 'exact', head: true }).eq('brf_id', brfId),
  ])
  for (const result of [brfResult, members, grants, invites, events, requests, cases]) {
    if (result.error) throw new Error(result.error.message)
  }
  if (!brfResult.data) throw new Error('BRF_NOT_FOUND')
  const now = Date.now()
  const accessIds = new Set((grants.data ?? []).filter(row => relation(row.product).key === 'renoapp'
    && (!relation(row.module).key || relation(row.module).key === 'board_portal')
    && ['board_member', 'renoapp_admin'].includes(String(relation(row.role).key))
    && (!row.expires_at || new Date(row.expires_at).getTime() > now)).map(row => row.profile_id))
  return {
    brf: brfResult.data as unknown as BrfAdminRecord, viewerId: context.userId, caseCount: cases.count ?? 0,
    members: (members.data ?? []).map(row => ({ profileId: row.profile_id, role: row.role,
      name: relation(row.profile).full_name as string | null, email: relation(row.profile).email as string | null,
      hasAccess: accessIds.has(row.profile_id) })),
    invites: (invites.data ?? []).map(row => ({ id: row.id, email: row.email, fullName: row.full_name,
      expiresAt: row.expires_at, state: getBrfInviteState({ acceptedAt: row.accepted_at, revokedAt: row.revoked_at, expiresAt: row.expires_at }),
      deliveryStatus: row.delivery_status, deliveryError: row.delivery_error, sentAt: row.sent_at })),
    events: (events.data ?? []).map(row => ({ id: row.id, kind: row.kind, createdAt: row.created_at,
      actor: (relation(row.actor).full_name ?? relation(row.actor).email ?? null) as string | null, details: relation(row.details) })),
    requests: requests.data ?? [],
  }
}

export async function updateBrfAdmin(brfId: string, body: Record<string, unknown>, origin: string) {
  const context = await requireBrfAdminContext()
  const admin = createSupabaseAdminClient()
  if (body.action === 'invite') {
    const fullName = String(body.fullName ?? '').trim()
    if (!fullName) throw new Error('Ange användarens namn.')
    const invite = await issueBrfInviteForAuthorizedUser({ brfId, fullName, email: String(body.email ?? ''), actorId: context.userId, origin })
    return { invite }
  }
  if (body.action === 'resend_invite' || body.action === 'revoke_invite') {
    const { data: invite, error } = await admin.from('brf_member_invites').select('id,email,full_name,accepted_at,revoked_at')
      .eq('id', String(body.inviteId ?? '')).eq('brf_id', brfId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!invite) throw new Error('INVITE_NOT_FOUND')
    if (body.action === 'revoke_invite') return revokeRenoAppUserInvite(invite.id, brfId)
    if (invite.accepted_at) throw new Error('INVITE_ALREADY_ACCEPTED')
    return { invite: await issueBrfInviteForAuthorizedUser({ brfId, fullName: invite.full_name,
      email: invite.email, actorId: context.userId, origin, replace: true }) }
  }
  if (body.action === 'remove_member') return removeRenoAppUserMember({ brfId, profileId: String(body.profileId ?? '') }, true)
  if (body.action === 'restore_member') {
    const { error } = await admin.rpc('renoapp_restore_brf_member', {
      p_actor: context.userId, p_brf_id: brfId, p_profile_id: String(body.profileId ?? ''),
    })
    if (error) throw new Error(error.message)
    return { saved: true }
  }
  if (!['save_details', 'save_visibility', 'save_note'].includes(String(body.action))) throw new Error('INVALID_ACTION')
  const { data: brf, error: readError } = await admin.from('brf_associations').select('onboarding_completed_at').eq('id', brfId).maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!brf) throw new Error('BRF_NOT_FOUND')
  const changes: Record<string, unknown> = {}
  if (body.action === 'save_note') changes.internal_note = String(body.note ?? '').trim() || null
  if (body.action === 'save_visibility') {
    if (!['listed', 'direct_link', 'disabled'].includes(String(body.mode))) throw new Error('INVALID_ACTION')
    changes.is_public_apply_enabled = body.mode !== 'disabled'
    changes.is_public_apply_listed = body.mode === 'listed'
  }
  if (body.action === 'save_details') {
    const fields = relation(body.fields)
    for (const [key] of BRF_ADMIN_FIELDS) {
      if (!(key in fields)) throw new Error('Föreningsuppgifter saknas. Ladda om sidan.')
      changes[key] = String(fields[key] ?? '').trim() || null
    }
    if (!changes.name) throw new Error('Ange föreningens namn.')
    changes.org_number = normalizeBrfOrgNumber(String(changes.org_number ?? ''))
    if (!/^\d{6}-\d{4}$/.test(String(changes.org_number))) throw new Error('ORG_NUMBER_INVALID')
    for (const key of ['email', 'invoice_email', 'primary_contact_email']) {
      if (changes[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(changes[key]))) throw new Error('Ange en giltig e-postadress.')
    }
    if (changes.unit_count !== null) {
      changes.unit_count = Number(changes.unit_count)
      if (!Number.isInteger(changes.unit_count) || Number(changes.unit_count) <= 0) throw new Error('Ange antal lägenheter som ett positivt heltal.')
    }
    if (changes.postal_code) {
      const digits = String(changes.postal_code).replace(/\s/g, '')
      if (!/^\d{5}$/.test(digits)) throw new Error('Ange ett giltigt postnummer.')
      changes.postal_code = digits.slice(0, 3) + ' ' + digits.slice(3)
    }
    if (brf.onboarding_completed_at) {
      for (const key of ['property_designation', 'address', 'postal_code', 'city', 'invoice_address', 'invoice_email', 'primary_contact_name', 'primary_contact_email', 'primary_contact_phone']) {
        if (!changes[key]) throw new Error('Obligatoriska uppgifter för en aktiv förening får inte tömmas.')
      }
    }
  }
  const { error } = await admin.rpc('renoapp_update_brf', { p_actor: context.userId, p_brf_id: brfId, p_changes: changes })
  if (error) throw new Error(error.message)
  return { saved: true }
}
