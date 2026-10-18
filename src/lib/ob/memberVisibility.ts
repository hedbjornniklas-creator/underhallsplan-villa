import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/** Only call after authenticating the actor's active membership and OB access. */
export async function canViewColleagueObAssignments(
  orgId: string, profileId: string, admin = createSupabaseAdminClient()
): Promise<boolean> {
  const { data, error } = await admin.from('organization_member_ob_visibility')
    .select('org_id,profile_id,can_view_colleagues').eq('org_id', orgId).eq('profile_id', profileId).maybeSingle()
  if (error) {
    // A rollout without the new table cannot enable colleague access.
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) return false
    throw new Error('OB_ORGANIZATION_READ_FAILED')
  }
  if (data === null) return false
  if (!data || data.org_id !== orgId || data.profile_id !== profileId || typeof data.can_view_colleagues !== 'boolean') {
    throw new Error('OB_ORGANIZATION_READ_FAILED')
  }
  if (data.can_view_colleagues !== true) return false

  // Legacy owner access may come from membership. Expanding access to a
  // colleague always requires an actual active OB module grant as well.
  const { data: grants, error: grantsError } = await admin.from('platform_access_assignments')
    .select('profile_id,product_id,scope_type,scope_id,is_active,expires_at,platform_products!inner(id,key,is_active),platform_modules!inner(product_id,key,is_active),platform_roles!inner(product_id,key,is_active)')
    .eq('profile_id', profileId).eq('is_active', true)
    .eq('platform_products.key', 'dashboard').eq('platform_products.is_active', true)
    .eq('platform_modules.key', 'inspections').eq('platform_modules.is_active', true)
    .eq('platform_roles.key', 'inspector').eq('platform_roles.is_active', true)
  if (grantsError || !Array.isArray(grants)) throw new Error('OB_ORGANIZATION_READ_FAILED')
  const relation = (value: unknown): Record<string, unknown> => {
    if (Array.isArray(value)) return value.length === 1 ? relation(value[0]) : {}
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  }
  const now = Date.now()
  return grants.some(grant => {
    const product = relation(grant.platform_products)
    const moduleEntry = relation(grant.platform_modules)
    const role = relation(grant.platform_roles)
    return grant.profile_id === profileId && grant.is_active === true &&
      ((grant.scope_type === 'organization' && grant.scope_id === orgId) || (grant.scope_type === 'global' && grant.scope_id === null)) &&
      typeof grant.product_id === 'string' && product.id === grant.product_id &&
      moduleEntry.product_id === grant.product_id && role.product_id === grant.product_id &&
      product.key === 'dashboard' && product.is_active === true && moduleEntry.key === 'inspections' && moduleEntry.is_active === true &&
      role.key === 'inspector' && role.is_active === true &&
      (grant.expires_at === null || (typeof grant.expires_at === 'string' && Date.parse(grant.expires_at) > now))
  })
}
