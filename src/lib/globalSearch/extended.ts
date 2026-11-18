import 'server-only'

import { hasCurrentUserAccess } from '@/lib/access/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getOrganizationCustomerNavigationContext } from '@/lib/customers/server'
import { requireRenoAppViewerContext } from '@/lib/renoapp/server'
import {
  GLOBAL_SEARCH_MODULE_LIMIT, compactGlobalSearchText, globalSearchCandidatePattern, globalSearchExactCandidatePattern, globalSearchSubtitle,
  matchesGlobalSearch, rankGlobalSearchResults, selectGlobalSearchKinds,
  type GlobalSearchContext, type GlobalSearchIssue, type GlobalSearchProviderResult, type GlobalSearchResult,
} from './model'

type Row = Record<string, unknown>
type ReadResult = { data: Row[] | null; error: unknown }
type Reader = PromiseLike<ReadResult> & {
  eq(column: string, value: unknown): Reader
  in(column: string, values: readonly string[]): Reader
  is(column: string, value: null): Reader
  ilike(column: string, value: string): Reader
  order(column: string, options?: { ascending?: boolean }): Reader
  limit(limit: number): Reader
  range(from: number, to: number): Reader
  abortSignal(signal: AbortSignal): Reader
}
type Database = { from(table: string): { select(columns: string): Reader } }
type Scope = (reader: Reader) => Reader
type Provider = GlobalSearchProviderResult & { issues?: GlobalSearchIssue[] }
type Execution = GlobalSearchContext['execution']
type Selection = { rows: Row[]; hasMore: boolean; timedOut: boolean }
const PAGE_SIZE = 25
const ID_CHUNK_SIZE = 100
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const id = (value: unknown) => text(value)
const taskLabels: Record<string, string> = { draft: 'Utkast', assigned: 'Tilldelad', in_progress: 'Pågår',
  waiting: 'Väntar', ready_for_review: 'Klar för kontroll', returned: 'Behöver rättas', approved: 'Godkänd', cancelled: 'Avbruten' }
const projectLabels: Record<string, string> = { preparing: 'Samla underlag', pricing: 'Kalkyl pågår', quote_ready: 'Offert klar',
  awaiting_customer: 'Väntar på kund', approved: 'Godkänt', in_progress: 'Pågår', completed: 'Slutfört', cancelled: 'Avbrutet' }
const renoLabels: Record<string, string> = { draft: 'Utkast', new_application: 'Ny ansökan', submitted: 'Inskickad', review: 'Handläggs',
  need_info: 'Komplettering behövs', approved: 'Godkänd', conditional: 'Godkänd med villkor', rejected: 'Avslagen' }
const denied = new Set(['MODULE_ACCESS_REQUIRED', 'PRODUCT_ACCESS_REQUIRED', 'ORG_MEMBERSHIP_REQUIRED',
  'RENOAPP_MEMBERSHIP_REQUIRED', 'CUSTOMER_ORGANIZATION_MEMBER_REQUIRED', 'CUSTOMER_ORGANIZATION_ADMIN_REQUIRED'])

function candidatePattern(query: string) {
  const first = query.trim().split(/\s+/u)[0]
  return globalSearchCandidatePattern(first)
}

function chunks(values: string[]) {
  return Array.from({ length: Math.ceil(values.length / ID_CHUNK_SIZE) }, (_, index) => values.slice(index * ID_CHUNK_SIZE, (index + 1) * ID_CHUNK_SIZE))
}

function exactDesignation(query: string, value: unknown) {
  return Boolean(text(value)) && compactGlobalSearchText(query) === compactGlobalSearchText(text(value))
}

function mergeSelections(...selections: Selection[]): Selection {
  return { rows: [...new Map(selections.flatMap(selection => selection.rows).map(row => [id(row.id), row])).values()],
    hasMore: selections.some(selection => selection.hasMore), timedOut: selections.some(selection => selection.timedOut) }
}

async function executeRead(reader: Reader, execution?: Execution): Promise<ReadResult> {
  return execution
    ? execution.run(async () => await reader.abortSignal(execution.signal))
    : await reader
}

function isTimeout(error: unknown) {
  return error instanceof Error && error.message === 'GLOBAL_SEARCH_TIMEOUT'
}

function selectedResults(query: string, results: GlobalSearchResult[], selection: Selection, moduleId: string, label: string): GlobalSearchProviderResult {
  return { ...limited(query, results, selection.hasMore),
    ...(selection.timedOut ? { issues: [{ moduleId, label, message: 'Sökningen tog för lång tid. Förfina sökningen eller försök igen.' }] } : {}) }
}

async function readFields(database: Database, table: string, columns: string, scope: Scope,
  fields: string[], query: string, extra: Array<() => Reader> = [],
  accept: (rows: Row[]) => Promise<Row[]> | Row[] = rows => rows,
  resultLimit = GLOBAL_SEARCH_MODULE_LIMIT, execution?: Execution, patternOverride?: string): Promise<Selection> {
  const pattern = patternOverride ?? candidatePattern(query)
  const sources = [...fields.map(field => () => scope(database.from(table).select(columns)).ilike(field, pattern)), ...extra]
    .map(read => ({ read, offset: 0, done: false }))
  const rows = new Map<string, Row>()
  const seen = new Set<string>()
  let timedOut = false
  while (sources.some(source => !source.done) && rows.size <= resultLimit) {
    try {
      execution?.check()
      const pages = await Promise.allSettled(sources.filter(source => !source.done).map(async source => ({
        source, result: await executeRead(source.read().order('id').range(source.offset, source.offset + PAGE_SIZE - 1), execution),
      })))
      const candidates: Row[] = []
      let failure: unknown
      for (const pageResult of pages) {
        if (pageResult.status === 'rejected') { failure ??= pageResult.reason; continue }
        const { source, result } = pageResult.value
        if (result.error) { failure ??= new Error('GLOBAL_SEARCH_EXTENDED_READ_FAILED'); continue }
        const page = result.data ?? []
        if (page.length > PAGE_SIZE) throw new Error('GLOBAL_SEARCH_SOURCE_INVALID')
        source.done = page.length < PAGE_SIZE
        source.offset += PAGE_SIZE
        for (const row of page) if (id(row.id) && !seen.has(id(row.id))) {
          seen.add(id(row.id)); candidates.push(row)
        }
      }
      for (const row of await accept(candidates)) rows.set(id(row.id), row)
      if (failure) throw failure
    } catch (error) {
      const reason = execution?.signal.aborted ? execution.signal.reason : error
      if (!isTimeout(reason)) throw reason
      timedOut = true
      break
    }
  }
  return { rows: [...rows.values()], hasMore: timedOut || rows.size > resultLimit || sources.some(source => !source.done), timedOut }
}

function limited(query: string, results: GlobalSearchResult[], hasMore: boolean): GlobalSearchProviderResult {
  const ranked = rankGlobalSearchResults(query, results)
  return { results: selectGlobalSearchKinds(query, ranked), hasMore: hasMore || ranked.length > GLOBAL_SEARCH_MODULE_LIMIT }
}

async function taskModuleAllowed(orgId: string) {
  const [organization, global] = await Promise.all([
    hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'organization', scopeId: orgId }),
    hasCurrentUserAccess({ productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'global' }),
  ])
  return organization || global
}

async function properties(input: GlobalSearchContext & { query: string }, database: Database): Promise<GlobalSearchProviderResult> {
  const columns = 'id,name,address,cadastral_id,municipality,city,status'
  const scope: Scope = reader => reader.eq('owner', input.userId)
  const exact = await readFields(database, 'properties', columns, scope, ['cadastral_id'], input.query,
    [], rows => rows.filter(row => exactDesignation(input.query, row.cadastral_id)), GLOBAL_SEARCH_MODULE_LIMIT, input.execution, globalSearchExactCandidatePattern(input.query))
  const coarse = exact.timedOut || exact.rows.length >= GLOBAL_SEARCH_MODULE_LIMIT ? { rows: [], hasMore: true, timedOut: exact.timedOut }
    : await readFields(database, 'properties', columns, scope, ['name', 'address', 'cadastral_id', 'municipality', 'city'], input.query,
      [], rows => rows.filter(row => matchesGlobalSearch(input.query, text(row.name), text(row.address), text(row.cadastral_id), text(row.municipality), text(row.city))), GLOBAL_SEARCH_MODULE_LIMIT, input.execution)
  const selected = mergeSelections(exact, coarse)
  const results = selected.rows.filter(row => matchesGlobalSearch(input.query, text(row.name), text(row.address), text(row.cadastral_id), text(row.municipality), text(row.city)))
    .map(row => ({ id: `properties:property:${id(row.id)}`, moduleId: 'properties', moduleLabel: 'Fastigheter', kind: 'property' as const,
      title: text(row.cadastral_id) || text(row.name) || text(row.address) || 'Fastighet',
      subtitle: globalSearchSubtitle(text(row.name), text(row.address), text(row.municipality), text(row.city)),
      propertyDesignation: text(row.cadastral_id) || undefined, status: text(row.status) || undefined,
      href: `/properties/${encodeURIComponent(id(row.id))}` }))
  return selectedResults(input.query, results, selected, 'properties', 'Fastigheter')
}

async function tasks(input: GlobalSearchContext & { query: string }, database: Database): Promise<GlobalSearchProviderResult> {
  // User RLS uses can_view_operational_task: issuer/assignee, their tree and org admins.
  // Archived tasks have no readable destination and remain excluded by that policy.
  const selected = await readFields(database, 'operational_tasks', 'id,title,description,context_label,status',
    reader => reader.eq('org_id', input.orgId).is('archived_at', null), ['title', 'description', 'context_label'], input.query,
    [], rows => rows.filter(row => matchesGlobalSearch(input.query, text(row.title), text(row.description), text(row.context_label))), GLOBAL_SEARCH_MODULE_LIMIT, input.execution)
  const results = selected.rows.filter(row => matchesGlobalSearch(input.query, text(row.title), text(row.description), text(row.context_label)))
    .map(row => ({ id: `tasks:task:${id(row.id)}`, moduleId: 'tasks', moduleLabel: 'Gizmo', kind: 'task' as const,
      title: text(row.title) || 'Uppgift', subtitle: globalSearchSubtitle('Uppgift', text(row.context_label)),
      status: taskLabels[text(row.status)], href: `/uppdrag?task=${encodeURIComponent(id(row.id))}` }))
  return selectedResults(input.query, results, selected, 'tasks', 'Gizmo')
}

async function projects(input: GlobalSearchContext & { query: string }, database: Database): Promise<GlobalSearchProviderResult> {
  const columns = 'id,title,property_address,property_id,customer_name,status'
  const scope: Scope = reader => reader.eq('org_id', input.orgId)
  // A project may link a property owned by another member. This is the same
  // organization-linked property access used by action_case_property_access.
  // Admin metadata is bounded by an INNER project join, never a global registry read.
  const admin = createSupabaseAdminClient() as unknown as Database
  const linkedColumns = 'id,name,cadastral_id,municipality,address,city,action_cases!inner(id,org_id)'
  const linkedById = new Map<string, Row>()
  const projectMatches = (row: Row) => {
    const property = linkedById.get(id(row.property_id))
    return matchesGlobalSearch(input.query, text(row.title), text(row.property_address), text(row.customer_name), text(property?.cadastral_id), text(property?.name), text(property?.address), text(property?.municipality), text(property?.city))
  }
  // Read exact-designation projects before broad metadata scans can fill a page
  // or exhaust the deadline. All candidate projects still pass user RLS.
  const exactLinked = await readFields(admin, 'properties', linkedColumns,
    reader => reader.eq('action_cases.org_id', input.orgId), ['cadastral_id'], input.query,
    [], rows => rows.filter(row => exactDesignation(input.query, row.cadastral_id)), GLOBAL_SEARCH_MODULE_LIMIT, input.execution, globalSearchExactCandidatePattern(input.query))
  for (const row of exactLinked.rows) linkedById.set(id(row.id), row)
  const exactProjects = await readFields(database, 'action_cases', columns, scope, [], input.query,
    chunks([...linkedById.keys()]).map(ids => () => scope(database.from('action_cases').select(columns)).in('property_id', ids)),
    rows => rows.filter(projectMatches), GLOBAL_SEARCH_MODULE_LIMIT, input.execution)
  const linked = exactProjects.rows.length >= GLOBAL_SEARCH_MODULE_LIMIT || exactLinked.timedOut || exactProjects.timedOut
    ? { rows: [], hasMore: true, timedOut: exactLinked.timedOut || exactProjects.timedOut }
    : await readFields(admin, 'properties', linkedColumns,
      reader => reader.eq('action_cases.org_id', input.orgId), ['cadastral_id', 'name', 'address', 'municipality', 'city'], input.query, [], rows => rows, Number.POSITIVE_INFINITY, input.execution)
  for (const row of linked.rows) linkedById.set(id(row.id), row)
  const byProperty = chunks([...linkedById.keys()]).map(ids => () => scope(database.from('action_cases').select(columns)).in('property_id', ids))
  const coarse = exactProjects.rows.length >= GLOBAL_SEARCH_MODULE_LIMIT ? { rows: [], hasMore: true, timedOut: false }
    : await readFields(database, 'action_cases', columns, scope,
    ['title', 'property_address', 'customer_name'], input.query, byProperty, async rows => {
      const missing = [...new Set(rows.map(row => id(row.property_id)).filter(propertyId => propertyId && !linkedById.has(propertyId)))]
      for (const ids of chunks(missing)) {
        const related = await executeRead(admin.from('properties').select(linkedColumns).eq('action_cases.org_id', input.orgId)
          .in('id', ids).order('id').limit(ids.length), input.execution)
        if (related.error) throw new Error('GLOBAL_SEARCH_EXTENDED_READ_FAILED')
        for (const property of related.data ?? []) linkedById.set(id(property.id), property)
      }
      return rows.filter(projectMatches)
    }, GLOBAL_SEARCH_MODULE_LIMIT, input.execution)
  const selected = mergeSelections(exactProjects, coarse)
  const results = selected.rows.flatMap<GlobalSearchResult>(row => {
    const property = linkedById.get(id(row.property_id))
    const designation = text(property?.cadastral_id)
    if (!projectMatches(row)) return []
    return [{ id: `tasks:project:${id(row.id)}`, moduleId: 'tasks', moduleLabel: 'Gizmo', kind: 'project',
      title: text(row.title) || 'Projekt', subtitle: globalSearchSubtitle(designation, text(row.property_address), text(row.customer_name)),
      propertyDesignation: designation || undefined, status: projectLabels[text(row.status)],
      href: `/uppdrag/${encodeURIComponent(id(row.id))}` }]
  })
  return selectedResults(input.query, results, { ...selected, hasMore: selected.hasMore || linked.hasMore || exactLinked.hasMore, timedOut: selected.timedOut || linked.timedOut || exactLinked.timedOut }, 'tasks', 'Gizmo')
}

async function customers(input: GlobalSearchContext & { query: string }): Promise<GlobalSearchProviderResult> {
  const context = input.execution ? await input.execution.run(() => getOrganizationCustomerNavigationContext(input.orgId)) : await getOrganizationCustomerNavigationContext(input.orgId)
  if (context.organization.id !== input.orgId) throw new Error('CUSTOMER_ORGANIZATION_MEMBER_REQUIRED')
  const admin = createSupabaseAdminClient() as unknown as Database
  const columns = 'id,customer_number,name,address,city,is_active'
  const scope: Scope = reader => reader.eq('org_id', context.organization.id)
  const numeric = /^\d{1,12}$/u.test(input.query) ? Number(input.query) : null
  const byNumber = numeric !== null && Number.isSafeInteger(numeric)
    ? [() => scope(admin.from('organization_customers').select(columns)).eq('customer_number', numeric)] : []
  const selected = await readFields(admin, 'organization_customers', columns, scope, ['name', 'address', 'city'], input.query, byNumber,
    rows => rows.filter(row => matchesGlobalSearch(input.query, text(row.name), String(row.customer_number ?? ''), text(row.address), text(row.city))), GLOBAL_SEARCH_MODULE_LIMIT, input.execution)
  const results = selected.rows.filter(row => matchesGlobalSearch(input.query, text(row.name), String(row.customer_number ?? ''), text(row.address), text(row.city)))
    .map(row => ({ id: `customers:customer:${id(row.id)}`, moduleId: 'customers', moduleLabel: 'Kundregister', kind: 'customer' as const,
      title: text(row.name) || 'Kund', subtitle: globalSearchSubtitle(`Kund ${String(row.customer_number ?? '')}`, text(row.address), text(row.city)),
      status: row.is_active === false ? 'Inaktiv' : undefined,
      href: `/settings/kunder?${new URLSearchParams({ orgId: input.orgId, customerId: id(row.id), q: String(row.customer_number ?? row.name ?? ''), ...(row.is_active === false ? { inactive: '1' } : {}) })}` }))
  return selectedResults(input.query, results, selected, 'customers', 'Kundregister')
}

async function renoapp(input: GlobalSearchContext & { query: string }): Promise<GlobalSearchProviderResult> {
  const context = input.execution ? await input.execution.run(() => requireRenoAppViewerContext()) : await requireRenoAppViewerContext()
  if (context.userId !== input.userId) throw new Error('UNAUTHORIZED')
  const brfIds = context.authorizedBrfIds ?? []
  if (!brfIds.length) return { results: [], hasMore: false }
  const admin = createSupabaseAdminClient() as unknown as Database
  const brfs = new Map<string, Row>()
  for (const ids of chunks(brfIds)) {
    const result = await executeRead(admin.from('brf_associations').select('id,name,address,property_designation').in('id', ids).order('id').limit(ids.length), input.execution)
    if (result.error) throw new Error('GLOBAL_SEARCH_EXTENDED_READ_FAILED')
    for (const row of result.data ?? []) brfs.set(id(row.id), row)
  }
  const firstWord = input.query.trim().split(/\s+/u)[0]
  const designationMatches = [...brfs.values()].filter(row => matchesGlobalSearch(firstWord, text(row.name), text(row.address), text(row.property_designation))).map(row => id(row.id))
  const exactBrfIds = [...brfs.values()].filter(row => exactDesignation(input.query, row.property_designation)).map(row => id(row.id))
  const columns = 'id,brf_id,case_number,title,status,unit_number_internal,unit_number_skatteverket'
  const fields = ['case_number', 'title', 'unit_number_internal', 'unit_number_skatteverket']
  const searches = chunks(brfIds).flatMap(ids => fields.map(field => () => admin.from('renovation_cases').select(columns)
    .in('brf_id', ids).ilike(field, candidatePattern(input.query))))
  searches.push(...[...chunks(exactBrfIds), ...chunks(designationMatches)].map(ids => () => admin.from('renovation_cases').select(columns).in('brf_id', ids)))
  const caseMatches = (row: Row) => {
    if (!brfIds.includes(id(row.brf_id))) return false
    const brf = brfs.get(id(row.brf_id))
    return matchesGlobalSearch(input.query, text(row.case_number), text(row.title), text(row.unit_number_internal), text(row.unit_number_skatteverket), text(brf?.name), text(brf?.address), text(brf?.property_designation))
  }
  const selected = await readFields(admin, 'renovation_cases', columns, reader => reader, [], input.query, searches, rows => rows.filter(caseMatches), GLOBAL_SEARCH_MODULE_LIMIT, input.execution)
  const results = selected.rows.flatMap<GlobalSearchResult>(row => {
    if (!brfIds.includes(id(row.brf_id))) return []
    const brf = brfs.get(id(row.brf_id))
    if (!matchesGlobalSearch(input.query, text(row.case_number), text(row.title), text(row.unit_number_internal), text(row.unit_number_skatteverket), text(brf?.name), text(brf?.address), text(brf?.property_designation))) return []
    return [{ id: `renoapp:case:${id(row.id)}`, moduleId: 'renoapp', moduleLabel: 'RenoApp', kind: 'case',
      title: text(row.title) || text(row.case_number) || 'Renoveringsärende',
      subtitle: globalSearchSubtitle(text(row.case_number), text(brf?.name), text(brf?.address)),
      propertyDesignation: text(brf?.property_designation) || undefined, status: renoLabels[text(row.status)],
      href: `/renoapp/app/cases/${encodeURIComponent(id(row.id))}` }]
  })
  return selectedResults(input.query, results, selected, 'renoapp', 'RenoApp')
}

export async function searchExtendedModules(input: GlobalSearchContext & { query: string }, taskAccess?: () => Promise<boolean>): Promise<Provider> {
  const database = createSupabaseServerClient() as unknown as Database
  const work: Array<{ moduleId: string; label: string; run: () => Promise<GlobalSearchProviderResult> }> = [
    { moduleId: 'properties', label: 'Fastigheter', run: () => properties(input, database) },
    { moduleId: 'customers', label: 'Kundregister', run: () => customers(input) },
    { moduleId: 'renoapp', label: 'RenoApp', run: () => renoapp(input) },
  ]
  work.push({ moduleId: 'tasks', label: 'Gizmo', run: async () => {
      // The caller may reuse its request-scoped access snapshot. Never run-wrap
      // that callback: its scoped/global checks already acquire their own slots.
      const allowed = taskAccess ? await taskAccess()
        : input.execution ? await input.execution.run(() => taskModuleAllowed(input.orgId)) : await taskModuleAllowed(input.orgId)
      if (!allowed) return { results: [], hasMore: false }
      const results = await Promise.allSettled([projects(input, database), tasks(input, database)])
      const available = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      for (const result of results) if (result.status === 'rejected' && result.reason instanceof Error && ['UNAUTHORIZED', 'GLOBAL_SEARCH_ABORTED'].includes(result.reason.message)) throw result.reason
      return { ...limited(input.query, available.flatMap(result => result.results), available.some(result => result.hasMore)),
        issues: [...available.flatMap(result => result.issues ?? []), ...(results.some(result => result.status === 'rejected')
          ? [{ moduleId: 'tasks', label: 'Gizmo', message: 'Alla projekt eller uppgifter kunde inte sökas igenom.' }] : [])] }
    } })
  const settled = await Promise.allSettled(work.map(provider => provider.run()))
  const output: Provider = { results: [], hasMore: false, issues: [] }
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') {
      output.results.push(...result.value.results)
      output.hasMore ||= result.value.hasMore
      output.issues!.push(...(result.value.issues ?? []))
      continue
    }
    const code = result.reason instanceof Error ? result.reason.message : ''
    if (['UNAUTHORIZED', 'GLOBAL_SEARCH_ABORTED'].includes(code)) throw result.reason
    if (!denied.has(code)) output.issues!.push({ moduleId: work[index].moduleId, label: work[index].label, message: 'Sökningen kunde inte slutföras i detta arbetsområde.' })
  }
  return output
}
