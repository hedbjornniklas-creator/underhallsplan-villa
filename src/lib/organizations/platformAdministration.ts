import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireModuleAccess } from '@/lib/access/server'
import {
  parsePlatformOrganizationCreate, parsePlatformOrganizationId,
  parsePlatformOrganizationMember, parsePlatformOrganizationModules,
  type PlatformOrganizationDirectory, type PlatformOrganizationDetail,
} from '@/lib/organizations/platformAdministrationTypes'
import { ORGANIZATION_MODULE_OPTIONS, SUPPORTED_ORGANIZATION_MODULES } from '@/lib/organizations/supportedModules'

type DbError = { code?: string; message?: string } | null
const ACCESS = { productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' } as const
const PAGE_SIZE = 500

function check(error: DbError) {
  if (!error) return
  if (['42P01', '42703', 'PGRST205', 'PGRST202'].includes(error.code ?? '')) throw new Error('ORG_SCHEMA_REQUIRED')
  if (/^ORG_[A-Z_]+$/u.test(error.message ?? '')) throw new Error(error.message)
  throw new Error('ORG_REQUEST_FAILED')
}

// Supabase's default row cap must never silently omit organizations or members.
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError }>) {
  const rows: T[] = []
  for (let offset = 0; offset < 50000; offset += PAGE_SIZE) {
    const result = await page(offset, offset + PAGE_SIZE - 1)
    check(result.error)
    rows.push(...(result.data ?? []))
    if ((result.data?.length ?? 0) < PAGE_SIZE) return rows
  }
  throw new Error('ORG_DIRECTORY_TOO_LARGE')
}

function relation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return relation(value[0])
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export async function listPlatformOrganizations(): Promise<PlatformOrganizationDirectory> {
  await requireModuleAccess(ACCESS)
  const db = createSupabaseAdminClient()
  const [organizations, users, members, enabled] = await Promise.all([
    readAll((from, to) => db.from('organizations').select('id,name,organization_number').order('name').order('id').range(from, to)),
    readAll((from, to) => db.from('profiles').select('id,full_name,email').order('full_name').order('id').range(from, to)),
    readAll((from, to) => db.from('org_members').select('org_id,profile_id,role').eq('is_active', true).order('org_id').order('profile_id').range(from, to)),
    readAll((from, to) => db.from('organization_enabled_modules').select('org_id,module_key,is_active')
      .in('module_key', [...SUPPORTED_ORGANIZATION_MODULES]).order('org_id').order('module_key').range(from, to)),
  ])
  const counts = new Map<string, { activeMemberCount: number; activeAdminCount: number }>()
  for (const member of members) {
    const count = counts.get(member.org_id) ?? { activeMemberCount: 0, activeAdminCount: 0 }
    count.activeMemberCount++
    if (member.role === 'admin') count.activeAdminCount++
    counts.set(member.org_id, count)
  }
  const managedByOrg = new Map<string, Set<string>>()
  const enabledByOrg = new Map<string, Set<string>>()
  for (const row of enabled) {
    const managed = managedByOrg.get(row.org_id) ?? new Set<string>()
    managed.add(row.module_key)
    managedByOrg.set(row.org_id, managed)
    if (row.is_active) {
      const active = enabledByOrg.get(row.org_id) ?? new Set<string>()
      active.add(row.module_key)
      enabledByOrg.set(row.org_id, active)
    }
  }
  return {
    organizations: organizations.map(row => ({ id: row.id, name: row.name, organizationNumber: row.organization_number,
      modules: ORGANIZATION_MODULE_OPTIONS.filter(module => enabledByOrg.get(row.id)?.has(module.key)).map(module => module.key),
      managedModules: ORGANIZATION_MODULE_OPTIONS.filter(module => managedByOrg.get(row.id)?.has(module.key)).map(module => module.key),
      tuManaged: managedByOrg.get(row.id)?.has('technical_investigations') ?? false,
      ...(counts.get(row.id) ?? { activeMemberCount: 0, activeAdminCount: 0 }),
    })),
    users: users.map(row => ({ id: row.id, fullName: row.full_name, email: row.email })),
  }
}

export async function getPlatformOrganization(orgId: unknown): Promise<PlatformOrganizationDetail> {
  await requireModuleAccess(ACCESS)
  const id = parsePlatformOrganizationId(orgId)
  const db = createSupabaseAdminClient()
  const [organization, enabled, members, grants] = await Promise.all([
    db.from('organizations').select('id,name,organization_number').eq('id', id).maybeSingle(),
    db.from('organization_enabled_modules').select('module_key,is_active').eq('org_id', id)
      .in('module_key', [...SUPPORTED_ORGANIZATION_MODULES]),
    readAll((from, to) => db.from('org_members').select('profile_id,role,is_active,profile:profiles(full_name,email)')
      .eq('org_id', id).order('created_at').order('profile_id').range(from, to)),
    readAll((from, to) => db.from('platform_access_assignments')
      .select('id,profile_id,expires_at,product:platform_products(key),module:platform_modules(key),role:platform_roles(key)')
      .eq('scope_type', 'organization').eq('scope_id', id).eq('is_active', true).order('id').range(from, to)),
  ])
  check(organization.error)
  check(enabled.error)
  if (!organization.data) throw new Error('ORG_NOT_FOUND')
  const row = organization.data
  const now = Date.now()
  const managedModules = ORGANIZATION_MODULE_OPTIONS.filter(module =>
    (enabled.data ?? []).some(item => item.module_key === module.key)).map(module => module.key)
  const memberModules = new Map<string, Set<string>>()
  for (const grant of grants) {
    const moduleKey = relation(grant.module).key
    if (relation(grant.product).key !== 'dashboard' || relation(grant.role).key !== 'inspector' ||
        !SUPPORTED_ORGANIZATION_MODULES.some(key => key === moduleKey) ||
        (moduleKey === 'inspections' && !managedModules.includes('inspections')) ||
        (grant.expires_at && !(Date.parse(grant.expires_at) > now))) continue
    const current = memberModules.get(grant.profile_id) ?? new Set<string>()
    current.add(moduleKey as string)
    memberModules.set(grant.profile_id, current)
  }
  return {
    organization: { id: row.id, name: row.name, organizationNumber: row.organization_number,
      modules: ORGANIZATION_MODULE_OPTIONS.filter(module =>
        (enabled.data ?? []).some(item => item.module_key === module.key && item.is_active)).map(module => module.key),
      managedModules,
      tuManaged: managedModules.includes('technical_investigations') },
    members: members.map(member => ({ profileId: member.profile_id, role: member.role, isActive: member.is_active,
      displayName: typeof relation(member.profile).full_name === 'string' ? relation(member.profile).full_name as string : null,
      email: typeof relation(member.profile).email === 'string' ? relation(member.profile).email as string : null,
      modules: member.is_active ? ORGANIZATION_MODULE_OPTIONS.filter(module =>
        memberModules.get(member.profile_id)?.has(module.key)).map(module => module.key) : [],
    })),
  }
}

export async function createPlatformOrganization(value: unknown) {
  const context = await requireModuleAccess(ACCESS)
  const { requestId, ...values } = parsePlatformOrganizationCreate(value)
  const { data, error } = await createSupabaseAdminClient().rpc('platform_organization_create', {
    p_actor: context.identity.profileId, p_request_id: requestId, p_values: values,
  })
  check(error)
  if (data?.saved !== true || typeof data.organizationId !== 'string') throw new Error('ORG_REQUEST_FAILED')
  return { saved: true, organizationId: data.organizationId as string }
}

export async function savePlatformOrganizationModules(orgId: unknown, value: unknown) {
  const context = await requireModuleAccess(ACCESS)
  const id = parsePlatformOrganizationId(orgId)
  const { expectedModules, modules } = parsePlatformOrganizationModules(value)
  const { data, error } = await createSupabaseAdminClient().rpc('platform_organization_modules_save', {
    p_actor: context.identity.profileId, p_org: id, p_expected: expectedModules, p_modules: modules,
  })
  check(error)
  if (data?.saved !== true) throw new Error('ORG_REQUEST_FAILED')
  return { saved: true }
}

export async function savePlatformOrganizationMember(orgId: unknown, value: unknown) {
  const context = await requireModuleAccess(ACCESS)
  const id = parsePlatformOrganizationId(orgId)
  const { profileId, expected, ...values } = parsePlatformOrganizationMember(value)
  const { data, error } = await createSupabaseAdminClient().rpc('platform_organization_member_save', {
    p_actor: context.identity.profileId, p_org: id, p_profile: profileId, p_expected: expected, p_values: values,
  })
  check(error)
  if (data?.saved !== true) throw new Error('ORG_REQUEST_FAILED')
  return { saved: true }
}
