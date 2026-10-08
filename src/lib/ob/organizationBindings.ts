import 'server-only'
import { createDashboardAccessRequest, hasCurrentUserAccess } from '@/lib/access/server'
import { requireOrgContext, type OrgContext } from '@/lib/assignments/server'
import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { OrganizationSwitcherContext } from '@/lib/organizations/server'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type InspectionAccessRow = {
  id: string
  inspection_family: string | null
  type: string | null
  properties: { owner: string } | { owner: string }[] | null
}

function parseId(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || !isOrganizationUuid(value.trim())) throw new Error(errorCode)
  return value.trim().toLowerCase()
}

function isObInspection(inspection: InspectionAccessRow): boolean {
  // SB is ambiguous in historical type-only data (it can mean EB slutbesiktning).
  // Only canonical OB/SB, or legacy OB/STATUS without a family, belongs here.
  if (inspection.inspection_family !== null && inspection.inspection_family !== undefined) {
    return inspection.inspection_family === 'OB'
  }
  return inspection.type === 'OB' || inspection.type === 'STATUS'
}

function relation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return value.length === 1 ? relation(value[0]) : {}
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

async function legacyObAccess(orgId: string): Promise<boolean> {
  const [scoped, global] = await Promise.all([
    hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'inspections', scopeType: 'organization', scopeId: orgId }),
    hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'inspections', scopeType: 'global' }),
  ])
  return scoped || global
}

async function hasObAccessWithClient(
  admin: AdminClient, orgId: string, userId: string,
  legacyAccess: (orgId: string) => Promise<boolean> = legacyObAccess
): Promise<boolean> {
  const { data, error } = await admin.from('organization_enabled_modules')
    .select('is_active').eq('org_id', orgId).eq('module_key', 'inspections').maybeSingle()
  if (error) throw new Error('OB_ORGANIZATION_READ_FAILED')

  if (data === null) {
    // Preserve untouched legacy access only while this organization has no
    // explicit OB management row. No other organization is ever considered.
    return legacyAccess(orgId)
  }
  if (data.is_active !== true) return false

  // A boolean scoped access check can itself succeed through legacy membership.
  // Managed OB must instead have an explicit active scoped inspector grant.
  // The shared legacy loader does not check catalog activation. Keep this
  // forward-looking managed branch strict without changing legacy behavior.
  const { data: grants, error: grantsError } = await admin.from('platform_access_assignments')
    .select('profile_id,product_id,scope_type,scope_id,is_active,expires_at,platform_products!inner(id,key,is_active),platform_modules!inner(product_id,key,is_active),platform_roles!inner(product_id,key,is_active)')
    .eq('profile_id', userId).eq('scope_type', 'organization').eq('scope_id', orgId).eq('is_active', true)
    .eq('platform_products.key', 'dashboard').eq('platform_products.is_active', true)
    .eq('platform_modules.key', 'inspections').eq('platform_modules.is_active', true)
    .eq('platform_roles.key', 'inspector').eq('platform_roles.is_active', true)
  if (grantsError || !Array.isArray(grants)) throw new Error('OB_ORGANIZATION_READ_FAILED')
  const now = Date.now()
  return grants.some((grant) => {
    const product = relation(grant.platform_products)
    const moduleEntry = relation(grant.platform_modules)
    const role = relation(grant.platform_roles)
    return grant.profile_id === userId && grant.is_active === true && grant.scope_type === 'organization' && grant.scope_id === orgId &&
      typeof grant.product_id === 'string' && product.id === grant.product_id &&
      moduleEntry.product_id === grant.product_id && role.product_id === grant.product_id &&
      product.key === 'dashboard' && product.is_active === true && moduleEntry.key === 'inspections' && moduleEntry.is_active === true &&
      role.key === 'inspector' && role.is_active === true &&
      (grant.expires_at === null || (typeof grant.expires_at === 'string' && Date.parse(grant.expires_at) > now))
  })
}

async function authenticatedObActor(): Promise<string> {
  const { data: { user }, error } = await createSupabaseServerClient().auth.getUser()
  if (error || !user) throw new Error('UNAUTHORIZED')
  return user.id
}

async function explicitObContext(orgId: string, userId: string): Promise<OrgContext> {
  let context: OrgContext
  try {
    context = await requireOrgContext(orgId)
  } catch (error) {
    if (error instanceof Error && ['UNAUTHORIZED', 'ORG_MEMBERSHIP_REQUIRED'].includes(error.message)) throw error
    throw new Error('OB_ORGANIZATION_READ_FAILED')
  }
  if (context.userId !== userId || context.orgId !== orgId) throw new Error('OB_ORGANIZATION_FORBIDDEN')
  try {
    if (!await hasObAccessWithClient(createSupabaseAdminClient(), orgId, userId)) throw new Error('MODULE_ACCESS_REQUIRED')
  } catch (error) {
    if (error instanceof Error && ['UNAUTHORIZED', 'MODULE_ACCESS_REQUIRED', 'OB_ORGANIZATION_READ_FAILED'].includes(error.message)) throw error
    throw new Error('OB_ORGANIZATION_READ_FAILED')
  }
  return context
}

export async function hasOrganizationObAccess(orgId: string, userId: string): Promise<boolean> {
  const actor = await authenticatedObActor()
  if (actor !== userId) return false
  const id = parseId(orgId, 'ORG_SELECTION_INVALID')
  try {
    await explicitObContext(id, actor)
    return true
  } catch (error) {
    if (error instanceof Error && ['ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED'].includes(error.message)) return false
    throw error
  }
}

/** Workspace selection only. Entity URLs always use their authoritative binding. */
export async function requireObContext(requestedOrgId?: unknown, requireExplicit = false): Promise<OrgContext> {
  const actor = await authenticatedObActor()
  if (requestedOrgId !== undefined) return explicitObContext(parseId(requestedOrgId, 'ORG_SELECTION_INVALID'), actor)
  if (requireExplicit) throw new Error('ORG_SELECTION_INVALID')

  const { data, error } = await createSupabaseAdminClient().from('org_members')
    .select('org_id').eq('profile_id', actor).eq('is_active', true)
    .order('is_default', { ascending: false }).order('created_at').order('org_id')
  if (error || !Array.isArray(data)) throw new Error('OB_ORGANIZATION_READ_FAILED')
  if (!data.length) throw new Error('ORG_MEMBERSHIP_REQUIRED')
  for (const member of data) {
    if (!isOrganizationUuid(member.org_id)) throw new Error('OB_ORGANIZATION_READ_FAILED')
    try {
      return await explicitObContext(member.org_id.toLowerCase(), actor)
    } catch (error) {
      if (!(error instanceof Error) || !['MODULE_ACCESS_REQUIRED', 'ORG_MEMBERSHIP_REQUIRED'].includes(error.message)) throw error
    }
  }
  throw new Error('MODULE_ACCESS_REQUIRED')
}

export async function requireObAssignmentContext(assignmentIdValue: unknown, requestedOrgIdValue?: unknown): Promise<OrgContext> {
  const actor = await authenticatedObActor()
  return assignmentContext(actor, () => createSupabaseAdminClient(), assignmentIdValue, requestedOrgIdValue,
    orgId => explicitObContext(orgId, actor), requireObInspectionContext)
}

async function assignmentContext(
  actor: string, getAdmin: () => AdminClient, assignmentIdValue: unknown, requestedOrgIdValue: unknown,
  resolveOrganization: (orgId: string) => Promise<OrgContext>,
  resolveInspection: (id: unknown, requestedOrgId?: unknown) => Promise<OrgContext>
): Promise<OrgContext> {
  const assignmentId = parseId(assignmentIdValue, 'OB_ASSIGNMENT_INVALID')
  const requestedOrgId = requestedOrgIdValue === undefined ? undefined : parseId(requestedOrgIdValue, 'ORG_SELECTION_INVALID')
  const admin = getAdmin()
  const { data, error } = await admin.from('assignments')
    .select('id,org_id,inspection_id,assignment_type').eq('id', assignmentId).maybeSingle()
  if (error) throw new Error('OB_ORGANIZATION_READ_FAILED')
  if (!data || !['OB', 'STATUS'].includes(data.assignment_type)) throw new Error('OB_ASSIGNMENT_NOT_FOUND')
  if (!isOrganizationUuid(data.org_id)) throw new Error('OB_ORGANIZATION_READ_FAILED')
  const context = data.inspection_id
    ? await resolveInspection(data.inspection_id, data.org_id)
    : await resolveOrganization(data.org_id.toLowerCase())
  if (context.userId !== actor) throw new Error('OB_ORGANIZATION_FORBIDDEN')
  if (requestedOrgId !== undefined && requestedOrgId !== context.orgId) throw new Error('OB_ORGANIZATION_MISMATCH')
  return context
}

/** Binding determines identity without expanding the existing owner boundary. */
export async function requireObInspectionContext(inspectionIdValue: unknown, requestedOrgIdValue?: unknown): Promise<OrgContext> {
  const actor = await authenticatedObActor()
  return inspectionContext(actor, () => createSupabaseAdminClient(), inspectionIdValue, requestedOrgIdValue,
    orgId => explicitObContext(orgId, actor))
}

async function inspectionContext(
  actor: string, getAdmin: () => AdminClient, inspectionIdValue: unknown, requestedOrgIdValue: unknown,
  resolveOrganization: (orgId: string) => Promise<OrgContext>
): Promise<OrgContext> {
  const inspectionId = parseId(inspectionIdValue, 'OB_INSPECTION_INVALID')
  const requestedOrgId = requestedOrgIdValue === undefined
    ? undefined : parseId(requestedOrgIdValue, 'ORG_SELECTION_INVALID')
  const admin = getAdmin()
  const { data: inspectionData, error: inspectionError } = await admin.from('inspections')
    .select('id,inspection_family,type,properties!inner(owner)')
    .eq('id', inspectionId).eq('properties.owner', actor).maybeSingle()
  if (inspectionError) throw new Error('OB_ORGANIZATION_READ_FAILED')
  const inspection = inspectionData as InspectionAccessRow | null
  const property = Array.isArray(inspection?.properties) ? inspection.properties[0] : inspection?.properties
  if (!inspection || inspection.id !== inspectionId || property?.owner !== actor || !isObInspection(inspection)) {
    throw new Error('OB_ORGANIZATION_FORBIDDEN')
  }

  // Do not even read a binding until authenticated ownership has been verified.
  const { data: binding, error: bindingError } = await admin.from('ob_organization_bindings')
    .select('inspection_id,org_id').eq('inspection_id', inspectionId).maybeSingle()
  if (bindingError) {
    if (['42P01', '42703', 'PGRST205'].includes(bindingError.code ?? '')) {
      throw new Error('OB_ORGANIZATION_MIGRATION_REQUIRED')
    }
    throw new Error('OB_ORGANIZATION_READ_FAILED')
  }
  if (binding === null) throw new Error('OB_ORGANIZATION_UNASSIGNED')
  if (!binding || binding.inspection_id !== inspectionId || !isOrganizationUuid(binding.org_id)) {
    throw new Error('OB_ORGANIZATION_READ_FAILED')
  }
  const orgId = binding.org_id.toLowerCase()

  // Always explicit; the default/bootstrap membership branch is unreachable.
  const context = await resolveOrganization(orgId)
  // Only an authorized owner learns that their requested organization mismatches.
  if (requestedOrgId !== undefined && requestedOrgId !== orgId) throw new Error('OB_ORGANIZATION_MISMATCH')
  return context
}

type ObNavigationMembership = {
  org_id: string
  profile_id: string
  role: OrgContext['role']
  is_active: boolean
  is_default: boolean
  organizations: { name: string | null; email_from: string | null } | Array<{ name: string | null; email_from: string | null }> | null
}

export type ObOrganizationEntity = { inspectionId?: string; assignmentId?: string }

/**
 * Resolve the whole navigation response inside one authenticated request. All
 * promises below belong to this invocation only, never to another HTTP request.
 * Entity authorization shares the same owner/binding checks as the API guards.
 */
export async function getObOrganizationSwitcherContext(
  requestedOrgIdValue?: unknown, entity: ObOrganizationEntity = {}
): Promise<OrganizationSwitcherContext> {
  const access = await createDashboardAccessRequest()
  const requestedOrgId = requestedOrgIdValue === undefined
    ? undefined : parseId(requestedOrgIdValue, 'ORG_SELECTION_INVALID')
  const admin = createSupabaseAdminClient()
  let membershipsPromise: Promise<ObNavigationMembership[]> | undefined
  const memberships = () => membershipsPromise ??= (async () => {
    const { data, error } = await admin.from('org_members')
      .select('org_id,profile_id,role,is_active,is_default,created_at,organizations(name,email_from)')
      .eq('profile_id', access.userId).eq('is_active', true)
      .order('is_default', { ascending: false }).order('created_at').order('org_id')
    if (error || !Array.isArray(data)) throw new Error('OB_ORGANIZATION_READ_FAILED')
    const rows = data as unknown as ObNavigationMembership[]
    if (rows.some(row => !isOrganizationUuid(row.org_id) || row.profile_id !== access.userId ||
        row.is_active !== true || !['admin', 'inspector'].includes(row.role))) {
      throw new Error('OB_ORGANIZATION_READ_FAILED')
    }
    return rows
  })()
  const contexts = new Map<string, Promise<OrgContext>>()
  const resolveOrganization = (orgId: string): Promise<OrgContext> => {
    let result = contexts.get(orgId)
    if (!result) {
      result = (async () => {
        const member = (await memberships()).find(row => row.org_id.toLowerCase() === orgId)
        if (!member) throw new Error('ORG_MEMBERSHIP_REQUIRED')
        let allowed: boolean
        try {
          allowed = await hasObAccessWithClient(admin, orgId, access.userId, async id => {
            const [scoped, global] = await Promise.all([
              access.hasAccess({ moduleKey: 'inspections', scopeType: 'organization', scopeId: id }),
              access.hasAccess({ moduleKey: 'inspections', scopeType: 'global' }),
            ])
            return scoped || global
          })
        } catch {
          throw new Error('OB_ORGANIZATION_READ_FAILED')
        }
        if (!allowed) throw new Error('MODULE_ACCESS_REQUIRED')
        const organization = relation(member.organizations)
        return {
          userId: access.userId, orgId, role: member.role,
          orgName: typeof organization.name === 'string' ? organization.name : null,
          orgEmailFrom: typeof organization.email_from === 'string' ? organization.email_from : null,
        }
      })()
      contexts.set(orgId, result)
    }
    return result
  }
  const allowedContext = async (orgId: string) => {
    try { return await resolveOrganization(orgId) } catch (error) {
      if (error instanceof Error && ['ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED'].includes(error.message)) return null
      throw error
    }
  }
  const resolveInspection = (id: unknown, orgId?: unknown) =>
    inspectionContext(access.userId, () => admin, id, orgId, resolveOrganization)
  // Ownership is verified before reading bindings, memberships or module access.
  let selected = entity.inspectionId !== undefined
    ? await resolveInspection(entity.inspectionId, requestedOrgId)
    : entity.assignmentId !== undefined
      ? await assignmentContext(access.userId, () => admin, entity.assignmentId, requestedOrgId, resolveOrganization, resolveInspection)
      : requestedOrgId !== undefined ? await resolveOrganization(requestedOrgId) : null
  const members = await memberships()
  if (!members.length) throw new Error('ORG_MEMBERSHIP_REQUIRED')
  const allowed = await Promise.all(members.map(async member => ({
    member, context: await allowedContext(member.org_id.toLowerCase()),
  })))
  if (!selected) selected = allowed.find(item => item.context)?.context ?? null
  if (!selected) throw new Error('MODULE_ACCESS_REQUIRED')
  const organizations = allowed.filter(item => item.context).map(({ member }) => {
    const name = relation(member.organizations).name
    return { id: member.org_id.toLowerCase(), name: typeof name === 'string' ? name.trim() || null : null, isDefault: member.is_default }
  })
  const organization = organizations.find(item => item.id === selected.orgId)
  if (!organization) throw new Error('MODULE_ACCESS_REQUIRED')
  return { organization, organizations }
}
