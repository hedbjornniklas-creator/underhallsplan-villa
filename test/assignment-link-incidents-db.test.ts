import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { before, after, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../docs/db/2026-09-21_01_assignment_link_incidents.sql', import.meta.url), 'utf8')
const org = randomUUID()
const assignmentId = randomUUID()
const linkId = randomUUID()
const tokenHash = 'a'.repeat(64)

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table assignments(id uuid primary key, org_id uuid, responsible_profile_id uuid,
      assignment_type text default 'OB', status text default 'sent', accepted_at timestamptz,
      unique(org_id,id));
    create table assignment_links(id uuid primary key, assignment_id uuid, org_id uuid, token_hash text unique,
      revoked_at timestamptz, used_at timestamptz, expires_at timestamptz);
    alter default privileges grant all on tables to anon, authenticated;
    insert into assignments(id,org_id,responsible_profile_id) values('${assignmentId}','${org}','${randomUUID()}');
    insert into assignment_links values('${linkId}','${assignmentId}','${org}','${tokenHash}',null,null,now()+interval '1 day');`)
  await db.exec(migration)
  await db.exec(migration)
})
after(async () => { await db.close() })

async function record(operation = 'open', token = tokenHash) {
  const { rows } = await db.query<{ value: { id: string; orgId: string; assignmentId: string; notify: boolean } | null }>(
    'select record_assignment_link_incident($1,$2,$3,$4) as value', [token, operation, randomUUID(), 'TEST_FAILURE'])
  return rows[0].value
}

test('diagnostics table and RPCs are denied to anonymous and authenticated clients', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const { rows } = await db.query<{ allowed: boolean }>('select has_table_privilege($1,$2,$3) as allowed', [role, 'assignment_link_incidents', privilege])
      assert.equal(rows[0].allowed, false)
    }
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query('select * from assignment_link_incidents'), /permission denied/)
    await assert.rejects(record(), /permission denied/)
    await assert.rejects(db.query("select resolve_assignment_link_incidents($1,'open',now())", [tokenHash]), /permission denied/)
    await db.exec('reset role')
  }
})

test('duplicate failures record one incident and claim only one notification', async () => {
  const results = await Promise.all([record(), record(), record()])
  assert.equal(results.filter(r => r?.notify).length, 1)
  assert.equal(new Set(results.map(r => r?.id)).size, 1)
  assert.equal(results[0]?.orgId, org)
  assert.equal(results[0]?.assignmentId, assignmentId)
  const { rows } = await db.query<{ occurrences: number }>('select occurrences from assignment_link_incidents')
  assert.equal(rows[0].occurrences, 3)
})

test('invalid and inactive links cannot generate an incident or email', async () => {
  assert.equal(await record('open', 'b'.repeat(64)), null)
  for (const column of ['revoked_at', 'used_at']) {
    await db.exec(`update assignment_links set ${column}=now()`)
    assert.equal(await record(), null)
    await db.exec(`update assignment_links set ${column}=null`)
  }
  await db.exec("update assignment_links set expires_at=now()-interval '1 minute'")
  assert.equal(await record(), null)
  await db.exec("update assignment_links set expires_at=now()+interval '1 day'; update assignments set status='cancelled'")
  assert.equal(await record(), null)
  await db.exec("update assignments set status='sent'")
})

test('successful opening clears only earlier opening failures, and new failures respect the email cooldown', async () => {
  await record('accept')
  await db.query("select resolve_assignment_link_incidents($1,'open','2000-01-01')", [tokenHash])
  let rows = (await db.query<{ n: number }>('select count(*)::int n from assignment_link_incidents where resolved_at is null')).rows
  assert.equal(rows[0].n, 2)
  await db.query("select resolve_assignment_link_incidents($1,'open',now())", [tokenHash])
  rows = (await db.query<{ n: number }>('select count(*)::int n from assignment_link_incidents where resolved_at is null')).rows
  assert.equal(rows[0].n, 1)
  assert.equal((await record())?.notify, false)
  await db.exec('update assignment_links set used_at=now()')
  await db.query("select resolve_assignment_link_incidents($1,'accept',now())", [tokenHash])
  rows = (await db.query<{ n: number }>('select count(*)::int n from assignment_link_incidents where resolved_at is null')).rows
  assert.equal(rows[0].n, 0)
})

test('incident storage cannot mix organizations and contains no token or form fields', async () => {
  await assert.rejects(db.query(`insert into assignment_link_incidents(id,org_id,assignment_id,link_id,operation,error_code,last_reference)
    values($1,$2,$3,$4,'open','TEST',$1)`, [randomUUID(), randomUUID(), assignmentId, linkId]), /foreign key/)
  const { rows } = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='assignment_link_incidents'")
  assert.ok(rows.every(r => !/token|customer|payload|email|ip_address/.test(r.column_name)))
  const a = (await db.query<{ status: string; accepted_at: string | null }>('select status,accepted_at from assignments')).rows[0]
  assert.deepEqual(a, { status: 'sent', accepted_at: null })
})
