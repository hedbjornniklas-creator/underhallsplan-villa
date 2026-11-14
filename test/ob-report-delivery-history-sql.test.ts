import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync('docs/db/2026-11-06_01_ob_report_delivery_history.sql', 'utf8')
const repairSql = readFileSync('docs/db/2026-11-06_02_ob_mokarr_delivery_history.sql', 'utf8')

test('legacy repair only links the three verified messages and aborts on a mismatched binding', async () => {
  const db = new PGlite()
  const inspection = 'e9b31370-39b8-4ee2-ac06-3bdecb80f96d'
  const org = '71c056a9-aef5-42ce-872c-75952bc55795'
  const property = '7361a788-24e6-41b9-91f5-081c04c116f3'
  const messages = ['8ea0a501-50dc-4bdb-82a2-ef7bccfaeb63', '176821a9-2fc0-416e-b694-7318436f06f9', '7431b736-c656-416b-b7e5-cce42b4e1986']
  try {
    await db.exec(`create table inspections(id uuid primary key, property_id uuid);
      create table ob_organization_bindings(inspection_id uuid, org_id uuid);
      create table outbound_messages(id uuid primary key, org_id uuid, inspection_id uuid,
        template_key text, provider text, status text, report_link_id uuid);
      create table inspection_report_links(snapshot_payload jsonb, token_hash text, revoked_at timestamptz);`)
    await db.query('insert into inspections values ($1,$2)', [inspection,property])
    await db.query('insert into ob_organization_bindings values ($1,$2)', [inspection,org])
    for (const id of messages) {
      await db.query("insert into outbound_messages values ($1,$2,null,'inspection_report_delivery','resend','sent',null)", [id,org])
    }
    await db.query("insert into outbound_messages values ('10000000-0000-4000-8000-000000000001',$1,null,'inspection_report_delivery','resend','sent',null)", [org])
    await db.exec(`insert into inspection_report_links values ('{"original":"unchanged"}','original-hash','2026-10-30');`)
    const frozen = (await db.query('select * from inspection_report_links')).rows
    await db.exec(repairSql)
    await db.exec(repairSql)
    const rows = (await db.query<{id:string,inspection_id:string|null,report_link_id:string|null}>('select * from outbound_messages')).rows
    assert.equal(rows.filter(row => row.inspection_id === inspection).length, 3)
    assert.equal(rows.find(row => !messages.includes(row.id))?.inspection_id, null)
    assert.ok(rows.every(row => row.report_link_id === null))
    assert.deepEqual((await db.query('select * from inspection_report_links')).rows, frozen)

    await db.query("update outbound_messages set inspection_id=null,provider='other' where id=$1", [messages[0]])
    await assert.rejects(db.exec(repairSql), /RECORD_MISMATCH/)
    await db.exec('rollback;')
    assert.equal((await db.query<{inspection_id:string|null}>('select inspection_id from outbound_messages where id=$1', [messages[0]])).rows[0].inspection_id, null)
    await db.exec('delete from ob_organization_bindings;')
    await assert.rejects(db.exec(repairSql), /BINDING_MISMATCH/)
    await db.exec('rollback;')
    assert.deepEqual((await db.query('select * from inspection_report_links')).rows, frozen)
  } finally { await db.close() }
})

test('audit migration preserves reports, includes retired versions, scopes mail, and records completion/locking atomically', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table organizations(id uuid primary key);
      create table profiles(id uuid primary key,full_name text);
      create table properties(id uuid primary key,owner uuid);
      create table inspections(id uuid primary key,property_id uuid,status text,locked_at timestamptz,locked_by uuid);
      create table ob_organization_bindings(inspection_id uuid,org_id uuid);
      create table org_members(org_id uuid,profile_id uuid,is_active boolean);
      create table assignments(id uuid primary key,inspection_id uuid,org_id uuid,assignment_type text);
      create table inspection_report_links(id uuid primary key,org_id uuid,inspection_id uuid,assignment_id uuid,
        created_at timestamptz,created_by uuid,pdf_status text,pdf_generated_at timestamptz,revoked_at timestamptz,snapshot_payload jsonb);
      create table outbound_messages(id uuid primary key,org_id uuid,assignment_id uuid,template_key text,
        recipient_email text,status text,sent_at timestamptz,created_at timestamptz,created_by uuid,error_message text);
      create table inspection_lock_events(id uuid,org_id uuid,inspection_id uuid,action text,performed_at timestamptz,created_at timestamptz,performed_by uuid,reason text);`)
    const ids = Array.from({ length: 8 }, (_,i) => `10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`)
    const [org,actor,property,inspection,report,old,assignment,message] = ids
    await db.exec(`insert into organizations values ('${org}'); insert into profiles values ('${actor}','Inspector');
      insert into properties values ('${property}','${actor}');
      insert into inspections values ('${inspection}','${property}','ongoing',null,null);
      insert into ob_organization_bindings values ('${inspection}','${org}');
      insert into org_members values ('${org}','${actor}',true);
      insert into assignments values ('${assignment}','${inspection}','${org}','OB');
      insert into inspection_report_links values ('${old}','${org}','${inspection}',null,'2026-10-01','${actor}','ready','2026-10-01','2026-11-06','{"original":"unchanged"}');
      insert into inspection_report_links values ('${report}','${org}','${inspection}',null,'2026-11-06','${actor}','ready','2026-11-06',null,'{"current":"unchanged"}');
      insert into outbound_messages values ('${message}','${org}','${assignment}','inspection_report_delivery','customer@example.test','sent','2026-11-06','2026-11-06','${actor}',null);`)
    await db.exec(sql)
    await db.exec(sql)
    const frozen = (await db.query(`select snapshot_payload from inspection_report_links order by id`)).rows
    assert.deepEqual(frozen.map((r: any) => r.snapshot_payload), [{ current: 'unchanged' }, { original: 'unchanged' }])
    assert.equal((await db.query<any>(`select inspection_id from outbound_messages`)).rows[0].inspection_id, inspection)
    await db.exec(`update outbound_messages set report_link_id='${report}' where id='${message}';`)
    await assert.rejects(db.exec(`update outbound_messages set inspection_id='${org}' where id='${message}'`), /BINDING_INVALID/)
    const history = (await db.query<any>(`select * from ob_report_delivery_history order by occurred_at,id`)).rows
    assert.equal(history.filter(r => r.type === 'published').length, 2)
    assert.equal(history.find(r => r.report_id === old).report_active, false)
    assert.equal(history.find(r => r.type === 'sent').recipient_email, 'customer@example.test')
    const complete = () => db.query(`select ob_complete_inspection_with_history($1,$2,$3,'send_and_complete',$4)`, [org,inspection,actor,report])
    await complete(); await complete()
    assert.equal((await db.query<any>(`select count(*)::integer n from ob_report_delivery_events`)).rows[0].n, 2)
    assert.equal((await db.query<any>(`select status from inspections`)).rows[0].status, 'completed')
    await assert.rejects(db.query(`select ob_complete_inspection_with_history($1,$2,$3,'complete_only',null)`,[property,inspection,actor]), /FORBIDDEN/)
    await db.exec(`update inspections set locked_at=null,status='ongoing';
      create function reject_audit() returns trigger language plpgsql as $$ begin raise exception 'TEST_AUDIT_FAILURE'; end $$;
      create trigger reject_audit before insert on ob_report_delivery_events for each row execute function reject_audit();`)
    await assert.rejects(complete(), /TEST_AUDIT_FAILURE/)
    assert.equal((await db.query<any>(`select locked_at from inspections`)).rows[0].locked_at, null)
    assert.deepEqual((await db.query(`select snapshot_payload from inspection_report_links order by id`)).rows, frozen)
  } finally { await db.close() }
})
