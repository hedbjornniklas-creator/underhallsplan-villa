import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationContext, requireOrganizationAdmin } from '@/lib/organizations/administration'
import { parseOrganizationSenderMutation, type OrganizationSenderWorkspace } from '@/lib/organizations/senderProfileTypes'

const migrationCodes = ['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST202']

export async function getOrganizationSenderWorkspace(orgId: string): Promise<OrganizationSenderWorkspace> {
  const context = await requireOrganizationContext(orgId)
  const empty: OrganizationSenderWorkspace = {
    organization: { id: context.organization.id, name: context.organization.name, organizationNumber: context.organization.organizationNumber,
      legalName: null, legalNameVersion: 0 },
    canEdit: context.role === 'admin', migrationRequired: false, profiles: [],
  }
  const db = createSupabaseAdminClient()
  const [organization, profiles] = await Promise.all([
    db.from('organizations').select('legal_name,legal_name_version').eq('id', context.organization.id).single(),
    db.from('organization_sender_profiles').select('id,org_id,version,name,address,postal_code,city,email,phone,website,logo_path,report_footer_text,is_active')
      .eq('org_id', context.organization.id).order('created_at').order('id'),
  ])
  const failures = [organization.error, profiles.error].filter(error => error !== null)
  if (failures.length) {
    if (failures.every(error => migrationCodes.includes(error.code ?? ''))) return { ...empty, migrationRequired: true }
    throw new Error('ORG_REQUEST_FAILED')
  }
  if (!organization.data) throw new Error('ORG_REQUEST_FAILED')
  return { ...empty, organization: { ...empty.organization, legalName: organization.data.legal_name,
    legalNameVersion: Number(organization.data.legal_name_version) }, profiles: (profiles.data ?? []).map(row => ({
    id: row.id, orgId: row.org_id, version: Number(row.version), name: row.name, address: row.address,
    postalCode: row.postal_code, city: row.city, email: row.email, phone: row.phone, website: row.website,
    logoPath: row.logo_path, reportFooterText: row.report_footer_text, isActive: row.is_active,
  })) }
}

export async function saveOrganizationSenderProfile(orgId: string, value: unknown) {
  const context = await requireOrganizationAdmin(orgId)
  const mutation = parseOrganizationSenderMutation(value)
  const db = createSupabaseAdminClient()
  const { data, error } = mutation.action === 'legalName'
    ? await db.rpc('organization_legal_name_save', { p_actor: context.profileId, p_org: context.organization.id,
      p_expected_version: mutation.expectedVersion, p_legal_name: mutation.legalName })
    : await db.rpc('organization_sender_profile_save', { p_actor: context.profileId, p_org: context.organization.id,
      p_id: mutation.id, p_expected_version: mutation.expectedVersion, p_values: mutation.values })
  if (error) {
    if (migrationCodes.includes(error.code ?? '')) throw new Error('ORG_SENDER_SCHEMA_REQUIRED')
    if (/^ORG_[A-Z_]+$/u.test(error.message ?? '')) throw new Error(error.message)
    throw new Error('ORG_REQUEST_FAILED')
  }
  if (data?.saved !== true) throw new Error('ORG_REQUEST_FAILED')
  return { saved: true as const, workspace: await getOrganizationSenderWorkspace(context.organization.id) }
}
