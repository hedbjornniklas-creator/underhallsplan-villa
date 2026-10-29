import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { workItemSum, workProjectSum } from '../src/lib/action-cases/workSums.ts'

const line = (patch={}) => ({quantity:2,unitCost:100,markupPercent:20,vatRate:25,verified:false,...patch})
const item = (lines=[line()],patch={}) => ({status:'pricing_needed',costLines:lines,...patch})

test('work amounts include each row VAT and markup, independently of Klar and agreed price',()=>{
  const i=item([line(),line({unitCost:100,quantity:1,markupPercent:0,vatRate:12})],{contractWork:{price:{amountOre:999999}}})
  const before=JSON.stringify(i)
  assert.deepEqual(workItemSum(i),{amountOre:41200,partial:false})
  assert.equal(JSON.stringify(i),before)
  assert.equal(workItemSum(item([line({markupPercent:-10})])).amountOre,22500)
})
test('missing rows retain only a clearly provisional known sum; zero is a real price',()=>{
  assert.deepEqual(workItemSum(item([line({unitCost:0})])),{amountOre:0,partial:false})
  assert.deepEqual(workItemSum(item([line(),line({quantity:null}),line({unitCost:null})])),{amountOre:30000,partial:true})
  for(const rows of [[],[line({unitCost:null})],[line({vatRate:undefined})]]) assert.deepEqual(workItemSum(item(rows)),{amountOre:null,partial:true})
})
test('lump sums override underlying rows and covered package rows are never double-counted',()=>{
  assert.equal(workItemSum(item([line(),line({coveredByQuoteId:'quote',unitCost:999999})])).amountOre,30000)
  assert.deepEqual(workItemSum(item([line()],{lumpSum:{customerPrice:500,vatRate:12,verified:false}})),{amountOre:56000,partial:false})
  assert.deepEqual(workItemSum(item([line()],{lumpSum:{customerPrice:null,vatRate:25}})),{amountOre:null,partial:true})
})
test('project total equals displayed rounded action amounts and excludes cancelled and declined actions',()=>{
  const rows=[item([line({quantity:1,unitCost:0.01,markupPercent:0})]),item([line({quantity:1,unitCost:0.01,markupPercent:0})])]
  assert.equal(workProjectSum(rows).amountOre,2)
  rows.push(item([line()],{status:'cancelled'}),item([line()],{status:'declined'}))
  assert.equal(workProjectSum(rows).amountOre,2)
  rows.push(item([line({unitCost:null})]))
  assert.deepEqual(workProjectSum(rows),{amountOre:2,partial:true,incompleteItems:1})
  assert.deepEqual(workProjectSum([item([])]),{amountOre:null,partial:true,incompleteItems:1})
  assert.deepEqual(workProjectSum([]),{amountOre:0,partial:false,incompleteItems:0})
})
test('work list exposes a gross calculation column and matching total with responsive labels, without write paths',()=>{
  const ui=readFileSync(new URL('../src/components/tasks/ActionCaseWorkspace.tsx',import.meta.url),'utf8')
  const css=readFileSync(new URL('../src/components/tasks/uppdrag-theme.css',import.meta.url),'utf8')
  assert.match(ui,/Kalkyl inkl\. moms/)
  assert.match(ui,/aria-label="Projektarbetets totalsumma"/)
  assert.match(ui,/workItemSum\(item\)/)
  assert.match(ui,/workProjectSum\(selectedCase.items\)/)
  assert.match(ui,/Preliminärt kalkylerat kundpris inkl\. moms/)
  assert.match(css,/\.gizmo-work-amount-label \{ display: block/)
  assert.match(css,/\.gizmo-work-total \{ flex-wrap: wrap/)
})
