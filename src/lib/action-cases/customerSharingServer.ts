import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import { customerSections, defaultCustomerVisibility, visibilityMutation, type CustomerSection, type CustomerSharing, type CustomerSharingWorkspace } from './customerSharing'

type Context = { orgId: string; userId: string }
const uuid = (v: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
function checked(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code || '')) throw new Error('CUSTOMER_SHARING_SCHEMA')
  throw new Error(error.message?.match(/CUSTOMER_SHARING_[A-Z_]+/)?.[0] || 'CUSTOMER_SHARING_FAILED')
}
export async function readCustomerVisibility(orgId: string, caseId: string): Promise<CustomerSharing> {
  const result = await createSupabaseAdminClient().from('action_case_customer_visibility').select('revision,contract,choices,payments,schedule,files,updated_at,updated_by').eq('org_id', orgId).eq('action_case_id', caseId).maybeSingle()
  checked(result.error)
  const row = result.data
  if (!row) return { revision: 0, tabs: defaultCustomerVisibility(), updatedAt: null, updatedBy: null }
  if (!Number.isSafeInteger(row.revision) || row.revision < 1 || customerSections.some(s => typeof row[s.key] !== 'boolean')) throw new Error('CUSTOMER_SHARING_FAILED')
  return { revision: row.revision, tabs: { contract: row.contract, choices: row.choices, payments: row.payments, schedule: row.schedule, files: row.files }, updatedAt: row.updated_at, updatedBy: row.updated_by }
}
export async function requireCustomerSection(orgId: string, caseId: string, section: CustomerSection) {
  if (!(await readCustomerVisibility(orgId, caseId)).tabs[section]) throw new Error('CUSTOMER_SHARING_HIDDEN')
}
export async function requireCustomerSectionForToken(token: string, section: CustomerSection) {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) throw new Error('CUSTOMER_SHARING_NOT_FOUND')
  const db = createSupabaseAdminClient()
  const result = await db.from('action_case_access_links').select('org_id,action_case_id,participant_id,expires_at,revoked_at').eq('token_hash', hashAssignmentToken(token)).maybeSingle()
  checked(result.error)
  const access = result.data
  if (!access || access.revoked_at || Date.parse(access.expires_at) <= Date.now()) throw new Error('CUSTOMER_SHARING_NOT_FOUND')
  const person = await db.from('action_case_participants').select('id').eq('org_id', access.org_id).eq('action_case_id', access.action_case_id).eq('id', access.participant_id).eq('role', 'customer').maybeSingle()
  checked(person.error)
  if (!person.data) throw new Error('CUSTOMER_SHARING_NOT_FOUND')
  await requireCustomerSection(access.org_id, access.action_case_id, section)
}
export async function getCustomerSharing(ctx: Context, caseId: string): Promise<CustomerSharingWorkspace> {
  if (!uuid(caseId)) throw new Error('CUSTOMER_SHARING_INVALID')
  const db = createSupabaseAdminClient()
  const project = await db.from('action_cases').select('manager_profile_id').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle()
  checked(project.error)
  if (!project.data) throw new Error('CUSTOMER_SHARING_NOT_FOUND')
  const visibility = await readCustomerVisibility(ctx.orgId, caseId)
  const recipients: CustomerSharingWorkspace['recipients'] = []
  for (let from = 0; ; from += 500) {
    const rows = await db.from('action_case_participants').select('id,name,email').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('role', 'customer').order('name').order('id').range(from, from + 499)
    checked(rows.error); recipients.push(...rows.data || [])
    if ((rows.data?.length || 0) < 500) break
  }
  return { ...visibility, managerId: project.data.manager_profile_id, canEdit: project.data.manager_profile_id === ctx.userId, recipients }
}
export async function writeCustomerSharing(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  const request = visibilityMutation(payload)
  const before = await getCustomerSharing(ctx, caseId)
  if (!before.canEdit) throw new Error('CUSTOMER_SHARING_FORBIDDEN')
  const result = await createSupabaseAdminClient().rpc('set_project_customer_visibility', { p_org_id: ctx.orgId, p_case_id: caseId, p_actor_id: ctx.userId, p_request: request })
  checked(result.error)
  if (!Number.isSafeInteger(result.data) || result.data !== request.revision + 1) throw new Error('CUSTOMER_SHARING_FAILED')
  return { requestId: request.requestId, acknowledgedRevision: result.data, workspace: await getCustomerSharing(ctx, caseId) }
}
