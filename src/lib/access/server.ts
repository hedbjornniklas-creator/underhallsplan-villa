import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { PlatformModuleKeyMap, PlatformProductKey, PlatformScopeType } from './model'

type SupabaseError = {
  message?: string
  details?: string | null
  hint?: string | null
  code?: string | null
} | null

type SupabaseResponse<T> = Promise<{ data: T | null; error: SupabaseError }>

type QueryBuilder<T = Record<string, unknown>> = {
  then: <TResult1 = { data: T[] | null; error: SupabaseError }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: T[] | null; error: SupabaseError }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => PromiseLike<TResult1 | TResult2>
  select: (columns: string) => QueryBuilder<T>
  eq: (column: string, value: unknown) => QueryBuilder<T>
  order: (
    column: string,
    options?: {
      ascending?: boolean
      nullsFirst?: boolean
    }
  ) => QueryBuilder<T>
  limit: (count: number) => QueryBuilder<T>
  maybeSingle: () => SupabaseResponse<T>
}

type SupabaseAdminClient = {
  from: (table: string) => QueryBuilder
}

type AccessProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  is_admin: boolean | null
}

type PlatformAssignmentRow = {
  id: string
  product_id: string
  module_id: string | null
  role_id: string
  scope_type: string | null
  scope_id: string | null
  expires_at: string | null
  platform_products:
    | {
        key: string | null
        label: string | null
      }
    | Array<{
        key: string | null
        label: string | null
      }>
    | null
  platform_modules:
    | {
        key: string | null
        label: string | null
      }
    | Array<{
        key: string | null
        label: string | null
      }>
    | null
  platform_roles:
    | {
        key: string | null
        label: string | null
      }
    | Array<{
        key: string | null
        label: string | null
      }>
    | null
}

type LegacyBrfMemberRow = {
  id: string
  brf_id: string
  role: 'board' | 'admin'
}

type LegacyOrgMemberRow = {
  id: string
  org_id: string
  role: 'admin' | 'inspector'
}

type RelationValue = Record<string, unknown> | Array<Record<string, unknown>> | null

export type PlatformIdentity = {
  userId: string
  profileId: string
  fullName: string | null
  email: string | null
  isLegacyAdmin: boolean
}

export type PlatformAccessAssignment = {
  id: string
  productId: string
  productKey: PlatformProductKey
  productLabel: string | null
  moduleId: string | null
  moduleKey: string | null
  moduleLabel: string | null
  roleId: string
  roleKey: string | null
  roleLabel: string | null
  scopeType: PlatformScopeType
  scopeId: string | null
  expiresAt: string | null
}

export type PlatformAccessContext = {
  identity: PlatformIdentity
  assignments: PlatformAccessAssignment[]
  normalizedAccessAvailable: boolean
}

export type PlatformEntryProduct = {
  key: PlatformProductKey
  label: string
  description: string
  href: string
}

type AccessCheckInput<TProduct extends PlatformProductKey> = {
  productKey: TProduct
  moduleKey?: PlatformModuleKeyMap[TProduct]
  scopeType?: PlatformScopeType
  scopeId?: string | null
}

const PLATFORM_SCHEMA_MARKERS = [
  'platform_access_assignments',
  'platform_products',
  'platform_modules',
  'platform_roles',
]

const PLATFORM_ENTRY_CONFIG: Record<PlatformProductKey, PlatformEntryProduct> = {
  renoapp: {
    key: 'renoapp',
    label: 'RenoApp',
    description: 'Granska renoveringsansökningar, begär kompletteringar och dokumentera beslut för din BRF.',
    href: '/renoapp/app',
  },
  dashboard: {
    key: 'dashboard',
    label: 'BesiktApp',
    description: 'Skapa uppdrag, genomför besiktningar och tekniska utredningar samt ta fram utlåtanden.',
    href: '/dashboard-v1',
  },
  hushub_admin: {
    key: 'hushub_admin',
    label: 'Administration',
    description: 'Hantera användare, behörigheter och gemensamma inställningar för HusHub.',
    href: '/admin',
  },
}

const PLATFORM_ENTRY_ORDER: PlatformProductKey[] = ['dashboard', 'renoapp', 'hushub_admin']

function parseRelation(value: RelationValue) {
  if (!value) return null
  if (Array.isArray(value)) return (value[0] ?? null) as Record<string, unknown> | null
  return value
}

function isPlatformSchemaMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return PLATFORM_SCHEMA_MARKERS.some((marker) => message.includes(marker))
}

async function requireAuthenticatedIdentity(): Promise<PlatformIdentity> {
  const userClient = createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()

  if (userError || !user) {
    throw new Error('UNAUTHORIZED')
  }

  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data: profileData, error: profileError } = await admin
    .from('profiles')
    .select('id,full_name,email,is_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError && !profileData) {
    throw new Error(profileError.message ?? 'PROFILE_NOT_FOUND')
  }

  const profile = (profileData ?? {
    id: user.id,
    full_name: (user.user_metadata?.full_name as string | null | undefined) ?? null,
    email: user.email ?? null,
    is_admin: false,
  }) as AccessProfileRow

  return {
    userId: user.id,
    profileId: profile.id,
    fullName: profile.full_name ?? null,
    email: profile.email ?? user.email ?? null,
    isLegacyAdmin: Boolean(profile.is_admin),
  }
}

async function loadNormalizedAssignments(profileId: string): Promise<PlatformAccessAssignment[] | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  try {
    const { data, error } = await admin
      .from('platform_access_assignments')
      .select(
        'id,product_id,module_id,role_id,scope_type,scope_id,expires_at,platform_products(key,label),platform_modules(key,label),platform_roles(key,label)'
      )
      .eq('profile_id', profileId)
      .eq('is_active', true)

    if (error) {
      throw new Error(error.message ?? 'Kunde inte läsa platform_access_assignments.')
    }

    const now = Date.now()

    return ((data ?? []) as PlatformAssignmentRow[])
      .map((row) => {
        const product = parseRelation(row.platform_products as RelationValue)
        const moduleItem = parseRelation(row.platform_modules as RelationValue)
        const role = parseRelation(row.platform_roles as RelationValue)

        const productKey = String(product?.key ?? '').trim()
        if (productKey !== 'renoapp' && productKey !== 'dashboard' && productKey !== 'hushub_admin') {
          return null
        }

        if (row.expires_at && new Date(row.expires_at).getTime() < now) {
          return null
        }

        return {
          id: row.id,
          productId: row.product_id,
          productKey,
          productLabel: typeof product?.label === 'string' ? product.label : null,
          moduleId: row.module_id ?? null,
          moduleKey: typeof moduleItem?.key === 'string' ? moduleItem.key : null,
          moduleLabel: typeof moduleItem?.label === 'string' ? moduleItem.label : null,
          roleId: row.role_id,
          roleKey: typeof role?.key === 'string' ? role.key : null,
          roleLabel: typeof role?.label === 'string' ? role.label : null,
          scopeType:
            row.scope_type === 'brf' ||
            row.scope_type === 'organization' ||
            row.scope_type === 'property' ||
            row.scope_type === 'case'
              ? row.scope_type
              : 'global',
          scopeId: row.scope_id ?? null,
          expiresAt: row.expires_at ?? null,
        } satisfies PlatformAccessAssignment
      })
      .filter((item): item is PlatformAccessAssignment => Boolean(item))
  } catch (error) {
    if (isPlatformSchemaMissing(error)) {
      return null
    }
    throw error
  }
}

async function loadLegacyBrfMembership(profileId: string) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin
    .from('brf_members')
    .select('id,brf_id,role')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa BRF-medlemskap.')
  }

  return (data ?? null) as LegacyBrfMemberRow | null
}

async function loadLegacyOrgMembership(profileId: string) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin
    .from('org_members')
    .select('id,org_id,role')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa org_members.')
  }

  return (data ?? null) as LegacyOrgMemberRow | null
}

function hasMatchingNormalizedAccess<TProduct extends PlatformProductKey>(
  assignments: PlatformAccessAssignment[],
  input: AccessCheckInput<TProduct>
) {
  return assignments.some((assignment) => {
    if (assignment.productKey !== input.productKey) return false
    if (input.moduleKey) {
      const matchesExplicitModule = assignment.moduleKey === input.moduleKey
      const matchesImplicitAdminModule =
        !assignment.moduleKey &&
        ((input.productKey === 'dashboard' &&
          input.moduleKey === 'admin' &&
          assignment.roleKey === 'dashboard_admin') ||
          (input.productKey === 'renoapp' &&
            input.moduleKey === 'admin' &&
            assignment.roleKey === 'renoapp_admin'))

      if (!matchesExplicitModule && !matchesImplicitAdminModule) {
        return false
      }
    }
    if (input.scopeType && assignment.scopeType !== input.scopeType) return false
    if (input.scopeId && assignment.scopeId !== input.scopeId) return false
    return true
  })
}

async function hasLegacyAccess<TProduct extends PlatformProductKey>(
  identity: PlatformIdentity,
  input: AccessCheckInput<TProduct>
) {
  if (input.productKey === 'hushub_admin') {
    return identity.isLegacyAdmin
  }

  if (input.productKey === 'renoapp') {
    if (identity.isLegacyAdmin) return true
    const brfMember = await loadLegacyBrfMembership(identity.profileId)
    if (!brfMember) return false
    if (input.scopeType && input.scopeType !== 'brf') return false
    if (input.scopeId && brfMember.brf_id !== input.scopeId) return false
    return true
  }

  if (input.productKey === 'dashboard') {
    if (identity.isLegacyAdmin) return true
    const orgMember = await loadLegacyOrgMembership(identity.profileId)
    if (!orgMember) return false
    if (input.scopeType && input.scopeType !== 'organization') return false
    if (input.scopeId && orgMember.org_id !== input.scopeId) return false
    if (input.moduleKey === 'admin') {
      return orgMember.role === 'admin' || identity.isLegacyAdmin
    }
    if (input.moduleKey === 'tasks') {
      return orgMember.role === 'admin'
    }
    if (input.moduleKey === 'technical_investigations') {
      return false
    }
    return true
  }

  return false
}

async function hasProductAccessInContext(context: PlatformAccessContext, productKey: PlatformProductKey) {
  if (context.assignments.some((item) => item.productKey === productKey)) {
    return true
  }

  if (productKey === 'renoapp' && context.normalizedAccessAvailable && !context.identity.isLegacyAdmin) return false
  return hasLegacyAccess(context.identity, { productKey })
}

export async function getCurrentUserPlatformAccessContext(): Promise<PlatformAccessContext> {
  const identity = await requireAuthenticatedIdentity()
  const assignments = await loadNormalizedAssignments(identity.profileId)

  return {
    identity,
    assignments: assignments ?? [],
    normalizedAccessAvailable: assignments !== null,
  }
}

export async function hasCurrentUserAccess<TProduct extends PlatformProductKey>(
  input: AccessCheckInput<TProduct>
) {
  const context = await getCurrentUserPlatformAccessContext()
  const productAssignments = context.assignments.filter((item) => item.productKey === input.productKey)

  if (productAssignments.length > 0) {
    return hasMatchingNormalizedAccess(productAssignments, input)
  }

  if (input.productKey === 'renoapp' && context.normalizedAccessAvailable && !context.identity.isLegacyAdmin) return false
  return hasLegacyAccess(context.identity, input)
}

export async function getCurrentUserAccessibleProducts(): Promise<PlatformEntryProduct[]> {
  const context = await getCurrentUserPlatformAccessContext()
  const products: PlatformEntryProduct[] = []

  for (const productKey of PLATFORM_ENTRY_ORDER) {
    if (await hasProductAccessInContext(context, productKey)) {
      products.push(PLATFORM_ENTRY_CONFIG[productKey])
    }
  }

  return products
}

export async function resolveCurrentUserEntryDestination() {
  const products = await getCurrentUserAccessibleProducts()

  if (products.length === 0) {
    return null
  }

  if (products.length === 1) {
    return products[0].href
  }

  return '/app'
}

export async function requireProductAccess(productKey: PlatformProductKey) {
  const context = await getCurrentUserPlatformAccessContext()
  const hasAccess = await hasProductAccessInContext(context, productKey)

  if (!hasAccess) {
    throw new Error('PRODUCT_ACCESS_REQUIRED')
  }

  return context
}

export async function requireModuleAccess<TProduct extends PlatformProductKey>(
  input: AccessCheckInput<TProduct> & { moduleKey: PlatformModuleKeyMap[TProduct] }
) {
  const hasAccess = await hasCurrentUserAccess(input)

  if (!hasAccess) {
    throw new Error('MODULE_ACCESS_REQUIRED')
  }

  return getCurrentUserPlatformAccessContext()
}
