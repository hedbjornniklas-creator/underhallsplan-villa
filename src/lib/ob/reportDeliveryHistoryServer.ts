import type { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { ObDeliveryEvent, ObDeliveryTimeline } from './reportDeliveryHistory'

type Admin = ReturnType<typeof createSupabaseAdminClient>
const PAGE_SIZE = 20

function readCursor(raw?: string | null): { at: string; id: string } | null {
  if (!raw) return null
  try {
    if (raw.length > 500) throw Error()
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(value.at) || !Number.isFinite(Date.parse(value.at)) ||
      !/^[a-z_]+:[0-9a-f-]{36}$/.test(value.id)) throw Error()
    return value
  } catch { throw Error('OB_HISTORY_CURSOR_INVALID') }
}

export async function readObDeliveryTimeline(admin: Admin, orgId: string, inspectionId: string, rawCursor?: string | null): Promise<ObDeliveryTimeline> {
  const cursor = readCursor(rawCursor)
  let query = admin.from('ob_report_delivery_history').select('*')
    .eq('org_id', orgId).eq('inspection_id', inspectionId)
    .order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE + 1)
  if (cursor) query = query.or(`occurred_at.lt.${cursor.at},and(occurred_at.eq.${cursor.at},id.lt.${cursor.id})`)
  const { data, error } = await query
  if (error) throw Error('OB_DELIVERY_HISTORY_UNAVAILABLE')
  const rows = data ?? []
  const entries: ObDeliveryEvent[] = rows.slice(0, PAGE_SIZE)
  const last = entries.at(-1)
  const nextCursor = rows.length > PAGE_SIZE && last
    ? Buffer.from(JSON.stringify({ at: last.occurred_at, id: last.id })).toString('base64url') : null
  const { data: overview, error: overviewError } = await admin.from('ob_report_delivery_overview')
    .select('*').eq('org_id', orgId).eq('inspection_id', inspectionId).maybeSingle()
  if (overviewError || !overview) throw Error('OB_DELIVERY_HISTORY_UNAVAILABLE')
  return { entries, nextCursor, overview: {
    publishedAt: overview.published_at, reportId: overview.report_id, version: overview.version,
    lockedAt: overview.locked_at, lastSentAt: overview.last_sent_at,
    lastRecipients: overview.last_recipients ?? [], historyIncomplete: overview.history_incomplete === true,
  } }
}
