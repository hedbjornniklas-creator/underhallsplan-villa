import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import type { FlowNode, FlowOccurrence } from '../src/lib/renoapp/flowEditor'

const require = createRequire(import.meta.url)
const layoutModule = { exports: {} } as { exports: typeof import('../src/lib/renoapp/flowLayout') }
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync('src/lib/renoapp/flowLayout.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(require, layoutModule, layoutModule.exports)
const { layoutFlow, FLOW_CARD_WIDTH, FLOW_COLUMN_GAP } = layoutModule.exports

function fixture() {
  const rows: FlowOccurrence[] = []
  const heights: Record<string, number> = {}
  const add = (id: string, parentId: string | null, height = 83) => {
    const node: FlowNode = { id, title: id, kind: 'question', tone: 'stone', badges: [], children: [], ref: { type: 'question', questionId: id } }
    rows.push({ id, parentId, node }); heights[id] = height
  }
  add('root', null); add('project', 'root'); add('minor', 'project'); add('move-kitchen', 'project')
  for (const branch of ['minor', 'move-kitchen']) {
    add(`${branch}-wall`, branch, 117)
    add(`${branch}-yes`, `${branch}-wall`); add(`${branch}-no`, `${branch}-wall`)
    add(`${branch}-constructor`, `${branch}-yes`, 100)
    for (let index = 0; index < 8; index++) add(`${branch}-other-${index}`, branch, index % 2 ? 83 : 117)
  }
  return { rows, heights }
}

test('compact tree keeps Yes/No with their parent despite many requirements on nearby ranks', () => {
  const { rows, heights } = fixture()
  const before = JSON.stringify(rows)
  const positions = layoutFlow(rows, heights)
  for (const branch of ['minor', 'move-kitchen']) {
    const parent = positions.get(`${branch}-wall`)!, yes = positions.get(`${branch}-yes`)!, no = positions.get(`${branch}-no`)!
    assert.equal(yes.x - parent.x - FLOW_CARD_WIDTH, FLOW_COLUMN_GAP)
    assert.equal(no.x, yes.x)
    assert.ok(no.y - yes.y - heights[`${branch}-yes`] <= 24)
    assert.ok(parent.y + heights[`${branch}-wall`] / 2 >= yes.y)
    assert.ok(parent.y + heights[`${branch}-wall`] / 2 <= no.y + heights[`${branch}-no`])
  }
  assert.equal(JSON.stringify(rows), before, 'layout never changes connections or input data')
  assert.deepEqual(layoutFlow(rows, heights), positions)
})

test('different card heights and shared occurrences have nonoverlapping bounds', () => {
  const { rows, heights } = fixture()
  rows[rows.length - 1].node = rows[3].node
  const positions = layoutFlow(rows, heights)
  assert.equal(positions.size, rows.length)
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = positions.get(rows[i].id)!, b = positions.get(rows[j].id)!
    const overlaps = a.x < b.x + FLOW_CARD_WIDTH && a.x + FLOW_CARD_WIDTH > b.x
      && a.y < b.y + heights[rows[j].id] && a.y + heights[rows[i].id] > b.y
    assert.equal(overlaps, false, `${rows[i].id} overlaps ${rows[j].id}`)
  }
  assert.equal(layoutFlow([], {}).size, 0)
  assert.ok([...layoutFlow(rows.slice(0, 1), {}).values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
})
