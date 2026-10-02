import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { OrganizationBranding } from './administrationTypes'

const SELECT = 'id,name,organization_number,profile_address,profile_postal_code,profile_city,profile_website,profile_logo_path,profile_report_footer_text,profile_configured,profile_version'

/** Internal reader. Caller must have established membership or a frozen-document context. */
export async function readOrganizationBranding(orgId: string): Promise<OrganizationBranding | null> {
  const { data, error } = await createSupabaseAdminClient().from('organizations').select(SELECT).eq('id', orgId).maybeSingle()
  if (error) {
    // Additive rollout: keep the old document resolver available before migration.
    if (['42703', 'PGRST204'].includes(error.code ?? '')) return null
    throw new Error('ORG_PROFILE_READ_FAILED')
  }
  if (!data) throw new Error('ORG_MEMBERSHIP_REQUIRED')
  return {
    id: data.id, name: data.name, organizationNumber: data.organization_number,
    address: data.profile_address, postalCode: data.profile_postal_code, city: data.profile_city,
    website: data.profile_website, logoPath: data.profile_logo_path, reportFooterText: data.profile_report_footer_text,
    configured: data.profile_configured === true, version: Number(data.profile_version),
  }
}
