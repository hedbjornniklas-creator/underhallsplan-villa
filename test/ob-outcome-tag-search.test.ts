import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'

const helperPath = '../src/lib/ob/searchOutcomeRows.ts'
const searchPath = '../src/lib/ob/roundSearch.ts'
const { searchOutcomeRows } = await import(helperPath) as typeof import('../src/lib/ob/searchOutcomeRows')
const { matchesWords, noteMatchRank } = await import(searchPath) as typeof import('../src/lib/ob/roundSearch')
const row = (id: string) => ({
  id, control_point_id: 'point', label: `Notering ${id}`,
  note_template: 'Iakttagelse', risk_template: null, ftu_template: null,
})

function setup(textRows = [row('text'), row('both')], tagRows = [row('both'), row('tag')], fail?: 'text' | 'tag') {
  const urls: URL[] = []
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      urls.push(url)
      const kind = url.searchParams.has('tags') ? 'tag' : 'text'
      return new Response(JSON.stringify(kind === fail
        ? { message: `${kind} search failed`, code: '42501', details: '', hint: '' }
        : kind === 'tag' ? tagRows : textRows), {
        status: kind === fail ? 403 : 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } },
  })
  return { client, urls }
}

test('outcome search unions text and exact JSON tags, preserves distinct outcomes and deduplicates IDs', async () => {
  const { client, urls } = setup()
  const result = await searchOutcomeRows(client, '  OTÄT  ')
  assert.equal(result.error, null)
  assert.deepEqual(result.data, [row('text'), row('both'), row('tag')])
  assert.equal(urls.length, 2)
  for (const url of urls) {
    assert.equal(url.pathname, '/rest/v1/settings_control_point_outcomes')
    assert.equal(url.searchParams.get('is_active'), 'eq.true')
    assert.ok(url.searchParams.get('select')?.split(',').includes('id'))
  }
  assert.equal(urls.find(url => url.searchParams.has('tags'))?.searchParams.get('tags'), 'cs.["otät"]')
  assert.equal(urls.find(url => url.searchParams.has('or'))?.searchParams.get('or'),
    '(label.ilike."%OTÄT%",note_template.ilike."%OTÄT%",risk_template.ilike."%OTÄT%",ftu_template.ilike."%OTÄT%")')
})

test('search punctuation is encoded as a value, including in JSON tags', async () => {
  const { client, urls } = setup([], [])
  const query = 'a,"b"\\c'
  await searchOutcomeRows(client, query)
  assert.equal(urls.find(url => url.searchParams.has('tags'))?.searchParams.get('tags'), `cs.${JSON.stringify([query])}`)
  const value = JSON.stringify(`%${query}%`)
  assert.equal(urls.find(url => url.searchParams.has('or'))?.searchParams.get('or'),
    `(${['label', 'note_template', 'risk_template', 'ftu_template'].map(field => `${field}.ilike.${value}`).join(',')})`)
})

for (const fail of ['text', 'tag'] as const) {
  test(`a ${fail} query error is returned instead of incomplete search results`, async () => {
    const { client } = setup(undefined, undefined, fail)
    const result = await searchOutcomeRows(client, 'glipa')
    assert.equal(result.data, null)
    assert.equal(result.error?.message, `${fail} search failed`)
  })
}

test('no text or tag matches returns an empty result', async () => {
  const { client } = setup([], [])
  assert.deepEqual(await searchOutcomeRows(client, 'saknas'), { data: [], error: null })
})

test('an outcome tag ranks ahead of a sibling found only through their shared control-point tags', () => {
  const opening = { ...row('opening'), label: 'Öppna anslutningar vid plåtdetaljer', tags: ['glipa'] }
  const corrosion = { ...row('corrosion'), label: 'Korrosion på plåtdetaljer', tags: ['rost'] }
  assert.equal(noteMatchRank(opening, 'glipa'), 2)
  assert.equal(noteMatchRank(corrosion, 'glipa'), 0)
  assert.deepEqual([corrosion, opening].sort((a, b) => noteMatchRank(b, 'glipa') - noteMatchRank(a, 'glipa')),
    [opening, corrosion])
  assert.equal(noteMatchRank({ ...opening, label: 'Glipa vid plåtdetaljer' }, 'glipa'), 3)
})

test('mobile and image-note search use outcome tags without changing the report text', () => {
  const read = (path: string) => readFileSync(new URL(`../src/components/ob/${path}.tsx`, import.meta.url), 'utf8')
  const outcome = { ...row('tag'), tags: ['glipa', 'otät', 'plåt', 'fönster'] }
  const original = JSON.stringify(outcome)
  for (const component of ['ObMobileRound', 'ObImageNoteForm']) {
    const expression = read(component).match(/matchesWords\(\s*(\[[\s\S]*?\]\.join\(' '\))/)?.[1]
    assert.ok(expression, `${component}: exercise the production search text`)
    const text = new Function('outcome', 'point', `return ${expression}`)(outcome, {}) as string
    for (const tag of outcome.tags) assert.equal(matchesWords(text, tag), true, `${component}: ${tag}`)
    assert.equal(matchesWords(text, 'källare'), false)
  }
  assert.equal(JSON.stringify(outcome), original)
  for (const component of ['ObStepRunda', 'ObStepInsida', 'ObStepUtsida']) {
    assert.match(read(component), /await searchOutcomeRows\(supabase, trimmed\)/)
  }
})
