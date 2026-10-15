import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

// Execute the real migration with the real global lock guard in a local WASM DB.
const db = new PGlite()
const org = randomUUID(), project = randomUUID(), profile = randomUUID()
const lockedAt = '2026-10-12T10:00:00Z'
const migration = readFileSync(new URL('../docs/db/2026-10-15_01_eb_inspection_lifecycle.sql', import.meta.url), 'utf8')

async function inspection({ status = 'completed', locked = true, auditOrg = '', eb = true } = {}) {
  const id = randomUUID()
  await db.query(`insert into inspections (id,status,locked_at,locked_by,report_text) values ($1,$2,$3,$4,'Frozen original')`,
    [id, status, locked ? lockedAt : null, profile])
  if (eb) await db.query('insert into eb_inspection_details values ($1,$2,$3,$4,$5)', [id, org, project, locked ? lockedAt : null, profile])
  if (auditOrg) await db.query(`insert into inspection_lock_events (org_id,inspection_id,action,reason,performed_by)
    values ($1,$2,'unlock','Rätta tidigare uppgift',$3)`, [auditOrg, id, profile])
  await db.query(`insert into inspection_report_links values ($1,$2,null,'{"report":"Frozen original"}')`, [randomUUID(), id])
  return id
}

before(async () => {
  await db.exec(`
    create role authenticated;
    create role service_role;
    create table profiles (id uuid primary key);
    create table inspections (id uuid primary key,status text,locked_at timestamptz,locked_by uuid,updated_at timestamptz,
      inspection_family text,inspection_variant text,report_text text);
    create table eb_inspection_details (inspection_id uuid primary key,org_id uuid,eb_project_id uuid,report_locked_at timestamptz,report_locked_by uuid);
    create table inspection_lock_events (id uuid primary key default gen_random_uuid(),org_id uuid,inspection_id uuid,
      action text,reason text,performed_by uuid references profiles(id),performed_at timestamptz default now());
    create table inspection_report_links (id uuid primary key,inspection_id uuid,revoked_at timestamptz,snapshot_payload jsonb);
  `)
  await db.query('insert into profiles values ($1)', [profile])
  const guardSource = readFileSync(new URL('../docs/db/2026-05-14_01_inspection_family_variant.sql', import.meta.url), 'utf8')
  const guard = guardSource.match(/create or replace function public\.guard_locked_inspections_write\(\)[\s\S]*?\$\$;/)?.[0]
  assert.ok(guard)
  await db.exec(`${guard}
    create trigger inspection_lock_guard before update or delete on inspections for each row execute function guard_locked_inspections_write();`)
  // Install predecessor, then verify CREATE OR REPLACE preserves existing ACLs.
  await db.exec(readFileSync(new URL('../docs/db/2026-06-09_02_eb_report_unlocking_keep_links.sql', import.meta.url), 'utf8'))
  await db.exec(`revoke all on function unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid) from public,authenticated;
    grant execute on function unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid) to service_role;`)
})
after(async () => { await db.close() })

test('EB lifecycle migration repairs only proven unlocked EB rows and is repeatable', async () => {
  const proven = await inspection({ locked: false, auditOrg: org })
  const noEvidence = await inspection({ locked: false })
  const wrongOrg = await inspection({ locked: false, auditOrg: randomUUID() })
  const stillLocked = await inspection({ locked: true, auditOrg: org })
  const ob = await inspection({ locked: false, auditOrg: org, eb: false })
  await db.exec(migration)
  await db.exec(migration)
  const statuses = new Map((await db.query<{ id: string; status: string }>('select id,status from inspections')).rows.map(row => [row.id, row.status]))
  assert.equal(statuses.get(proven), 'ongoing')
  for (const id of [noEvidence, wrongOrg, stillLocked, ob]) assert.equal(statuses.get(id), 'completed')
  const acl = await db.query<{ authenticated: boolean; service: boolean }>(`select
    has_function_privilege('authenticated','unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid)','EXECUTE') authenticated,
    has_function_privilege('service_role','unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid)','EXECUTE') service`)
  assert.deepEqual(acl.rows[0], { authenticated: false, service: true })
})

test('EB unlock clears both locks, returns to ongoing and preserves frozen public version with write guards active', async () => {
  const id = await inspection()
  await assert.rejects(db.query(`update inspections set status='ongoing' where id=$1`, [id]), /Låst besiktning kan inte ändras/)
  const unlocked = await db.query<{ previous: Date }>('select unlock_eb_inspection_report($1,$2,$3,$4,$5) previous',
    [org, project, id, 'Rätta uppgift i utlåtandet', profile])
  assert.equal(unlocked.rows[0].previous.toISOString(), new Date(lockedAt).toISOString())
  const row = (await db.query<{ status: string; locked_at: null; report_locked_at: null; report_text: string }>(
    'select i.status,i.locked_at,d.report_locked_at,i.report_text from inspections i join eb_inspection_details d on i.id=d.inspection_id where i.id=$1', [id])).rows[0]
  assert.deepEqual(row, { status: 'ongoing', locked_at: null, report_locked_at: null, report_text: 'Frozen original' })
  const links = await db.query<{ revoked_at: null; snapshot_payload: unknown }>('select revoked_at,snapshot_payload from inspection_report_links where inspection_id=$1', [id])
  assert.deepEqual(links.rows, [{ revoked_at: null, snapshot_payload: { report: 'Frozen original' } }])
  const audit = await db.query<{ action: string; reason: string }>('select action,reason from inspection_lock_events where inspection_id=$1', [id])
  assert.deepEqual(audit.rows, [{ action: 'unlock', reason: 'Rätta uppgift i utlåtandet' }])
  await assert.rejects(db.query('select unlock_eb_inspection_report($1,$2,$3,$4,$5)', [org, project, id, 'Rätta samma uppgift', profile]), /EB_INSPECTION_ALREADY_UNLOCKED/)
})

test('EB unlock invalid reason/scope or failed audit leaves status and locks untouched', async () => {
  const id = await inspection()
  for (const [scopeOrg, scopeProject, reason, performer, error] of [
    [org, project, 'Kort', profile, /UNLOCK_REASON_REQUIRED/],
    [randomUUID(), project, 'Rätta uppgift i utlåtandet', profile, /EB_INSPECTION_NOT_FOUND/],
    [org, randomUUID(), 'Rätta uppgift i utlåtandet', profile, /EB_INSPECTION_NOT_FOUND/],
    [org, project, 'Rätta uppgift i utlåtandet', randomUUID(), /foreign key constraint/],
  ] as const) {
    await assert.rejects(db.query('select unlock_eb_inspection_report($1,$2,$3,$4,$5)', [scopeOrg, scopeProject, id, reason, performer]), error)
    const row = (await db.query<{ status: string; locked: boolean; report_locked: boolean }>(
      'select i.status,i.locked_at is not null locked,d.report_locked_at is not null report_locked from inspections i join eb_inspection_details d on i.id=d.inspection_id where i.id=$1', [id])).rows[0]
    assert.deepEqual(row, { status: 'completed', locked: true, report_locked: true })
    assert.equal((await db.query('select id from inspection_lock_events where inspection_id=$1', [id])).rows.length, 0)
  }
})
