import type { SupabaseClient } from '@supabase/supabase-js'
import {
  makeObOverviewItem, type ObOverviewPage, type OverviewAssignment, type OverviewInspection,
  type OverviewPageOptions, type OverviewWorkflow,
} from './overview'

type OverviewRow = {
  assignment: OverviewAssignment | null
  inspection: OverviewInspection | null
  workflow: OverviewWorkflow | null
}
type DatabasePage = Omit<ObOverviewPage, 'items'> & { rows: OverviewRow[] }

const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

// One invoker RPC keeps inspection/property/snapshot reads inside the signed-in
// user's RLS boundary. Filtering, counts and LIMIT share one database snapshot.
// Only this page is returned; never fall back to fetching all inspection data.
export async function loadObOverview(input: {
  userClient: SupabaseClient; orgId: string; options: OverviewPageOptions
}): Promise<ObOverviewPage> {
  const { userClient, orgId, options } = input
  const { data, error } = await userClient.rpc('ob_overview_page', {
    p_org_id: orgId, p_search: options.search, p_filter: options.filter, p_sort: options.sort,
    p_attention_only: options.attentionOnly, p_show_archived: options.showArchived,
    p_page: options.page, p_page_size: options.pageSize,
  })
  if (error) throw new Error('Kunde inte läsa uppdragslistans sida.')
  const result = data as DatabasePage | null
  if (!result || !Array.isArray(result.rows) || result.rows.length > options.pageSize ||
    !nonnegativeInteger(result.total) || !nonnegativeInteger(result.page) || result.page < 1 ||
    result.pageSize !== options.pageSize || !result.counts ||
    !['all', 'active', 'closed'].every(key => nonnegativeInteger(result.counts[key as keyof typeof result.counts])) ||
    result.counts.all !== result.counts.active + result.counts.closed ||
    result.total !== result.counts[options.filter] || result.rows.length > result.total) {
    throw new Error('Uppdragslistans svar kunde inte verifieras.')
  }
  const items = result.rows.map(row => {
    if (!row || (!row.assignment && !row.inspection)) throw new Error('Uppdragslistans rad saknar underlag.')
    if (row.workflow && row.assignment && row.workflow.current_assignment_id !== row.assignment.id) {
      throw new Error('Uppdraget ändrades medan listan lästes. Försök igen.')
    }
    return makeObOverviewItem(row.assignment ?? undefined, row.inspection ?? undefined, row.workflow ?? undefined)
  })
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Uppdragslistan innehåller dubbla rader.')
  return { items, total: result.total, counts: result.counts, page: result.page, pageSize: result.pageSize }
}
