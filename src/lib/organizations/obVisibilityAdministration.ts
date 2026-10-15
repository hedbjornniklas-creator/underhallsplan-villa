import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationAdmin } from '@/lib/organizations/administration'
import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'

export type ObMemberVisibility = { canViewColleagues: boolean; revision: number; canEnable: boolean }

function check(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', 'PGRST205', 'PGRST202'].includes(error.code ?? '')) throw new Error('ORG_OB_VISIBILITY_SCHEMA_REQUIRED')
  if (/^ORG_[A-Z_]+$/.test(error.message ?? '')) throw new Error(error.message)
  throw new Error('ORG_REQUEST_FAILED')
}

export async function listOrganizationObVisibility(orgId: string) {
  const context = await requireOrganizationAdmin(orgId)
  const result = await createSupabaseAdminClient().rpc('organization_member_ob_visibility_list', {
    p_actor: context.profileId, p_org: context.organization.id,
  })
  // Existing member administration remains usable before the separate SQL is installed.
  // Missing schema is never represented as a successfully saved permission.
  if (['42P01', '42703', 'PGRST202', 'PGRST205'].includes(result.error?.code ?? '')) {
    return { permissions: {} as Record<string, ObMemberVisibility>, migrationRequired: true }
  }
  check(result.error)
  if (!Array.isArray(result.data) || result.data.length > 1000) throw new Error('ORG_DIRECTORY_TOO_LARGE')
  const permissions: Record<string, ObMemberVisibility> = {}
  for (const row of result.data) {
    if (!isOrganizationUuid(row.profileId) || typeof row.canViewColleagues !== 'boolean' ||
        typeof row.canEnable !== 'boolean' || !Number.isInteger(row.revision) || row.revision < 0 ||
        Object.hasOwn(permissions, row.profileId)) throw new Error('ORG_REQUEST_FAILED')
    permissions[row.profileId] = { canViewColleagues: row.canViewColleagues, revision: row.revision, canEnable: row.canEnable }
  }
  return { permissions, migrationRequired: false }
}

export async function setOrganizationObVisibility(values: Record<string, unknown>) {
  if (!isOrganizationUuid(values.orgId) || !isOrganizationUuid(values.profileId) ||
      typeof values.canViewColleagues !== 'boolean' || !Number.isInteger(values.revision) ||
      Number(values.revision) < 0 || Number(values.revision) >= 2147483647) throw new Error('ORG_REQUEST_INVALID')
  const context = await requireOrganizationAdmin(values.orgId.toLowerCase())
  const result = await createSupabaseAdminClient().rpc('organization_member_ob_visibility_set', {
    p_actor: context.profileId, p_org: context.organization.id, p_profile: values.profileId.toLowerCase(),
    p_can_view: values.canViewColleagues, p_revision: values.revision,
  })
  check(result.error)
  if (result.data?.saved !== true || result.data.canViewColleagues !== values.canViewColleagues ||
      !Number.isInteger(result.data.revision) || result.data.revision < 1) throw new Error('ORG_REQUEST_FAILED')
  return { saved: true, canViewColleagues: result.data.canViewColleagues as boolean, revision: result.data.revision as number }
}
