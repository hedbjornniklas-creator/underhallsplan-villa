import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { overviewContract, overviewItemAmount, overviewPointStatus, overviewTimeline, overviewToday, projectOverview } from '../src/lib/action-cases/projectOverview.ts'
import { emptyCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'

const today = '2026-10-20'
const project = () => ({ id: 'project', title: 'TEST-projekt', items: [], attachments: [] })
const offer = () => ({ draft: { ...emptyCustomerOffer(), baseAmountOre: 200_000, pricingMode: 'total', paymentPlan: { version: 1, installments: [{ amountOre: 180_000 }] } }, revision: 1, offers: [] })
const question = (id = 'q1', patch = {}) => ({ id, number: 1, body: { title: `Fråga ${id}`, status: 'open', assignee: { kind: 'profile', id: 'me', name: 'Anna' } }, tasks: [], events: [], updatedAt: '2026-10-20T10:00:00Z', ...patch })
const questions = (rows = []) => ({ userId: 'me', managerId: 'me', assignees: [{ kind: 'profile', id: 'me', name: 'Anna' }], questions: rows })
const schedule = (rows = []) => ({ available: true, rows })
const row = (id, startDate = '', endDate = '', status = 'planned') => ({ id, title: id, startDate, endDate, status })
const item = (patch = {}) => ({ id: 'i1', status: 'pricing_needed', costLines: [{ quantity: 2, unitCost: 100, markupPercent: 10, vatRate: 25, verified: false }], ...patch })
const model = (p = project(), o = offer(), q = questions(), s = schedule()) => projectOverview(p, o, q, s, today)

test('overview reads known prices regardless of Klar, with VAT and no duplicate covered costs', () => {
  assert.equal(overviewItemAmount(item()), 27_500)
  assert.equal(overviewItemAmount(item({ costLines: [...item().costLines, { coveredByQuoteId: 'package', quantity: 9, unitCost: 99_999 }] })), 27_500)
  assert.equal(overviewItemAmount(item({ lumpSum: { customerPrice: 100, vatRate: 12, verified: false } })), 11_200)
  assert.equal(overviewItemAmount(item({ costLines: [{ quantity: 0, unitCost: 0, markupPercent: 0, vatRate: 0 }] })), 0)
})
test('unknown prices are not zero or a partial project total', () => {
  for (const i of [item({ costLines: [] }), item({ costLines: [{ quantity: null, unitCost: 9 }] }), item({ lumpSum: { customerPrice: null, vatRate: 25 } })]) assert.equal(overviewItemAmount(i), null)
  const p = { ...project(), items: [item(), item({ costLines: [] })] }
  assert.equal(model(p).calculation, null)
  assert.equal(model(p).missingPrices, 1)
  assert.equal(overviewItemAmount(item({ costLines: [{ quantity: 1, unitCost: 100, markupPercent: 0 }] })), null, 'unknown VAT is not guessed')
  p.items[1].status = 'cancelled'
  assert.equal(model(p).calculation, 27_500)
})
test('frozen agreement and payment plan are read from the same version, ignoring a newer draft', () => {
  const o = offer(), snapshot = structuredClone(o.draft)
  o.draft.baseAmountOre = 900_000
  o.draft.paymentPlan.installments[0].amountOre = 800_000
  o.signingVersions = [{ id: 'signed', version: 4, createdAt: '2026-10-19T09:00:00Z', releasedAt: null, snapshot }]
  const before = JSON.stringify(o)
  const result = overviewContract(o)
  assert.equal(result.base, 200_000)
  assert.equal(result.planAmount, 180_000)
  assert.equal(result.difference, 20_000)
  assert.equal(result.source, 'Avtalsversion 4')
  assert.equal(result.label, 'Låst')
  assert.equal(result.shared, false)
  assert.equal(JSON.stringify(o), before)
})
test('released versions are not mistaken for locked agreements; digital approval takes precedence', () => {
  const o = offer()
  o.signingVersions = [{ releasedAt: '2026-10-19', snapshot: { ...o.draft, baseAmountOre: 1 } }]
  assert.equal(overviewContract(o).label, 'Utkast')
  o.offers = [{ status: 'accepted', version: 2, snapshot: { ...o.draft, baseAmountOre: 300_000 }, acceptedAt: '2026-10-19T10:00:00Z' }]
  assert.equal(overviewContract(o).base, 300_000)
  assert.equal(overviewContract(o).label, 'Godkänt')
})

test('the signed-copy task appears in Next steps until the PDF is registered, without mutating its locked agreement',()=>{
  const o=offer(),version={id:'paper',version:1,snapshot:structuredClone(o.draft),releasedAt:null,createdAt:'2026-10-20',signedCopyTask:{id:'task',status:'assigned',dueAt:'2026-10-27T08:00:00Z',assigneeProfileId:'me'}}
  o.signingVersions=[version]
  const before=JSON.stringify(o)
  const point=model(project(),o).points.find(p=>p.id==='contract-upload:paper')
  assert.equal(point.title,'Ladda upp signerat avtal');assert.equal(point.owner,'Anna');assert.equal(point.view,'contract');assert.equal(point.mine,true)
  assert.equal(point.due,version.signedCopyTask.dueAt)
  assert.equal(JSON.stringify(o),before)
  version.delivery={signedCopy:{fileName:'Signerad.pdf'}}
  assert.equal(model(project(),o).points.some(p=>p.id==='contract-upload:paper'),false)
})
test('missing payment amounts and running pricing do not invent totals or balancing tasks', () => {
  const o = offer()
  o.draft.paymentPlan.installments[0].amountOre = null
  assert.equal(overviewContract(o).planAmount, null)
  assert.equal(model(project(), o).points.length, 0)
  o.draft.contractPricing = { mode: 'running', rows: [] }
  assert.equal(overviewContract(o).base, null)
  assert.equal(overviewContract(null).base, null)
})
test('each visible open question appears once, and only an active assignment supplies a deadline', () => {
  const q = questions([question('open', { tasks: [{ status: 'approved', active: false, dueAt: '2026-10-01T10:00:00Z' }, { status: 'assigned', active: true, dueAt: '2026-10-23T10:00:00Z' }] }), question('closed', { body: { title: 'Closed', status: 'closed' } })])
  const points = model(project(), null, q).points
  assert.equal(points.length, 1)
  assert.equal(points[0].due, '2026-10-23T10:00:00Z')
  assert.equal(points[0].mine, true)
  assert.equal(model(project(), null, questions()).activities.length, 0)
})
test('Stockholm midnight and precise task deadlines are classified correctly', () => {
  assert.equal(overviewToday(new Date('2026-10-19T22:30:00Z')), today)
  assert.equal(overviewPointStatus({ due: '2026-10-19T22:30:00Z' }, today), 'soon')
  assert.equal(overviewPointStatus({ due: '2026-10-20T10:00:00Z' }, today, Date.parse('2026-10-20T10:01:00Z')), 'late')
  assert.equal(overviewPointStatus({ due: today }, today, Date.parse('2026-10-20T20:00:00Z')), 'soon')
  assert.equal(overviewPointStatus({ due: null }, today), 'undated')
})
test('choices are counted once per category, never summed into agreement or calculation', () => {
  const o = offer()
  o.planning = { available: true, items: [{ id: 'a', budgetOre: 999_999 }, { id: 'b', budgetOre: 999_999 }], categories: [{ id: 'windows', title: 'Fönster', specification: '', optionIds: ['a', 'b'], decisionBy: '2026-10-23' }] }
  const result = model(project(), o)
  assert.equal(result.points.filter(p => p.view === 'choices').length, 1)
  assert.equal(result.nextDecision.title, 'Fönster')
  assert.equal(result.contract.base, 200_000)
  assert.equal(result.calculation, null)
  o.planning.sharedChoices = { versions: { windows: 'v1' }, categories: structuredClone(o.planning.categories), choices: [{ categoryId: 'windows', categoryVersion: 'v1', optionId: 'a' }] }
  assert.equal(model(project(), o).points.filter(p => p.view === 'choices').length, 0)
  o.planning.sharedChoices.choices[0].categoryVersion = 'old'
  assert.equal(model(project(), o).points.filter(p => p.view === 'choices').length, 1)
  o.planning.categories = []
  assert.equal(model(project(), o).points.filter(p => p.view === 'choices').length, 0, 'deleted categories do not reappear from legacy options')
})
test('only the project manager owns unassigned planning and payment follow-up', () => {
  const s = schedule([row('undated'), row('finished', '', '', 'completed')])
  assert.equal(model(project(), offer(), questions(), s).points.filter(p => p.mine).length, 2)
  const q = questions(); q.managerId = 'someone-else'
  assert.equal(model(project(), offer(), q, s).points.filter(p => p.mine).length, 0)
  assert.equal(model(project(), offer(), null, null).points.filter(p => p.mine).length, 0)
})
test('activity uses the latest matching metadata, never a message or the first creation event', () => {
  const q = question('q1', { events: [{ createdAt: '2026-10-18T10:00:00Z', operation: 'create', actorName: 'Old', text: 'SECRET' }, { createdAt: '2026-10-20T10:00:00Z', operation: 'note', actorName: 'Latest', text: 'SECRET' }] })
  const activity = model(project(), null, questions([q])).activities[0]
  assert.match(activity.title, /Intern anteckning/)
  assert.equal(activity.actor, 'Latest')
  assert.doesNotMatch(JSON.stringify(activity), /SECRET/)
  q.updatedAt = '2026-10-20T10:01:00Z'
  assert.match(model(project(), null, questions([q])).activities[0].title, /Fråga uppdaterad/)
})
test('timeline clips overlapping moments to six full weeks and excludes undated or outside rows', () => {
  const s = schedule([row('long', '2026-10-01', '2026-12-31'), row('inside', '2026-11-02', '2026-11-13'), row('outside', '2026-12-01', '2026-12-02'), row('undated')])
  const result = overviewTimeline(s, today)
  assert.equal(result.weeks[0], '2026-10-19')
  assert.equal(result.weeks[5], '2026-11-23')
  assert.equal(result.total, 2)
  assert.equal(result.rows[0].left, 0)
  assert.equal(result.rows[0].width, 100)
  for (const r of result.rows) { assert.ok(r.left >= 0); assert.ok(r.width > 0); assert.ok(r.left + r.width <= 100.000001) }
  assert.equal(overviewTimeline(s, '2027-01-01').weeks[0], '2026-12-28')
})
test('all overview derivation is read-only, including under strict frozen input', () => {
  function freeze(value) { if (value && typeof value === 'object') { for (const nested of Object.values(value)) freeze(nested); Object.freeze(value) } return value }
  const p = freeze({ ...project(), items: [item()] }), o = freeze(offer()), q = freeze(questions([question()])), s = freeze(schedule([row('a')]))
  const before = JSON.stringify({ p, o, q, s })
  model(p, o, q, s); overviewTimeline(s, today)
  assert.equal(JSON.stringify({ p, o, q, s }), before)
})
test('overview has only GET reads and isolated styles; existing editors remain mounted', () => {
  const component = readFileSync(new URL('../src/components/tasks/ProjectOverview.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(component, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]|\.rpc\(|localStorage|supabase/)
  assert.match(component, /cache: 'no-store'/)
  assert.match(component, /<button type="button" className="gizmo-home-lanerow"/, 'the full schedule lane is a touch target, not a tiny bar')
  const host = readFileSync(new URL('../src/components/tasks/ActionCaseProject.tsx', import.meta.url), 'utf8')
  assert.match(host, /<ProjectOverview key=\{`overview:\$\{caseId\}`\}/)
  assert.match(host, /Keep the existing editors mounted/)
  assert.match(host, /offerItems=\{estimate\?\.draft.items \?\? \[\]\}/)
  const css = readFileSync(new URL('../src/components/tasks/project-overview.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /gizmo-contract|gizmo-register|gizmo-project-header|vw|vh/)
})
