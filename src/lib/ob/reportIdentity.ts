import 'server-only'
import { requireConfiguredOrganizationProfileCard } from '@/lib/organizations/profileCard'
import { readOrganizationBranding } from '@/lib/organizations/companyProfile'

const identityFields = ['full_name', 'phone', 'email', 'company_name', 'company_orgno',
  'company_address', 'company_postal_code', 'company_city', 'company_website'] as const
type Profile = Record<typeof identityFields[number] | 'logo_path', string | null>

/** Caller must first authorize the inspection's immutable organization binding. */
export async function resolveObReportIdentity(input: {
  orgId: string
  profileId: string
  locked: boolean
  frozenProfile: Record<string, unknown> | null
  frozenCompany: Record<string, unknown> | null
}): Promise<Profile> {
  if (input.locked) {
    // Missing historical fields are deliberately empty, never today's branding.
    // A legacy locked document with no preserved issuer needs manual review.
    if (!input.frozenProfile) throw new Error('OB_FROZEN_IDENTITY_REQUIRED')
    const profile = Object.fromEntries(identityFields.map(key => [key,
      typeof input.frozenProfile?.[key] === 'string' ? input.frozenProfile[key] : null,
    ])) as Omit<Profile, 'logo_path'>
    return { ...profile, logo_path: typeof input.frozenCompany?.logo_url === 'string'
      ? input.frozenCompany.logo_url : null }
  }

  const card = await requireConfiguredOrganizationProfileCard({ orgId: input.orgId, profileId: input.profileId })
  const company = await readOrganizationBranding(input.orgId)
  if (!company?.configured || company.id !== input.orgId || card.orgId !== input.orgId || card.profileId !== input.profileId) {
    throw new Error('ORG_PROFILE_CARD_REQUIRED')
  }
  return {
    full_name: card.displayName, phone: card.phone, email: card.email,
    company_name: company.name, company_orgno: company.organizationNumber,
    company_address: company.address, company_postal_code: company.postalCode,
    company_city: company.city, company_website: company.website, logo_path: company.logoPath,
  }
}
