import { getStockholmDate, type DashboardModuleSummary } from './model'

export type DashboardActionCaseSource = {
  id: string
  org_id: string
  title: string
  status: string
  site_visit_at: string | null
  property_address: string | null
}

const activeStatuses = new Set(['preparing', 'pricing', 'quote_ready', 'awaiting_customer', 'approved', 'in_progress'])

export function buildActionCaseDashboard(orgId: string, rows: DashboardActionCaseSource[]): DashboardModuleSummary {
  const active = rows.filter(row => row.org_id === orgId && activeStatuses.has(row.status))
  const bookings: DashboardModuleSummary['bookings'] = []
  for (const row of active) {
    // site_visit_at is a real visit timestamp. Deadlines and project work periods
    // do not provide visit times, and a customer's order does not confirm a visit.
    if (!row.site_visit_at?.includes('T') || !getStockholmDate(row.site_visit_at)) continue
    const address = row.property_address?.trim()
    bookings.push({
      id: `tasks:case:${row.id}`, moduleId: 'tasks', title: row.title,
      href: `/uppdrag/${encodeURIComponent(row.id)}`, startsAt: row.site_visit_at,
      status: 'tentative', confirmationStatus: 'Planerat platsbesök',
      ...(address ? { address } : {}),
    })
  }
  return { activeCount: active.length, actions: [], bookings }
}
