import 'server-only'
import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { InterestSubmission } from './interestContracts'
import { TRACKING_PAGE_SIZE, type InterestStatus, type TrackedInterest, type validateInterestUpdate } from './interestTrackingContracts'

const TABLE = 'besiktapp_interest_requests'
const COLUMNS = 'id,name,email,company,phone,message,status,owner_name,follow_up_on,notification_state,created_at,updated_at,revision'
export function isInterestTrackingEnabled() { return process.env.BESIKTAPP_INTEREST_TRACKING === '1' }
function assertEnabled() { if (!isInterestTrackingEnabled()) throw new Error('TRACKING_DISABLED') }
function fail(error: { code?: string } | null) {
  if (error) throw new Error(error.code === '42P01' || error.code === 'PGRST205' ? 'TRACKING_SCHEMA_REQUIRED' : 'TRACKING_FAILED')
}
export async function recordInterest(value: InterestSubmission) {
  assertEnabled()
  const db = createSupabaseAdminClient()
  const { name, email, company, phone, message, submissionId } = value
  // Stable across mail-provider configuration changes; edits are separate submissions.
  const requestKey = createHash('sha256').update(JSON.stringify({ name, email, company, phone, message, submissionId })).digest('hex')
  const inserted = await db.from(TABLE).insert({ request_key: requestKey, name, email, company, phone, message }).select('id').single()
  if (!inserted.error) return (inserted.data as { id: string }).id
  if (inserted.error.code !== '23505') fail(inserted.error)
  // A retry never overwrites contact details or an administrator's work.
  const existing = await db.from(TABLE).select('id').eq('request_key', requestKey).single()
  fail(existing.error)
  return (existing.data as { id: string }).id
}
export async function markInterestNotification(id: string, state: 'accepted' | 'failed') {
  const result = await createSupabaseAdminClient().from(TABLE).update({ notification_state: state }).eq('id', id).neq('notification_state', 'accepted')
  fail(result.error)
}
export async function listInterests(status: InterestStatus | null, page: number) {
  assertEnabled()
  let query = createSupabaseAdminClient().from(TABLE).select(COLUMNS, { count: 'exact' })
  if (status) query = query.eq('status', status)
  const result = await query.order('created_at', { ascending: false }).order('id').range(page * TRACKING_PAGE_SIZE, (page + 1) * TRACKING_PAGE_SIZE - 1)
  fail(result.error)
  return { items: result.data as TrackedInterest[], total: result.count ?? 0 }
}
export async function updateInterest(value: NonNullable<ReturnType<typeof validateInterestUpdate>>) {
  assertEnabled()
  const { id, revision, ...changes } = value
  const result = await createSupabaseAdminClient().from(TABLE).update({ ...changes, revision: revision + 1, updated_at: new Date().toISOString() })
    .eq('id', id).eq('revision', revision).select(COLUMNS).maybeSingle()
  fail(result.error)
  if (!result.data) throw new Error('TRACKING_CONFLICT')
  return result.data as TrackedInterest
}
