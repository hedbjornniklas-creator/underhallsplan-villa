import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const helperPath = '../src/lib/ob/selectedOutcomeLookup.ts'
const { fetchSelectedOutcomes } = await import(helperPath) as typeof import('../src/lib/ob/selectedOutcomeLookup')
const archived = { id: 'archived', control_point_id: 'active-parent', label: 'Tidigare val', is_active: false }
const moved = { id: 'moved', control_point_id: 'new-parent', label: 'Flyttat val', is_active: true }

test('selected outcomes are fetched by ID regardless of activity or current parent', async () => {
  const urls: URL[] = []
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      urls.push(new URL(input instanceof Request ? input.url : String(input)))
      return new Response(JSON.stringify([archived, moved]), { headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const rows = await fetchSelectedOutcomes(client, ['archived', 'moved', 'archived'])
  assert.deepEqual(rows, { archived, moved })
  assert.equal(urls.length, 1)
  assert.equal(urls[0].searchParams.get('id'), 'in.(archived,moved)')
  assert.equal(urls[0].searchParams.has('is_active'), false)
  assert.equal(urls[0].searchParams.has('control_point_id'), false)
  assert.deepEqual(await fetchSelectedOutcomes(client, []), {})
  assert.equal(urls.length, 1, 'empty selection does not read the catalogue')
})

test('historical lookup errors do not masquerade as missing outcomes', async () => {
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({ message: 'denied', code: '42501' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }) },
  })
  await assert.rejects(fetchSelectedOutcomes(client, ['archived']), { message: 'denied' })
})

test('legacy editors resolve selected inactive and reparented outcomes without adding them to new choices', () => {
  const read = (file: string) => readFileSync(new URL(`../src/components/ob/${file}.tsx`, import.meta.url), 'utf8')
  for (const [file, count] of [['ObStepRunda', 2], ['ObStepInsida', 2], ['ObStepUtsida', 1]] as const) {
    const source = read(file)
    const ast = ts.createSourceFile(file + '.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const expressions: string[] = []
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selectedOutcome' && node.initializer) {
        expressions.push(node.initializer.getText(ast))
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.equal(expressions.length, count, `${file}: exercise every selected-outcome display`)
    const activeChoices = Object.freeze([{ id: 'other-active', is_active: true }])
    for (const row of [archived, moved]) {
      const item = { selected_outcome_id: row.id, control_point_id: 'old-parent', note: 'Sparad kundtext' }
      for (const expression of expressions) {
        const result = new Function('item', 'ci', 'outcomes', 'selectedOutcomes', `return (${expression})`)(
          item, item, activeChoices, { [row.id]: row },
        )
        assert.equal(result, row, `${file}: ${row.id} must remain visible`)
      }
      assert.equal(item.note, 'Sparad kundtext')
      assert.equal(item.control_point_id, 'old-parent')
    }
    assert.deepEqual(activeChoices.map(row => row.id), ['other-active'])
    assert.match(source, /\.from\('settings_control_point_outcomes'\)[\s\S]*?\.eq\('is_active', true\)/)
    assert.match(source, /outcomes\.map\(outcome =>/)
    assert.doesNotMatch(source, /Object\.values\(selectedOutcomes\)\.map/)
    assert.doesNotMatch(source, /if \(!selectedOutcome\) return null/,
      'missing metadata must not hide saved note text while lookup is pending or failed')
    if (file !== 'ObStepRunda') assert.match(source, /selectedOutcome\?\.label \?\? ci\.title/)
  }
  const mobile = read('ObMobileRound')
  assert.match(mobile, /\.from\(table\)[\s\S]*?\.eq\('is_active', true\)/)
  assert.match(mobile, /note: note\.note \?\? ''/)
})
