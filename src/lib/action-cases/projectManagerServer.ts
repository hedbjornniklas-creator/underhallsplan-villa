import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTaskPeople } from '@/lib/tasks/server'
import { questionUuid } from './projectQuestions'

type Context = { orgId: string; userId: string }
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42703', '42883', 'PGRST202', 'PGRST204'].includes(error.code || '')) throw new Error('PROJECT_MANAGER_SCHEMA')
  throw new Error(error.message?.match(/PROJECT_MANAGER_[A-Z_]+/)?.[0] || 'PROJECT_MANAGER_FAILED')
}
export async function getProjectManager(ctx: Context, caseId: string) {
  if (!questionUuid(caseId)) throw new Error('PROJECT_MANAGER_INVALID')
  const db = createSupabaseAdminClient()
  const project = await db.from('action_cases').select('id,manager_profile_id').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle()
  checked(project.error)
  if (!project.data) throw new Error('PROJECT_MANAGER_NOT_FOUND')
  const actor = await db.from('org_members').select('role').eq('org_id', ctx.orgId).eq('profile_id', ctx.userId).eq('is_active', true).maybeSingle()
  checked(actor.error)
  if (!actor.data) throw new Error('PROJECT_MANAGER_FORBIDDEN')
  const people = (await getTaskPeople({ ...ctx, isOrgAdmin: actor.data.role === 'admin' })).filter(p => p.kind === 'profile' && p.isActive).map(p => ({ id: p.id, name: p.name }))
  const managerId: string | null = project.data.manager_profile_id
  let managerName = managerId ? people.find(p => p.id === managerId)?.name || '' : ''
  if (managerId && !managerName) {
    const stored = await db.from('profiles').select('full_name').eq('id', managerId).maybeSingle()
    checked(stored.error); managerName = stored.data?.full_name || 'Inte tillgänglig'
  }
  return { managerId, managerName, canEdit: actor.data.role === 'admin', people }
}
export async function setProjectManager(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  if (!questionUuid(caseId) || (payload.managerId !== null && !questionUuid(payload.managerId)) || (payload.expectedManagerId !== null && !questionUuid(payload.expectedManagerId))) throw new Error('PROJECT_MANAGER_INVALID')
  const current = await getProjectManager(ctx, caseId)
  if (!current.canEdit) throw new Error('PROJECT_MANAGER_FORBIDDEN')
  if (payload.managerId && !current.people.some(p => p.id === payload.managerId)) throw new Error('PROJECT_MANAGER_INVALID')
  // The RPC also checks administrator status and compares the previous appointment atomically.
  if (current.managerId === payload.managerId) return current
  const result = await createSupabaseAdminClient().rpc('set_project_manager', { p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_manager_id: payload.managerId, p_expected_manager_id: payload.expectedManagerId })
  checked(result.error)
  return getProjectManager(ctx, caseId)
}
