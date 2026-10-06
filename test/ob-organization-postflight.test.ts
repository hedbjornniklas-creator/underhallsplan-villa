import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../docs/db/2026-10-02_04_ob_organization_postflight.sql', import.meta.url), 'utf8')
const approved = [...sql.matchAll(/\('([0-9a-f-]{36})'::uuid\)/g)].map(match => match[1])
const bbsab = '71c056a9-aef5-42ce-872c-75952bc55795'
const owner = 'fe8cde81-8fa4-4fef-bd4c-1d3c5dfbb8fa'
const otherOrg = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const newInspection = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
type Check = { kontroll: string; antal: number; forvantat: number; resultat: string }

async function report(db: PGlite) {
  await db.exec('begin transaction isolation level repeatable read read only')
  try { return (await db.query<Check>(sql)).rows }
  finally { await db.exec('rollback') }
}

test('ownership postflight flags new unbound OB, source drift, non-OB bindings and accidental client privileges', async () => {
  const db = new PGlite()
  try {
    assert.equal(approved.length, 21)
    assert.equal(new Set(approved).size, 21)
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table inspections(id uuid primary key,property_id uuid,type text,inspection_family text);
      create table properties(id uuid primary key,owner uuid);
      create table ob_organization_bindings(inspection_id uuid primary key,org_id uuid,attribution_source text default 'approved_legacy_bbsab',created_at timestamptz default now());
      create table ob_organization_binding_audit(inspection_id uuid primary key,org_id uuid,attribution_source text,created_at timestamptz);
      create table assignments(id uuid primary key,inspection_id uuid,org_id uuid,assignment_type text);
      create table ob_assignment_workflows(inspection_id uuid,org_id uuid,initial_assignment_id uuid,current_assignment_id uuid);
      create table inspection_report_links(inspection_id uuid,org_id uuid,assignment_id uuid,revoked_at timestamptz);
      alter table ob_organization_bindings enable row level security;
      alter table ob_organization_binding_audit enable row level security;
      grant select on ob_organization_bindings,ob_organization_binding_audit to service_role;`)
    await db.query('insert into properties values($1,$1)', [owner])
    for (const id of approved) {
      await db.query("insert into inspections values($1,$2,'OB','OB')", [id, owner])
      await db.query('insert into ob_organization_bindings(inspection_id,org_id) values($1,$2)', [id, bbsab])
    }
    await db.exec('insert into ob_organization_binding_audit select * from ob_organization_bindings')
    const success = await report(db)
    assert.equal(success.length, 14)
    assert.ok(success.every(row => row.resultat === 'OK'))

    await db.query("insert into inspections values($1,$2,'STATUS','OB')", [newInspection, owner])
    let checks = await report(db)
    assert.match(checks[3].resultat, /^GRANSKA/)
    assert.equal(Number(checks[3].antal), 1)
    assert.equal(Number(checks[1].antal), 21, 'new creations never silently join the approved set')

    await db.query('insert into inspection_report_links values($1,$2,null,now())', [approved[0], otherOrg])
    checks = await report(db)
    assert.match(checks[5].resultat, /^GRANSKA/, 'revoked historical reports still count as evidence')

    await db.query("update inspections set inspection_family='EB' where id=$1", [approved[1]])
    await db.exec('grant update on ob_organization_bindings to authenticated')
    checks = await report(db)
    assert.match(checks[4].resultat, /^GRANSKA/)
    assert.match(checks[9].resultat, /^GRANSKA/)
    await db.query('delete from ob_organization_binding_audit where inspection_id=$1', [approved[0]])
    checks = await report(db)
    assert.match(checks[12].resultat, /^GRANSKA/)

    // Same-org pointers can still be invalid: do not hide them with inner joins.
    await db.query('insert into inspection_report_links values($1,$2,$3,null)', [approved[2], bbsab, newInspection])
    checks = await report(db)
    assert.equal(Number(checks[13].antal), 1, 'dangling report assignment is visible')
    await db.query("insert into assignments values($1,$2,$3,'OB')", [newInspection, approved[3], bbsab])
    checks = await report(db)
    assert.equal(Number(checks[13].antal), 1, 'same-org assignment for a different inspection is visible')
    await db.query('update assignments set inspection_id=null where id=$1', [newInspection])
    checks = await report(db)
    assert.equal(Number(checks[13].antal), 0, 'unlinked historical assignment is permitted')
    await db.query("update assignments set assignment_type='EB' where id=$1", [newInspection])
    checks = await report(db)
    assert.equal(Number(checks[13].antal), 1, 'wrong-family historical assignment is visible')
    await db.query("update assignments set assignment_type='STATUS',org_id=null where id=$1", [newInspection])
    checks = await report(db)
    assert.equal(Number(checks[13].antal), 1, 'missing assignment organization is visible')
    for (const [family, type] of [['STATUS', 'STATUS'], ['', 'OB'], [null, 'SB'], [null, 'UNKNOWN']]) {
      await db.query('update inspections set inspection_family=$1,type=$2 where id=$3', [family, type, newInspection])
      checks = await report(db)
      assert.equal(Number(checks[8].antal), 1, 'invalid/ambiguous classification cannot look ready')
    }
    assert.equal((await db.query<{n: number}>('select count(*)::int as n from ob_organization_bindings')).rows[0].n, 21)
  } finally { await db.close() }
})
