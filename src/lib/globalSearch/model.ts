export const GLOBAL_SEARCH_MIN_LENGTH = 2
export const GLOBAL_SEARCH_MAX_LENGTH = 200
export const GLOBAL_SEARCH_RESULT_LIMIT = 40
export const GLOBAL_SEARCH_TOTAL_LIMIT = GLOBAL_SEARCH_RESULT_LIMIT
export const GLOBAL_SEARCH_MODULE_LIMIT = 8

export type GlobalSearchKind = 'property' | 'inspection' | 'report' | 'assignment' | 'project' | 'case' | 'customer' | 'task'

export type GlobalSearchResult = {
  id: string
  moduleId: string
  moduleLabel: string
  kind: GlobalSearchKind
  title: string
  subtitle: string
  href: string
  propertyDesignation?: string | null
  status?: string | null
}

export type GlobalSearchIssue = { moduleId: string; label: string; message: string }
export type GlobalSearchProviderResult = { results: GlobalSearchResult[]; hasMore: boolean; issues?: GlobalSearchIssue[] }
export type GlobalSearchResponse = GlobalSearchProviderResult & { query: string; issues: GlobalSearchIssue[] }
export type GlobalSearchExecution = {
  signal: AbortSignal
  run<T>(work: () => Promise<T>): Promise<T>
  check(): void
}
export type GlobalSearchContext = { orgId: string; userId: string; role: string; execution?: GlobalSearchExecution }

export class InvalidGlobalSearchQuery extends Error {}

export function parseGlobalSearchQuery(value: unknown): string {
  if (typeof value !== 'string' || value.length > GLOBAL_SEARCH_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InvalidGlobalSearchQuery('Sökningen får innehålla högst 200 tecken.')
  }
  return value.trim().replace(/\s+/gu, ' ')
}

export function normalizeGlobalSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('sv-SE').replace(/\s+/gu, ' ').trim()
}

export function matchesGlobalSearch(query: string, ...values: Array<string | null | undefined>): boolean {
  const words = normalizeGlobalSearchText(query).split(' ').filter(Boolean)
  const text = normalizeGlobalSearchText(values.filter(Boolean).join(' '))
  const compact = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '')
  const compactText = compact(text)
  return words.every(word => text.includes(word) || (compact(word).length > 0 && compactText.includes(compact(word))))
}

/** Values passed to .ilike(), never interpolated into a PostgREST .or() clause. */
export function globalSearchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/gu, character => `\\${character}`)}%`
}

/** Broad DB candidate only; exact normalized matching still happens afterward. */
export function globalSearchCandidatePattern(query: string): string {
  const words = normalizeGlobalSearchText(query).replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .match(/[\p{L}\p{N}]+/gu) ?? []
  const anchor = words.sort((left, right) => right.length - left.length)[0]
  // Vowel positions may hold Swedish diacritics in storage (a/å/ä, o/ö).
  // Only this generated pattern contains wildcards; user punctuation stays literal.
  return anchor ? `%${anchor.replace(/[aeiouy]/gu, '_')}%` : globalSearchPattern(query)
}

export function compactGlobalSearchText(value: string): string {
  return normalizeGlobalSearchText(value).replace(/[^\p{L}\p{N}]/gu, '')
}

/** Whole-field designation candidate, tolerant of Swedish vowels and separators. */
export function globalSearchExactCandidatePattern(query: string): string {
  const chunks = normalizeGlobalSearchText(query).replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .match(/[\p{L}\p{N}]+/gu)
  return chunks?.length ? chunks.map(chunk => chunk.replace(/[aeiouy]/gu, '_')).join('%')
    : globalSearchPattern(query).slice(1, -1)
}

export function globalSearchSubtitle(...values: Array<string | null | undefined>): string {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].join(' · ')
}

export function rankGlobalSearchResults(query: string, results: GlobalSearchResult[]): GlobalSearchResult[] {
  const normalized = normalizeGlobalSearchText(query)
  const compact = (value: string) => normalizeGlobalSearchText(value).replace(/[^\p{L}\p{N}]/gu, '')
  const compactQuery = compact(query)
  function score(result: GlobalSearchResult) {
    const designation = normalizeGlobalSearchText(result.propertyDesignation ?? '')
    const title = normalizeGlobalSearchText(result.title)
    if (designation && (designation === normalized || compact(designation) === compactQuery)) return 0
    if (title === normalized) return 1
    if (designation && designation.startsWith(normalized)) return 2
    if (title.startsWith(normalized)) return 3
    return 4
  }
  const collator = new Intl.Collator('sv-SE', { numeric: true, sensitivity: 'base' })
  const unique = new Map<string, GlobalSearchResult>()
  for (const result of results) {
    // Every destination is constructed on the server, and must remain local.
    if (!result.href.startsWith('/') || result.href.startsWith('//') || /[\u0000-\u001f\\]/u.test(result.href)) continue
    if (!unique.has(result.id)) unique.set(result.id, result)
  }
  return [...unique.values()].sort((left, right) => score(left) - score(right)
    || Number(right.kind === 'report') - Number(left.kind === 'report')
    || collator.compare(left.title, right.title) || collator.compare(left.moduleLabel, right.moduleLabel)
    || left.id.localeCompare(right.id))
}

/** Show the existence of each matching content kind before filling a module. */
export function selectGlobalSearchKinds(query: string, results: GlobalSearchResult[], limit = GLOBAL_SEARCH_MODULE_LIMIT): GlobalSearchResult[] {
  const ranked = rankGlobalSearchResults(query, results)
  const kinds = new Set<GlobalSearchKind>()
  const selected = new Set<string>()
  for (const result of ranked) {
    if (!kinds.has(result.kind) && selected.size < limit) {
      kinds.add(result.kind)
      selected.add(result.id)
    }
  }
  for (const result of ranked) {
    if (selected.size >= limit) break
    selected.add(result.id)
  }
  return ranked.filter(result => selected.has(result.id))
}

