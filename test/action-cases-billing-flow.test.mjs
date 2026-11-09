import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as uuid } from 'node:crypto'
import { applyBillingCommand as apply, emptyBillingFlow, billingEntryBalance as balance, billingCostCharge, billingTotals, billingNet, billingBudget, billingParseAmount, billingValidateFlow } from '../src/lib/action-cases/billingFlow.ts'

const day = '2026-11-09', now = day + 'T12:00:00.000Z'
const fixed = { key: 'change:fixed', title: 'Undersökning', group: 'change', mode: 'fixed', fixedGrossOre: 2500000, hourlyGrossOre: null, markupPercent: null, budgetGrossOre: null, reference: 'ÄTA 1', conditions: '', fingerprint: 'fixed-v1' }
const running = { ...fixed, key: 'change:running', title: 'Löpande ÄTA', mode: 'running', fixedGrossOre: null, hourlyGrossOre: 75000, markupPercent: 15, fingerprint: 'running-v1' }
const budget = { ...running, key: 'change:budget', mode: 'budget', budgetGrossOre: 12500000, fingerprint: 'budget-v1' }
const ctx = { candidates: [fixed, running, budget], suppliers: [], canManage: true, cancelled: false, legacyCount: 0, openQuestions: 0, baseFixedGrossOre: null, issuer: 'Fiktiv AB', recipient: 'Testkund' }
const cmd = (operation, patch = {}) => ({ operation, ...patch })
const run = (f, c, context = ctx) => apply(f, c, context, now)
const register = (f = emptyBillingFlow(), candidate = running, context = ctx) => run(f, cmd('register_agreement', { id: uuid(), key: candidate.key, fingerprint: candidate.fingerprint, vatRate: 25, evidence: 'Kundens mejl 2026-11-08', approvedBy: 'Testbeställare', approvedOn: day }), context)
function manual(f, patch = {}, context = ctx) {
  return run(f, cmd('save_cost', { id: uuid(), agreementId: f.agreements.at(-1).id, kind: 'purchase', description: 'Material', date: day, internalNetOre: 1000000, hoursUnits: null, evidence: 'Kvitto 123', missingEvidenceReason: '', ...patch }), context)
}
const review = (f, context = ctx) => run(f, cmd('review_cost', { id: f.costs.at(-1).id, confirmed: true }), context)
const debit = (f, patch = {}, context = ctx) => run(f, cmd('create_entry', { id: uuid(), agreementId: f.agreements.at(-1).id, costId: f.costs.at(-1)?.id, description: 'Undersökning', netOre: 2000000, fulfilled: 'Arbetet utfört', reason: 'Avstämning av verklig kostnad', date: day, ...patch }), context)
const reserve = (f, patch = {}, context = ctx) => run(f, cmd('reserve_basis', { id: uuid(), title: 'Fakturaunderlag', date: day, note: '', lines: f.entries.filter(e => balance(f, e).availableOre).map(e => ({ id: uuid(), entryId: e.id, netOre: balance(f, e).availableOre })), ...patch }), context)
const post = (f, patch = {}, context = ctx) => run(f, cmd('register_invoice', { id: uuid(), number: uuid(), date: day, issuer: ctx.issuer, kind: 'invoice', externalNetOre: 0, note: '', confirmed: true, lines: f.bases.filter(b => b.status !== 'cancelled').flatMap(b => b.lines.map(l => ({ basisId: b.id, lineId: l.id, netOre: l.netOre }))), ...patch }), context)
const supplier = (key = 'invoice:allocation', patch = {}) => ({ key, invoiceId: uuid(), allocationId: uuid(), revision: 1, targetKey: running.key, title: 'Leverantör A100', date: day, netOre: 980000, reviewed: true, original: true, legacy: false, ...patch })

test('S01 fixed price uses the customer agreement, not internal cost', () => {
  let f = register(emptyBillingFlow(), fixed)
  f = manual(f, { internalNetOre: 1900000 }); f = review(f)
  assert.throws(() => debit(f), /FIXED_COST/)
  f = debit(f, { costId: null })
  assert.equal(f.entries[0].netOre, 2000000)
  assert.deepEqual(billingTotals(f.entries), { netOre: 2000000, vatOre: 500000, grossOre: 2500000 })
})
test('S02 manually incurred purchases and hours use separate customer pricing', () => {
  let f = debit(review(manual(register())))
  f = manual(f, { kind: 'hours', hoursUnits: 100000, internalNetOre: 300000, description: '10 timmars arbete' }); f = debit(review(f))
  assert.deepEqual(f.entries.map(e => e.netOre), [1150000, 600000])
  assert.equal(billingTotals(f.entries).grossOre, 2187500)
})
test('S03 imports only the assigned invoice portion without changing the invoice', () => {
  const s = supplier('a', { netOre: 600000 }), c = { ...ctx, suppliers: [s] }, before = structuredClone(c)
  const f = debit(review(manual(register(), { supplierKey: 'a' }, c), c), {}, c)
  assert.equal(billingTotals(f.entries).grossOre, 862500); assert.deepEqual(c, before)
})
test('S04 fixed instalments consume one ceiling and permit only the remainder', () => {
  let f = register(emptyBillingFlow(), fixed)
  f = debit(f, { costId: null, netOre: 600000 }); f = post(reserve(f))
  assert.equal(balance(f, f.entries[0]).invoicedOre, 600000)
  assert.throws(() => debit(f, { costId: null, netOre: 1400001 }), /PRICE_LIMIT/)
  f = debit(f, { costId: null, netOre: 1400000 }); assert.equal(f.entries.length, 2)
})
test('S05 mixed work keeps fixed-price costs out of running billing', () => {
  const f = review(manual(register(emptyBillingFlow(), fixed)))
  assert.throws(() => billingCostCharge(f.costs[0], f.agreements[0]), /FIXED_COST/)
})
test('S06 an unapproved selection is not a billing agreement', () => {
  assert.throws(() => register(emptyBillingFlow(), { ...running, fingerprint: 'unknown' }), /SOURCE_CHANGED/)
  assert.throws(() => run(emptyBillingFlow(), cmd('register_agreement', { id: uuid(), key: running.key, fingerprint: running.fingerprint, vatRate: 25, evidence: '', approvedBy: 'Kund', approvedOn: day })), /INVALID/)
})
test('S07 zero purchase cost is valid; an unknown purchase amount is not an actual cost', () => {
  const f = debit(review(manual(register(), { internalNetOre: 0 })))
  assert.equal(f.entries[0].netOre, 0)
  assert.throws(() => manual(register(), { internalNetOre: null }), /INVALID/)
  assert.equal(billingParseAmount('0'), 0); assert.equal(billingParseAmount(''), null)
})
test('S08 later invoice matches the existing manual source rather than adding another', () => {
  const s = supplier(), c = { ...ctx, suppliers: [s] }
  let f = manual(register()); const costId = f.costs[0].id
  f = run(f, cmd('match_supplier', { id: costId, supplierKey: s.key, reason: 'Samma inköp' }), c)
  f = debit(review(f, c), {}, c)
  assert.equal(f.costs.length, 1); assert.equal(f.costs[0].internalNetOre, 980000); assert.equal(f.entries[0].netOre, 1127000)
})
test('S09 matched invoice after billing creates a correction, never rewrites the PDF', () => {
  let f = post(reserve(debit(review(manual(register()))))), old = structuredClone(f.bases)
  const s = supplier(), c = { ...ctx, suppliers: [s] }
  f = run(f, cmd('match_supplier', { id: f.costs[0].id, supplierKey: s.key, reason: 'Sen faktura' }), c)
  f = debit(review(f, c), {}, c)
  assert.equal(f.entries.at(-1).netOre, -23000); assert.deepEqual(f.bases, old)
})
test('S10 a reserved portion is unavailable to another basis', () => {
  const f = reserve(debit(review(manual(register())))), e = f.entries[0]
  assert.equal(balance(f, e).reservedOre, 1150000)
  assert.throws(() => reserve(f, { lines: [{ id: uuid(), entryId: e.id, netOre: 1 }] }), /BALANCE/)
})
test('S11 exported basis is immutable; cancellation releases its reservation', () => {
  let f = reserve(debit(review(manual(register()))))
  f = run(f, cmd('export_basis', { id: f.bases[0].id }))
  assert.equal(f.bases[0].exportedAt, now)
  f = run(f, cmd('cancel_basis', { id: f.bases[0].id, confirmed: true, reason: 'Inte fakturerat, ersätt med ny PDF' }))
  assert.equal(balance(f, f.entries[0]).availableOre, 1150000)
  const g = reserve(f); assert.equal(g.bases.length, 2); assert.equal(g.bases[0].status, 'cancelled')
})
test('S12 partial external invoice leaves the unbilled portion reserved', () => {
  let f = reserve(debit(review(manual(register())))), b = f.bases[0]
  f = post(f, { lines: [{ basisId: b.id, lineId: b.lines[0].id, netOre: 900000 }] })
  assert.deepEqual(balance(f, f.entries[0]), { reservedOre: 250000, invoicedOre: 900000, availableOre: 0, blocked: false })
  assert.throws(() => run(f, cmd('cancel_basis', { id: b.id, confirmed: true, reason: 'Wrong' })), /ALREADY_INVOICED/)
})
test('S13 no detached manual customer amount can bypass running cost sources', () => {
  assert.throws(() => debit(register(), { costId: uuid() }), /NOT_FOUND/)
})
test('S14 base-contract fixed ceiling includes payment plan and work sources together', () => {
  const one = { ...fixed, key: 'base:payment:1', group: 'base' }, two = { ...one, key: 'base:work:1' }
  const c = { ...ctx, baseFixedGrossOre: 2500000, candidates: [one, two] }, f = register(emptyBillingFlow(), one, c)
  assert.throws(() => register(f, two, c), /BASE_LIMIT/)
})
test('S15 supplier credit is a reviewed negative running-cost source', () => {
  const s = supplier('credit', { netOre: -200000 }), c = { ...ctx, suppliers: [s] }
  const f = debit(review(manual(register(), { supplierKey: s.key }, c), c), {}, c)
  assert.equal(f.entries[0].netOre, -230000)
  assert.equal(billingTotals(f.entries).grossOre, -287500)
})
test('S16 agreed price reduction cannot be billed again; rebilling waits for actual credit', () => {
  let f = post(reserve(debit(register(emptyBillingFlow(), fixed), { costId: null })))
  f = run(f, cmd('credit_entry', { id: uuid(), entryId: f.entries[0].id, netOre: 400000, date: day, reason: 'Avtalat prisavdrag', rebill: false }))
  assert.throws(() => debit(f, { costId: null, netOre: 400000 }), /PRICE_LIMIT/)
  assert.throws(() => run(f, cmd('credit_entry', { id: uuid(), entryId: f.entries[0].id, netOre: 1800000, date: day, reason: 'För stor', rebill: false })), /CREDIT_LIMIT/)
  let g = post(reserve(debit(register(emptyBillingFlow(), fixed), { costId: null })))
  g = run(g, cmd('credit_entry', { id: uuid(), replacementId: uuid(), entryId: g.entries[0].id, netOre: 2000000, date: day, reason: 'Fel fakturaadress', rebill: true }))
  assert.equal(balance(g, g.entries.at(-1)).blocked, true)
  const negative = g.entries.find(e => e.netOre < 0)
  g = reserve(g, { lines: [{ id: uuid(), entryId: negative.id, netOre: negative.netOre }] })
  const b = g.bases.at(-1)
  g = post(g, { kind: 'credit', lines: b.lines.map(l => ({ basisId: b.id, lineId: l.id, netOre: l.netOre })) })
  assert.equal(balance(g, g.entries.at(-1)).availableOre, 2000000)
})
test('S17 new agreement version does not reprice old invoices', () => {
  let f = post(reserve(debit(register(emptyBillingFlow(), fixed), { costId: null, netOre: 1000000 }))), old = structuredClone(f.bases)
  const changed = { ...fixed, fixedGrossOre: 3125000, fingerprint: 'fixed-v2' }
  f = register(f, changed, { ...ctx, candidates: [changed] })
  f = debit(f, { costId: null, netOre: 1500000 }); assert.deepEqual(f.bases, old)
})
test('S18 hours retain their approved price version after a rate change', () => {
  let f = review(manual(register(), { kind: 'hours', hoursUnits: 20000, internalNetOre: null })), oldAgreement = f.agreements[0]
  const changed = { ...running, hourlyGrossOre: 81250, fingerprint: 'running-v2' }
  f = register(f, changed, { ...ctx, candidates: [changed] })
  f = debit(f, { agreementId: oldAgreement.id, costId: f.costs[0].id })
  f = debit(review(manual(f, { kind: 'hours', hoursUnits: 20000, internalNetOre: null })))
  assert.deepEqual(f.entries.map(e => e.netOre), [120000, 130000])
})
test('S19 manual actual cost needs evidence or an explicit manager reason; disputed source cannot pass', () => {
  let f = manual(register(), { evidence: '', missingEvidenceReason: '' })
  assert.throws(() => review(f), /EVIDENCE_REQUIRED/)
  f = run(f, cmd('save_cost', { ...f.costs[0], evidence: '', missingEvidenceReason: 'Verifierat inköp på följesedel, faktura kommer', operation: 'save_cost' }))
  assert.equal(review(f).costs[0].reviewed, true)
  const s = supplier('disputed', { reviewed: false }), c = { ...ctx, suppliers: [s] }
  assert.throws(() => review(manual(register(), { supplierKey: s.key }, c), c), /SOURCE_CHANGED/)
})
test('S20 same invoice allocation cannot be imported twice or bypass a legacy link', () => {
  const s = supplier(), c = { ...ctx, suppliers: [s] }, f = manual(register(), { supplierKey: s.key }, c)
  assert.throws(() => manual(f, { supplierKey: s.key }, c), /SOURCE_IN_USE/)
  assert.throws(() => manual(register(), { supplierKey: s.key }, { ...c, suppliers: [{ ...s, legacy: true }] }), /SOURCE_IN_USE/)
})
test('S21 stale supplier revision blocks review and reservation without modifying the source', () => {
  const s = supplier(), c = { ...ctx, suppliers: [s] }, f = debit(review(manual(register(), { supplierKey: s.key }, c), c), {}, c)
  assert.throws(() => reserve(f, {}, { ...c, suppliers: [{ ...s, revision: 2 }] }), /SOURCE_CHANGED/)
})
test('S22 budget requires documented review at 80 percent or forecast overrun', () => {
  let f = debit(review(manual(register(emptyBillingFlow(), budget), { internalNetOre: 7000000 })))
  assert.equal(billingBudget(f, budget.key).needsReview, true)
  assert.throws(() => reserve(f), /BUDGET_REVIEW/)
  f = run(f, cmd('budget_review', { agreementId: f.agreements[0].id, remainingOre: 4000000, date: day, participants: 'Beställare och projektansvarig', decision: 'Avstämning, fortsättning enligt mejl', evidence: 'Mejl 2026-11-09' }))
  assert.equal(reserve(f).bases.length, 1)
  assert.equal(billingBudget(f, budget.key).forecastOre, 12050000)
})
test('S23 VAT is grouped by rate, credits are symmetric and old calculation is untouched', () => {
  assert.deepEqual(billingTotals([{ netOre: 1, vatRate: 25 }, { netOre: 1, vatRate: 25 }, { netOre: 1, vatRate: 25 }]), { netOre: 3, vatOre: 1, grossOre: 4 })
  assert.deepEqual(billingTotals([{ netOre: -1, vatRate: 25 }, { netOre: -1, vatRate: 25 }, { netOre: -1, vatRate: 25 }]), { netOre: -3, vatOre: -1, grossOre: -4 })
  assert.equal(billingNet(2500000, 25), 2000000)
})
test('S24 invalid tax and malformed monetary precision are rejected', () => {
  assert.throws(() => run(emptyBillingFlow(), cmd('register_agreement', { id: uuid(), key: fixed.key, fingerprint: fixed.fingerprint, vatRate: 24, evidence: 'Mejl', approvedBy: 'Kund', approvedOn: day })), /INVALID/)
  assert.throws(() => billingParseAmount('1,234'), /INVALID/)
})
test('S25 two bases and an external amount share one actual invoice reference', () => {
  let f = debit(review(manual(register()))); f = reserve(f, { lines: [{ id: uuid(), entryId: f.entries[0].id, netOre: 1000000 }] })
  f = reserve(f)
  f = post(f, { number: '1001', externalNetOre: 500000, note: 'Arbete utanför dessa underlag' })
  assert.equal(f.invoices[0].lines.reduce((s, l) => s + l.netOre, 0), 1150000)
  assert.equal(f.invoices[0].externalNetOre, 500000)
  assert.throws(() => post(f, { number: '1001' }), /INVOICE_DUPLICATE/)
})
test('S26 domain operations are immutable and invalid commands do not mutate state', () => {
  const f = debit(review(manual(register()))), before = structuredClone(f)
  assert.throws(() => reserve(f, { lines: [{ id: uuid(), entryId: f.entries[0].id, netOre: 999999999 }] }), /BALANCE/)
  assert.deepEqual(f, before)
})
test('S27 only project manager may change the ledger, including direct operations', () => {
  assert.throws(() => register(emptyBillingFlow(), running, { ...ctx, canManage: false }), /FORBIDDEN/)
})
test('S28 closure requires questions and all billing portions resolved; late costs reopen only economics', () => {
  let f = post(reserve(debit(review(manual(register())))))
  assert.throws(() => run(f, cmd('close_economy', { confirmed: true }), { ...ctx, openQuestions: 1 }), /INCOMPLETE/)
  f = run(f, cmd('close_economy', { confirmed: true })); assert.equal(f.economyClosed, true)
  f = manual(f); assert.equal(f.economyClosed, false)
  assert.equal(f.invoices.length, 1)
})
test('legacy history must be explicitly reconciled, not silently treated as uninvoiced', () => {
  const c = { ...ctx, legacyCount: 2 }
  const prepared = register(emptyBillingFlow(), fixed, c)
  assert.throws(() => debit(prepared, { costId: null }, c), /LEGACY_REVIEW/)
  const f = run(emptyBillingFlow(), cmd('confirm_legacy', { note: 'Tidigare underlag är avstämda mot Fortnox, referens 123' }), c)
  assert.equal(register(f, running, c).agreements.length, 1)
})
test('previous invoices consume the fixed ceiling without creating a new billable amount', () => {
  let f = register(emptyBillingFlow(), fixed)
  f = run(f, { operation: 'record_opening_invoice', id: uuid(), basisId: uuid(), number: 'Gamla-123', date: day, note: 'Avstämt mot gammal kundfaktura', confirmed: true,
    lines: [{ id: uuid(), entryId: uuid(), agreementId: f.agreements[0].id, netOre: 2000000 }] })
  assert.equal(balance(f, f.entries[0]).invoicedOre, 2000000)
  assert.equal(balance(f, f.entries[0]).availableOre, 0)
  assert.equal(f.bases[0].historical, true)
  assert.throws(() => debit(f, { costId: null, netOre: 1 }), /PRICE_LIMIT/)
})
test('malformed saved state is rejected rather than treated as empty', () => {
  assert.throws(() => billingValidateFlow({ version: 1 }), /INVALID/)
  assert.doesNotThrow(() => billingValidateFlow(emptyBillingFlow()))
})

test('unbilled remainder of a partly invoiced basis can be released without rewriting its PDF', () => {
  let f = reserve(debit(review(manual(register())))), b = f.bases[0], old = structuredClone(b)
  f = post(f, { lines: [{ basisId: b.id, lineId: b.lines[0].id, netOre: 900000 }] })
  f = run(f, { operation: 'release_basis', id: b.id, releaseIds: [uuid()], date: day, reason: 'Resten ska på nytt underlag', confirmed: true })
  assert.deepEqual(f.bases[0], old)
  assert.deepEqual(balance(f, f.entries[0]), { reservedOre: 0, invoicedOre: 900000, availableOre: 250000, blocked: false })
  assert.throws(() => post(f, { lines: [{ basisId: b.id, lineId: b.lines[0].id, netOre: 1 }] }), /BALANCE/)
  assert.equal(reserve(f).bases.length, 2)
})

test('matching an invoice after partial billing replaces only the unused remainder', () => {
  let f = reserve(debit(review(manual(register())))), b = f.bases[0]
  f = post(f, { lines: [{ basisId: b.id, lineId: b.lines[0].id, netOre: 500000 }] })
  f = run(f, { operation: 'release_basis', id: b.id, releaseIds: [uuid()], date: day, reason: 'Fakturan har kommit', confirmed: true })
  const s = supplier(), c = { ...ctx, suppliers: [s] }
  f = run(f, { operation: 'match_supplier', id: f.costs[0].id, supplierKey: s.key, reason: 'Samma inköp' }, c)
  f = debit(review(f, c), {}, c)
  assert.equal(f.entries.at(-1).netOre, 627000)
  assert.equal(balance(f, f.entries[0]).availableOre, 0)
  assert.equal(balance(f, f.entries[0]).invoicedOre, 500000)
})

test('manual credits and automatic supplier corrections cannot jointly overcredit a cost', () => {
  let f = post(reserve(debit(review(manual(register())))))
  const s = supplier(), c = { ...ctx, suppliers: [s] }
  f = run(f, { operation: 'match_supplier', id: f.costs[0].id, supplierKey: s.key, reason: 'Samma inköp' }, c)
  f = debit(review(f, c), {}, c)
  assert.throws(() => run(f, { operation: 'credit_entry', id: uuid(), entryId: f.entries[0].id, netOre: 1140000, date: day, reason: 'För stort med tidigare rättning' }, c), /CREDIT_LIMIT/)
})

test('note-only supplier revisions do not invalidate reviewed financial information', () => {
  const s = supplier('stable', { fingerprint: 'financial-v1' }), c = { ...ctx, suppliers: [s] }
  const f = debit(review(manual(register(), { supplierKey: s.key }, c), c), {}, c)
  assert.doesNotThrow(() => reserve(f, {}, { ...c, suppliers: [{ ...s, revision: 2 }] }))
  assert.throws(() => reserve(f, {}, { ...c, suppliers: [{ ...s, revision: 2, fingerprint: 'financial-v2' }] }), /SOURCE_CHANGED/)
})

test('closing cannot omit an agreed fixed remainder or treat prior running invoices as free opening balances', () => {
  const f = register(emptyBillingFlow(), fixed)
  assert.throws(() => run(f, { operation: 'close_economy', confirmed: true }), /INCOMPLETE/)
  const runningFlow = register()
  assert.throws(() => run(runningFlow, { operation: 'record_opening_invoice', id: uuid(), basisId: uuid(), number: 'Old-123', date: day, note: 'Historik', confirmed: true, lines: [{ id: uuid(), entryId: uuid(), agreementId: runningFlow.agreements[0].id, netOre: 10000 }] }), /HISTORY_COST_REQUIRED/)
})
