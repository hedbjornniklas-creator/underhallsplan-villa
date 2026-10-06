import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../docs/db/2026-10-02_02_ob_organization_preflight.sql', import.meta.url), 'utf8')
type Report = {
  read_only: boolean
  schema: {table: string; available: boolean; columns: string[]; missing_requested_columns: string[]}[]
  classification: {total: number; ob: number; unknown_family: number; other_family: number; ambiguous_legacy_sb: number; invalid_canonical_family: number}
  ob_attribution: Record<string, number>
  manual_review_samples: {id: string; recorded_org_ids: string[]}[]
  ob_grants: {id: string; current: boolean; role_key: string; scope_type: string; expires_at: string | null}[]
  legacy_fallback_review: Record<string, number>
  policies: {policyname: string; permissive: string}[]
  rpc_guards: {signature: string; mentions_owner: boolean; execute: {role: string; allowed: boolean}[]}[]
  advisory_child_orgs: {source: string; rows_without_recorded_parent_org: number; rows_outside_recorded_parent_orgs: number}[]
}
async function run(db: PGlite) {
  await db.exec('begin transaction isolation level repeatable read read only')
  try {
    const result = await db.query<{ob_organization_preflight: Report}>(sql)
    assert.equal(result.rows.length, 1)
    return result.rows[0].ob_organization_preflight
  } finally { await db.exec('rollback') }
}

test('OB preflight executes actual PostgreSQL XML in a read-only transaction with minimal old schema', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create table inspections(id text,property_id text);
      create table properties(id text,owner text);
      create table org_members(org_id text,profile_id text);
      create table assignments(id text);
      insert into inspections values('old','property'); insert into properties values('property','owner');`)
    const result = await run(db)
    assert.equal(result.read_only,true)
    assert.deepEqual(result.classification,{total:1,ob:0,unknown_family:1,other_family:0,ambiguous_legacy_sb:0,invalid_canonical_family:0})
    assert.equal(result.schema.find(row=>row.table==='ob_assignment_workflows')?.available,false)
    assert.ok(result.schema.find(row=>row.table==='inspections')?.missing_requested_columns.includes('org_id'))
    assert.deepEqual((await db.query('select * from inspections')).rows,[{id:'old',property_id:'property'}])
    assert.equal((await db.query<{n:number}>("select count(*)::int as n from pg_class where relnamespace='public'::regnamespace and relkind='r'")).rows[0].n,4)
  } finally { await db.close() }
})

test('OB preflight reports conflicts, historical sources, STATUS/SB and access metadata without leaking document data', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table inspections(id text,property_id text,inspection_family text,type text,org_id text,customer_name text);
      create table properties(id text,owner text);
      create table org_members(org_id text,profile_id text,role text,is_active boolean,is_default boolean);
      create table assignments(id text,inspection_id text,org_id text,assignment_type text);
      create table organizations(id text);
      create table profiles(id text,is_admin boolean,email text);
      create table ob_assignment_workflows(inspection_id text,org_id text,initial_assignment_id text,current_assignment_id text,initial_snapshot jsonb);
      create table inspection_report_links(id text,inspection_id text,org_id text,assignment_id text,revoked_at timestamptz,pdf_base64 text,token_hash text,snapshot_payload jsonb);
      create table inspection_environmental_protocols(inspection_id text,org_id text,document jsonb);
      create table platform_products(id text,key text,is_active boolean);
      create table platform_modules(id text,product_id text,key text,is_active boolean);
      create table platform_roles(id text,product_id text,key text,is_active boolean);
      create table platform_access_assignments(id text,profile_id text,product_id text,module_id text,role_id text,scope_type text,scope_id text,is_active boolean,expires_at timestamptz,source_system text);
      insert into organizations values('o1'),('o2');
      insert into profiles values('p1',false,'private@example.test'),('p2',true,'hidden@example.test');
      insert into properties values('property1','p1'),('property2','p2');
      insert into org_members values('o1','p1','admin',true,true),('o2','p1','inspector',true,false);
      insert into inspections values
        ('i1','property1','OB','OB',null,'private customer'),
        ('i2','property1','OB','OB',null,null),('i3','property1','OB','OB',null,null),
        ('i4','property2','OB','OB',null,null),('i5','property1','OB','OB',null,null),
        ('i6','missing','OB','OB',null,null),('i7','property1',null,'OB','o1',null),
        ('eb','property1','EB','OB',null,null),('unknown','property1',null,null,null,null),
        ('status','property1',null,'STATUS','o1',null),('sb','property1',null,'SB','o1',null),
        ('canonical-sb','property1','OB','SB','o1',null),
        ('bad-family','property1','STATUS','STATUS','o1',null),('blank-family','property1','','OB','o1',null);
      insert into assignments values('a1','i1','o1','OB'),('a2',null,'o2','OB'),
        ('a5','i5','o1','OB'),('a5duplicate','i5','o1','EB'),('aStatus','status','o1','STATUS');
      insert into ob_assignment_workflows values('i2','o1','a2','a2','{"secret":"private snapshot"}');
      insert into inspection_report_links values('r4','i4','o2',null,now(),'private pdf','private token','{"secret":"private report"}');
      insert into inspection_environmental_protocols values('i3','o2','{"secret":"private environmental"}'),('i1','o2','{}');
      insert into platform_products values('dashboard','dashboard',true);
      insert into platform_modules values('ob','dashboard','inspections',true),('tu','dashboard','technical_investigations',true);
      insert into platform_roles values('inspector','dashboard','inspector',true),('admin','dashboard','dashboard_admin',true);
      insert into platform_access_assignments values
        ('g1','p1','dashboard','ob','inspector','global',null,true,null,null),
        ('g2','p1','dashboard','ob','inspector','organization','o1',true,now()-interval '1 day',null),
        ('g3','p1','dashboard','ob','admin','organization','o2',false,null,null),
        ('g4','p1','dashboard','tu','inspector','global',null,true,null,null);
      alter table inspections enable row level security;
      create policy owner_boundary on inspections as restrictive using (property_id='property1');
      create function ob_test_guard() returns boolean language sql stable as $$select exists(select 1 from properties p where p.owner='p1')$$;
      revoke all on function ob_test_guard() from public;
      grant execute on function ob_test_guard() to service_role;`)
    const before = (await db.query("select jsonb_agg(to_jsonb(r)) as rows from inspection_report_links r")).rows
    const result = await run(db)
    assert.deepEqual(result.classification,{total:14,ob:9,unknown_family:4,other_family:1,ambiguous_legacy_sb:1,invalid_canonical_family:2})
    assert.equal(result.ob_attribution.one_recorded_org,6)
    assert.equal(result.ob_attribution.conflicting_recorded_orgs,1)
    assert.equal(result.ob_attribution.no_recorded_org,2)
    assert.equal(result.ob_attribution.unattributed_owner_multiple_active_orgs,1)
    assert.equal(result.ob_attribution.unattributed_owner_no_active_org,1)
    assert.equal(result.ob_attribution.wrong_family_direct_assignments,1)
    assert.equal(result.ob_attribution.multiple_direct_assignments,1)
    assert.equal(result.ob_attribution.ob_revoked_report_links,1)
    assert.equal(result.ob_attribution.owner_not_active_in_recorded_org,1)
    assert.deepEqual(result.manual_review_samples.find(row=>row.id==='i2')?.recorded_org_ids,['o1','o2'])
    assert.equal(result.advisory_child_orgs[0].rows_without_recorded_parent_org,1)
    assert.equal(result.advisory_child_orgs[0].rows_outside_recorded_parent_orgs,1)
    assert.equal(result.ob_grants.length,3)
    assert.equal(result.ob_grants.find(g=>g.id==='g1')?.current,true)
    assert.equal(result.ob_grants.find(g=>g.id==='g2')?.current,false)
    assert.equal(result.ob_grants.find(g=>g.id==='g3')?.role_key,'dashboard_admin')
    assert.equal(Object.values(result.legacy_fallback_review)[0],1)
    assert.ok(result.policies.some(p=>p.policyname==='owner_boundary' && p.permissive==='RESTRICTIVE'))
    const guard = result.rpc_guards.find(g=>g.signature==='ob_test_guard()')
    assert.equal(guard?.mentions_owner,true)
    assert.deepEqual(guard?.execute,[{role:'anon',allowed:false},{role:'authenticated',allowed:false},{role:'service_role',allowed:true}])
    const serialized = JSON.stringify(result)
    for (const secret of ['private customer','private@example.test','private snapshot','private pdf','private token','private report','private environmental']) {
      assert.ok(!serialized.includes(secret),`must omit ${secret}`)
    }
    assert.deepEqual((await db.query("select jsonb_agg(to_jsonb(r)) as rows from inspection_report_links r")).rows,before)
  } finally { await db.close() }
})
