import 'server-only'

import { createDashboardAccessRequest } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { searchOb, searchTu, searchEb, searchMoisture } from './providers'
import { searchExtendedModules } from './extended'
import { createGlobalSearchExecution } from './runtime'
import {
  GLOBAL_SEARCH_MIN_LENGTH, GLOBAL_SEARCH_MODULE_LIMIT, GLOBAL_SEARCH_RESULT_LIMIT,
  parseGlobalSearchQuery, rankGlobalSearchResults,
  type GlobalSearchContext, type GlobalSearchProviderResult, type GlobalSearchResponse,
} from './model'

const MODULES = [
  { id: 'ob', label: 'Överlåtelsebesiktning', key: 'inspections', search: searchOb },
  { id: 'eb', label: 'Entreprenadbesiktning', key: 'construction_inspections', search: searchEb },
  { id: 'tu', label: 'Tekniska utredningar', key: 'technical_investigations', search: searchTu },
  { id: 'moisture', label: 'Fuktsäkerhet', key: 'moisture_safety', search: searchMoisture },
] as const

const fatalAccessErrors = new Set(['UNAUTHORIZED', 'ORG_MEMBERSHIP_REQUIRED', 'ORG_SELECTION_INVALID', 'GLOBAL_SEARCH_SCOPE_MISMATCH', 'GLOBAL_SEARCH_ABORTED'])

export async function searchHusHub(queryValue: unknown, requestedOrgId?: unknown, signal?: AbortSignal): Promise<GlobalSearchResponse> {
  const query = parseGlobalSearchQuery(queryValue)
  const execution = createGlobalSearchExecution(signal)
  try {
  const context = await execution.run(() => requireOrgContext(requestedOrgId))
  if (requestedOrgId !== undefined && context.orgId !== (await execution.run(() => requireOrgContext())).orgId) {
    // OB/EB/Gizmo destinations still resolve the default organization. Until
    // their whole flow supports explicit selection, never return a wrong-org URL.
    throw new Error('GLOBAL_SEARCH_ORGANIZATION_UNSUPPORTED')
  }
  const access = await execution.run(() => createDashboardAccessRequest())
  if (access.userId !== context.userId) throw new Error('UNAUTHORIZED')
  const allowed = async (moduleKey?: (typeof MODULES)[number]['key'] | 'tasks') => {
    const [scoped, global] = await Promise.all([
      execution.run(() => access.hasAccess({ moduleKey, scopeType: 'organization', scopeId: context.orgId })),
      execution.run(() => access.hasAccess({ moduleKey, scopeType: 'global' })),
    ])
    return scoped || global
  }
  if (!await allowed()) throw new Error('MODULE_ACCESS_REQUIRED')
  if (query.length < GLOBAL_SEARCH_MIN_LENGTH) return { query, results: [], hasMore: false, issues: [] }

  const selected: GlobalSearchContext = { orgId: context.orgId, userId: context.userId, role: context.role, execution }
  const readers = [
    ...MODULES.map(module => ({ id: module.id, label: module.label, read: async (): Promise<GlobalSearchProviderResult> => {
      if (!await allowed(module.key)) return { results: [], hasMore: false }
      try { return await module.search(selected, query) }
      catch (error) {
        // A revoked or unavailable module is not an empty authorized module.
        // Its records are simply not part of this user's global search.
        if (error instanceof Error && ['MODULE_ACCESS_REQUIRED', 'PRODUCT_ACCESS_REQUIRED'].includes(error.message)) {
          return { results: [], hasMore: false }
        }
        throw error
      }
    } })),
    { id: 'extended', label: 'Övriga arbetsområden', read: () => searchExtendedModules({ ...selected, query }, () => allowed('tasks')) },
  ]
  const outcomes = await Promise.allSettled(readers.map(reader => reader.read()))
  const response: GlobalSearchResponse = { query, results: [], hasMore: false, issues: [] }
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      const code = outcome.reason instanceof Error ? outcome.reason.message : ''
      if (fatalAccessErrors.has(code)) throw outcome.reason
      response.hasMore ||= code === 'GLOBAL_SEARCH_TIMEOUT'
      response.issues.push({ moduleId: readers[index].id, label: readers[index].label,
        message: code === 'GLOBAL_SEARCH_TIMEOUT' ? 'Sökningen tog för lång tid. Förfina sökningen eller försök igen.' : 'Sökningen i arbetsområdet kunde inte hämtas. Försök igen.' })
      return
    }
    response.results.push(...outcome.value.results)
    response.hasMore ||= outcome.value.hasMore
    response.issues.push(...(outcome.value.issues ?? []))
  })
  const ranked = rankGlobalSearchResults(query, response.results)
  const moduleCounts = new Map<string, number>()
  const capped = ranked.filter(result => {
    const count = moduleCounts.get(result.moduleId) ?? 0
    if (count >= GLOBAL_SEARCH_MODULE_LIMIT) return false
    moduleCounts.set(result.moduleId, count + 1)
    return true
  })
  // Keep every matching module represented, even if one has many reports.
  const selectedIds = new Set<string>()
  const represented = new Set<string>()
  for (const result of capped) {
    if (!represented.has(result.moduleId) && selectedIds.size < GLOBAL_SEARCH_RESULT_LIMIT) {
      represented.add(result.moduleId)
      selectedIds.add(result.id)
    }
  }
  for (const result of capped) {
    if (selectedIds.size >= GLOBAL_SEARCH_RESULT_LIMIT) break
    selectedIds.add(result.id)
  }
  response.results = capped.filter(result => selectedIds.has(result.id))
  response.hasMore ||= ranked.length > response.results.length
  return response
  } finally { execution.dispose() }
}
