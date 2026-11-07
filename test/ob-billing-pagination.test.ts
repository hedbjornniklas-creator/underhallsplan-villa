import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { billingDb, saveBilling, asRole, ACTOR, COLLEAGUE, ORG, OTHER, ADMIN } from './helpers/ob-billing-db.ts'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { create } from './helpers/ob-organization-runtime-db.ts'

type Row = {
  assignment: { id: string; status: string } | null;
  inspection: { id: string; status: string; customer_name: string } | null;
  billing: { status: 'invoiced' | 'not_invoiced' } | null; canEdit: boolean
}
type Page = {
  rows: Row[]; billingAvailable: boolean; total: number;
  counts: { all: number; active: number; closed: number; 'to-invoice': number };
  page: number; pageSize: number
}
let db: PGlite
const unbilled = new Set<string>(), billed = new Set<string>(), ongoing = new Set<string>()
let colleagueId: string, otherOrgId: string
async function page(filter = 'all', pageNo = 1, attention = false, archived = false, actor = ACTOR, org = ORG) {
  return asRole(db, 'authenticated', async () => (await db.query<{ value: Page }>(
    'select ob_overview_page($1,$2,$3,$4,$5,$6,$7,$8) value',
    [org, 'Fakturaprovet', filter, 'date-desc', attention, archived, pageNo, 10],
  )).rows[0].value, actor)
}
async function specimen(n: number, status: string, flag = false, actor = ACTOR, org = ORG) {
  const item = await create(db, org, actor)
  const date = new Date(Date.UTC(2026, 10, n)).toISOString().slice(0, 10)
  await db.query("update properties set address=$2 where id=$1", [item.propertyId, `Fakturaprovet Gata ${n}`])
  await db.query('update inspections set customer_name=$2,date=$3,status=$4 where id=$1',
    [item.inspectionId, `Fakturaprovet Kund ${n}`, date, status])
  if (flag) await saveBilling(db, item.inspectionId, true, `F-${n}`, 0, org, actor)
  return item.inspectionId
}

before(async () => {
  db = await billingDb()
  for (let n = 1; n <= 35; n++) {
    const id = await specimen(n, n % 3 === 0 ? 'done' : n % 3 === 1 ? 'completed' : 'klar', n <= 10)
    ;(n <= 10 ? billed : unbilled).add(id)
  }
  for (let n = 36; n <= 42; n++) ongoing.add(await specimen(n, 'ongoing', n <= 37))
  await specimen(43, 'archived', true); await specimen(44, 'arkiverad')
  for (const status of ['cancelled', 'draft']) {
    await db.query(`insert into assignments(id,org_id,responsible_profile_id,customer_email,assignment_type,status,property_address)
      values($1,$2,$3,'billing@example.test','OB',$4,$5)`, [randomUUID(), ORG, ACTOR, status, `Fakturaprovet ${status}`])
  }
  colleagueId = await specimen(45, 'completed', false, COLLEAGUE)
  await saveBilling(db, colleagueId, false, 'PRIVATE-COLLEAGUE-INVOICE', 0, ORG, COLLEAGUE)
  otherOrgId = await specimen(46, 'completed', false, ACTOR, OTHER)
})
after(async () => { await db?.close() })

test('Aktuell includes completed-unbilled; Avslutade requires completed-invoiced without changing inspection status', async () => {
  const all = await page()
  assert.equal(all.billingAvailable, true); assert.equal(all.total, 44)
  assert.deepEqual(all.counts, { all: 44, active: 33, closed: 11, 'to-invoice': 25 })
  const current = await page('active')
  assert.equal(current.total, 33)
  const closed = await page('closed')
  assert.equal(closed.total, 11)
  assert.ok(closed.rows.every(row => row.inspection ? billed.has(row.inspection.id) && row.billing?.status === 'invoiced' : row.assignment?.status === 'cancelled'))
  const actual = await db.query<{ id: string; status: string }>('select id,status from inspections where id=any($1::uuid[])', [[...unbilled]])
  assert.ok(actual.rows.every(row => ['completed', 'done', 'klar'].includes(row.status)), 'list semantics never reopen completed inspections')
  assert.equal((await page('all', 1, false, true)).total, 46)
  assert.equal((await page('closed', 1, false, true)).total, 13)
})

test('Att fakturera is a server-wide paginated selection, excludes ongoing even when billed and includes all completed aliases', async () => {
  const pages = [await page('to-invoice', 1), await page('to-invoice', 2), await page('to-invoice', 3)]
  assert.deepEqual(pages.map(item => item.rows.length), [10, 10, 5])
  assert.ok(pages.every(item => item.total === 25 && item.counts['to-invoice'] === 25))
  const ids = pages.flatMap(item => item.rows.map(row => row.inspection!.id))
  assert.equal(new Set(ids).size, 25); assert.deepEqual(new Set(ids), unbilled)
  assert.ok(pages.flatMap(item => item.rows).every(row => row.billing?.status === 'not_invoiced' && !ongoing.has(row.inspection!.id)))
  assert.equal((await page('to-invoice', 99)).page, 3, 'stale page clamps against the filtered total')
})

test('invoice count/filter are independent of attention-only and assignment-only rows have no billable inspection', async () => {
  const attention = await page('all', 1, true)
  assert.equal(attention.total, 1); assert.equal(attention.rows[0].assignment?.status, 'draft')
  assert.equal(attention.rows[0].billing, null)
  assert.equal(attention.counts['to-invoice'], 25)
  assert.equal((await page('to-invoice', 1, true)).total, 25)
})

test('colleague flag permits read-only invoice metadata but never another org; live mark/reset immediately changes global counts', async () => {
  assert.ok(!(await page('to-invoice')).rows.some(row => row.inspection?.id === colleagueId))
  await asRole(db, 'service_role', () => db.query('select organization_member_ob_visibility_set($1,$2,$3,true,0)', [ADMIN, ORG, ACTOR]))
  const visible = await page('to-invoice')
  assert.equal(visible.total, 26)
  assert.ok(visible.rows.some(row => row.inspection?.id === colleagueId && !row.canEdit && row.billing?.status === 'not_invoiced'))
  for (const response of [visible, await page('all'), await page('closed')]) {
    for (const row of response.rows) if (row.inspection) assert.deepEqual(Object.keys(row.billing!), ['status'])
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE-COLLEAGUE-INVOICE|Testbesiktningsman|invoiceNumber|invoicedAt|updatedAt|updatedByName|revision/)
  }
  assert.ok(!visible.rows.some(row => row.inspection?.id === otherOrgId))
  await assert.rejects(saveBilling(db, colleagueId, true, null, 0), /OB_BILLING_ACTOR_FORBIDDEN/)
  const id = [...unbilled][0]
  await saveBilling(db, id, true, 'AFTER-LIST', 0)
  assert.equal((await page('to-invoice')).total, 25)
  const closed = await page('closed')
  assert.equal(closed.total, 12)
  await saveBilling(db, id, false, 'AFTER-LIST', 1)
  assert.equal((await page('to-invoice')).total, 26)
  await asRole(db, 'service_role', () => db.query('select organization_member_ob_visibility_set($1,$2,$3,false,1)', [ADMIN, ORG, ACTOR]))
  assert.equal((await page('to-invoice')).total, 25)
})
