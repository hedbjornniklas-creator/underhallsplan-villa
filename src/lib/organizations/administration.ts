import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { readOrganizationBranding } from './companyProfile'
import { parseOrganizationProfile, type OrganizationAdministrationWorkspace } from './administrationTypes'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export async function requireOrganizationContext(requestedOrgId?: unknown): Promise<OrganizationAdministrationWorkspace> {
  if (requestedOrgId !== undefined && (typeof requestedOrgId !== 'string' || !UUID.test(requestedOrgId))) {
    throw new Error('ORG_SELECTION_INVALID')
  }
  const { data: { user }, error: authError } = await createSupabaseServerClient().auth.getUser()
  if (authError || !user) throw new Error('UNAUTHORIZED')
  const db = createSupabaseAdminClient()
  let query = db.from('org_members').select('org_id,role,is_default,created_at').eq('profile_id', user.id).eq('is_active', true)
  if (requestedOrgId) query = query.eq('org_id', requestedOrgId)
  const { data: member, error } = await query.order('is_default', { ascending: false }).order('created_at').order('org_id').limit(1).maybeSingle()
  if (error) throw new Error('ORG_PROFILE_READ_FAILED')
  if (!member || !['admin', 'inspector'].includes(member.role)) throw new Error('ORG_MEMBERSHIP_REQUIRED')
  const branding = await readOrganizationBranding(member.org_id)
  if (!branding) {
    const { data, error: legacyError } = await db.from('organizations').select('id,name,organization_number').eq('id', member.org_id).single()
    if (legacyError || !data) throw new Error('ORG_PROFILE_READ_FAILED')
    return { profileId: user.id, role: member.role, modules: [], migrationRequired: true, organization: {
      id: data.id, name: data.name, organizationNumber: data.organization_number,
      address: null, postalCode: null, city: null, website: null, logoPath: null, reportFooterText: null,
      configured: false, version: 1,
    } }
  }
  const { data: modules, error: modulesError } = await db.from('organization_enabled_modules').select('module_key').eq('org_id', member.org_id).eq('is_active', true)
  if (modulesError) throw new Error('ORG_MIGRATION_REQUIRED')
  return { profileId: user.id, role: member.role, organization: branding, modules: (modules ?? []).map(row => row.module_key), migrationRequired: false }
}

export const getOrganizationWorkspace = requireOrganizationContext

export async function requireOrganizationAdmin(orgId: unknown) {
  const context = await requireOrganizationContext(orgId)
  if (context.role !== 'admin') throw new Error('ORG_ADMIN_REQUIRED')
  if (context.migrationRequired) throw new Error('ORG_MIGRATION_REQUIRED')
  return context
}

export async function saveOrganizationProfile(orgId: unknown, expectedVersion: unknown, value: unknown) {
  const context = await requireOrganizationAdmin(orgId)
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1) throw new Error('ORG_INPUT_INVALID')
  const values = parseOrganizationProfile(value)
  if (values.logoPath && values.logoPath !== context.organization.logoPath) {
    const prefix = `organizations/${context.organization.id}/`
    if (!values.logoPath.startsWith(prefix) || !/^logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/u.test(values.logoPath.slice(prefix.length))) {
      throw new Error('ORG_INPUT_INVALID')
    }
  }
  const { data, error } = await createSupabaseAdminClient().rpc('organization_profile_save', {
    p_actor: context.profileId, p_org: context.organization.id, p_expected_version: expectedVersion, p_values: values,
  })
  if (error) {
    if (/^ORG_[A-Z_]+$/u.test(error.message)) throw new Error(error.message)
    throw new Error('ORG_PROFILE_SAVE_FAILED')
  }
  if (data?.saved !== true) throw new Error('ORG_PROFILE_SAVE_FAILED')
  return getOrganizationWorkspace(context.organization.id)
}
