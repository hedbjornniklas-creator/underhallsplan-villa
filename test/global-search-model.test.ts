import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Native Node TypeScript tests require the extension.
import { InvalidGlobalSearchQuery, globalSearchCandidatePattern, globalSearchPattern, matchesGlobalSearch, parseGlobalSearchQuery, rankGlobalSearchResults, selectGlobalSearchKinds, type GlobalSearchResult } from '../src/lib/globalSearch/model.ts'

const result = (id: string, values: Partial<GlobalSearchResult> = {}): GlobalSearchResult => ({
  id, moduleId: 'ob', moduleLabel: 'Överlåtelsebesiktning', kind: 'inspection', title: id, subtitle: '', href: `/ob/${id}`, ...values,
})

test('query validation rejects invalid shapes and control characters before provider reads', () => {
  assert.equal(parseGlobalSearchQuery('  Björnen   1:12  '), 'Björnen 1:12')
  for (const value of [null, ['Björnen'], 'x'.repeat(201), 'Björnen\u0000', 'Björnen\n1:12']) {
    assert.throws(() => parseGlobalSearchQuery(value), InvalidGlobalSearchQuery)
  }
})

test('Swedish names and designation spacing/colon variants match the same property', () => {
  assert.equal(matchesGlobalSearch('Björnen1:12', 'BJÖRNEN 1 : 12'), true)
  assert.equal(matchesGlobalSearch('bjornen 1:12', 'Björnen 1:12'), true)
  assert.equal(matchesGlobalSearch('Björnen', 'Bjo\u0308rnen'), true)
  assert.equal(matchesGlobalSearch('Björnen 1:12 Andersson', 'Björnen 1:12', 'Anna Andersson'), true)
  assert.equal(matchesGlobalSearch('Björnen 1:13', 'Björnen 1:12'), false)
})

test('literal LIKE patterns cannot turn user wildcard characters into broad matches', () => {
  assert.equal(globalSearchPattern('a%b_c\\d'), '%a\\%b\\_c\\\\d%')
  assert.equal(globalSearchCandidatePattern('Björnen1:12'), '%bj_rn_n%')
  assert.equal(globalSearchCandidatePattern('1:12'), '%12%')
  assert.equal(globalSearchCandidatePattern('%_'), '%\\%\\_%')
})

test('ranking prioritizes a property designation and drops external/unsafe destinations', () => {
  const rows = rankGlobalSearchResults('Björnen 1:12', [
    result('title', { title: 'Björnen 1:12' }),
    result('designation', { title: 'Utredning', propertyDesignation: 'Björnen 1:12' }),
    result('external', { href: 'https://other.invalid' }),
    result('network', { href: '//other.invalid' }),
    result('slash', { href: '/\\other.invalid' }),
    result('designation', { title: 'Duplicate' }),
  ])
  assert.deepEqual(rows.map(row => row.id), ['designation', 'title'])
})

test('a busy property still shows that both a report and inspection exist', () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, index) => result(`pdf${index}`, { title: `Utlåtande ${index}`, kind: 'report' })),
    result('inspection', { title: 'Besiktning', kind: 'inspection' }),
    result('confirmation', { title: 'Bekräftelse', kind: 'assignment' }),
  ]
  const selected = selectGlobalSearchKinds('Björnen', rows, 8)
  assert.equal(selected.length, 8)
  assert(selected.some(row => row.kind === 'inspection'))
  assert(selected.some(row => row.kind === 'report'))
  assert(selected.some(row => row.kind === 'assignment'))
})
