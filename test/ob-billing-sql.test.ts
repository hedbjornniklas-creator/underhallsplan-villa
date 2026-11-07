import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { billingDb, billingMigration, saveBilling, asRole, ACTOR, COLLEAGUE, ORG, OTHER, ADMIN } from './helpers/ob-billing-db.ts'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { create } from './helpers/ob-organization-runtime-db.ts'

let db: PGlite
before(async () => { db = await billingDb(); await db.exec(billingMigration) })
after(async () => { await db?.close() })

test('full visibility/overview migration chain is repeatable; tables stay private and writes are audited RPC-only', async () => {
  const access = (await db.query(`select
    has_table_privilege('authenticated','ob_inspection_billing','SELECT') auth_read,
    has_table_privilege('anon','ob_inspection_billing_events','SELECT') anon_read,
    has_table_privilege('service_role','ob_inspection_billing','SELECT') server_read,
    has_table_privilege('service_role','ob_inspection_billing','UPDATE') server_write,
    has_table_privilege('service_role','ob_inspection_billing_events','INSERT') server_audit,
    has_function_privilege('authenticated','ob_set_inspection_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE') auth_rpc,
    has_function_privilege('service_role','ob_set_inspection_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE') server_rpc,
    (select prosecdef from pg_proc where oid='ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)'::regprocedure) overview_definer,
    has_function_privilege('service_role','ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)','EXECUTE') server_overview`)).rows[0]
  assert.deepEqual(access, { auth_read: false, anon_read: false, server_read: true,
    server_write: false, server_audit: false, auth_rpc: false, server_rpc: true,
    overview_definer: true, server_overview: false })
  await assert.rejects(asRole(db, 'authenticated', () => db.query('select * from ob_inspection_billing')), /permission denied/)
  await assert.rejects(asRole(db, 'service_role', () => db.query('delete from ob_inspection_billing')), /permission denied/)
})

test('locked completed inspection and frozen published report stay unchanged while invoice number/status can be corrected', async () => {
  const created = await create(db)
  const id = created.inspectionId
  await db.query("update inspections set status='completed',locked_at='2026-11-01T10:00:00Z',locked_by=$2 where id=$1", [id, ACTOR])
  await db.query("insert into inspection_report_links(inspection_id,org_id,snapshot_payload) values($1,$2,'{\"frozen\":\"untouched\"}')", [id, ORG])
  const beforeState = (await db.query('select to_jsonb(i) as inspection from inspections i where id=$1', [id])).rows
  const first = await saveBilling(db, id, true, ' F-101 ', 0)
  assert.equal(first.status, 'invoiced'); assert.equal(first.invoiceNumber, 'F-101'); assert.equal(first.revision, 1)
  assert.equal(first.updatedByName, 'Testbesiktningsman'); assert.ok(first.invoicedAt)
  const corrected = await saveBilling(db, id, true, 'F-102', 1)
  assert.equal(corrected.invoicedAt, first.invoicedAt); assert.equal(corrected.revision, 2)
  const reset = await saveBilling(db, id, false, 'F-102', 2)
  assert.equal(reset.status, 'not_invoiced'); assert.equal(reset.invoicedAt, null)
  assert.equal(reset.invoiceNumber, 'F-102'); assert.equal(reset.revision, 3)
  assert.equal((await saveBilling(db, id, false, null, 3)).invoiceNumber, null)
  const events = (await db.query<{ previous_state: { isInvoiced: boolean; invoiceNumber: string }; new_state: { isInvoiced: boolean } }>(
    'select previous_state,new_state from ob_inspection_billing_events where inspection_id=$1 order by revision', [id])).rows
  assert.equal(events.length, 4); assert.equal(events[2].previous_state.isInvoiced, true)
  assert.equal(events[2].new_state.isInvoiced, false); assert.equal(events[3].previous_state.invoiceNumber, 'F-102')
  assert.deepEqual((await db.query('select to_jsonb(i) as inspection from inspections i where id=$1', [id])).rows, beforeState)
  assert.deepEqual((await db.query<{ snapshot_payload: unknown }>('select snapshot_payload from inspection_report_links where inspection_id=$1', [id])).rows[0].snapshot_payload,
    { frozen: 'untouched' })
  await assert.rejects(db.query("update inspections set customer_name='must remain locked' where id=$1", [id]), /låst/i)
})

test('no-op saves do not write; stale concurrent revisions never overwrite a confirmed marker', async () => {
  const id = (await create(db)).inspectionId
  assert.deepEqual(await saveBilling(db, id, false, null, 0), {
    status: 'not_invoiced', invoiceNumber: null, invoicedAt: null, updatedAt: null, updatedByName: null, revision: 0,
  })
  const first = await saveBilling(db, id, true, null, 0)
  assert.deepEqual(await saveBilling(db, id, true, null, 1), first)
  await assert.rejects(saveBilling(db, id, false, null, 0), /OB_BILLING_CONFLICT/)
  await assert.rejects(saveBilling(db, id, true, 'older browser', 0), /OB_BILLING_CONFLICT/)
  assert.equal((await db.query('select * from ob_inspection_billing_events where inspection_id=$1', [id])).rows.length, 1)
})

test('organization binding, ownership, OB access and active membership are required even for colleague-visible records', async () => {
  const mine = (await create(db)).inspectionId
  const theirs = (await create(db, ORG, COLLEAGUE)).inspectionId
  await assert.rejects(saveBilling(db, mine, true, null, 0, OTHER), /OB_BILLING_ACTOR_FORBIDDEN/)
  await assert.rejects(saveBilling(db, mine, true, null, 0, ORG, ADMIN), /OB_BILLING_ACTOR_FORBIDDEN/)
  await assert.rejects(saveBilling(db, randomUUID(), true, null, 0), /OB_BILLING_ACTOR_FORBIDDEN/)
  await asRole(db, 'service_role', () => db.query('select organization_member_ob_visibility_set($1,$2,$3,true,0)', [ADMIN, ORG, ACTOR]))
  assert.equal((await db.query<{ can_view: boolean }>('select ob_inspection_visibility_access($1,$2,$3,false) can_view', [theirs, ORG, ACTOR])).rows[0].can_view, true)
  await assert.rejects(saveBilling(db, theirs, true, null, 0), /OB_BILLING_ACTOR_FORBIDDEN/)
  await db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2', [ORG, ACTOR])
  await assert.rejects(saveBilling(db, mine, true, null, 0), /OB_BILLING_ACTOR_FORBIDDEN/)
  await db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2', [ORG, ACTOR])
  await db.query("insert into organization_enabled_modules values($1,'inspections',false)", [ORG])
  await assert.rejects(saveBilling(db, mine, true, null, 0), /OB_BILLING_ACTOR_FORBIDDEN/)
  await db.query("update organization_enabled_modules set is_active=true where org_id=$1 and module_key='inspections'", [ORG])
  assert.equal((await saveBilling(db, mine, true, null, 0)).revision, 1)
})

test('invalid input and audit insertion failure roll back marker and revision atomically', async () => {
  const id = (await create(db)).inspectionId
  for (const [number, revision] of [['x'.repeat(101), 0], ['X\nY', 0], [null, -1]] as const) {
    await assert.rejects(saveBilling(db, id, true, number, revision), /OB_BILLING_INPUT_INVALID/)
  }
  await db.exec(`create function billing_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'TEST_AUDIT_FAILURE'; end $$;
    create trigger billing_audit_failure before insert on ob_inspection_billing_events for each row execute function billing_audit_failure();`)
  await assert.rejects(saveBilling(db, id, true, 'FAIL', 0), /TEST_AUDIT_FAILURE/)
  await db.exec('drop trigger billing_audit_failure on ob_inspection_billing_events; drop function billing_audit_failure();')
  assert.equal((await db.query('select * from ob_inspection_billing where inspection_id=$1', [id])).rows.length, 0)
  assert.equal((await saveBilling(db, id, true, 'SUCCESS', 0)).revision, 1)
})

test('unknown overview source drift aborts the entire migration rather than replacing newer authorization code', async () => {
  const original = (await db.query<{ body: string; definition: string }>(`select prosrc body,pg_get_functiondef(oid) definition from pg_proc
    where oid='ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)'::regprocedure`)).rows[0]
  await db.exec(original.definition.replace(original.body, original.body + '\n-- unrelated future security change\n'))
  await assert.rejects(db.exec(billingMigration), /OB_BILLING_OVERVIEW_REVIEW_REQUIRED/)
  await db.exec('rollback')
  const drifted = (await db.query<{ body: string }>("select prosrc body from pg_proc where oid='ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)'::regprocedure")).rows[0].body
  assert.match(drifted, /unrelated future security change/)
  await db.exec(original.definition)
  await db.exec(billingMigration)
})
