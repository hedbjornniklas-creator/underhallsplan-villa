import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import * as quotes from '../src/lib/action-cases/quotes.ts'
import { calculateActionCaseCostTotals } from '../src/lib/action-cases/domain.ts'

function compile(name, dependencies) {
  const compiledModule = { exports: {} }
  const source = readFileSync(new URL(`../src/lib/action-cases/${name}.ts`, import.meta.url), 'utf8')
  new Function('module', 'exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(compiledModule, compiledModule.exports, (name) => {
    assert.ok(name in dependencies, `Unexpected import ${name}`)
    return dependencies[name]
  })
  return compiledModule.exports
}

function withoutWorkPartSnapshot(line) {
  const legacyLine = { ...line }
  delete legacyLine.workPartId
  delete legacyLine.workPartTitle
  delete legacyLine.workPartScope
  return legacyLine
}

function withoutAuditFields(value) {
  const record = { ...value }
  const updatedAt = record.updated_at
  delete record.updated_at
  delete record.updated_by
  return { record, updatedAt }
}
const requests = compile('quoteRequests', { './quotes': quotes })
const packages = compile('quotePackages', { './quotes': quotes, './quoteRequests': requests })
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sql = (name) => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8')
const packageMigration = () => sql('2026-09-09_04_action_case_package_pricing')
const db = new PGlite()
const row = async (table, key) => JSON.parse(JSON.stringify((await db.query(`select * from ${table} where id=$1`, [key])).rows[0]))
let sequence = 100
let legacyDraft, legacySent

async function fixture({ groups = 1, parts = false, sameItem = false } = {}) {
  const n = sequence; sequence += 100
  const c = id(n), r = id(n + 1), lines = [], extras = []
  await db.query('insert into action_cases(id,org_id,title,customer_name,property_address) values($1,$2,$3,$4,$5)', [c, id(1), 'Case', 'Customer', 'Address'])
  for (let group = 0; group < groups; group++) {
    const itemId = id(n + 10 + (sameItem ? 0 : group)), partId = parts ? id(n + 20 + group) : null
    if (!sameItem || group === 0) await db.query('insert into action_case_items(id,org_id,action_case_id,title,scope,own_labor_ready,material_price_ready,waste_solution_ready,sort_order) values($1,$2,$3,$4,$5,true,true,true,$6)', [itemId, id(1), c, `Action ${sameItem ? 0 : group}`, `Scope ${sameItem ? 0 : group}`, (group + 1) * 100])
    if (partId) await db.query('insert into action_case_work_parts(id,org_id,action_case_id,action_case_item_id,title,scope) values($1,$2,$3,$4,$5,$6)', [partId, id(1), c, itemId, `Part ${group}`, `Part scope ${group}`])
    for (let index = 0; index < 3; index++) {
      const lineId = id(n + 30 + group * 3 + index)
      await db.query("insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost,markup_percent,quantity_basis,is_verified,verified_by,verified_at,notes,source_url,updated_by) values($1,$2,$3,$4,$5,$6,4,'tim',$7,20,'provided',true,$8,now(),'Original notes','https://example.test/basis',$8)", [lineId, id(1), c, itemId, index === 2 ? 'material' : 'own_labor', `Work ${group}-${index}`, index === 2 ? 100 : 500, id(2)])
      if (partId) await db.query('update action_case_cost_lines set work_part_id=$1 where id=$2', [partId, lineId])
      const source = { costLineId: lineId, itemId, itemTitle: `Action ${sameItem ? 0 : group}`, scope: `Scope ${sameItem ? 0 : group}`, description: `Work ${group}-${index}`,
        workPartId: partId, workPartTitle: partId ? `Part ${group}` : '', workPartScope: partId ? `Part scope ${group}` : '' }
      if (index === 2) extras.push(source); else lines.push(source)
    }
  }
  const input = { requestId: r, supplierName: 'UE', supplierEmail: 'ue@example.test', subject: 'Request', lines, requirementKeys: ['materials'], attachmentIds: [] }
  const write = async (op, data = {}, org = id(1)) => (await db.query('select write_action_case_request($1,$2,$3,$4,$5,$6::jsonb) result', [org, c, r, id(2), op, JSON.stringify(data)])).rows[0].result
  const get = () => row('action_case_quote_requests', r)
  const save = async (more = {}) => write('save', requests.normalizeQuoteRequest({ ...input, ...more }))
  const send = async () => {
    const request = await get()
    const claim = await write('claim_send', { expectedUpdatedAt: request.updated_at, emailPayload: { to: 'ue@example.test', text: request.body } })
    await write('finish_send', { leaseId: claim.leaseId, success: true })
    return claim
  }
  const response = async (amount = 2500) => write('response', { expectedUpdatedAt: (await get()).updated_at, responseMode: 'package', packageAmount: amount, responseNotes: 'Reviewed', responseDocumentId: null })
  const groupList = requests.groupRequestLines(lines)
  const groupPayload = async (group = 0, more = {}) => {
    const sources = groupList[group].lines
    const coveredLineIds = more.coveredLineIds ?? []
    const expectedLines = []
    for (const lineId of [...sources.map((s) => s.costLineId), ...coveredLineIds]) expectedLines.push({ costLineId: lineId, updatedAt: (await row('action_case_cost_lines', lineId)).updated_at })
    return { operation: 'accept', caseId: c, requestId: r, groupKey: groupList[group].key,
      amount: 2500, checked: true, offeredScope: 'All listed group work', separateGroupPriceConfirmed: groups > 1,
      expectedUpdatedAt: (await get()).updated_at, expectedLines, coveredLineIds, ...more }
  }
  const packageWrite = async (op, data, org = id(1), caseId = c) => (await db.query('select write_action_case_quote_package($1,$2,$3,$4,$5,$6::jsonb) result', [org, caseId, r, id(2), op, JSON.stringify(data)])).rows[0].result
  const accept = async (group = 0, more = {}) => packageWrite('accept', await groupPayload(group, more))
  const remove = async (group = 0) => packageWrite('remove', { groupKey: groupList[group].key, expectedUpdatedAt: (await get()).updated_at })
  return { c, r, lines, extras, input, groupList, get, save, send, write, response, groupPayload, packageWrite, accept, remove }
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;`)
  await db.exec(sql('2026-09-08_01_action_cases_foundation').replace('create extension if not exists pgcrypto;', ''))
  await db.exec('create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,action_case_item_id uuid,attachment_type text);')
  for (const name of ['03_action_case_costing', '04_action_case_ai_costing', '05_action_case_work_quotes', '09_action_case_grouped_requests']) await db.exec(sql(`2026-09-08_${name}`))
  await db.exec(`insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');`)
  legacyDraft = await fixture(); legacySent = await fixture()
  for (const f of [legacyDraft, legacySent]) {
    await f.save({ pricePresentation: 'itemized' })
    await db.query('update action_case_quote_requests set body=$1,lines=$2 where id=$3', ['LEGACY saved body unchanged', JSON.stringify(f.lines.map(withoutWorkPartSnapshot)), f.r])
  }
  await legacySent.send()
  await db.exec(packageMigration())
  await db.exec(packageMigration())
  // Verify optional-table absence before installing the real work-part migration.
  const noParts = await fixture(); await noParts.save(); await noParts.send(); await noParts.accept(); await noParts.remove()
  await db.exec(sql('2026-09-09_02_action_case_scope_attachments'))
  await db.exec(sql('2026-09-09_03_action_case_work_parts'))
  await db.exec(packageMigration())
})
after(() => db.close())

test('upgrade preserves old body/snapshots and legacy itemized default; new requests group by default', async () => {
  for (const f of [legacyDraft, legacySent]) {
    const r = await f.get()
    assert.equal(r.price_presentation, 'itemized')
    assert.equal(r.body, 'LEGACY saved body unchanged')
    assert.ok(!('workPartId' in r.lines[0]))
    assert.equal(requests.mapQuoteRequest(r).pricePresentation, 'itemized')
  }
  await legacyDraft.send()
  assert.equal((await legacyDraft.get()).body, 'LEGACY saved body unchanged')
  const f = await fixture(); await f.save()
  assert.equal((await f.get()).price_presentation, 'grouped')
  assert.equal(requests.mapQuoteRequest({}).pricePresentation, 'itemized')
})

test('grouped body collects noncontiguous action/part groups, prints scopes once and never copies internal prices', async () => {
  const f = await fixture({ groups: 2, parts: true, sameItem: true })
  const lines = [f.lines[0], f.lines[2], f.lines[1], f.lines[3]].map((s) => ({ ...s, unitCost: 999999, markupPercent: 666 }))
  const request = requests.normalizeQuoteRequest({ ...f.input, lines })
  assert.equal(request.pricePresentation, 'grouped')
  assert.equal(request.body.split('Åtgärd:').length - 1, 1)
  assert.equal(request.body.split('Part scope 0').length - 1, 1)
  assert.equal(request.body.split('Scope 0').length - 1, 1)
  assert.ok(!/999999|666|kalkylrad/.test(request.body))
  assert.match(request.body, /endast listade arbetsmoment/)
  assert.ok(!('unitCost' in request.lines[0]))
  const itemized = requests.normalizeQuoteRequest({ ...f.input, pricePresentation: 'itemized' })
  assert.match(itemized.body, /per numrerat arbetsmoment/)
  assert.equal(itemized.body.split('Åtgärd:').length - 1, 1)
  for (const change of [{ pricePresentation: 'x' }, { lines: [{ ...f.lines[0], workPartTitle: '' }] }, { lines: [{ ...f.lines[0], workPartId: null }] }]) assert.throws(() => requests.normalizeQuoteRequest({ ...f.input, ...change }))
})

test('one package counts once with explicit extra coverage, unselected rows stay independent, removal restores every original field', async () => {
  const f = await fixture({ parts: true }); await f.save(); await f.send(); await f.response()
  const ids = [...f.lines, ...f.extras].map((s) => s.costLineId)
  const originals = await Promise.all(ids.map((lineId) => row('action_case_cost_lines', lineId)))
  const body = (await f.get()).body
  const result = await f.accept(0, { coveredLineIds: [f.extras[0].costLineId] })
  const costLines = await Promise.all(ids.map((lineId) => row('action_case_cost_lines', lineId)))
  assert.equal(costLines[0].selected_quote_id, result.quoteId)
  assert.equal(costLines[1].covered_by_quote_id, result.quoteId)
  assert.equal(costLines[2].covered_by_quote_id, result.quoteId)
  assert.equal(Number((await row('action_case_items', f.lines[0].itemId)).estimated_cost), 2500)
  assert.equal(Number((await row('action_case_items', f.lines[0].itemId)).customer_price), 3000)
  assert.deepEqual(calculateActionCaseCostTotals(costLines.map((l) => ({ quantity: Number(l.quantity), unitCost: Number(l.unit_cost), markupPercent: Number(l.markup_percent), coveredByQuoteId: l.covered_by_quote_id }))), { internalCost: 2500, customerPrice: 3000 })
  const q = await row('action_case_work_quotes', result.quoteId)
  assert.equal(q.package_request_id, f.r)
  assert.equal(q.request_id, null)
  assert.equal((await f.get()).body, body)
  await f.remove()
  for (let index = 0; index < ids.length; index++) {
    const restored = withoutAuditFields(await row('action_case_cost_lines', ids[index]))
    const original = withoutAuditFields(originals[index])
    assert.deepEqual(restored.record, original.record)
    assert.notEqual(restored.updatedAt, original.updatedAt)
  }
  assert.equal(Number((await row('action_case_items', f.lines[0].itemId)).estimated_cost), 4400)
  await f.accept()
  assert.equal(Number((await row('action_case_items', f.lines[0].itemId)).estimated_cost), 2900, 'unselected material remains priced')
})

test('independent groups on one request are priced and removed individually, never automatically allocated', async () => {
  for (const sameItem of [false, true]) {
    const f = await fixture({ groups: 2, parts: sameItem, sameItem }); await f.save(); await f.send()
    await assert.rejects(f.accept(0, { separateGroupPriceConfirmed: false }), /ACTION_CASE_PACKAGE_ALLOCATION_REQUIRED/)
    await assert.rejects(f.accept(0, { groupKey: 'whole-request' }), /ACTION_CASE_PACKAGE_GROUP_NOT_FOUND/)
    const first = await f.accept(0, { amount: 2100, coveredLineIds: [f.extras[0].costLineId] })
    const second = await f.accept(1, { amount: 3200, coveredLineIds: [f.extras[1].costLineId] })
    assert.notEqual(first.quoteId, second.quoteId)
    const views = (await db.query(`select ${packages.PACKAGE_VIEW_COLUMNS} from action_case_quote_packages where request_id=$1 order by group_key`, [f.r])).rows.map(packages.mapQuotePackage)
    assert.equal(views.length, 2)
    assert.deepEqual(views.map((v) => v.amount), [2100, 3200])
    assert.ok(views.every((v) => !('original_lines' in v)))
    const items = new Set(f.lines.map((s) => s.itemId))
    let total = 0
    for (const item of items) total += Number((await row('action_case_items', item)).estimated_cost)
    assert.equal(total, 5300)
    await f.remove(0)
    assert.equal((await row('action_case_cost_lines', f.groupList[1].lines[0].costLineId)).selected_quote_id, second.quoteId)
    await f.remove(1)
  }
})

test('stale source, part identity/scope/title and coverage versions fail before any costing write', async () => {
  const f = await fixture({ parts: true }); await f.save(); await f.send()
  const payload = await f.groupPayload()
  await db.query('update action_case_cost_lines set unit_cost=501 where id=$1', [f.lines[1].costLineId])
  await assert.rejects(f.packageWrite('accept', payload), /ACTION_CASE_PACKAGE_STALE/)
  await db.query('update action_case_work_parts set scope=$1 where id=$2', ['Changed', f.lines[0].workPartId])
  await assert.rejects(f.accept(), /ACTION_CASE_PACKAGE_STALE/)
  await db.query('update action_case_work_parts set scope=$1,title=$2 where id=$3', [f.lines[0].workPartScope, 'Changed', f.lines[0].workPartId])
  await assert.rejects(f.accept(), /ACTION_CASE_PACKAGE_STALE/)
  await db.query('update action_case_work_parts set title=$1 where id=$2', [f.lines[0].workPartTitle, f.lines[0].workPartId])
  await db.query('update action_case_cost_lines set description=$1 where id=$2', ['Changed secondary', f.lines[1].costLineId])
  await assert.rejects(f.accept(), /ACTION_CASE_PACKAGE_STALE/)
  assert.equal((await db.query('select count(*) n from action_case_quote_packages where request_id=$1', [f.r])).rows[0].n, 0)
  const draft = await fixture({ parts: true })
  await assert.rejects(draft.save({ lines: draft.lines.map((s) => ({ ...s, workPartScope: 'Forged' })) }), /ACTION_CASE_QUOTE_STALE/)
  await draft.save()
  await db.query('update action_case_work_parts set scope=$1 where id=$2', ['Changed', draft.lines[0].workPartId])
  await assert.rejects(draft.send(), /ACTION_CASE_QUOTE_STALE/)
})

test('active package locks every source, part and response; ordinary quote operations cannot change it', async () => {
  const f = await fixture({ parts: true }); await f.save(); await f.send()
  const accepted = await f.accept(0, { coveredLineIds: [f.extras[0].costLineId] })
  for (const source of [...f.lines, ...f.extras]) {
    await assert.rejects(db.query('update action_case_cost_lines set description=$1 where id=$2', ['Changed', source.costLineId]), /ACTION_CASE_(PACKAGE_REMOVE_FIRST|QUOTE_COVERAGE)/)
    await assert.rejects(db.query('delete from action_case_cost_lines where id=$1', [source.costLineId]), /ACTION_CASE_(PACKAGE_REMOVE_FIRST|QUOTE_COVERAGE|QUOTE_SENT_IMMUTABLE)/)
  }
  for (const field of ['title', 'scope']) await assert.rejects(db.query(`update action_case_work_parts set ${field}=$1 where id=$2`, ['Changed', f.lines[0].workPartId]), /ACTION_CASE_(PACKAGE_REMOVE_FIRST|QUOTE_COVERAGE)/)
  await assert.rejects(db.query('update action_case_items set scope=$1 where id=$2', ['Changed', f.lines[0].itemId]), /ACTION_CASE_PACKAGE_REMOVE_FIRST/)
  await assert.rejects(f.response(), /ACTION_CASE_PACKAGE_REMOVE_FIRST/)
  await assert.rejects(f.accept(), /ACTION_CASE_PACKAGE_REMOVE_FIRST/)
  await assert.rejects(db.query('update action_case_work_quotes set amount=7 where id=$1', [accepted.quoteId]), /ACTION_CASE_PACKAGE_USE_RPC/)
  const quoteWrite = async (op) => db.query('select write_action_case_quote($1,$2,$3,$4,$5,$6,$7::jsonb)', [id(1), f.c, f.lines[0].itemId, f.lines[0].costLineId, id(2), op, JSON.stringify({ id: accepted.quoteId, method: 'direct' })])
  for (const op of ['select', 'unselect', 'method', 'delete', 'claim_send']) await assert.rejects(quoteWrite(op), /ACTION_CASE_(PACKAGE_|QUOTE_)/)
  await f.remove()
  await assert.rejects(quoteWrite('select'), /ACTION_CASE_PACKAGE_USE_RPC/)
})

test('coverage is scoped to the exact action/part, overlap and existing selections cannot overwrite originals', async () => {
  const f = await fixture({ groups: 2, parts: true, sameItem: true }); await f.save(); await f.send()
  await assert.rejects(f.accept(0, { coveredLineIds: [f.extras[1].costLineId] }), /ACTION_CASE_PACKAGE_STALE/)
  await assert.rejects(f.accept(0, { coveredLineIds: [f.lines[2].costLineId] }), /ACTION_CASE_PACKAGE_STALE/)
  await assert.rejects(f.accept(0, { coveredLineIds: [f.lines[0].costLineId] }), /ACTION_CASE_PACKAGE_INVALID/)
  const other = await fixture(); await other.save(); await other.send()
  await assert.rejects(f.accept(0, { coveredLineIds: [other.extras[0].costLineId] }), /ACTION_CASE_PACKAGE_STALE/)
  const quoteId = id(99901)
  await db.query('select write_action_case_quote($1,$2,$3,$4,$5,$6,$7::jsonb)', [id(1), other.c, other.lines[0].itemId, other.lines[0].costLineId, id(2), 'save', JSON.stringify(quotes.normalizeQuote({ quoteId, supplierName: 'Alternative', amount: 1000, checked: true, offeredScope: 'Work' }))])
  await db.query('select write_action_case_quote($1,$2,$3,$4,$5,$6,$7::jsonb)', [id(1), other.c, other.lines[0].itemId, other.lines[0].costLineId, id(2), 'select', JSON.stringify({ id: quoteId })])
  await assert.rejects(other.accept(), /ACTION_CASE_PACKAGE_CONFLICT/)
  assert.equal((await row('action_case_cost_lines', other.lines[0].costLineId)).selected_quote_id, quoteId)
})

test('named group explicitly covers unassigned material once and restores its unassigned original', async () => {
  const f = await fixture({ groups: 2, parts: true, sameItem: true })
  const material = f.extras[0].costLineId
  await db.query('update action_case_cost_lines set work_part_id=null where id=$1', [material])
  const original = await row('action_case_cost_lines', material)
  await f.save(); await f.send()
  const accepted = await f.accept(0, { coveredLineIds: [material] })
  assert.equal((await row('action_case_cost_lines', material)).covered_by_quote_id, accepted.quoteId)
  assert.equal((await row('action_case_cost_lines', material)).work_part_id, null)
  await assert.rejects(f.accept(1, { coveredLineIds: [material] }), /ACTION_CASE_PACKAGE_CONFLICT/)
  await f.remove(0)
  const restored = withoutAuditFields(await row('action_case_cost_lines', material))
  const basis = withoutAuditFields(original)
  assert.deepEqual(restored.record, basis.record)
})

test('versions serialize competing accepts/removes; failed writes roll back; tenant and ACL boundaries hold', async () => {
  const f = await fixture(); await f.save(); await f.send()
  const payload = await f.groupPayload()
  const results = await Promise.allSettled([f.packageWrite('accept', payload), f.packageWrite('accept', payload)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /ACTION_CASE_QUOTE_STALE/)
  await assert.rejects(f.packageWrite('remove', payload), /ACTION_CASE_QUOTE_STALE/)
  await assert.rejects(f.packageWrite('remove', await f.groupPayload(), id(9)), /ACTION_CASE_NOT_FOUND/)
  const foreign = await fixture()
  await assert.rejects(f.packageWrite('remove', await f.groupPayload(), id(1), foreign.c), /ACTION_CASE_REQUEST_NOT_FOUND/)
  await f.remove()
  const check = (await db.query("select has_function_privilege('authenticated','write_action_case_quote_package(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') rpc, has_table_privilege('authenticated','action_case_quote_packages','SELECT') readable, has_function_privilege('service_role','write_action_case_request_pre_packages(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') bypass")).rows[0]
  assert.deepEqual(check, { rpc: false, readable: false, bypass: false })
  const forbidden = await f.groupPayload()
  await db.exec('set role authenticated')
  try { await assert.rejects(f.packageWrite('accept', forbidden), /permission denied/); } finally { await db.exec('reset role') }
})

test('itemized linked quotes check part snapshot on selection, including legacy unassigned snapshots', async () => {
  for (const f of [await fixture({ parts: true }), legacySent]) {
    if (f !== legacySent) { await f.save(); await f.send() }
    await f.write('response', { expectedUpdatedAt: (await f.get()).updated_at, responseMode: 'itemized', packageAmount: null, responseNotes: '', responseDocumentId: null })
    const q = (await db.query('select * from action_case_work_quotes where request_id=$1 and cost_line_id=$2', [f.r, f.lines[0].costLineId])).rows[0]
    await db.query('update action_case_work_quotes set checked=true,amount=1234,offered_scope=$1 where id=$2', ['Reviewed work', q.id])
    const select = () => db.query('select write_action_case_quote($1,$2,$3,$4,$5,$6,$7::jsonb)', [id(1), f.c, f.lines[0].itemId, f.lines[0].costLineId, id(2), 'select', JSON.stringify({ id: q.id })])
    await select()
    if (f.lines[0].workPartId) {
      await db.query('update action_case_cost_lines set selected_quote_id=null where id=$1', [f.lines[0].costLineId])
      await db.query('update action_case_work_parts set scope=$1 where id=$2', ['Changed', f.lines[0].workPartId])
      await assert.rejects(select(), /ACTION_CASE_QUOTE_STALE/)
    }
  }
})

test('quote-mode originals and secondary rows restore exactly; failed accept is atomic; immutable send retries remain unchanged', async () => {
  const f = await fixture(); await f.save()
  for (const source of f.lines) await db.query('update action_case_cost_lines set pricing_method=$1 where id=$2', ['quotes', source.costLineId])
  const originals = await Promise.all(f.lines.map((s) => row('action_case_cost_lines', s.costLineId)))
  await f.send()
  // Snapshot category changes are allowed, descriptions and scope remain identical.
  await f.accept()
  assert.equal((await row('action_case_cost_lines', f.lines[1].costLineId)).pricing_method, 'direct')
  await f.remove()
  for (let n = 0; n < f.lines.length; n++) {
    const actual = withoutAuditFields(await row('action_case_cost_lines', f.lines[n].costLineId))
    const expected = withoutAuditFields(originals[n])
    assert.deepEqual(actual.record, expected.record)
  }
  await assert.rejects(db.query('update action_case_quote_requests set body=$1 where id=$2', ['Mutated', f.r]), /ACTION_CASE_QUOTE_SENT_IMMUTABLE/)
  await assert.rejects(db.query('update action_case_quote_requests set price_presentation=$1 where id=$2', ['itemized', f.r]), /ACTION_CASE_QUOTE_SENT_IMMUTABLE/)
  await db.query('delete from action_cases where id=$1', [f.c])
  assert.equal((await db.query('select count(*) n from action_case_quote_packages where action_case_id=$1', [f.c])).rows[0].n, 0)
})

test('package input rejects missing review, invalid cents, duplicate/missing versions and invalid group identity', () => {
  const input = { operation: 'accept', caseId: id(10), requestId: id(11), groupKey: `${id(12)}:`, checked: true,
    offeredScope: 'Scope', amount: 0, expectedUpdatedAt: '2026-09-09T10:00:00Z', expectedLines: [{ costLineId: id(13), updatedAt: '2026-09-09T10:00:00Z' }] }
  assert.equal(packages.normalizeQuotePackageAction(input).amount, 0)
  for (const change of [{ checked: false }, { amount: null }, { amount: false }, { amount: 1.234 }, { amount: -1 }, { expectedUpdatedAt: null }, { expectedLines: [] }, { expectedLines: [...input.expectedLines, ...input.expectedLines] }, { groupKey: 'all' }, { validUntil: '2026-02-30' }]) assert.throws(() => packages.normalizeQuotePackageAction({ ...input, ...change }))
})

test('mid-accept and mid-remove failures roll back every quote, basis, version and price change', async () => {
  const f = await fixture(); await f.save(); await f.send()
  const ids = [...f.lines, ...f.extras].map((s) => s.costLineId)
  const originals = await Promise.all(ids.map((lineId) => row('action_case_cost_lines', lineId)))
  const initialRequest = await f.get()
  await db.exec(`create function test_package_failure() returns trigger language plpgsql as $$
    begin if new.id='${f.lines[1].costLineId}' then raise exception 'TEST_ATOMIC_FAILURE'; end if; return new; end $$;
    create trigger trg_zzzzz_test_failure before update on action_case_cost_lines for each row execute function test_package_failure();`)
  await assert.rejects(f.accept(0, { coveredLineIds: [f.extras[0].costLineId] }), /TEST_ATOMIC_FAILURE/)
  assert.deepEqual(await Promise.all(ids.map((lineId) => row('action_case_cost_lines', lineId))), originals)
  assert.deepEqual(await f.get(), initialRequest)
  assert.equal((await db.query('select count(*) n from action_case_quote_packages where request_id=$1', [f.r])).rows[0].n, 0)
  assert.equal((await db.query('select count(*) n from action_case_work_quotes where package_request_id=$1', [f.r])).rows[0].n, 0)
  await db.exec('drop trigger trg_zzzzz_test_failure on action_case_cost_lines')
  await f.accept(0, { coveredLineIds: [f.extras[0].costLineId] })
  const activeLines = await Promise.all(ids.map((lineId) => row('action_case_cost_lines', lineId)))
  const activeRequest = await f.get()
  await db.exec('create trigger trg_zzzzz_test_failure before update on action_case_cost_lines for each row execute function test_package_failure()')
  await assert.rejects(f.remove(), /TEST_ATOMIC_FAILURE/)
  assert.deepEqual(await Promise.all(ids.map((lineId) => row('action_case_cost_lines', lineId))), activeLines)
  assert.deepEqual(await f.get(), activeRequest)
  assert.equal((await db.query('select state from action_case_quote_packages where request_id=$1', [f.r])).rows[0].state, 'active')
  await db.exec('drop trigger trg_zzzzz_test_failure on action_case_cost_lines; drop function test_package_failure();')
  await f.remove()
})

test('package review verifies amount, exact version set, expiry, zero pricing and saved total', async () => {
  const f = await fixture(); await f.save()
  await assert.rejects(f.accept(), /ACTION_CASE_PACKAGE_RESPONSE_REQUIRED/)
  await f.send(); await f.response(0)
  await assert.rejects(f.accept(), /ACTION_CASE_PACKAGE_AMOUNT_MISMATCH/)
  for (const change of [{ amount: 0, checked: false }, { amount: 'NaN' }, { amount: 1.234 }, { amount: 0, expectedLines: [] }, { amount: 0, validUntil: '2000-01-01' }]) await assert.rejects(f.accept(0, change), /ACTION_CASE_PACKAGE_/)
  const accepted = await f.accept(0, { amount: 0 })
  assert.equal(Number((await row('action_case_cost_lines', f.lines[0].costLineId)).unit_cost), 0)
  assert.equal(Number((await row('action_case_items', f.lines[0].itemId)).estimated_cost), 400)
  await f.remove()
  await assert.rejects(db.query('update action_case_cost_lines set pricing_method=$1,selected_quote_id=$2 where id=$3', ['quotes', accepted.quoteId, f.lines[0].costLineId]), /ACTION_CASE_PACKAGE_USE_RPC/)
})

test('document deletion preserves the attachment and historical quote reference for active and removed packages', async () => {
  const f = await fixture(); await f.save(); await f.send()
  const doc = id(99910)
  await db.query("insert into action_case_attachments(id,org_id,action_case_id,action_case_item_id,attachment_type) values($1,$2,$3,$4,'document')", [doc, id(1), f.c, f.lines[0].itemId])
  await f.write('response', { expectedUpdatedAt: (await f.get()).updated_at, responseMode: 'package', packageAmount: 2500, responseNotes: '', responseDocumentId: doc })
  const accepted = await f.accept()
  const attachment = await row('action_case_attachments', doc)
  const quote = await row('action_case_work_quotes', accepted.quoteId)
  assert.equal(quote.document_id, doc)
  for (const state of ['active', 'removed']) {
    if (state === 'removed') await f.remove()
    const request = await f.get()
    assert.equal((await db.query('select state from action_case_quote_packages where request_id=$1 and group_key=$2', [f.r, f.groupList[0].key])).rows[0].state, state)
    await assert.rejects(db.query('delete from action_case_attachments where id=$1 and org_id=$2 and action_case_id=$3', [doc, id(1), f.c]), /ACTION_CASE_PACKAGE_USE_RPC/)
    assert.deepEqual(await row('action_case_attachments', doc), attachment)
    assert.deepEqual(await row('action_case_work_quotes', accepted.quoteId), quote)
    assert.deepEqual(await f.get(), request)
    assert.equal((await f.get()).response_document_id, doc)
  }
})

test('whole-case deletion remains possible with active package, work parts and response document', async () => {
  const f = await fixture({ parts: true }); await f.save(); await f.send()
  const doc = id(99909)
  await db.query("insert into action_case_attachments(id,org_id,action_case_id,action_case_item_id,attachment_type) values($1,$2,$3,$4,'document')", [doc, id(1), f.c, f.lines[0].itemId])
  await f.write('response', { expectedUpdatedAt: (await f.get()).updated_at, responseMode: 'package', packageAmount: 2500, responseNotes: '', responseDocumentId: doc })
  await f.accept(0, { coveredLineIds: [f.extras[0].costLineId] })
  await db.query('delete from action_cases where id=$1', [f.c])
  assert.equal((await db.query('select count(*) n from action_case_quote_packages where action_case_id=$1', [f.c])).rows[0].n, 0)
})

test('accept and remove reject every non-draft item/case state without changing pricing', async () => {
  const f = await fixture(); await f.save(); await f.send(); await f.accept()
  const lines = await Promise.all(f.lines.map((s) => row('action_case_cost_lines', s.costLineId)))
  async function itemStatus(status) {
    await db.exec('alter table action_case_items disable trigger trg_action_case_item_cost_state')
    try { await db.query('update action_case_items set status=$1 where id=$2', [status, f.lines[0].itemId]) }
    finally { await db.exec('alter table action_case_items enable trigger trg_action_case_item_cost_state') }
  }
  for (const status of ['offered', 'approved', 'declined', 'scheduled', 'in_progress', 'ready_for_review', 'completed', 'cancelled']) {
    await itemStatus(status)
    await assert.rejects(f.accept(), /ACTION_CASE_ITEM_LOCKED/)
    await assert.rejects(f.remove(), /ACTION_CASE_ITEM_LOCKED/)
  }
  await itemStatus('pricing_needed')
  for (const status of ['awaiting_customer', 'approved', 'in_progress', 'completed', 'cancelled']) {
    await db.query('update action_cases set status=$1 where id=$2', [status, f.c])
    await assert.rejects(f.accept(), /ACTION_CASE_ITEM_LOCKED/)
    await assert.rejects(f.remove(), /ACTION_CASE_ITEM_LOCKED/)
  }
  assert.deepEqual(await Promise.all(f.lines.map((s) => row('action_case_cost_lines', s.costLineId))), lines)
})

test('upgraded send retry uses the immutable payload even when work-part source changes after first attempt', async () => {
  const f = await fixture({ parts: true }); await f.save()
  const request = await f.get(), email = { to: request.supplier_email, text: request.body, idempotencyKey: 'unchanged' }
  const claim = await f.write('claim_send', { expectedUpdatedAt: request.updated_at, emailPayload: email })
  await assert.rejects(f.write('claim_send'), /ACTION_CASE_QUOTE_SEND_BUSY/)
  await f.write('finish_send', { leaseId: claim.leaseId, success: false })
  await db.query('update action_case_work_parts set scope=$1 where id=$2', ['Changed after attempt', f.lines[0].workPartId])
  const retry = await f.write('claim_send', { emailPayload: { to: 'different@example.test' } })
  assert.deepEqual(retry.payload, email)
  await f.write('finish_send', { leaseId: retry.leaseId, success: true })
  assert.equal((await f.get()).body, request.body)
  assert.equal((await db.query('select count(*) n from action_case_work_quotes where request_id=$1', [f.r])).rows[0].n, 2)
  await assert.rejects(f.accept(), /ACTION_CASE_PACKAGE_STALE/)
})

test('server package helper normalizes once, preserves versions, calls only scoped RPC and maps actionable errors', async () => {
  const calls = []; let error = null
  const server = compile('quotePackagesServer', {
    'server-only': {}, './quotePackages': packages,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { state: 'active' }, error }
    } }) },
  })
  const payload = { operation: 'accept', caseId: id(100), requestId: id(101), groupKey: `${id(102)}:`, expectedUpdatedAt: '2026-09-09T10:00:00.123456Z',
    amount: '100.01', checked: true, offeredScope: ' Work ', expectedLines: [{ costLineId: id(103), updatedAt: '2026-09-09T10:00:00.123456Z' }], ignoredInternalAmount: 99999 }
  await server.handleQuotePackageAction({ orgId: id(1), userId: id(2) }, payload)
  assert.equal(calls[0].name, 'write_action_case_quote_package')
  assert.equal(calls[0].args.p_org_id, id(1))
  assert.equal(calls[0].args.p_user_id, id(2))
  assert.equal(calls[0].args.p_data.expectedUpdatedAt, payload.expectedUpdatedAt)
  assert.equal(calls[0].args.p_data.amount, 100.01)
  assert.ok(!('ignoredInternalAmount' in calls[0].args.p_data))
  for (const code of ['ACTION_CASE_ITEM_LOCKED', 'ACTION_CASE_PACKAGE_REMOVE_FIRST', 'ACTION_CASE_PACKAGE_ALLOCATION_REQUIRED', 'ACTION_CASE_QUOTE_STALE']) {
    error = { code: 'P0001', message: code }
    await assert.rejects(server.handleQuotePackageAction({ orgId: id(1), userId: id(2) }, payload), new RegExp(code))
  }
  error = { code: '42883', message: 'Missing function' }
  await assert.rejects(server.handleQuotePackageAction({ orgId: id(1), userId: id(2) }, payload), /ACTION_CASES_SCHEMA_REQUIRED/)
})
