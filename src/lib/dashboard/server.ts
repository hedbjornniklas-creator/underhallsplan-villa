import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { hasCurrentUserAccess } from '@/lib/access/server'
import type { PlatformModuleKeyMap } from '@/lib/access/model'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadObOverview } from '@/lib/ob/overviewLoader'
import type { ObOverviewItem } from '@/lib/ob/overview'
import { listTuAssignments, listTuInvestigations, requireTuContext } from '@/lib/tu/server'
import { listEbProjects } from '@/lib/eb/server'
import { listEbAssignmentConfirmationSummaries } from '@/lib/eb/assignmentConfirmationServer'
import { listMoistureProjects, requireMoistureContext } from '@/lib/moisture/server'
import { getTaskWorkspace } from '@/lib/tasks/server'
import { buildActionCaseDashboard, type DashboardActionCaseSource } from './actionCases'
import {
  buildObDashboard, buildTuDashboard, buildEbDashboard, buildMoistureDashboard, buildTaskDashboard,
  getStockholmDate, sortDashboardActions,
  type DashboardData, type DashboardModule, type DashboardModuleId, type DashboardModuleSummary, type DashboardConfirmationBookingSource,
} from './model'

export { getStockholmDate } from './model'
export type { DashboardData } from './model'

const MODULES: Array<Omit<DashboardModule, 'active' | 'activeCount' | 'actionCount'> & {
  moduleKey: PlatformModuleKeyMap['dashboard']
}> = [
  { id: 'ob', title: 'Överlåtelsebesiktning', code: 'ÖB', href: '/ob', moduleKey: 'inspections' },
  { id: 'eb', title: 'Entreprenadbesiktning', code: 'EB', href: '/eb', moduleKey: 'construction_inspections' },
  { id: 'tu', title: 'Tekniska utredningar', code: 'TU', href: '/tu', moduleKey: 'technical_investigations' },
  { id: 'moisture', title: 'Fuktsäkerhet', code: 'FS', href: '/fuktsakerhet', moduleKey: 'moisture_safety' },
  { id: 'tasks', title: 'Uppdrag', code: 'UP', href: '/uppdrag', moduleKey: 'tasks' },
]

async function allowedInOrganization(orgId: string, moduleKey?: PlatformModuleKeyMap['dashboard']) {
  const [organization, global] = await Promise.all([
    hasCurrentUserAccess({ productKey: 'dashboard', moduleKey, scopeType: 'organization', scopeId: orgId }),
    hasCurrentUserAccess({ productKey: 'dashboard', moduleKey, scopeType: 'global' }),
  ])
  return organization || global
}

async function readConfirmationBookings(userClient: SupabaseClient, orgId: string, ids: string[]) {
  const result = new Map<string, DashboardConfirmationBookingSource>()
  if (!ids.length) return result
  const { data, error } = await userClient.from('assignments')
    .select('id,status,preferred_date,preferred_time,accepted_at,booked_at,last_sent_at,archived_at')
    .eq('org_id', orgId).in('id', [...new Set(ids)])
  if (error) throw new Error('DASHBOARD_CONFIRMATION_BOOKING_READ_FAILED')
  for (const assignment of data || []) result.set(assignment.id, assignment)
  return result
}

async function readActionCaseVisits(orgId: string): Promise<DashboardModuleSummary> {
  const userClient = createSupabaseServerClient() as unknown as SupabaseClient
  const cases: DashboardActionCaseSource[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await userClient.from('action_cases')
      .select('id,org_id,title,status,site_visit_at,property_address').eq('org_id', orgId)
      .order('id', { ascending: true }).range(offset, offset + pageSize - 1)
    if (error) throw new Error('DASHBOARD_ACTION_CASE_VISIT_READ_FAILED')
    const page = (data || []) as DashboardActionCaseSource[]
    cases.push(...page)
    if (page.length < pageSize) break
  }
  return buildActionCaseDashboard(orgId, cases)
}

async function readOb(orgId: string, today: string): Promise<DashboardModuleSummary> {
  const userClient = createSupabaseServerClient() as unknown as SupabaseClient
  const items: ObOverviewItem[] = [], times = new Map<string, string | null>(), inspectionDates = new Map<string, string | null>()
  const confirmations = new Map<string, DashboardConfirmationBookingSource>()
  let page = 1, total = 0
  // The existing invoker RPC supplies only normalized rows visible to this user,
  // including the current confirmation after a reissue. No admin fallback.
  do {
    const result = await loadObOverview({ userClient, orgId, options: {
      search: '', filter: 'active', sort: 'date-asc', attentionOnly: false,
      showArchived: false, page, pageSize: 50,
    } })
    total = result.total
    const ownItems = result.items.filter(item => !('canEdit' in item) || item.canEdit !== false)
    items.push(...ownItems)
    const inspectionRows = ownItems.filter(item => item.id.startsWith('inspection:'))
    // The overview already resolves reissued confirmations. Fetch only its
    // current confirmation IDs rather than searching by inspection/date/address.
    const assignmentIds = new Map(ownItems.flatMap(item => {
      const id = item.confirmationHref?.match(/^\/ob\/assignments\/([^/?#]+)$/)?.[1]
      return id ? [[item.id, id] as const] : []
    }))
    for (const inspection of inspectionRows) inspectionDates.set(inspection.id, null)
    const [inspections, assignments] = await Promise.all([
      inspectionRows.length ? userClient.from('inspections').select('id,date,inspection_time')
        .in('id', inspectionRows.map(item => item.id.slice('inspection:'.length))) : Promise.resolve({ data: [], error: null }),
      readConfirmationBookings(userClient, orgId, [...assignmentIds.values()]),
    ])
    if (inspections.error) throw new Error('DASHBOARD_OB_BOOKING_READ_FAILED')
    for (const inspection of inspections.data || []) {
      times.set(`inspection:${inspection.id}`, inspection.inspection_time)
      inspectionDates.set(`inspection:${inspection.id}`, inspection.date)
    }
    for (const [rowId, assignmentId] of assignmentIds) {
      const source = assignments.get(assignmentId)
      if (!source) continue
      confirmations.set(rowId, source)
      if (rowId.startsWith('assignment:')) times.set(rowId, source.preferred_time)
    }
    page += 1
  } while ((page - 1) * 50 < total)
  return buildObDashboard([...new Map(items.map(item => [item.id, item])).values()], times, today, inspectionDates, confirmations)
}

export async function getDashboardData(requestedOrgId?: unknown): Promise<DashboardData> {
  const context = await requireOrgContext(requestedOrgId)
  if (requestedOrgId !== undefined) {
    const defaultContext = await requireOrgContext()
    // OB, EB and Uppdrag currently resolve their default organization. Keep the
    // combined start page aligned with those destinations until they support
    // an explicit organization selection throughout their workflows.
    if (context.orgId !== defaultContext.orgId) throw new Error('DASHBOARD_ORGANIZATION_UNSUPPORTED')
  }
  if (!await allowedInOrganization(context.orgId)) throw new Error('MODULE_ACCESS_REQUIRED')
  const today = getStockholmDate()
  const access = await Promise.all(MODULES.map(module => allowedInOrganization(context.orgId, module.moduleKey)))
  const readers: Record<DashboardModuleId, () => Promise<DashboardModuleSummary>> = {
    ob: () => readOb(context.orgId, today),
    tu: async () => {
      const selected = await requireTuContext(context.orgId)
      const [assignments, investigations] = await Promise.all([
        listTuAssignments(selected.orgId), listTuInvestigations(selected.orgId),
      ])
      return buildTuDashboard(selected.orgId, assignments, investigations, today)
    },
    eb: async () => {
      const projects = await listEbProjects(context.orgId)
      const confirmations = await listEbAssignmentConfirmationSummaries({
        orgId: context.orgId, inspectionIds: projects.flatMap(project => project.inspections.map(inspection => inspection.inspectionId)),
      })
      const confirmationBookings = await readConfirmationBookings(
        createSupabaseServerClient() as unknown as SupabaseClient, context.orgId, confirmations.map(item => item.assignmentId))
      return buildEbDashboard(context.orgId, projects, confirmations, today, confirmationBookings)
    },
    moisture: async () => {
      const selected = await requireMoistureContext(context.orgId)
      return buildMoistureDashboard(selected.orgId, await listMoistureProjects(selected), today)
    },
    tasks: async () => {
      const [workspace, cases] = await Promise.all([
        getTaskWorkspace({ orgId: context.orgId, userId: context.userId, isOrgAdmin: context.role === 'admin' }),
        readActionCaseVisits(context.orgId),
      ])
      const tasks = buildTaskDashboard(workspace, today)
      return { activeCount: tasks.activeCount + cases.activeCount, actions: tasks.actions, bookings: [...tasks.bookings, ...cases.bookings] }
    },
  }
  const results = await Promise.allSettled(MODULES.map((module, index) => access[index]
    ? readers[module.id]() : Promise.resolve<DashboardModuleSummary>({ activeCount: 0, actions: [], bookings: [] })))
  const data: DashboardData = { modules: [], actions: [], bookings: [], issues: [], organizationId: context.orgId, today }
  MODULES.forEach((module, index) => {
    const result = results[index]
    const summary = result.status === 'fulfilled' ? result.value : null
    const href = ['tu', 'moisture'].includes(module.id) ? `${module.href}?orgId=${encodeURIComponent(context.orgId)}` : module.href
    data.modules.push({ id: module.id, title: module.title, code: module.code, href,
      active: access[index], activeCount: summary?.activeCount || 0, actionCount: summary?.actions.length || 0 })
    if (summary) {
      data.actions.push(...summary.actions)
      data.bookings.push(...summary.bookings)
    } else {
      const code = result.status === 'rejected' && result.reason instanceof Error ? result.reason.message : ''
      // A changed membership/session must never be represented as an empty module.
      if (['UNAUTHORIZED', 'ORG_MEMBERSHIP_REQUIRED', 'ORG_SELECTION_INVALID'].includes(code)) throw result.status === 'rejected' ? result.reason : new Error(code)
      data.issues!.push({ moduleId: module.id, message: `Kunde inte läsa ${module.title.toLocaleLowerCase('sv-SE')}. Öppna modulen eller försök igen.` })
    }
  })
  data.actions = sortDashboardActions(data.actions)
  data.bookings.sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id))
  return data
}
