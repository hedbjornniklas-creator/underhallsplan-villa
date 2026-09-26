import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

type Outcome = {
  id: string
  control_point_id: string
  is_active: boolean
  label: string
  risk_template: string
  ftu_template: string
}
type Item = {
  id: string
  control_point_id: string | null
  selected_outcome_id: string | null
  note: string
  risk_text: string | null
  ftu_text: string | null
}
type Block = { title: string; noteText: string; riskText: string; ftuText: string }

const catalog: Outcome[] = [
  { id: 'archived-A', control_point_id: 'original', is_active: false, label: 'Archived A', risk_template: '', ftu_template: '' },
  { id: 'moved-B', control_point_id: 'new-parent', is_active: true, label: 'Moved B', risk_template: 'B original risk', ftu_template: 'B original FTU' },
  { id: 'unselected-C', control_point_id: 'original', is_active: true, label: 'Active C', risk_template: 'Unselected risk', ftu_template: 'Unselected FTU' },
]
const fixtures: Item[] = [
  { id: 'A', control_point_id: 'original', selected_outcome_id: 'archived-A', note: 'Saved observation A', risk_text: null, ftu_text: null },
  { id: 'B', control_point_id: 'original', selected_outcome_id: 'moved-B', note: 'Saved observation B', risk_text: null, ftu_text: null },
  { id: 'cleared', control_point_id: 'original', selected_outcome_id: 'moved-B', note: 'Saved cleared observation', risk_text: '', ftu_text: '' },
  { id: 'custom', control_point_id: 'original', selected_outcome_id: 'moved-B', note: 'Saved custom observation', risk_text: 'Own risk', ftu_text: 'Own FTU' },
]

function execute<T>(code: string, bindings: Record<string, unknown>): T {
  const output = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(bindings), output)(...Object.values(bindings)) as T
}

// Run the production query blocks and report callbacks. This exercises both separate
// builders without mocking the many unrelated report sections or copying fallback logic.
function reportBoundary(path: string, interior: boolean) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const start = interior ? 'const interiorControlItemsRows =' : 'const exteriorControlItemsForIds ='
  const end = interior ? 'if (interiorOutcomesError)' : 'if (outcomesError)'
  const queryStart = source.indexOf(start)
  const queryEnd = source.indexOf(end, queryStart)
  assert.ok(queryStart >= 0 && queryEnd > queryStart, 'exercise the production historical lookup')
  const query = source.slice(queryStart, queryEnd)
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const callbacks: string[] = []
  const collection = interior ? 'roomControlItems' : 'controlItemsForItem'
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'forEach' && node.expression.expression.getText(parsed) === collection) {
      callbacks.push(node.arguments[0].getText(parsed))
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.equal(callbacks.length, 1, 'exercise the production report block builder')

  async function load(items: Item[]) {
    const requests: { field: string; values: readonly unknown[] }[] = []
    let reads = 0
    const supabase = {
      from(table: string) {
        assert.equal(table, 'settings_control_point_outcomes')
        reads += 1
        let rows = [...catalog]
        const builder = {
          select() { return builder },
          in(field: keyof Outcome, values: readonly unknown[]) {
            requests.push({ field, values })
            rows = rows.filter(row => values.includes(row[field]))
            return builder
          },
          eq(field: keyof Outcome, value: unknown) {
            rows = rows.filter(row => row[field] === value)
            return builder
          },
          order() { return Promise.resolve({ data: rows, error: null }) },
        }
        return builder
      },
    }
    const rows = await execute<Promise<Outcome[]>>(
      `return (async () => { ${query}\nreturn ${interior ? 'interiorOutcomeRows' : 'outcomeRows'} })()`,
      { supabase, exteriorControlItems: items, interiorControlItems: items },
    )
    return { rows, requests, reads }
  }

  function render(items: Item[], rows: Outcome[]) {
    const blocks: Block[] = []
    const riskLines: string[] = []
    const ftuLines: string[] = []
    const title = interior ? 'Saved floor - Saved room' : 'Saved exterior section'
    const callback = execute<(item: Item) => void>(`return (${callbacks[0]})`, {
      outcomeById: new Map(rows.map(row => [row.id, row])),
      trimText: (value: string | null | undefined) => (value ?? '').trim(),
      imagesByControlItemId: new Map(),
      buildInspectionImageUrl: () => null,
      item: { label: title }, roomTitle: title,
      blocksForItem: blocks, roomBlocks: blocks,
      itemLines: [], roomLines: [], riskLines, ftuLines,
    })
    items.forEach(callback)
    return { blocks, riskLines, ftuLines, title }
  }
  return { load, render }
}

for (const [format, path] of [
  ['HTML', 'src/app/utlatande/[propertyId]/[inspectionId]/page.tsx'],
  ['PDF', 'src/lib/report/pdfV2/buildReportDataV2.ts'],
] as const) {
  for (const interior of [false, true]) {
    const boundary = reportBoundary(path, interior)
    const name = `${format} ${interior ? 'interior' : 'exterior'}`

    test(`${name}: archived and moved selections retain report text and original placement`, async () => {
      const items = structuredClone(fixtures)
      const { rows, requests } = await boundary.load(items)
      assert.deepEqual(requests, [{ field: 'id', values: ['archived-A', 'moved-B'] }])
      assert.deepEqual(rows.map(row => row.id), ['archived-A', 'moved-B'])
      const { blocks, riskLines, ftuLines, title } = boundary.render(items, rows)
      assert.deepEqual(blocks.map(({ title, noteText, riskText, ftuText }) => ({ title, noteText, riskText, ftuText })), [
        { title, noteText: fixtures[0].note, riskText: '', ftuText: '' },
        { title, noteText: fixtures[1].note, riskText: 'B original risk', ftuText: 'B original FTU' },
        { title, noteText: fixtures[2].note, riskText: '', ftuText: '' },
        { title, noteText: fixtures[3].note, riskText: 'Own risk', ftuText: 'Own FTU' },
      ])
      assert.deepEqual(riskLines, [title, 'B original risk', '', title, 'Own risk', ''])
      assert.deepEqual(ftuLines, [title, 'B original FTU', '', title, 'Own FTU', ''])
      assert.deepEqual(items, fixtures, 'report generation must not reparent or rewrite saved notes')
    })

    test(`${name}: no selected outcomes means no catalog read`, async () => {
      const { rows, requests, reads } = await boundary.load([
        { ...fixtures[3], selected_outcome_id: null },
      ])
      assert.deepEqual(rows, [])
      assert.deepEqual(requests, [])
      assert.equal(reads, 0)
    })
  }
}
