import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserPlatformAccessContext } from './server'
import type { PlatformProductKey, PlatformScopeType } from './model'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

type ProductRow = {
  id: string
  key: string
  label: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type ModuleRow = {
  id: string
  product_id: string
  key: string
  label: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type RoleRow = {
  id: string
  product_id: string
  key: string
  label: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  org_name: string | null
  is_admin: boolean | null
}

type AssignmentRow = {
  id: string
  profile_id: string
  product_id: string
  module_id: string | null
  role_id: string
  scope_type: PlatformScopeType
  scope_id: string | null
  is_active: boolean
  granted_reason: string | null
  expires_at: string | null
  created_at: string
}

type BrfRow = {
  id: string
  name: string
  slug: string | null
}

type OrganizationRow = {
  id: string
  name: string
}

export type AccessManagementModule = {
  id: string
  key: string
  label: string
  description: string | null
}

export type AccessManagementRole = {
  id: string
  key: string
  label: string
  description: string | null
}

export type AccessManagementProduct = {
  id: string
  key: PlatformProductKey
  label: string
  description: string | null
  modules: AccessManagementModule[]
  roles: AccessManagementRole[]
}

export type AccessManagementScopeOption = {
  id: string
  label: string
  meta: string | null
}

export type AccessManagementAssignment = {
  id: string
  productId: string
  productKey: PlatformProductKey
  productLabel: string
  moduleId: string | null
  moduleKey: string | null
  moduleLabel: string | null
  roleId: string
  roleKey: string
  roleLabel: string
  scopeType: PlatformScopeType
  scopeId: string | null
  scopeLabel: string
  grantedReason: string | null
  expiresAt: string | null
  createdAt: string
}

export type AccessManagementUser = {
  id: string
  fullName: string | null
  email: string | null
  orgName: string | null
  legacyAdmin: boolean
  productKeys: PlatformProductKey[]
  assignments: AccessManagementAssignment[]
}

export type AccessManagementData = {
  products: AccessManagementProduct[]
  users: AccessManagementUser[]
  scopeOptions: {
    brfs: AccessManagementScopeOption[]
    organizations: AccessManagementScopeOption[]
  }
}

export type SavePlatformAssignmentInput = {
  profileId: string
  productId: string
  moduleId?: string | null
  roleId: string
  scopeType: PlatformScopeType
  scopeId?: string | null
  grantedReason?: string | null
  expiresAt?: string | null
}

const PLATFORM_SCHEMA_MARKERS = [
  'platform_access_assignments',
  'platform_products',
  'platform_modules',
  'platform_roles',
]

function getAdminClient() {
  return createSupabaseAdminClient() as AdminClient
}

function isPlatformSchemaMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return PLATFORM_SCHEMA_MARKERS.some((marker) => message.includes(marker))
}

function toPlatformProductKey(value: string): PlatformProductKey {
  if (value === 'renoapp' || value === 'dashboard' || value === 'hushub_admin') {
    return value
  }
  throw new Error('Ogiltig produktnyckel.')
}

function buildScopeLabel(
  scopeType: PlatformScopeType,
  scopeId: string | null,
  brfMap: Map<string, AccessManagementScopeOption>,
  organizationMap: Map<string, AccessManagementScopeOption>
) {
  if (scopeType === 'global') return 'Global'
  if (scopeType === 'brf') return brfMap.get(scopeId ?? '')?.label ?? `BRF ${scopeId ?? ''}`
  if (scopeType === 'organization') {
    return organizationMap.get(scopeId ?? '')?.label ?? `Organisation ${scopeId ?? ''}`
  }
  if (scopeType === 'property') return `Fastighet ${scopeId ?? ''}`
  return `Ärende ${scopeId ?? ''}`
}

export async function listAccessManagementData(): Promise<AccessManagementData> {
  const admin = getAdminClient()

  try {
    const [
      profileResult,
      productResult,
      moduleResult,
      roleResult,
      assignmentResult,
      brfResult,
      organizationResult,
    ] = await Promise.all([
      admin.from('profiles').select('id,full_name,email,org_name,is_admin').order('full_name', { ascending: true }),
      admin
        .from('platform_products')
        .select('id,key,label,description,sort_order,is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      admin
        .from('platform_modules')
        .select('id,product_id,key,label,description,sort_order,is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      admin
        .from('platform_roles')
        .select('id,product_id,key,label,description,sort_order,is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      admin
        .from('platform_access_assignments')
        .select('id,profile_id,product_id,module_id,role_id,scope_type,scope_id,is_active,granted_reason,expires_at,created_at')
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
      admin.from('brf_associations').select('id,name,slug').order('name', { ascending: true }),
      admin.from('organizations').select('id,name').order('name', { ascending: true }),
    ])

    if (profileResult.error) throw new Error(profileResult.error.message ?? 'Kunde inte läsa användare.')
    if (productResult.error) throw new Error(productResult.error.message ?? 'Kunde inte läsa produkter.')
    if (moduleResult.error) throw new Error(moduleResult.error.message ?? 'Kunde inte läsa moduler.')
    if (roleResult.error) throw new Error(roleResult.error.message ?? 'Kunde inte läsa roller.')
    if (assignmentResult.error) throw new Error(assignmentResult.error.message ?? 'Kunde inte läsa access assignments.')
    if (brfResult.error) throw new Error(brfResult.error.message ?? 'Kunde inte läsa BRF-listan.')
    if (organizationResult.error) {
      throw new Error(organizationResult.error.message ?? 'Kunde inte läsa organisationslistan.')
    }

    const profiles = ((profileResult.data ?? []) as ProfileRow[]).sort((a, b) => {
      const aLabel = (a.full_name ?? a.email ?? '').toLowerCase()
      const bLabel = (b.full_name ?? b.email ?? '').toLowerCase()
      return aLabel.localeCompare(bLabel, 'sv')
    })
    const products = (productResult.data ?? []) as ProductRow[]
    const modules = (moduleResult.data ?? []) as ModuleRow[]
    const roles = (roleResult.data ?? []) as RoleRow[]
    const assignments = (assignmentResult.data ?? []) as AssignmentRow[]
    const brfs = (brfResult.data ?? []) as BrfRow[]
    const organizations = (organizationResult.data ?? []) as OrganizationRow[]

    const moduleMap = new Map(modules.map((item) => [item.id, item]))
    const roleMap = new Map(roles.map((item) => [item.id, item]))
    const productMap = new Map(products.map((item) => [item.id, item]))

    const brfOptions = brfs.map((item) => ({
      id: item.id,
      label: item.name,
      meta: item.slug ?? null,
    }))
    const organizationOptions = organizations.map((item) => ({
      id: item.id,
      label: item.name,
      meta: null,
    }))
    const brfMap = new Map(brfOptions.map((item) => [item.id, item]))
    const organizationMap = new Map(organizationOptions.map((item) => [item.id, item]))

    const productItems: AccessManagementProduct[] = products.map((product) => ({
      id: product.id,
      key: toPlatformProductKey(product.key),
      label: product.label,
      description: product.description ?? null,
      modules: modules
        .filter((item) => item.product_id === product.id)
        .map((item) => ({
          id: item.id,
          key: item.key,
          label: item.label,
          description: item.description ?? null,
        })),
      roles: roles
        .filter((item) => item.product_id === product.id)
        .map((item) => ({
          id: item.id,
          key: item.key,
          label: item.label,
          description: item.description ?? null,
        })),
    }))

    const users: AccessManagementUser[] = profiles.map((profile) => {
      const userAssignments = assignments
        .filter((assignment) => assignment.profile_id === profile.id)
        .map((assignment) => {
          const product = productMap.get(assignment.product_id)
          const moduleItem = assignment.module_id ? moduleMap.get(assignment.module_id) ?? null : null
          const role = roleMap.get(assignment.role_id)

          if (!product || !role) {
            return null
          }

          return {
            id: assignment.id,
            productId: product.id,
            productKey: toPlatformProductKey(product.key),
            productLabel: product.label,
            moduleId: moduleItem?.id ?? null,
            moduleKey: moduleItem?.key ?? null,
            moduleLabel: moduleItem?.label ?? null,
            roleId: role.id,
            roleKey: role.key,
            roleLabel: role.label,
            scopeType: assignment.scope_type,
            scopeId: assignment.scope_id ?? null,
            scopeLabel: buildScopeLabel(
              assignment.scope_type,
              assignment.scope_id ?? null,
              brfMap,
              organizationMap
            ),
            grantedReason: assignment.granted_reason ?? null,
            expiresAt: assignment.expires_at ?? null,
            createdAt: assignment.created_at,
          } satisfies AccessManagementAssignment
        })
        .filter((item): item is AccessManagementAssignment => Boolean(item))
        .sort((a, b) => {
          const aLabel = `${a.productLabel} ${a.moduleLabel ?? ''} ${a.roleLabel} ${a.scopeLabel}`.toLowerCase()
          const bLabel = `${b.productLabel} ${b.moduleLabel ?? ''} ${b.roleLabel} ${b.scopeLabel}`.toLowerCase()
          return aLabel.localeCompare(bLabel, 'sv')
        })

      const productKeys = Array.from(new Set(userAssignments.map((item) => item.productKey)))

      return {
        id: profile.id,
        fullName: profile.full_name ?? null,
        email: profile.email ?? null,
        orgName: profile.org_name ?? null,
        legacyAdmin: Boolean(profile.is_admin),
        productKeys,
        assignments: userAssignments,
      }
    })

    return {
      products: productItems,
      users,
      scopeOptions: {
        brfs: brfOptions,
        organizations: organizationOptions,
      },
    }
  } catch (error) {
    if (isPlatformSchemaMissing(error)) {
      throw new Error('ACCESS_SCHEMA_REQUIRED')
    }
    throw error
  }
}

export async function savePlatformAssignment(input: SavePlatformAssignmentInput) {
  const admin = getAdminClient()
  const context = await getCurrentUserPlatformAccessContext()
  const scopeType = input.scopeType
  const scopeId = scopeType === 'global' ? null : (input.scopeId ?? '').trim() || null
  const grantedReason = (input.grantedReason ?? '').trim() || null
  const expiresAt = (input.expiresAt ?? '').trim() || null

  if (scopeType !== 'global' && !scopeId) {
    throw new Error('Scope krävs för vald scopetyp.')
  }

  const [productResult, roleResult, moduleResult] = await Promise.all([
    admin.from('platform_products').select('id,key,label').eq('id', input.productId).maybeSingle(),
    admin.from('platform_roles').select('id,product_id,key,label').eq('id', input.roleId).maybeSingle(),
    input.moduleId
      ? admin.from('platform_modules').select('id,product_id,key,label').eq('id', input.moduleId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (productResult.error || !productResult.data) {
    throw new Error(productResult.error?.message ?? 'Kunde inte hitta vald produkt.')
  }
  if (roleResult.error || !roleResult.data) {
    throw new Error(roleResult.error?.message ?? 'Kunde inte hitta vald roll.')
  }
  if (moduleResult.error) {
    throw new Error(moduleResult.error.message ?? 'Kunde inte hitta vald modul.')
  }

  if (roleResult.data.product_id !== input.productId) {
    throw new Error('Vald roll tillhör inte vald produkt.')
  }
  if (moduleResult.data && moduleResult.data.product_id !== input.productId) {
    throw new Error('Vald modul tillhör inte vald produkt.')
  }

  let existingQuery = admin
    .from('platform_access_assignments')
    .select('id')
    .eq('profile_id', input.profileId)
    .eq('product_id', input.productId)
    .eq('role_id', input.roleId)
    .eq('scope_type', scopeType)

  existingQuery = input.moduleId
    ? existingQuery.eq('module_id', input.moduleId)
    : existingQuery.is('module_id', null)
  existingQuery =
    scopeType === 'global' ? existingQuery.is('scope_id', null) : existingQuery.eq('scope_id', scopeId)

  const existingResult = await existingQuery.maybeSingle()
  if (existingResult.error) {
    throw new Error(existingResult.error.message ?? 'Kunde inte kontrollera befintlig assignment.')
  }

  const payload = {
    profile_id: input.profileId,
    product_id: input.productId,
    module_id: input.moduleId ?? null,
    role_id: input.roleId,
    scope_type: scopeType,
    scope_id: scopeId,
    is_active: true,
    granted_by_profile_id: context.identity.profileId,
    granted_reason: grantedReason,
    expires_at: expiresAt,
    source_system: 'admin_access_management',
  }

  if (existingResult.data?.id) {
    const { error: updateError } = await admin
      .from('platform_access_assignments')
      .update(payload)
      .eq('id', existingResult.data.id)

    if (updateError) {
      throw new Error(updateError.message ?? 'Kunde inte uppdatera assignment.')
    }
  } else {
    const { error: insertError } = await admin.from('platform_access_assignments').insert(payload)

    if (insertError) {
      throw new Error(insertError.message ?? 'Kunde inte skapa assignment.')
    }
  }
}

export async function deactivatePlatformAssignment(assignmentId: string) {
  const admin = getAdminClient()
  const { error } = await admin
    .from('platform_access_assignments')
    .update({ is_active: false })
    .eq('id', assignmentId)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte inaktivera assignment.')
  }
}
