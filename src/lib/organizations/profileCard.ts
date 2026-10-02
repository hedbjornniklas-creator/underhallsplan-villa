import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { readOrganizationBranding } from '@/lib/organizations/companyProfile'
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

const MAX_IMPORTED_MEDIA_SIZE = 5 * 1024 * 1024
const LEGACY_PUBLIC_MEDIA_PREFIX = '/storage/v1/object/public/property-media/'

function importableLegacyMediaPath(value: string | null | undefined) {
  const storedValue = clean(value)
  if (!storedValue) return null

  let path = storedValue
  if (/^[a-z][a-z0-9+.-]*:/iu.test(storedValue)) {
    const supabaseUrl = clean(process.env.NEXT_PUBLIC_SUPABASE_URL)
    if (!supabaseUrl) return null
    try {
      const sourceUrl = new URL(storedValue)
      const expectedOrigin = new URL(supabaseUrl).origin
      if (
        sourceUrl.protocol !== 'https:'
        || sourceUrl.origin !== expectedOrigin
        || !sourceUrl.pathname.startsWith(LEGACY_PUBLIC_MEDIA_PREFIX)
      ) {
        return null
      }
      path = decodeURIComponent(sourceUrl.pathname.slice(LEGACY_PUBLIC_MEDIA_PREFIX.length))
    } catch {
      return null
    }
  }

  return (
    path
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.split('/').includes('..')
    && !path.includes('/organizations/')
  ) ? path : null
}

function legacyMediaAvailability(profile: LegacyProfileRow) {
  return {
    avatarPath: Boolean(importableLegacyMediaPath(profile.avatar_path)),
    logoPath: Boolean(importableLegacyMediaPath(profile.logo_path)),
    signaturePath: Boolean(importableLegacyMediaPath(profile.signature_path)),
  }
}

function detectStoredImage(buffer: Buffer) {
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return { extension: 'png', contentType: 'image/png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' }
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' }
  }
  return null
}

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
  const availableLegacyMedia = legacyMediaAvailability(profile)
  const company = await readOrganizationBranding(input.orgId)
  const sharedValues = company ? {
    companyName: company.name,
    companyOrgNo: company.organizationNumber,
    companyAddress: company.address,
    companyPostalCode: company.postalCode,
    companyCity: company.city,
    logoPath: company.logoPath,
    reportFooterText: company.reportFooterText,
  } : {}
  // Corporate branding is resolved once per organization; personal card values
  // cannot override it. Existing frozen document snapshots use their own values.
  if (company) availableLegacyMedia.logoPath = false

  if (row) {
    return {
      id: row.id,
      orgId: input.orgId,
      profileId: input.profileId,
      source: 'organization_card',
      configured: company ? company.configured : true,
      sharedCompany: Boolean(company),
      companyConfigured: company?.configured ?? false,
      migrationRequired: false,
      isDefaultOrganization: selectedMembership.is_default,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      legacyMediaAvailable: availableLegacyMedia,
      ...rowValues(row),
      ...sharedValues,
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
    sharedCompany: Boolean(company),
    companyConfigured: company?.configured ?? false,
    migrationRequired,
    isDefaultOrganization: selectedMembership.is_default,
    version: null,
    createdAt: null,
    updatedAt: null,
    legacyMediaAvailable: availableLegacyMedia,
    ...values,
    ...sharedValues,
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
    sharedCompany: resolved.sharedCompany,
    companyConfigured: resolved.companyConfigured,
    profileId: input.profileId,
    organization: {
      id: input.orgId,
      name: input.orgName,
      isDefault: resolved.isDefaultOrganization,
    },
    role: input.role,
    configured: resolved.configured,
    migrationRequired: resolved.migrationRequired || !resolved.sharedCompany,
    version: resolved.version,
    source: resolved.source,
    legacyMediaAvailable: resolved.legacyMediaAvailable,
    card,
  }
}

export async function importLegacyOrganizationProfileMedia(input: {
  orgId: string
  profileId: string
  actorProfileId: string
  expectedVersion: number
}) {
  const admin = createSupabaseAdminClient()
  const current = await resolveOrganizationProfileCard({
    orgId: input.orgId,
    profileId: input.profileId,
  })
  if (current.migrationRequired) throw new Error('ORG_PROFILE_CARD_MIGRATION_REQUIRED')
  if (current.source !== 'organization_card' || current.version === null) {
    throw new Error('ORG_PROFILE_CARD_REQUIRED')
  }
  if (current.version !== input.expectedVersion) throw new Error('ORG_PROFILE_CARD_CONFLICT')
  if (input.actorProfileId !== input.profileId) {
    throw new Error('ORG_PROFILE_CARD_ADMIN_REQUIRED')
  }

  const { data: profileData, error: profileError } = await admin
    .from('profiles')
    .select('avatar_path,logo_path,signature_path')
    .eq('id', input.profileId)
    .maybeSingle()
  if (profileError || !profileData) {
    throw new Error(profileError?.message ?? 'ORG_PROFILE_NOT_FOUND')
  }

  const legacyPaths = {
    avatarPath: importableLegacyMediaPath(
      (profileData as Pick<LegacyProfileRow, 'avatar_path'>).avatar_path
    ),
    logoPath: importableLegacyMediaPath(
      (profileData as Pick<LegacyProfileRow, 'logo_path'>).logo_path
    ),
    signaturePath: importableLegacyMediaPath(
      (profileData as Pick<LegacyProfileRow, 'signature_path'>).signature_path
    ),
  }
  const fields = ORGANIZATION_PROFILE_MEDIA_FIELDS.filter((field) => (
    field !== 'logoPath' && !current[field] && Boolean(legacyPaths[field])
  ))
  if (fields.length === 0) throw new Error('ORG_PROFILE_CARD_LEGACY_MEDIA_NOT_FOUND')

  const bucket = admin.storage.from('property-media')
  const importedPaths: Partial<Record<OrganizationProfileMediaField, string>> = {}
  const uploadedPaths: string[] = []
  try {
    for (const field of fields) {
      const sourcePath = legacyPaths[field]!
      const { data, error } = await bucket.download(sourcePath)
      if (error || !data || data.size <= 0 || data.size > MAX_IMPORTED_MEDIA_SIZE) {
        throw new Error('ORG_PROFILE_CARD_LEGACY_MEDIA_INVALID')
      }
      const buffer = Buffer.from(await data.arrayBuffer())
      const detected = detectStoredImage(buffer)
      if (!detected) throw new Error('ORG_PROFILE_CARD_LEGACY_MEDIA_INVALID')

      const storagePath = [
        'profiles',
        input.profileId,
        'organizations',
        input.orgId,
        `${field}-${crypto.randomUUID()}.${detected.extension}`,
      ].join('/')
      const { error: uploadError } = await bucket.upload(storagePath, buffer, {
        cacheControl: '31536000',
        contentType: detected.contentType,
        upsert: false,
      })
      if (uploadError) throw uploadError
      importedPaths[field] = storagePath
      uploadedPaths.push(storagePath)
    }

    const values: OrganizationProfileCardValues = {
      displayName: current.displayName,
      title: current.title,
      phone: current.phone,
      email: current.email,
      companyName: current.companyName,
      companyOrgNo: current.companyOrgNo,
      companyAddress: current.companyAddress,
      companyPostalCode: current.companyPostalCode,
      companyCity: current.companyCity,
      avatarPath: importedPaths.avatarPath ?? current.avatarPath,
      logoPath: importedPaths.logoPath ?? current.logoPath,
      signaturePath: importedPaths.signaturePath ?? current.signaturePath,
      reportFooterText: current.reportFooterText,
    }
    return await saveOrganizationProfileCard({
      orgId: input.orgId,
      profileId: input.profileId,
      actorProfileId: input.actorProfileId,
      expectedVersion: input.expectedVersion,
      values,
    })
  } catch (error) {
    if (uploadedPaths.length > 0) await bucket.remove(uploadedPaths).catch(() => undefined)
    throw error
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
  if (!current.sharedCompany) throw new Error('ORG_PROFILE_CARD_MIGRATION_REQUIRED')
  if (current.version !== input.expectedVersion) {
    throw new Error('ORG_PROFILE_CARD_CONFLICT')
  }
  if (input.actorProfileId !== input.profileId) throw new Error('ORG_PROFILE_CARD_ADMIN_REQUIRED')
  const corporateFields = ['companyName', 'companyOrgNo', 'companyAddress', 'companyPostalCode', 'companyCity', 'logoPath', 'reportFooterText'] as const
  if (corporateFields.some(field => input.values[field] !== current[field])) throw new Error('ORG_COMPANY_FIELDS_READ_ONLY')
  assertOrganizationProfileMediaPaths({
    orgId: input.orgId,
    profileId: input.profileId,
    current,
    values: input.values,
  })

  const values = {
    displayName: input.values.displayName,
    title: input.values.title,
    phone: input.values.phone,
    email: input.values.email,
    avatarPath: input.values.avatarPath,
    signaturePath: input.values.signaturePath,
  }
  const result = await admin.rpc('organization_member_profile_save', {
    p_actor: input.actorProfileId, p_org: input.orgId,
    p_expected_version: input.expectedVersion ?? 0, p_values: values,
  })

  if (result.error) {
    if (result.error.message === 'ORG_CONFLICT') throw new Error('ORG_PROFILE_CARD_CONFLICT')
    if (result.error.message === 'ORG_MEMBERSHIP_REQUIRED') throw new Error('ORG_MEMBERSHIP_REQUIRED')
    if (isMissingProfileCardTable(result.error)) {
      throw new Error('ORG_PROFILE_CARD_MIGRATION_REQUIRED')
    }
    if (result.error.code === '23505') throw new Error('ORG_PROFILE_CARD_CONFLICT')
    throw new Error(result.error.message ?? 'ORG_PROFILE_CARD_SAVE_FAILED')
  }
  if (!result.data) throw new Error('ORG_PROFILE_CARD_CONFLICT')

  return resolveOrganizationProfileCard({ orgId: input.orgId, profileId: input.profileId })
}
