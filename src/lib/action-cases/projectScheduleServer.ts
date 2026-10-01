import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { offerId } from './customerOffers'
import { normalizeScheduleRows, type ProjectSchedule } from './projectSchedule'

type Context = { orgId: string; userId: string }
const missing = (code?: string) => ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code ?? '')
function check(error: { code?: string; message?: string } | null) {
  if (error) throw new Error(missing(error.code) ? 'PROJECT_SCHEDULE_SCHEMA' : error.message?.match(/PROJECT_SCHEDULE_[A-Z_]+/)?.[0] ?? 'PROJECT_SCHEDULE_FAILED')
}
async function requireCase(ctx: Context, caseId: string) {
  const result = await createSupabaseAdminClient().from('action_cases').select('id').eq('org_id', ctx.orgId).eq('id', offerId(caseId)).maybeSingle()
  check(result.error)
  if (!result.data) throw new Error('PROJECT_SCHEDULE_NOT_FOUND')
}
export async function getProjectSchedule(ctx: Context, caseId: string): Promise<ProjectSchedule> {
  await requireCase(ctx, caseId)
  const result = await createSupabaseAdminClient().from('action_case_schedules').select('revision,rows,shared_rows').eq('org_id', ctx.orgId).eq('action_case_id', caseId).maybeSingle()
  if (missing(result.error?.code)) return { available: false, revision: 0, rows: [], sharedRows: [] }
  check(result.error)
  return { available: true, revision: result.data?.revision ?? 0, rows: normalizeScheduleRows(result.data?.rows ?? []), sharedRows: normalizeScheduleRows(result.data?.shared_rows ?? []) }
}
export async function writeProjectSchedule(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  await requireCase(ctx, caseId)
  if (!['save', 'share', 'unshare'].includes(String(payload.operation)) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0 || (payload.operation === 'share' && payload.confirmed !== true)) throw new Error('PROJECT_SCHEDULE_INVALID')
  const rows = payload.operation === 'save' ? normalizeScheduleRows(payload.rows) : []
  const sources = rows.flatMap((r) => r.sourceItemId ? [r.sourceItemId] : [])
  if (sources.length) {
    const result = await createSupabaseAdminClient().from('action_case_items').select('id').eq('org_id', ctx.orgId).eq('action_case_id', caseId).in('id', sources)
    check(result.error)
    if (result.data?.length !== sources.length) throw new Error('PROJECT_SCHEDULE_INVALID')
  }
  const result = await createSupabaseAdminClient().rpc('write_action_case_schedule', { p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId, p_operation: payload.operation, p_revision: payload.revision, p_rows: rows })
  check(result.error)
}
export async function getSharedProjectSchedule(orgId: string, caseId: string) {
  const result = await createSupabaseAdminClient().from('action_case_schedules').select('shared_rows').eq('org_id', orgId).eq('action_case_id', caseId).maybeSingle()
  if (missing(result.error?.code)) return []
  check(result.error)
  return normalizeScheduleRows(result.data?.shared_rows ?? [])
}
