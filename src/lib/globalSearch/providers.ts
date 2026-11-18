import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireObContext, requireObInspectionReadContext, filterObAssignmentList } from '@/lib/ob/organizationBindings'
import { loadOverviewPdfIds } from '@/lib/ob/overviewPdfs'
import { canViewColleagueObAssignments } from '@/lib/ob/memberVisibility'
import { requireTuContext } from '@/lib/tu/server'
import { requireMoistureContext } from '@/lib/moisture/server'
import { readGlobalSearchCandidates } from './candidates'
import {
  GLOBAL_SEARCH_MODULE_LIMIT, globalSearchCandidatePattern, globalSearchExactCandidatePattern, globalSearchSubtitle, matchesGlobalSearch, selectGlobalSearchKinds,
  type GlobalSearchContext, type GlobalSearchProviderResult,
} from './model'

type Row = Record<string, unknown>
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const relation = (value: unknown): Row => Array.isArray(value)
  ? value.length === 1 ? relation(value[0]) : {}
  : value && typeof value === 'object' ? value as Row : {}
const admin = () => createSupabaseAdminClient() as unknown as SupabaseClient
const orgUrl = (path: string, orgId: string) => `${path}?orgId=${encodeURIComponent(orgId)}`
const id = (value: unknown) => encodeURIComponent(text(value))
const run = <T>(context: GlobalSearchContext, work: () => Promise<T>) => context.execution ? context.execution.run(work) : work()
const candidateOptions = (context: GlobalSearchContext, moduleId: string, label: string) => ({ execution: context.execution,
  timeoutIssue: { moduleId, label, message: 'Sökningen tog för lång tid. Förfina sökningen eller försök igen.' } })
const patternFor = (query: string, exact?: boolean) => exact ? globalSearchExactCandidatePattern(query) : globalSearchCandidatePattern(query)

export function globalSearchStatus(value: unknown): string {
  const state = text(value).toLocaleLowerCase('sv-SE')
  if (['draft', 'utkast'].includes(state)) return 'Utkast'
  if (['completed', 'done', 'klar'].includes(state)) return 'Klar'
  if (['archived', 'arkiverad'].includes(state)) return 'Arkiverad'
  if (['cancelled', 'canceled', 'avbokad'].includes(state)) return 'Avbokad'
  if (['accepted', 'confirmed', 'booked'].includes(state)) return 'Bekräftad'
  if (['sent', 'pending'].includes(state)) return 'Inväntar svar'
  if (state) return 'Pågående'
  return ''
}

function scoped(row: Row, context: GlobalSearchContext) {
  if (row.org_id !== context.orgId) throw new Error('GLOBAL_SEARCH_SCOPE_MISMATCH')
}

async function resultPage(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const { data, error } = await query
  if (error || !Array.isArray(data)) throw new Error('GLOBAL_SEARCH_SOURCE_READ_FAILED')
  return data as Row[]
}

async function addReports(
  moduleId: string, moduleLabel: string, context: GlobalSearchContext, query: string, source: GlobalSearchProviderResult,
): Promise<GlobalSearchProviderResult> {
  const inspections = source.results.filter(result => result.kind === 'inspection')
  if (!inspections.length) return source
  try {
    const ids = inspections.map(result => result.id.split(':').at(-1)!)
    const ready = await run(context, () => loadOverviewPdfIds(admin(), context.orgId, ids, context.execution?.signal))
    const results = [...source.results]
    for (const inspection of inspections) {
      const inspectionId = inspection.id.split(':').at(-1)!
      if (!ready.has(inspectionId)) continue
      const href = moduleId === 'tu' ? orgUrl(`/tu/investigations/${encodeURIComponent(inspectionId)}/print`, context.orgId)
        : moduleId === 'ob' ? inspection.href.replace(/\/properties\/([^/?]+)\/ob\/([^/?]+)/u, '/utlatande/$1/$2')
          : inspection.href.replace(/\/perform(?=\?|$)/u, '/report')
      results.push({ ...inspection, id: `${moduleId}:report:${inspectionId}`, kind: 'report',
        title: `Utlåtande – ${inspection.title}`, href, status: 'PDF' })
    }
    return { ...source, results: selectGlobalSearchKinds(query, results),
      hasMore: source.hasMore || results.length > GLOBAL_SEARCH_MODULE_LIMIT }
  } catch (error) {
    if (context.execution?.signal.aborted && context.execution.signal.reason instanceof Error && context.execution.signal.reason.message === 'GLOBAL_SEARCH_ABORTED') throw context.execution.signal.reason
    if (error instanceof Error && error.message === 'GLOBAL_SEARCH_ABORTED') throw error
    return { ...source, issues: [...(source.issues ?? []), { moduleId, label: moduleLabel,
      message: 'Utlåtandenas PDF-status kunde inte hämtas. Besiktningarna går fortfarande att öppna.' }] }
  }
}

async function searchConfirmations(context: GlobalSearchContext, query: string, family: 'OB' | 'TU', obColleagues = false) {
  const client = admin()
  const moduleId = family === 'OB' ? 'ob' : 'tu'
  const moduleLabel = family === 'OB' ? 'Överlåtelsebesiktning' : 'Tekniska utredningar'
  return readGlobalSearchCandidates<Row>({ query, ...candidateOptions(context, moduleId, moduleLabel), exactFields: ['cadastral_id'],
    fields: ['cadastral_id', 'property_address', 'property_city', 'preliminary_address', 'customer_name', 'brf_name'],
    key: row => text(row.id),
    read: (field, offset, size, exact) => {
      let request = client.from('assignments')
      .select('id,org_id,assignment_type,responsible_profile_id,inspection_id,status,customer_name,property_address,preliminary_address,property_city,cadastral_id,brf_name,archived_at')
      .eq('org_id', context.orgId).in('assignment_type', family === 'OB' ? ['OB', 'STATUS'] : ['TU'])
      if (family === 'OB' && !obColleagues) request = request.eq('responsible_profile_id', context.userId)
      if (context.execution) request = request.abortSignal(context.execution.signal)
      return resultPage(request.ilike(field, patternFor(query, exact)).order('id').range(offset, offset + size - 1))
    },
    project: async row => {
      scoped(row, context)
      if (!matchesGlobalSearch(query, text(row.cadastral_id), text(row.property_address), text(row.preliminary_address), text(row.property_city), text(row.customer_name), text(row.brf_name))) return []
      if (family === 'OB') {
        const visible = await run(context, () => filterObAssignmentList([row as unknown as {
          id: string; org_id: string; assignment_type: string; responsible_profile_id: string; inspection_id: string | null
        }], { ...context, role: context.role as 'admin' | 'inspector', orgName: null, orgEmailFrom: null }))
        if (!visible.length) return []
      }
      const designation = text(row.cadastral_id)
      const address = text(row.property_address) || text(row.preliminary_address)
      return [{ id: `${moduleId}:assignment:${text(row.id)}`, moduleId, moduleLabel, kind: 'assignment',
        title: `Uppdragsbekräftelse – ${designation || address || text(row.customer_name) || family}`,
        subtitle: globalSearchSubtitle(designation, address, text(row.property_city), text(row.customer_name)),
        propertyDesignation: designation || undefined,
        status: row.archived_at ? 'Arkiverad' : globalSearchStatus(row.status),
        href: orgUrl(`/${moduleId}/assignments/${id(row.id)}`, context.orgId) }]
    },
  })
}

export async function searchOb(context: GlobalSearchContext, query: string): Promise<GlobalSearchProviderResult> {
  const selected = await run(context, () => requireObContext(context.orgId, true))
  if (selected.userId !== context.userId || selected.orgId !== context.orgId) throw new Error('GLOBAL_SEARCH_SCOPE_MISMATCH')
  const source = createSupabaseAdminClient()
  const client = source as unknown as SupabaseClient
  const colleagues = await run(context, () => canViewColleagueObAssignments(context.orgId, context.userId, source))
  const inspected = await readGlobalSearchCandidates<Row>({ query, ...candidateOptions(context, 'ob', 'Överlåtelsebesiktning'), exactFields: ['inspections.properties.cadastral_id'],
    fields: ['inspections.properties.cadastral_id', 'inspections.properties.address', 'inspections.properties.city', 'inspections.properties.name', 'inspections.customer_name', 'inspections.assignment_number'],
    key: row => text(row.inspection_id),
    read: (field, offset, size, exact) => {
      let request = client.from('ob_organization_bindings')
      .select('inspection_id,org_id,inspections!inner(id,property_id,status,type,assignment_number,customer_name,properties!inner(id,name,address,city,cadastral_id))')
      .eq('org_id', context.orgId)
      if (!colleagues) request = request.eq('inspections.properties.owner', context.userId)
      if (context.execution) request = request.abortSignal(context.execution.signal)
      return resultPage(request.ilike(field, patternFor(query, exact)).order('inspection_id').range(offset, offset + size - 1))
    },
    project: async row => {
      scoped(row, context)
      const inspection = relation(row.inspections), property = relation(inspection.properties)
      if (!text(inspection.id) || !text(property.id)) return []
      if (!matchesGlobalSearch(query, text(property.cadastral_id), text(property.name), text(property.address), text(property.city), text(inspection.customer_name), text(inspection.assignment_number))) return []
      // Candidate metadata is never returned before the same owner/colleague
      // guard used by the destination has authorized this exact inspection.
      let access
      try { access = await run(context, () => requireObInspectionReadContext(inspection.id, context.orgId)) }
      catch (error) {
        if (error instanceof Error && ['OB_ORGANIZATION_FORBIDDEN', 'OB_ORGANIZATION_UNASSIGNED', 'OB_ORGANIZATION_MISMATCH'].includes(error.message)) return []
        throw error
      }
      if (access.orgId !== context.orgId || access.userId !== context.userId) throw new Error('GLOBAL_SEARCH_SCOPE_MISMATCH')
      const designation = text(property.cadastral_id)
      const title = `${['STATUS', 'SB'].includes(text(inspection.type)) ? 'Statusbesiktning' : 'Överlåtelsebesiktning'}${text(inspection.assignment_number) ? ` ${text(inspection.assignment_number)}` : ''}`
      const path = access.canEdit ? `/properties/${id(property.id)}/ob/${id(inspection.id)}` : `/utlatande/${id(property.id)}/${id(inspection.id)}`
      return [{ id: `ob:inspection:${text(inspection.id)}`, moduleId: 'ob', moduleLabel: 'Överlåtelsebesiktning', kind: 'inspection', title,
        subtitle: globalSearchSubtitle(designation, text(property.address), text(property.city), text(inspection.customer_name)),
        propertyDesignation: designation || undefined, status: globalSearchStatus(inspection.status), href: orgUrl(path, context.orgId) }]
    },
  })
  const confirmations = await searchConfirmations(context, query, 'OB', colleagues)
  return addReports('ob', 'Överlåtelsebesiktning', context, query, {
    results: [...inspected.results, ...confirmations.results], hasMore: inspected.hasMore || confirmations.hasMore,
    issues: [...(inspected.issues ?? []), ...(confirmations.issues ?? [])],
  })
}

export async function searchTu(context: GlobalSearchContext, query: string): Promise<GlobalSearchProviderResult> {
  const selected = await run(context, () => requireTuContext(context.orgId))
  if (selected.orgId !== context.orgId || selected.userId !== context.userId) throw new Error('GLOBAL_SEARCH_SCOPE_MISMATCH')
  const client = admin()
  const investigations = await readGlobalSearchCandidates<Row>({ query, ...candidateOptions(context, 'tu', 'Tekniska utredningar'), exactFields: ['properties.cadastral_id', 'assignments.cadastral_id'],
    fields: ['properties.cadastral_id', 'assignments.cadastral_id', 'title', 'properties.address', 'properties.city', 'assignments.property_address', 'assignments.property_city', 'assignments.customer_name', 'inspections.customer_name', 'inspections.assignment_number', 'brf_name', 'apartment_number'],
    key: row => text(row.inspection_id),
    read: (field, offset, size, exact) => {
      let request = client.from('technical_investigation_details')
      .select(`inspection_id,org_id,title,brf_name,apartment_number,report_locked_at,properties${field.startsWith('properties.') ? '!inner' : ''}(id,address,city,cadastral_id),assignments${field.startsWith('assignments.') ? '!inner' : ''}(cadastral_id,property_address,property_city,customer_name),inspections!inner(id,status,inspection_family,type,assignment_number,customer_name)`)
      .eq('org_id', context.orgId).ilike(field, patternFor(query, exact)).order('inspection_id').range(offset, offset + size - 1)
      if (context.execution) request = request.abortSignal(context.execution.signal)
      return resultPage(request)
    },
    project: row => {
      scoped(row, context)
      const property = relation(row.properties), assignment = relation(row.assignments), inspection = relation(row.inspections)
      if (!text(inspection.id) || (text(inspection.inspection_family) && inspection.inspection_family !== 'TU')) return []
      const designation = text(property.cadastral_id) || text(assignment.cadastral_id)
      const address = text(property.address) || text(assignment.property_address)
      const customer = text(inspection.customer_name) || text(assignment.customer_name)
      if (!matchesGlobalSearch(query, designation, address, text(property.city), text(assignment.property_city), customer, text(row.title), text(row.brf_name), text(row.apartment_number), text(inspection.assignment_number))) return []
      return [{ id: `tu:inspection:${text(inspection.id)}`, moduleId: 'tu', moduleLabel: 'Tekniska utredningar', kind: 'inspection',
        title: text(row.title) || 'Teknisk utredning',
        subtitle: globalSearchSubtitle(designation, address, text(property.city), customer, text(inspection.assignment_number)),
        propertyDesignation: designation || undefined, status: row.report_locked_at ? 'Låst' : globalSearchStatus(inspection.status),
        href: orgUrl(`/tu/investigations/${id(inspection.id)}`, context.orgId) }]
    },
  })
  const confirmations = await searchConfirmations(context, query, 'TU')
  return addReports('tu', 'Tekniska utredningar', context, query, {
    results: [...investigations.results, ...confirmations.results], hasMore: investigations.hasMore || confirmations.hasMore,
    issues: [...(investigations.issues ?? []), ...(confirmations.issues ?? [])],
  })
}

export async function searchEb(context: GlobalSearchContext, query: string): Promise<GlobalSearchProviderResult> {
  const client = admin()
  const projects = await readGlobalSearchCandidates<Row>({ query, ...candidateOptions(context, 'eb', 'Entreprenadbesiktning'), exactFields: ['property_designation'],
    fields: ['property_designation', 'title', 'address', 'city', 'client_name'], key: row => text(row.id),
    read: (field, offset, size, exact) => {
      let request = client.from('eb_projects')
      .select('id,org_id,title,property_designation,address,city,client_name,status')
      .eq('org_id', context.orgId).ilike(field, patternFor(query, exact)).order('id').range(offset, offset + size - 1)
      if (context.execution) request = request.abortSignal(context.execution.signal)
      return resultPage(request)
    },
    project: row => {
      scoped(row, context)
      if (!matchesGlobalSearch(query, text(row.property_designation), text(row.title), text(row.address), text(row.city), text(row.client_name))) return []
      return [{ id: `eb:project:${text(row.id)}`, moduleId: 'eb', moduleLabel: 'Entreprenadbesiktning', kind: 'project',
        title: text(row.title) || 'Entreprenad', subtitle: globalSearchSubtitle(text(row.property_designation), text(row.address), text(row.city), text(row.client_name)),
        propertyDesignation: text(row.property_designation) || undefined, status: globalSearchStatus(row.status), href: `/eb/projects/${id(row.id)}` }]
    },
  })
  const inspections = await readGlobalSearchCandidates<Row>({ query, ...candidateOptions(context, 'eb', 'Entreprenadbesiktning'), exactFields: ['eb_projects.property_designation'],
    fields: ['eb_projects.property_designation', 'eb_projects.title', 'eb_projects.address', 'eb_projects.city', 'eb_projects.client_name', 'inspections.assignment_number', 'inspections.customer_name'], key: row => text(row.inspection_id),
    read: (field, offset, size, exact) => {
      let request = client.from('eb_inspection_details')
      .select('inspection_id,org_id,inspection_variant,sequence_no,report_locked_at,eb_projects!inner(id,org_id,title,property_designation,address,city,client_name),inspections!eb_inspection_details_inspection_id_fkey!inner(id,status,inspection_family,assignment_number,customer_name)')
      .eq('org_id', context.orgId).eq('eb_projects.org_id', context.orgId).ilike(field, patternFor(query, exact)).order('inspection_id').range(offset, offset + size - 1)
      if (context.execution) request = request.abortSignal(context.execution.signal)
      return resultPage(request)
    },
    project: row => {
      scoped(row, context)
      const project = relation(row.eb_projects), inspection = relation(row.inspections)
      scoped(project, context)
      if (!text(project.id) || !text(inspection.id) || (text(inspection.inspection_family) && inspection.inspection_family !== 'EB')) return []
      if (!matchesGlobalSearch(query, text(project.property_designation), text(project.title), text(project.address), text(project.city), text(project.client_name), text(inspection.assignment_number), text(inspection.customer_name))) return []
      const title = `${text(row.inspection_variant) || 'Entreprenadbesiktning'} ${row.sequence_no ?? ''}${text(inspection.assignment_number) ? ` – ${text(inspection.assignment_number)}` : ''}`.trim()
      return [{ id: `eb:inspection:${text(inspection.id)}`, moduleId: 'eb', moduleLabel: 'Entreprenadbesiktning', kind: 'inspection', title,
        subtitle: globalSearchSubtitle(text(project.title), text(project.property_designation), text(project.address), text(project.client_name)),
        propertyDesignation: text(project.property_designation) || undefined, status: globalSearchStatus(inspection.status),
        href: `/eb/projects/${id(project.id)}/inspections/${id(inspection.id)}/${row.report_locked_at ? 'report' : 'perform'}` }]
    },
  })
  return addReports('eb', 'Entreprenadbesiktning', context, query, { results: [...inspections.results, ...projects.results], hasMore: inspections.hasMore || projects.hasMore,
    issues: [...(inspections.issues ?? []), ...(projects.issues ?? [])] })
}

export async function searchMoisture(context: GlobalSearchContext, query: string): Promise<GlobalSearchProviderResult> {
  const selected = await run(context, () => requireMoistureContext(context.orgId))
  if (selected.orgId !== context.orgId || selected.userId !== context.userId) throw new Error('GLOBAL_SEARCH_SCOPE_MISMATCH')
  const client = admin()
  return readGlobalSearchCandidates<Row>({ query, ...candidateOptions(context, 'moisture', 'Fuktsäkerhet'), exactFields: ['properties.cadastral_id'],
    fields: ['properties.cadastral_id', 'properties.address', 'properties.city', 'properties.name', 'title', 'organization_customers.name'], key: row => text(row.id),
    read: (field, offset, size, exact) => {
      let request = client.from('moisture_projects')
      .select(`id,org_id,title,status,properties!inner(id,name,address,city,cadastral_id),organization_customers${field.startsWith('organization_customers.') ? '!inner' : ''}(name)`)
      .eq('org_id', context.orgId).ilike(field, patternFor(query, exact)).order('id').range(offset, offset + size - 1)
      if (context.execution) request = request.abortSignal(context.execution.signal)
      return resultPage(request)
    },
    project: row => {
      scoped(row, context)
      const property = relation(row.properties), customer = relation(row.organization_customers)
      if (!matchesGlobalSearch(query, text(row.title), text(property.cadastral_id), text(property.name), text(property.address), text(property.city), text(customer.name))) return []
      return [{ id: `moisture:project:${text(row.id)}`, moduleId: 'moisture', moduleLabel: 'Fuktsäkerhet', kind: 'project',
        title: text(row.title) || 'Fuktsäkerhetsuppdrag', subtitle: globalSearchSubtitle(text(property.cadastral_id), text(property.address), text(property.city), text(customer.name)),
        propertyDesignation: text(property.cadastral_id) || undefined, status: globalSearchStatus(row.status),
        href: orgUrl(`/fuktsakerhet/projekt/${id(row.id)}`, context.orgId) }]
    },
  })
}
