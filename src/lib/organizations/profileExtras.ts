import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationContext } from '@/lib/organizations/administration'
import { isCustomerSelectableAddonKey } from '@/lib/assignments/addons'
import {
  parseProfileExtraMutation,
  profileAddonPrice,
  profileExtrasOrgId,
  type AddonEntry,
  type CertificationEntry,
  type ProfileExtrasWorkspace,
  type ProfileExtraSaved,
} from '@/lib/organizations/profileExtrasTypes'

type CatalogRow = { id: string; key: string; name: string; description: string | null }
type CertificationCatalogRow = CatalogRow & {
  category: 'certification' | 'membership'
  requires_number: boolean
  requires_valid_to: boolean
  number_label: string | null
  valid_to_label: string | null
}
type CertificationRow = {
  certification_id: string
  is_enabled: boolean
  number_value: string | null
  valid_to: string | null
}
type AddonRow = {
  addon_service_id: string
  is_enabled: boolean
  price_amount: number | string | null
  currency: string
}
type DatabaseError = { code?: string } | null

const CERTIFICATION_CATALOG = 'id,key,name,description,category,requires_number,requires_valid_to,number_label,valid_to_label'
const ADDON_CATALOG = 'id,key,name,description'
const CERTIFICATION_VALUES = 'certification_id,is_enabled,number_value,valid_to'
const ADDON_VALUES = 'addon_service_id,is_enabled,price_amount,currency'

function databaseError(error: DatabaseError, creating = false) {
  if (!error) return
  if (creating && error.code === '23505') throw new Error('ORG_PROFILE_CARD_CONFLICT')
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) throw new Error('ORG_SCHEMA_REQUIRED')
  throw new Error('ORG_REQUEST_FAILED')
}

function certificationEntry(catalog: CertificationCatalogRow, row?: CertificationRow): CertificationEntry {
  return {
    id: catalog.id, key: catalog.key, name: catalog.name, description: catalog.description,
    exists: Boolean(row), category: catalog.category === 'membership' ? 'membership' : 'certification',
    requiresNumber: catalog.requires_number === true, requiresValidTo: catalog.requires_valid_to === true,
    numberLabel: catalog.number_label, validToLabel: catalog.valid_to_label,
    value: { enabled: row?.is_enabled === true, number: row?.number_value ?? '', date: row?.valid_to ?? '' },
  }
}

function addonEntry(catalog: CatalogRow, row?: AddonRow): AddonEntry {
  return {
    id: catalog.id, key: catalog.key, name: catalog.name, description: catalog.description,
    exists: Boolean(row), currency: row?.currency ?? 'SEK',
    value: { enabled: row?.is_enabled === true, price: row?.price_amount == null ? '' : String(Number(row.price_amount)) },
  }
}

async function contextFor(orgId: unknown) {
  const context = await requireOrganizationContext(profileExtrasOrgId(orgId))
  if (context.migrationRequired) throw new Error('ORG_MIGRATION_REQUIRED')
  return context
}

export async function getProfileExtrasWorkspace(orgId: unknown): Promise<ProfileExtrasWorkspace> {
  const context = await contextFor(orgId)
  const db = createSupabaseAdminClient()
  const [certifications, addons, selectedCertifications, selectedAddons] = await Promise.all([
    db.from('settings_certifications').select(CERTIFICATION_CATALOG).eq('is_active', true).order('sort_order').order('name'),
    db.from('settings_addon_services').select(ADDON_CATALOG).eq('is_active', true).order('sort_order').order('name'),
    db.from('profile_certifications').select(CERTIFICATION_VALUES).eq('org_id', context.organization.id).eq('profile_id', context.profileId),
    db.from('profile_addon_services').select(ADDON_VALUES).eq('org_id', context.organization.id).eq('profile_id', context.profileId),
  ])
  for (const result of [certifications, addons, selectedCertifications, selectedAddons]) databaseError(result.error)
  const certificationsById = new Map((selectedCertifications.data as CertificationRow[] ?? []).map(row => [row.certification_id, row]))
  const addonsById = new Map((selectedAddons.data as AddonRow[] ?? []).map(row => [row.addon_service_id, row]))
  return {
    orgId: context.organization.id, profileId: context.profileId,
    certifications: (certifications.data as CertificationCatalogRow[] ?? []).map(row => certificationEntry(row, certificationsById.get(row.id))),
    addons: (addons.data as CatalogRow[] ?? []).filter(row => isCustomerSelectableAddonKey(row.key))
      .map(row => addonEntry(row, addonsById.get(row.id))),
  }
}

export async function saveProfileExtra(body: unknown): Promise<ProfileExtraSaved> {
  const mutation = parseProfileExtraMutation(body)
  const context = await contextFor(mutation.orgId)
  const db = createSupabaseAdminClient()
  const scope = { org_id: context.organization.id, profile_id: context.profileId }
  const identity = { orgId: context.organization.id, profileId: context.profileId }

  if (mutation.kind === 'certification') {
    const catalogResult = await db.from('settings_certifications').select(CERTIFICATION_CATALOG)
      .eq('id', mutation.id).eq('is_active', true).maybeSingle()
    databaseError(catalogResult.error)
    const catalog = catalogResult.data as CertificationCatalogRow | null
    if (!catalog) throw new Error('ORG_INPUT_INVALID')
    if (mutation.values.enabled && ((catalog.requires_number && !mutation.values.number)
      || (catalog.requires_valid_to && !mutation.values.date))) throw new Error('ORG_INPUT_INVALID')
    const values = {
      is_enabled: mutation.values.enabled,
      number_value: mutation.values.number || null,
      valid_to: mutation.values.date || null,
    }

    let result
    if (mutation.expected === null) {
      result = await db.from('profile_certifications').insert({ ...scope, certification_id: mutation.id, ...values })
        .select(CERTIFICATION_VALUES).maybeSingle()
    } else {
      const currentResult = await db.from('profile_certifications').select(CERTIFICATION_VALUES)
        .eq('org_id', scope.org_id).eq('profile_id', scope.profile_id).eq('certification_id', mutation.id).maybeSingle()
      databaseError(currentResult.error)
      const current = currentResult.data as CertificationRow | null
      if (!current || current.is_enabled !== mutation.expected.enabled
        || (current.number_value ?? '') !== mutation.expected.number || (current.valid_to ?? '') !== mutation.expected.date) {
        throw new Error('ORG_PROFILE_CARD_CONFLICT')
      }
      // Re-check the actual stored values in the UPDATE, closing the race after
      // this read and distinguishing an existing empty string from SQL NULL.
      let query = db.from('profile_certifications').update(values)
        .eq('org_id', scope.org_id).eq('profile_id', scope.profile_id).eq('certification_id', mutation.id)
        .eq('is_enabled', current.is_enabled)
      query = current.number_value === null ? query.is('number_value', null) : query.eq('number_value', current.number_value)
      query = current.valid_to === null ? query.is('valid_to', null) : query.eq('valid_to', current.valid_to)
      result = await query.select(CERTIFICATION_VALUES).maybeSingle()
    }
    databaseError(result.error, mutation.expected === null)
    if (!result.data) throw new Error('ORG_PROFILE_CARD_CONFLICT')
    return { ...identity, kind: mutation.kind, entry: certificationEntry(catalog, result.data as CertificationRow) }
  }

  const catalogResult = await db.from('settings_addon_services').select(ADDON_CATALOG)
    .eq('id', mutation.id).eq('is_active', true).maybeSingle()
  databaseError(catalogResult.error)
  const catalog = catalogResult.data as CatalogRow | null
  if (!catalog || !isCustomerSelectableAddonKey(catalog.key)) throw new Error('ORG_INPUT_INVALID')
  const values = { is_enabled: mutation.values.enabled, price_amount: profileAddonPrice(mutation.values.price) }

  let result
  if (mutation.expected === null) {
    result = await db.from('profile_addon_services').insert({ ...scope, addon_service_id: mutation.id, ...values, currency: 'SEK' })
      .select(ADDON_VALUES).maybeSingle()
  } else {
    const currentResult = await db.from('profile_addon_services').select(ADDON_VALUES)
      .eq('org_id', scope.org_id).eq('profile_id', scope.profile_id).eq('addon_service_id', mutation.id).maybeSingle()
    databaseError(currentResult.error)
    const current = currentResult.data as AddonRow | null
    const expectedPrice = profileAddonPrice(mutation.expected.price)
    const currentPrice = current?.price_amount == null ? null : Number(current.price_amount)
    if (!current || current.is_enabled !== mutation.expected.enabled || currentPrice !== expectedPrice) {
      throw new Error('ORG_PROFILE_CARD_CONFLICT')
    }
    let query = db.from('profile_addon_services').update(values)
      .eq('org_id', scope.org_id).eq('profile_id', scope.profile_id).eq('addon_service_id', mutation.id)
      .eq('is_enabled', current.is_enabled)
    query = currentPrice === null ? query.is('price_amount', null) : query.eq('price_amount', currentPrice)
    // Currency and audit metadata belong to the existing row and are untouched.
    result = await query.select(ADDON_VALUES).maybeSingle()
  }
  databaseError(result.error, mutation.expected === null)
  if (!result.data) throw new Error('ORG_PROFILE_CARD_CONFLICT')
  return { ...identity, kind: mutation.kind, entry: addonEntry(catalog, result.data as AddonRow) }
}
