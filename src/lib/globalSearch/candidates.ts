// @ts-expect-error Node's native TypeScript tests require the extension.
import { GLOBAL_SEARCH_MODULE_LIMIT, compactGlobalSearchText, rankGlobalSearchResults, type GlobalSearchExecution, type GlobalSearchIssue, type GlobalSearchProviderResult, type GlobalSearchResult } from './model.ts'

export const GLOBAL_SEARCH_PAGE_SIZE = 25

/**
 * Page a coarse, scoped metadata query until enough actual matches are found.
 * There is no arbitrary early scan cutoff that could hide an older match.
 * Callers select metadata only and apply literal .ilike() values to static fields.
 */
export async function readGlobalSearchCandidates<T>(input: {
  query: string
  fields: readonly string[]
  exactFields?: readonly string[]
  read: (field: string, offset: number, size: number, exact?: boolean) => Promise<T[]>
  project: (row: T) => Promise<GlobalSearchResult[]> | GlobalSearchResult[]
  key: (row: T) => string
  limit?: number
  execution?: GlobalSearchExecution
  timeoutIssue?: GlobalSearchIssue
}): Promise<GlobalSearchProviderResult> {
  const limit = input.limit ?? GLOBAL_SEARCH_MODULE_LIMIT
  const found = new Map<string, GlobalSearchResult>()
  const projected = new Map<string, GlobalSearchResult[]>()
  let unprojected = false
  let unfinished = false
  try {
    for (const exact of [true, false]) {
      const states = (exact ? input.exactFields ?? [] : input.fields).map(field => ({ field, offset: 0, done: false }))
      while (states.some(state => !state.done) && found.size <= limit) {
        input.execution?.check()
        const active = states.filter(state => !state.done)
        const pages = await Promise.allSettled(active.map(async state => ({ state,
          rows: input.execution ? await input.execution.run(() => input.read(state.field, state.offset, GLOBAL_SEARCH_PAGE_SIZE, exact))
            : await input.read(state.field, state.offset, GLOBAL_SEARCH_PAGE_SIZE, exact),
        })))
        let failure: unknown
        for (const page of pages) {
          if (page.status === 'rejected') { failure ??= page.reason; continue }
          const { state, rows } = page.value
          if (rows.length > GLOBAL_SEARCH_PAGE_SIZE) throw new Error('GLOBAL_SEARCH_SOURCE_INVALID')
          state.done = rows.length < GLOBAL_SEARCH_PAGE_SIZE
          state.offset += GLOBAL_SEARCH_PAGE_SIZE
          for (const row of rows) {
            input.execution?.check()
            if (found.size > limit) { unprojected = true; break }
            const key = input.key(row)
            let results = projected.get(key)
            if (!results) { results = await input.project(row); projected.set(key, results) }
            for (const result of results) {
              if (exact && compactGlobalSearchText(result.propertyDesignation ?? '') !== compactGlobalSearchText(input.query)) continue
              found.set(result.id, result)
            }
          }
        }
        if (failure) throw failure
      }
      unfinished ||= states.some(state => !state.done)
    }
  } catch (error) {
    const reason = input.execution?.signal.aborted ? input.execution.signal.reason : error
    if (!(reason instanceof Error) || reason.message !== 'GLOBAL_SEARCH_TIMEOUT') throw reason
    return { results: rankGlobalSearchResults(input.query, [...found.values()]).slice(0, limit), hasMore: true,
      issues: [input.timeoutIssue ?? { moduleId: 'search', label: 'Sökning', message: 'Sökningen tog för lång tid. Förfina sökningen eller försök igen.' }] }
  }
  return { results: rankGlobalSearchResults(input.query, [...found.values()]).slice(0, limit),
    hasMore: found.size > limit || unprojected || unfinished }
}
