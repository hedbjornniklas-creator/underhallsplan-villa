import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Native Node tests require the explicit TypeScript extension.
import { readObNoteText } from '../src/lib/ob/noteText.ts'
type Item = {
  id: string
  control_point_id: string | null
  selected_outcome_id: string | null
  note: string
  risk_text: string | null
  ftu_text: string | null
}
type Block = { title: string; noteText: string; riskText: string; ftuText: string }

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

// Run the production report callbacks without a catalogue. Selected IDs must not
// affect stored text or placement, even if the associated template no longer exists.
function reportBoundary(path: string, interior: boolean) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  assert.doesNotMatch(source, /settings_control_point_outcomes|outcomeById/,
    'reports must never query or use the current catalogue to fill inspection text')
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

  function render(items: Item[]) {
    const blocks: Block[] = []
    const riskLines: string[] = []
    const ftuLines: string[] = []
    const title = interior ? 'Saved floor - Saved room' : 'Saved exterior section'
    const callback = execute<(item: Item) => void>(`return (${callbacks[0]})`, {
      readObNoteText,
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
  return { render }
}

for (const [format, path] of [
  ['HTML', 'src/app/utlatande/[propertyId]/[inspectionId]/page.tsx'],
  ['PDF', 'src/lib/report/pdfV2/buildReportDataV2.ts'],
] as const) {
  for (const interior of [false, true]) {
    const boundary = reportBoundary(path, interior)
    const name = `${format} ${interior ? 'interior' : 'exterior'}`

    test(`${name}: archived and moved selections retain only saved text and original placement`, () => {
      const items = structuredClone(fixtures)
      const { blocks, riskLines, ftuLines, title } = boundary.render(items)
      assert.deepEqual(blocks.map(({ title, noteText, riskText, ftuText }) => ({ title, noteText, riskText, ftuText })), [
        { title, noteText: fixtures[0].note, riskText: '', ftuText: '' },
        { title, noteText: fixtures[1].note, riskText: '', ftuText: '' },
        { title, noteText: fixtures[2].note, riskText: '', ftuText: '' },
        { title, noteText: fixtures[3].note, riskText: 'Own risk', ftuText: 'Own FTU' },
      ])
      assert.deepEqual(riskLines, [title, 'Own risk', ''])
      assert.deepEqual(ftuLines, [title, 'Own FTU', ''])
      assert.deepEqual(items, fixtures, 'report generation must not reparent or rewrite saved notes')
    })

    test(`${name}: free notes also render without a catalogue`, () => {
      const { blocks, title } = boundary.render([
        { ...fixtures[3], control_point_id: null, selected_outcome_id: null },
      ])
      assert.deepEqual(blocks.map(({ title, noteText, riskText, ftuText }) => ({ title, noteText, riskText, ftuText })), [
        { title, noteText: fixtures[3].note, riskText: 'Own risk', ftuText: 'Own FTU' },
      ])
    })
  }
}
