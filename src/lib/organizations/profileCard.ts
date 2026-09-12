import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type {
  OrganizationProfileWorkspace,
  OrganizationProfileCardValues,
  ResolvedOrganizationProfileCard,
} from '@/lib/organizations/profileCardTypes'

type LegacyProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  avatar_path: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  logo_path: string | null
  signature_path: string | null
}

type OrganizationProfileCardRow = {
  id: string
  org_id: string
  profile_id: string
  display_name: string
  title: string | null
  phone: string | null
  email: string | null
  company_name: string
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  avatar_path: string | null
  logo_path: string | null
  signature_path: string | null
  report_footer_text: string | null
  version: number
  created_at: string | null
  updated_at: string | null
}

type MembershipRow = {
  org_id: string
  is_default: boolean
}

type DatabaseError = {
  code?: string | null
  message?: string | null
}

type OrganizationProfileMediaField = 'avatarPath' | 'logoPath' | 'signaturePath'

const ORGANIZATION_PROFILE_MEDIA_FIELDS = [
  'avatarPath',
  'logoPath',
  'signaturePath',
] as const satisfies readonly OrganizationProfileMediaField[]

const ORGANIZATION_PROFILE_MEDIA_FILE_PATTERNS = {
  avatarPath:
    /^avatarPath-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/u,
  logoPath:
    /^logoPath-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/u,
  signaturePath:
    /^signaturePath-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/u,
} as const satisfies Record<OrganizationProfileMediaField, RegExp>

function clean(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || null
}

function assertOrganizationProfileMediaPaths(input: {
  orgId: string
  profileId: string
  current: ResolvedOrganizationProfileCard
  values: OrganizationProfileCardValues
}) {
  const storagePrefix = `profiles/${input.profileId}/organizations/${input.orgId}/`

  for (const field of ORGANIZATION_PROFILE_MEDIA_FIELDS) {
    const nextPath = input.values[field]
    if (nextPath === null || nextPath === input.current[field]) continue
    if (
      typeof nextPath !== 'string' ||
      !nextPath.startsWith(storagePrefix) ||
      !ORGANIZATION_PROFILE_MEDIA_FILE_PATTERNS[field].test(
        nextPath.slice(storagePrefix.length)
      )
    ) {
      throw new Error('ORG_PROFILE_CARD_INPUT_INVALID')
    }
  }
}

function isMissingProfileCardTable(error: DatabaseError | null | undefined) {
  const message = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return (
    message.includes('42p01') ||
    message.includes('pgrst205') ||
    (message.includes('profile_org_cards') &&
      (message.includes('does not exist') || message.includes('schema cache')))
  )
}

function legacyValues(profile: LegacyProfileRow): OrganizationProfileCardValues {
  return {
    displayName: clean(profile.full_name) ?? clean(profile.email) ?? 'Besiktningsman',
    title: null,
    phone: clean(profile.phone),
    email: clean(profile.email)?.toLowerCase() ?? null,
    companyName: clean(profile.company_name) ?? 'Organisation',
    companyOrgNo: clean(profile.company_orgno),
    companyAddress: clean(profile.company_address),
    companyPostalCode: clean(profile.company_postal_code),
    companyCity: clean(profile.company_city),
    avatarPath: clean(profile.avatar_path),
    logoPath: clean(profile.logo_path),
    signaturePath: clean(profile.signature_path),
    reportFooterText: null,
  }
}

function unconfiguredValues(profile: LegacyProfileRow): OrganizationProfileCardValues {
  return {
    displayName: clean(profile.full_name) ?? clean(profile.email) ?? 'Besiktningsman',
    title: null,
    phone: null,
    email: null,
    companyName: '',
    companyOrgNo: null,
    companyAddress: null,
    companyPostalCode: null,
    companyCity: null,
    avatarPath: null,
    logoPath: null,
    signaturePath: null,
    reportFooterText: null,
  }
}

function rowValues(row: OrganizationProfileCardRow): OrganizationProfileCardValues {
  return {
    displayName: row.display_name,
    title: row.title,
    phone: row.phone,
    email: row.email,
    companyName: row.company_name,
    companyOrgNo: row.company_orgno,
    companyAddress: row.company_address,
    companyPostalCode: row.company_postal_code,
    companyCity: row.company_city,
    avatarPath: row.avatar_path,
    logoPath: row.logo_path,
    signaturePath: row.signature_path,
    reportFooterText: row.report_footer_text,
  }
}

export async function resolveOrganizationProfileCard(input: {
  orgId: string
  profileId: string
}): Promise<ResolvedOrganizationProfileCard> {
  const admin = createSupabaseAdminClient()

  const [profileResult, cardResult, membershipsResult] = await Promise.all([
    admin
      .from('profiles')
      .select(
        'id,full_name,email,phone,avatar_path,company_name,company_orgno,company_address,company_postal_code,company_city,logo_path,signature_path'
      )
      .eq('id', input.profileId)
      .maybeSingle(),
    admin
      .from('profile_org_cards')
      .select(
        'id,org_id,profile_id,display_name,title,phone,email,company_name,company_orgno,company_address,company_postal_code,company_city,avatar_path,logo_path,signature_path,report_footer_text,version,created_at,updated_at'
      )
      .eq('org_id', input.orgId)
      .eq('profile_id', input.profileId)
      .maybeSingle(),
    admin
      .from('org_members')
      .select('org_id,is_default')
      .eq('profile_id', input.profileId)
      .eq('is_active', true),
  ])

  if (profileResult.error || !profileResult.data) {
    throw new Error(profileResult.error?.message ?? 'ORG_PROFILE_NOT_FOUND')
  }
  if (membershipsResult.error) {
    throw new Error(membershipsResult.error.message ?? 'ORG_MEMBERSHIP_REQUIRED')
  }

  const migrationRequired = isMissingProfileCardTable(cardResult.error)
  if (cardResult.error && !migrationRequired) {
    throw new Error(cardResult.error.message ?? 'ORG_PROFILE_CARD_READ_FAILED')
  }

  const profile = profileResult.data as LegacyProfileRow
  const row = migrationRequired ? null : cardResult.data as OrganizationProfileCardRow | null
  const memberships = (membershipsResult.data ?? []) as MembershipRow[]
  const selectedMembership = memberships.find((membership) => membership.org_id === input.orgId)
  if (!selectedMembership) throw new Error('ORG_MEMBERSHIP_REQUIRED')

  if (row) {
    return {
      id: row.id,
      orgId: input.orgId,
      profileId: input.profileId,
      source: 'organization_card',
      configured: true,
      migrationRequired: false,
      isDefaultOrganization: selectedMembership.is_default,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...rowValues(row),
    }
  }

  // Legacy profile branding is shown only while the new table is unavailable
  // and the person belongs to exactly one active organization. Once SQL 07 is
  // installed, a missing row is deliberately unconfigured so mutable global
  // branding can never enter a newly frozen document.
  const legacyFallbackAllowed = migrationRequired && memberships.length === 1
  const values = legacyFallbackAllowed ? legacyValues(profile) : unconfiguredValues(profile)

  return {
    id: null,
    orgId: input.orgId,
    profileId: input.profileId,
    source: legacyFallbackAllowed ? 'legacy_profile' : 'unconfigured',
    configured: legacyFallbackAllowed,
    migrationRequired,
    isDefaultOrganization: selectedMembership.is_default,
    version: null,
    createdAt: null,
    updatedAt: null,
    ...values,
  }
}

export async function requireConfiguredOrganizationProfileCard(input: {
  orgId: string
  profileId: string
}) {
  const card = await resolveOrganizationProfileCard(input)
  if (card.migrationRequired) {
    throw new Error('ORG_PROFILE_CARD_MIGRATION_REQUIRED')
  }
  if (
    card.source !== 'organization_card' ||
    !card.configured ||
    !clean(card.companyName)
  ) {
    throw new Error('ORG_PROFILE_CARD_REQUIRED')
  }
  return card
}

export async function getOrganizationProfileWorkspace(input: {
  orgId: string
  orgName: string | null
  profileId: string
  role: 'admin' | 'inspector'
}): Promise<OrganizationProfileWorkspace> {
  const resolved = await resolveOrganizationProfileCard(input)
  const card: OrganizationProfileCardValues = {
    displayName: resolved.displayName,
    title: resolved.title,
    phone: resolved.phone,
    email: resolved.email,
    companyName:
      resolved.source === 'unconfigured' && !resolved.companyName
        ? clean(input.orgName) ?? ''
        : resolved.companyName,
    companyOrgNo: resolved.companyOrgNo,
    companyAddress: resolved.companyAddress,
    companyPostalCode: resolved.companyPostalCode,
    companyCity: resolved.companyCity,
    avatarPath: resolved.avatarPath,
    logoPath: resolved.logoPath,
    signaturePath: resolved.signaturePath,
    reportFooterText: resolved.reportFooterText,
  }

  return {
    profileId: input.profileId,
    organization: {
      id: input.orgId,
      name: input.orgName,
      isDefault: resolved.isDefaultOrganization,
    },
    role: input.role,
    configured: resolved.configured,
    migrationRequired: resolved.migrationRequired,
    version: resolved.version,
    source: resolved.source,
    card,
  }
}

export async function saveOrganizationProfileCard(input: {
  orgId: string
  profileId: string
  actorProfileId: string
  expectedVersion: number | null
  values: OrganizationProfileCardValues
}) {
  const admin = createSupabaseAdminClient()
  const current = await resolveOrganizationProfileCard({
    orgId: input.orgId,
    profileId: input.profileId,
  })
  if (current.migrationRequired) {
    throw new Error('ORG_PROFILE_CARD_MIGRATION_REQUIRED')
  }
  if (current.version !== input.expectedVersion) {
    throw new Error('ORG_PROFILE_CARD_CONFLICT')
  }
  if (input.actorProfileId !== input.profileId) {
    const { data: actorMembership, error: actorMembershipError } = await admin
      .from('org_members')
      .select('role,is_active')
      .eq('org_id', input.orgId)
      .eq('profile_id', input.actorProfileId)
      .maybeSingle()
    if (
      actorMembershipError ||
      !actorMembership ||
      actorMembership.is_active !== true ||
      actorMembership.role !== 'admin'
    ) {
      throw new Error('ORG_PROFILE_CARD_ADMIN_REQUIRED')
    }
  }
  assertOrganizationProfileMediaPaths({
    orgId: input.orgId,
    profileId: input.profileId,
    current,
    values: input.values,
  })

  const values = {
    display_name: input.values.displayName,
    title: input.values.title,
    phone: input.values.phone,
    email: input.values.email,
    company_name: input.values.companyName,
    company_orgno: input.values.companyOrgNo,
    company_address: input.values.companyAddress,
    company_postal_code: input.values.companyPostalCode,
    company_city: input.values.companyCity,
    avatar_path: input.values.avatarPath,
    logo_path: input.values.logoPath,
    signature_path: input.values.signaturePath,
    report_footer_text: input.values.reportFooterText,
    updated_by_profile_id: input.actorProfileId,
  }
  const result = input.expectedVersion === null
    ? await admin
        .from('profile_org_cards')
        .insert({
          org_id: input.orgId,
          profile_id: input.profileId,
          ...values,
          created_by_profile_id: input.actorProfileId,
        })
        .select('id')
        .single()
    : await admin
        .from('profile_org_cards')
        .update(values)
        .eq('org_id', input.orgId)
        .eq('profile_id', input.profileId)
        .eq('version', input.expectedVersion)
        .select('id')
        .maybeSingle()

  if (result.error) {
    if (isMissingProfileCardTable(result.error)) {
      throw new Error('ORG_PROFILE_CARD_MIGRATION_REQUIRED')
    }
    if (result.error.code === '23505') throw new Error('ORG_PROFILE_CARD_CONFLICT')
    throw new Error(result.error.message ?? 'ORG_PROFILE_CARD_SAVE_FAILED')
  }
  if (!result.data) throw new Error('ORG_PROFILE_CARD_CONFLICT')

  return resolveOrganizationProfileCard({ orgId: input.orgId, profileId: input.profileId })
}
