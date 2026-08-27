import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type MemberRow = {
  profile_id: string
  role: string | null
}

type ProfileRow = {
  id: string
  is_admin: boolean | null
}

type AccessAssignmentRow = {
  profile_id: string
  module_id: string | null
  scope_type: string
  scope_id: string | null
  expires_at: string | null
}

function isMissingAccessSchema(error: { code?: string | null; message?: string | null } | null) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const message = error.message ?? ''
  return [
    'platform_access_assignments',
    'platform_products',
    'platform_modules',
    'platform_roles',
  ].some((marker) => message.includes(marker))
}

/**
 * Mirrors the Dashboard access boundary for an arbitrary active organization
 * member. It is used before a profile is offered as an internal task recipient,
 * so an assignment email can never point at a module the recipient cannot open.
 */
export async function getInternalTaskModuleAccessProfileIds(input: {
  orgId: string
  profileIds: string[]
}) {
  const requestedProfileIds = [...new Set(input.profileIds.filter(Boolean))]
  const allowed = new Set<string>()
  if (requestedProfileIds.length === 0) return allowed

  const admin = createSupabaseAdminClient()
  const [membersResult, profilesResult, productResult] = await Promise.all([
    admin
      .from('org_members')
      .select('profile_id,role')
      .eq('org_id', input.orgId)
      .eq('is_active', true)
      .in('profile_id', requestedProfileIds),
    admin.from('profiles').select('id,is_admin').in('id', requestedProfileIds),
    admin.from('platform_products').select('id').eq('key', 'dashboard').maybeSingle(),
  ])

  if (membersResult.error) throw new Error('TASK_MEMBERS_READ_FAILED')
  if (profilesResult.error) throw new Error('TASK_PROFILES_READ_FAILED')

  const members = (membersResult.data ?? []) as MemberRow[]
  const activeMemberIds = new Set(members.map((member) => String(member.profile_id)))
  const legacyAllowedIds = new Set(
    members
      .filter((member) => member.role === 'admin')
      .map((member) => String(member.profile_id))
  )
  for (const profile of (profilesResult.data ?? []) as ProfileRow[]) {
    if (profile.is_admin && activeMemberIds.has(String(profile.id))) {
      legacyAllowedIds.add(String(profile.id))
    }
  }
  if (activeMemberIds.size === 0) return allowed

  if (productResult.error) {
    if (!isMissingAccessSchema(productResult.error)) throw new Error('TASK_ACCESS_READ_FAILED')
    return legacyAllowedIds
  }
  if (!productResult.data?.id) return legacyAllowedIds

  const dashboardProductId = String(productResult.data.id)
  const [moduleResult, assignmentsResult] = await Promise.all([
    admin
      .from('platform_modules')
      .select('id')
      .eq('product_id', dashboardProductId)
      .eq('key', 'tasks')
      .maybeSingle(),
    admin
      .from('platform_access_assignments')
      .select('profile_id,module_id,scope_type,scope_id,expires_at')
      .eq('product_id', dashboardProductId)
      .eq('is_active', true)
      .in('profile_id', [...activeMemberIds]),
  ])

  const accessError = moduleResult.error ?? assignmentsResult.error
  if (accessError) {
    if (!isMissingAccessSchema(accessError)) throw new Error('TASK_ACCESS_READ_FAILED')
    return legacyAllowedIds
  }

  const taskModuleId = moduleResult.data?.id ? String(moduleResult.data.id) : null
  const now = Date.now()
  const assignments = ((assignmentsResult.data ?? []) as AccessAssignmentRow[]).filter(
    (assignment) =>
      !assignment.expires_at || new Date(assignment.expires_at).getTime() >= now
  )
  const normalizedProfiles = new Set(assignments.map((assignment) => String(assignment.profile_id)))

  for (const profileId of activeMemberIds) {
    if (!normalizedProfiles.has(profileId)) {
      if (legacyAllowedIds.has(profileId)) allowed.add(profileId)
      continue
    }
    if (
      taskModuleId &&
      assignments.some(
        (assignment) =>
          String(assignment.profile_id) === profileId &&
          assignment.module_id === taskModuleId &&
          assignment.scope_type === 'organization' &&
          assignment.scope_id === input.orgId
      )
    ) {
      allowed.add(profileId)
    }
  }

  return allowed
}

export async function hasInternalTaskModuleAccess(input: {
  orgId: string
  profileId: string
}) {
  const allowed = await getInternalTaskModuleAccessProfileIds({
    orgId: input.orgId,
    profileIds: [input.profileId],
  })
  return allowed.has(input.profileId)
}
