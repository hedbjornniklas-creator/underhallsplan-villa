import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOverviewPdfIds } from './overviewPdfs'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { parseObInspectionBillingStatus, type ObInspectionBillingStatus } from './billing'
import {
  makeObOverviewItem, type ObOverviewPage, type OverviewAssignment, type OverviewInspection,
  type OverviewPageOptions, type OverviewWorkflow,
} from './overview'

type OverviewRow = {
  assignment: OverviewAssignment | null
  inspection: OverviewInspection | null
  workflow: OverviewWorkflow | null
  canEdit: boolean
  billing?: unknown
}
type DatabasePage = Omit<ObOverviewPage, 'items'> & { rows: OverviewRow[] }

export class ObOverviewBillingConfigurationError extends Error {
  readonly code = 'OB_OVERVIEW_BILLING_CONFIGURATION'
  constructor() {
    super('Databasstödet för fakturamarkering behöver installeras innan listan kan visas korrekt.')
    this.name = 'ObOverviewBillingConfigurationError'
  }
}

const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

// One authenticated RPC verifies active membership, OB access and colleague
// visibility. Filtering, counts and LIMIT share one database snapshot.
// Only this page is returned; never fall back to fetching all inspection data.
export async function loadObOverview(input: {
  userClient: SupabaseClient; orgId: string; options: OverviewPageOptions
}): Promise<ObOverviewPage> {
  const { userClient, orgId, options } = input
  const { data, error } = await userClient.rpc('ob_overview_page', {
    p_org_id: orgId, p_search: options.search, p_filter: options.filter, p_sort: options.sort,
    p_attention_only: options.filter === 'to-invoice' ? false : options.attentionOnly,
    p_show_archived: options.showArchived,
    p_page: options.page, p_page_size: options.pageSize,
  })
  if (error) {
    if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
      throw new ObOverviewBillingConfigurationError()
    }
    throw new Error('Kunde inte läsa uppdragslistans sida.')
  }
  const result = data as DatabasePage | null
  // An old RPC still classifies every completed inspection as closed. A single
  // page cannot repair that filter or its totals; do not silently use them.
  if (result && result.billingAvailable !== true) throw new ObOverviewBillingConfigurationError()
  if (!result || !Array.isArray(result.rows) || result.rows.length > options.pageSize ||
    !nonnegativeInteger(result.total) || !nonnegativeInteger(result.page) || result.page < 1 ||
    result.pageSize !== options.pageSize || !result.counts ||
    !['all', 'active', 'closed', 'to-invoice'].every(key => nonnegativeInteger(result.counts[key as keyof typeof result.counts])) ||
    result.counts.all !== result.counts.active + result.counts.closed ||
    result.total !== result.counts[options.filter] || result.rows.length > result.total) {
    throw new Error('Uppdragslistans svar kunde inte verifieras.')
  }
  const items = result.rows.map(row => {
    if (!row || (!row.assignment && !row.inspection) || typeof row.canEdit !== 'boolean') throw new Error('Uppdragslistans rad saknar underlag.')
    if (row.workflow && row.assignment && row.workflow.current_assignment_id !== row.assignment.id) {
      throw new Error('Uppdraget ändrades medan listan lästes. Försök igen.')
    }
    let billing: ObInspectionBillingStatus | undefined
    if (row.inspection) {
      billing = parseObInspectionBillingStatus(row.billing) ?? undefined
      if (!billing) throw new Error('Uppdragslistans fakturastatus kunde inte verifieras.')
    } else if (row.billing != null) {
      throw new Error('Uppdragslistans fakturastatus saknar besiktning.')
    }
    const item = makeObOverviewItem(row.assignment ?? undefined, row.inspection ?? undefined, row.workflow ?? undefined, billing)
    // The RPC, not this already-paginated subset, owns membership and totals.
    // Treat a mismatched classification as an invalid response, never re-page.
    if ((options.filter === 'active' && item.closed) || (options.filter === 'closed' && !item.closed) ||
      (options.filter === 'to-invoice' && (item.inspection !== 'Klar' || item.billing?.status !== 'not_invoiced'))) {
      throw new Error('Uppdragslistans urval kunde inte verifieras.')
    }
    return { ...item, canEdit: row.canEdit,
      ...(row.inspection && !row.canEdit ? { inspectionHref: `/utlatande/${row.inspection.property_id}/${row.inspection.id}` } : {}),
      ...(!row.canEdit ? { confirmationAction: 'Visa bekräftelse' } : {}),
    }
  })
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Uppdragslistan innehåller dubbla rader.')
  // These IDs came only from the authorization-enforcing RPC above. The admin
  // client reads bounded PDF metadata for that page; no additional entity IDs.
  const pdfIds = await loadOverviewPdfIds(createSupabaseAdminClient(), orgId,
    result.rows.flatMap(row => row.inspection ? [row.inspection.id] : []))
  result.rows.forEach((row, index) => {
    if (row.inspection && pdfIds.has(row.inspection.id)) {
      items[index].pdfHref = `/api/report-v2/${row.inspection.id}/pdf`
    }
  })
  return { items, total: result.total, counts: result.counts, page: result.page, pageSize: result.pageSize,
    billingAvailable: true }
}
