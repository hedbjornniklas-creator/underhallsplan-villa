import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireOrgContext } from '@/lib/assignments/server'
import { hasCurrentUserAccess } from '@/lib/access/server'
import {
  MoistureError, parseMoistureId, parseMoistureProjectInput, parseMoistureProjectUpdate,
  type MoistureContext, type MoistureOptions, type MoistureProject,
} from './domain'

const DATABASE_ERRORS = new Set([
  'MOISTURE_FORBIDDEN', 'MOISTURE_NOT_FOUND', 'MOISTURE_INVALID_INPUT', 'MOISTURE_PROPERTY_INVALID',
  'MOISTURE_BUILDING_INVALID', 'MOISTURE_CUSTOMER_INVALID', 'MOISTURE_CONFLICT', 'MOISTURE_CREATE_CONFLICT',
])
function databaseError(error: { code?: string; message?: string }): never {
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
    throw new MoistureError('MOISTURE_SCHEMA_REQUIRED')
  }
  throw new MoistureError(DATABASE_ERRORS.has(error.message ?? '') ? error.message! : 'MOISTURE_OPERATION_FAILED')
}
async function rpc(name: string, input: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await createSupabaseAdminClient().rpc(name, input)
  if (error) databaseError(error)
  return data
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function project(value: unknown, context: MoistureContext): MoistureProject {
  if (!isRecord(value) || value.orgId !== context.orgId || typeof value.id !== 'string'
    || typeof value.title !== 'string' || !isRecord(value.property) || !Array.isArray(value.buildings)
    || !Array.isArray(value.scopes) || !Number.isInteger(value.revision)) {
    throw new MoistureError('MOISTURE_OPERATION_FAILED')
  }
  return value as MoistureProject
}
function contextArgs(context: MoistureContext) {
  return { p_org_id: parseMoistureId(context.orgId, 'orgId'), p_actor_id: parseMoistureId(context.userId, 'userId') }
}

export async function requireMoistureContext(requestedOrgId?: unknown): Promise<MoistureContext> {
  let context = await requireOrgContext(requestedOrgId)
  const [organizationAccess, globalAccess] = await Promise.all([
    hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'moisture_safety', scopeType: 'organization', scopeId: context.orgId }),
    hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'moisture_safety', scopeType: 'global' }),
  ])
  if (!organizationAccess && !globalAccess) {
    // Only an unscoped entry URL may choose another active membership. A user's
    // explicit organization selection must never silently fall back elsewhere.
    if (requestedOrgId !== undefined) throw new MoistureError('MODULE_ACCESS_REQUIRED')
    const { data, error } = await createSupabaseAdminClient().from('org_members')
      .select('org_id,is_default,created_at').eq('profile_id', context.userId).eq('is_active', true)
      .order('is_default', { ascending: false }).order('created_at', { ascending: true }).order('org_id', { ascending: true })
    if (error) databaseError(error)
    let fallback: string | null = null
    for (const membership of data ?? []) {
      if (membership.org_id === context.orgId) continue
      if (await hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'moisture_safety', scopeType: 'organization', scopeId: membership.org_id })) {
        fallback = membership.org_id
        break
      }
    }
    if (!fallback) throw new MoistureError('MODULE_ACCESS_REQUIRED')
    context = await requireOrgContext(fallback)
  }
  return { orgId: context.orgId, orgName: context.orgName, userId: context.userId }
}
export async function requireMoistureRequestContext(request: Request): Promise<MoistureContext> {
  const params = new URL(request.url).searchParams
  if (params.getAll('orgId').length !== 1) throw new MoistureError('ORG_SELECTION_INVALID')
  return requireMoistureContext(params.get('orgId'))
}
export async function listMoistureProjects(context: MoistureContext): Promise<MoistureProject[]> {
  const data = await rpc('moisture_projects_read', { ...contextArgs(context), p_project_id: null })
  if (!Array.isArray(data)) throw new MoistureError('MOISTURE_OPERATION_FAILED')
  return data.map(item => project(item, context))
}
export async function getMoistureProject(context: MoistureContext, id: unknown): Promise<MoistureProject> {
  const data = await rpc('moisture_projects_read', { ...contextArgs(context), p_project_id: parseMoistureId(id) })
  return project(data, context)
}
export async function getMoistureOptions(context: MoistureContext): Promise<MoistureOptions> {
  const data = await rpc('moisture_options_read', contextArgs(context))
  if (!isRecord(data) || !Array.isArray(data.properties) || !Array.isArray(data.customers)) throw new MoistureError('MOISTURE_OPERATION_FAILED')
  return data as MoistureOptions
}
export async function createMoistureProject(context: MoistureContext, body: unknown): Promise<MoistureProject> {
  const input = parseMoistureProjectInput(body)
  return project(await rpc('moisture_project_write', {
    ...contextArgs(context), p_project_id: input.projectId, p_operation: 'create', p_input: input,
  }), context)
}
export async function updateMoistureProject(context: MoistureContext, id: unknown, body: unknown): Promise<MoistureProject> {
  const input = parseMoistureProjectUpdate(body)
  return project(await rpc('moisture_project_write', {
    ...contextArgs(context), p_project_id: parseMoistureId(id), p_operation: 'update', p_input: input,
  }), context)
}
