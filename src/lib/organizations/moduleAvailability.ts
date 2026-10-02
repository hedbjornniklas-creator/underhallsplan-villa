import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export async function hasOrganizationTuAccess(orgId: string, hasOrganizationAccess: boolean, hasGlobalAccess: boolean): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient().from('organization_enabled_modules')
    .select('is_active').eq('org_id', orgId).eq('module_key', 'technical_investigations').maybeSingle()
  // Untouched legacy organizations keep their old global-grant behavior. Once
  // managed here, both organization entitlement and personal scoped access are
  // required: neither enabling TU nor re-enabling it may activate global grants.
  if (error) throw new Error('MODULE_ACCESS_REQUIRED')
  if (data === null) return hasOrganizationAccess || hasGlobalAccess
  return data.is_active === true && hasOrganizationAccess
}
