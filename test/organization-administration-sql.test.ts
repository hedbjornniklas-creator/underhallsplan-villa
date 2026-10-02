import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../docs/db/2026-10-01_01_organization_administration.sql', import.meta.url), 'utf8')
const sql = (name: string) => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8').replace(/^\uFEFF/u, '')
const token = () => createHash('sha256').update(randomUUID()).digest('hex')

async function setup() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;
    create schema storage; grant usage on schema storage to authenticated,anon,service_role;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,metadata jsonb);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated,service_role;
    create policy legacy_permissive_bucket on storage.objects for all to authenticated using(true) with check(true);
    create table public.profiles(id uuid primary key,email text,full_name text,phone text,is_admin boolean default false,
      org_name text,company_name text,company_orgno text,company_address text,company_postal_code text,company_city text);
  `)
  await db.exec(sql('2026-02-20_01_assignments_org_foundation.sql'))
  await db.exec(sql('2026-04-08_02_platform_access_foundation.sql').split('with renoapp_refs as (')[0].replace('create extension if not exists pgcrypto;', ''))
  await db.exec('grant all privileges on public.platform_access_assignments to anon,authenticated')
  const foundation = sql('2026-09-09_05_fortnox_connection_foundation.sql')
  await db.exec(foundation.slice(foundation.indexOf('alter table public.organizations'), foundation.indexOf('create table if not exists public.fortnox_connections')))
  await db.exec(`create table fortnox_connections(org_id uuid primary key,company_organization_number text,
    foreign key(org_id,company_organization_number) references organizations(id,organization_number) on update restrict);
    insert into platform_modules(product_id,key,label) select id,'technical_investigations','TU' from platform_products where key='dashboard';`)
  const cards = sql('2026-09-12_07_profile_org_cards.sql')
  await db.exec(cards.slice(cards.indexOf('create table if not exists public.profile_org_cards'), cards.indexOf('-- Copy legacy data')))
  await db.exec(cards.slice(cards.indexOf('alter table public.profile_org_cards enable row level security'), cards.indexOf('revoke all on function public.profile_org_cards_prepare_write')))
  await db.exec(`grant select,insert,update,delete on organizations,org_members to authenticated,service_role;
    grant select on profiles to authenticated;
    alter table organizations enable row level security;
    create policy organizations_select_member on organizations for select to authenticated using(public.is_org_member(id));
    create policy organizations_update_admin on organizations for update to authenticated using(public.is_org_admin(id));
    alter table org_members enable row level security;
    create policy members_select on org_members for select to authenticated using(public.is_org_member(org_id));
    create policy members_update on org_members for update to authenticated using(public.is_org_admin(org_id));`)
  return db
}

async function person(db: PGlite, email = `${randomUUID()}@example.test`, confirmed = true) {
  const id = randomUUID()
  await db.query('insert into auth.users values($1,$2,$3)', [id,email,confirmed ? new Date().toISOString() : null])
  await db.query('insert into profiles(id,email,full_name) values($1,$2,$3)', [id,email,'Original name'])
  return id
}
async function organization(db: PGlite, admin: string, name = 'Testbolag') {
  const org = randomUUID()
  await db.query('insert into organizations(id,name,created_by,organization_number) values($1,$2,$3,$4)', [org,name,admin,'559281-0823'])
  await db.query("insert into org_members(org_id,profile_id,role,is_default) values($1,$2,'admin',not exists(select 1 from org_members where profile_id=$2 and is_default))", [org,admin])
  return org
}
async function enable(db: PGlite, org: string) {
  await db.query("insert into organization_enabled_modules(org_id,module_key) values($1,'technical_investigations') on conflict do nothing", [org])
}
async function invite(db: PGlite, admin: string, org: string, email: string, patch: Record<string, unknown> = {}) {
  const values = { requestId: randomUUID(),email,fullName:'Invited name',role:'inspector',modules:['technical_investigations'],tokenHash:token(),expiresAt:new Date(Date.now()+86400000).toISOString(),...patch }
  const result = await db.query<{ result: Record<string, unknown> }>('select organization_invitation_create($1,$2,$3) as result',[admin,org,JSON.stringify(values)])
  return { values, row: result.rows[0].result }
}
const accept = (db: PGlite, id: string, hash: string) => db.query<{ result: {accepted:boolean;reused:boolean;organizationId:string} }>('select organization_invitation_accept($1,$2) as result',[id,hash])
const member = (db: PGlite, admin: string, org: string, id: string, values: Record<string,unknown>) => db.query('select organization_member_update($1,$2,$3,$4)',[admin,org,id,JSON.stringify(values)])
const company = (db: PGlite, admin: string, org: string, version = 1, patch: Record<string, unknown> = {}) => db.query('select organization_profile_save($1,$2,$3,$4)',[admin,org,version,JSON.stringify({name:'Testbolag',organizationNumber:'559281-0823',...patch})])
async function authenticated(db: PGlite, id: string, work: () => Promise<unknown>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated')
  try { return await work() } finally { await db.exec('reset role'); await db.exec("select set_config('request.jwt.claim.sub','',false)") }
}

test('organization administration database authorization and lifecycle', async t => {
  const db = await setup()
  try {
    const admin = await person(db), colleague = await person(db)
    const org = await organization(db,admin), otherOrg = await organization(db,admin,'Other organization')
    await db.query("insert into org_members(org_id,profile_id,role) values($1,$2,'inspector')",[org,colleague])
    for (const [o,p,address] of [[org,admin,'One street'],[org,colleague,'One street'],[otherOrg,admin,'Other street']]) {
      await db.query(`insert into profile_org_cards(org_id,profile_id,display_name,company_name,company_orgno,company_address)
        values($1,$2,'Personal name',$3,'559281-0823',$4)`,[o,p,o===org?'Testbolag':'Conflicting company name',address])
    }
    await db.query(`insert into platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,is_active,expires_at,granted_reason)
      select $1,p.id,m.id,r.id,'global',true,now()+interval '10 days','Original reason'
      from platform_products p join platform_modules m on m.product_id=p.id and m.key='technical_investigations'
      join platform_roles r on r.product_id=p.id and r.key='inspector' where p.key='dashboard'`,[admin])
    await t.test('preflight runs before migration in a read-only transaction and preserves every fixture row', async () => {
      const tables = ['auth.users','profiles','organizations','org_members','profile_org_cards','platform_products',
        'platform_modules','platform_roles','platform_access_assignments','fortnox_connections','storage.objects']
      async function snapshot() {
        const rows = []
        for (const table of tables) {
          const result = await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)
          rows.push(result.rows[0])
        }
        return rows
      }
      const before = await snapshot()
      await db.exec('begin read only')
      try {
        const reports = await db.exec(sql('2026-10-01_00_organization_administration_preflight.sql'))
        assert.equal(reports.length,8)
        const consensus = reports[4].rows as Array<{organization_id:string;active_member_cards:number;company_variants:number;matches_organization_identity:boolean}>
        assert.equal(consensus.find(row=>row.organization_id===org)?.active_member_cards,2)
        assert.equal(consensus.find(row=>row.organization_id===org)?.company_variants,1)
        assert.equal(consensus.find(row=>row.organization_id===otherOrg)?.matches_organization_identity,false)
      } finally { await db.exec('rollback') }
      assert.deepEqual(await snapshot(),before)
      assert.equal((await db.query("select column_name from information_schema.columns where table_name='organizations' and column_name='profile_version'")).rows.length,0)
    })
    await db.exec(migration)

    await t.test('backfill is unanimous and global TU grants become exact organization grants with expiry preserved', async () => {
      const rows = (await db.query<{id:string;profile_configured:boolean;profile_address:string}>('select id,profile_configured,profile_address from organizations')).rows
      assert.equal(rows.find(r=>r.id===org)?.profile_configured,true)
      assert.equal(rows.find(r=>r.id===org)?.profile_address,'One street')
      assert.equal(rows.find(r=>r.id===otherOrg)?.profile_configured,false)
      const grants = (await db.query<{scope_type:string;scope_id:string;is_active:boolean;expires_at:Date|null;granted_reason:string}>(`select a.* from platform_access_assignments a join platform_modules m on m.id=a.module_id where a.profile_id=$1 and m.key='technical_investigations'`,[admin])).rows
      assert.equal(grants.filter(g=>g.scope_type==='global' && g.is_active).length,0)
      assert.equal(grants.filter(g=>g.scope_type==='organization' && g.is_active).length,2)
      assert.ok(grants.every(g=>g.expires_at && g.granted_reason==='Original reason'))
      await db.exec(migration)
      assert.equal((await db.query('select * from organization_enabled_modules')).rows.length,2)
    })

    await t.test('shared profile requires active admin, validated fields and exact version; Fortnox legal identity stays bound', async () => {
      await assert.rejects(company(db,colleague,org),/ORG_ADMIN_REQUIRED/)
      await company(db,admin,org,1,{address:'New shared address'})
      await assert.rejects(company(db,admin,org,1),/ORG_CONFLICT/)
      await assert.rejects(company(db,admin,org,2,{organizationNumber:'111111-1111'}),/ORG_INPUT_INVALID/)
      await assert.rejects(company(db,admin,org,2,{name:'x'.repeat(241)}),/ORG_INPUT_INVALID/)
      await assert.rejects(company(db,admin,org,2,{signaturePath:'forged'}),/ORG_INPUT_INVALID/)
      await assert.rejects(company(db,admin,org,2,{logoPath:`organizations/${otherOrg}/logo-${randomUUID()}.png`}),/ORG_INPUT_INVALID/)
      await db.query('insert into fortnox_connections values($1,$2)',[org,'559281-0823'])
      await assert.rejects(company(db,admin,org,2,{organizationNumber:null}),/ORG_FORTNOX_IDENTITY_LOCKED/)
      assert.equal((await db.query<{profile_version:number}>('select profile_version from organizations where id=$1',[org])).rows[0].profile_version,2)
    })

    await t.test('members edit their own card but company data and colleagues signatures are protected even from admin', async () => {
      await authenticated(db,colleague,async()=> {
        await db.query("update profile_org_cards set phone='123' where org_id=$1 and profile_id=$2",[org,colleague])
        await assert.rejects(db.query("update profile_org_cards set company_name='Forged' where org_id=$1 and profile_id=$2",[org,colleague]),/ORG_COMPANY_FIELDS_MANAGED/)
        await assert.rejects(db.query('update profile_org_cards set signature_path=$3 where org_id=$1 and profile_id=$2',[org,colleague,`profiles/${admin}/organizations/${org}/signaturePath-${randomUUID()}.png`]),/ORG_INPUT_INVALID/)
        await assert.rejects(db.query("update organizations set name='Forged' where id=$1",[org]),/permission denied/)
        await assert.rejects(company(db,colleague,org),/permission denied/)
      })
      await authenticated(db,admin,async()=>{
        const changed = await db.query("update profile_org_cards set signature_path='forged' where org_id=$1 and profile_id=$2 returning id",[org,colleague])
        assert.equal(changed.rows.length,0)
        await assert.rejects(db.query('delete from profile_org_cards where org_id=$1 and profile_id=$2',[org,colleague]),/permission denied/)
        await assert.rejects(db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2',[org,admin]),/ORG_ADMIN_REQUIRED/)
        await assert.rejects(db.query('delete from org_members where org_id=$1 and profile_id=$2',[org,colleague]),/permission denied/)
        await assert.rejects(db.query('delete from organizations where id=$1',[org]),/permission denied/)
      })
      await assert.rejects(db.query('select organization_member_profile_save($1,$2,2,$3)',[colleague,org,JSON.stringify({displayName:'Name',companyName:'Forbidden'})]),/ORG_INPUT_INVALID/)
      await assert.rejects(db.query('select organization_member_profile_save($1,$2,2,$3)',[colleague,org,JSON.stringify({displayName:'Name',signaturePath:`profiles/${admin}/organizations/${org}/signaturePath-${randomUUID()}.png`})]),/ORG_INPUT_INVALID/)
      const sig = `profiles/${colleague}/organizations/${org}/signaturePath-${randomUUID()}.png`
      await db.query('select organization_member_profile_save($1,$2,2,$3)',[colleague,org,JSON.stringify({displayName:'Own name',signaturePath:sig})])
      const card = (await db.query<{company_name:string;signature_path:string;version:number}>('select * from profile_org_cards where org_id=$1 and profile_id=$2',[org,colleague])).rows[0]
      assert.equal(card.company_name,'Testbolag'); assert.equal(card.signature_path,sig); assert.equal(card.version,3)
    })

    await t.test('invitation creation is admin-only, entitlement-limited, idempotent, and cannot overwrite existing members', async () => {
      await assert.rejects(invite(db,colleague,org,'x@example.test'),/ORG_ADMIN_REQUIRED/)
      await assert.rejects(invite(db,admin,org,'x@example.test',{modules:['inspections']}),/ORG_MODULE_NOT_ENABLED/)
      await assert.rejects(invite(db,admin,org,'x@example.test',{modules:['admin']}),/ORG_MODULE_NOT_ENABLED/)
      const noTu = await organization(db,admin,'No TU')
      await assert.rejects(invite(db,admin,noTu,'x@example.test'),/ORG_MODULE_NOT_ENABLED/)
      await enable(db,noTu)
      assert.ok((await invite(db,admin,noTu,'x@example.test')).row.id)
      const first = await invite(db,admin,org,'repeat@example.test')
      const second = await invite(db,admin,org,'repeat@example.test',{...first.values,tokenHash:token()})
      assert.equal(first.row.id,second.row.id); assert.equal(second.row.token_hash,first.values.tokenHash)
      await assert.rejects(invite(db,admin,org,'changed@example.test',{requestId:first.values.requestId}),/ORG_CONFLICT/)
      const existing = (await db.query<{email:string}>('select email from profiles where id=$1',[colleague])).rows[0].email
      await assert.rejects(invite(db,admin,org,existing),/ORG_MEMBER_EXISTS/)
    })

    await t.test('existing multi-organization account accepts a second membership without changing default, identity, or global access', async () => {
      const id = await person(db,'multi@example.test'), oldOrg = await organization(db,id,'Own existing company')
      const invitation = await invite(db,admin,org,'multi@example.test')
      const result = (await accept(db,id,invitation.values.tokenHash)).rows[0].result
      assert.deepEqual(result,{accepted:true,reused:false,organizationId:org,profileId:id})
      assert.equal((await db.query<{org_id:string}>('select org_id from org_members where profile_id=$1 and is_default',[id])).rows[0].org_id,oldOrg)
      assert.equal((await db.query<{full_name:string}>('select full_name from profiles where id=$1',[id])).rows[0].full_name,'Original name')
      const grants = (await db.query<{scope_type:string;scope_id:string}>('select * from platform_access_assignments where profile_id=$1',[id])).rows
      assert.equal(grants.length,1); assert.equal(grants[0].scope_type,'organization'); assert.equal(grants[0].scope_id,org)
      await member(db,admin,org,id,{role:'inspector',isActive:true,modules:[]})
      assert.equal((await accept(db,id,invitation.values.tokenHash)).rows[0].result.reused,true)
      assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1 and is_active',[id])).rows.length,0)
      await member(db,admin,org,id,{role:'inspector',isActive:false,modules:[]})
      await assert.rejects(accept(db,id,invitation.values.tokenHash),/ORG_INVITE_INVALID/)
      assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1 and is_active',[id])).rows.length,0)
      assert.equal((await db.query<{is_active:boolean}>('select is_active from org_members where profile_id=$1 and org_id=$2',[id,org])).rows[0].is_active,false)
    })

    await t.test('new account acceptance requires confirmed matching email and atomic rollback', async () => {
      const id = randomUUID(), hash = (await invite(db,admin,org,'new@example.test')).values.tokenHash
      await db.query('insert into auth.users values($1,$2,null)',[id,'new@example.test'])
      await assert.rejects(accept(db,id,hash),/ORG_INVITE_EMAIL_MISMATCH/)
      await db.query('update auth.users set email_confirmed_at=now() where id=$1',[id])
      const other = await person(db,'wrong@example.test')
      await assert.rejects(accept(db,other,hash),/ORG_INVITE_EMAIL_MISMATCH/)
      await db.exec("update platform_roles set is_active=false where key='inspector' and product_id=(select id from platform_products where key='dashboard')")
      await assert.rejects(accept(db,id,hash),/ORG_CATALOG_REQUIRED/)
      assert.equal((await db.query('select * from profiles where id=$1',[id])).rows.length,0)
      assert.equal((await db.query('select * from org_members where profile_id=$1',[id])).rows.length,0)
      await db.exec("update platform_roles set is_active=true where key='inspector' and product_id=(select id from platform_products where key='dashboard')")
      await accept(db,id,hash)
      assert.equal((await db.query('select * from org_members where profile_id=$1 and is_default',[id])).rows.length,1)
    })

    await t.test('resend and revoke use compare-and-swap; old tokens expire immediately', async () => {
      const id = await person(db,'rotate@example.test'), first = await invite(db,admin,org,'rotate@example.test'), newHash = token()
      const args = [admin,org,first.row.id,0,'resend',newHash,new Date(Date.now()+86400000).toISOString()]
      const changed = (await db.query<{result:{revision:number;token_hash:string}}>('select organization_invitation_change($1,$2,$3,$4,$5,$6,$7) as result',args)).rows[0].result
      assert.equal(changed.revision,1); assert.equal(changed.token_hash,newHash)
      await assert.rejects(db.query('select organization_invitation_change($1,$2,$3,$4,$5,$6,$7)',args),/ORG_CONFLICT/)
      await assert.rejects(accept(db,id,first.values.tokenHash),/ORG_INVITE_INVALID/)
      await db.query('select organization_invitation_change($1,$2,$3,1,$4,null,null)',[admin,org,first.row.id,'revoke'])
      await assert.rejects(accept(db,id,newHash),/ORG_INVITE_INVALID/)
    })

    await t.test('last admin cannot leave; role grant changes are isolated and inactive actors cannot administer', async () => {
      await assert.rejects(member(db,admin,org,admin,{role:'inspector',isActive:true,modules:[]}),/ORG_LAST_ADMIN/)
      await assert.rejects(member(db,admin,org,admin,{role:'admin',isActive:false,modules:[]}),/ORG_LAST_ADMIN/)
      await member(db,admin,org,colleague,{role:'admin',isActive:true,modules:['technical_investigations']})
      await member(db,colleague,org,admin,{role:'inspector',isActive:false,modules:[]})
      await assert.rejects(invite(db,admin,org,'inactive@example.test'),/ORG_ADMIN_REQUIRED/)
      const stillActive = (await db.query('select * from platform_access_assignments where profile_id=$1 and scope_id=$2 and is_active',[admin,otherOrg])).rows
      assert.ok(stillActive.length>0)
      assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1 and scope_id=$2 and is_active',[admin,org])).rows.length,0)
      await assert.rejects(member(db,colleague,org,colleague,{role:'inspector',isActive:true,modules:[]}),/ORG_LAST_ADMIN/)
    })

    await t.test('empty module selection leaves an inactive marker for previously legacy-only membership', async () => {
      const legacy = await person(db,'legacy-only@example.test')
      await db.query("insert into org_members(org_id,profile_id,role) values($1,$2,'inspector')",[org,legacy])
      assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1',[legacy])).rows.length,0)
      await member(db,colleague,org,legacy,{role:'inspector',isActive:true,modules:[]})
      const markers = (await db.query<{is_active:boolean;scope_type:string;scope_id:string;source_system:string}>(
        'select * from platform_access_assignments where profile_id=$1',[legacy])).rows
      assert.equal(markers.length,1)
      assert.equal(markers[0].is_active,false); assert.equal(markers[0].scope_type,'organization')
      assert.equal(markers[0].scope_id,org); assert.equal(markers[0].source_system,'organization_administration')
      await member(db,colleague,org,legacy,{role:'inspector',isActive:false,modules:[]})
      assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1 and is_active',[legacy])).rows.length,0)
      assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1',[legacy])).rows.length,1)
    })

    await t.test('anonymous and authenticated callers cannot invoke trusted actor RPCs or read invitation hashes', async () => {
      for (const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`)
        try {
          await assert.rejects(db.query('select * from organization_invitations'),/permission denied/)
          await assert.rejects(db.query('select * from organization_enabled_modules'),/permission denied/)
          await assert.rejects(db.query('select * from platform_access_assignments'),/permission denied/)
          await assert.rejects(db.query('update platform_access_assignments set is_active=true'),/permission denied/)
          await assert.rejects(db.query('insert into platform_access_assignments(profile_id) values($1)',[admin]),/permission denied/)
          await assert.rejects(member(db,colleague,org,colleague,{role:'admin',isActive:true,modules:[]}),/permission denied/)
          await assert.rejects(accept(db,admin,token()),/permission denied/)
          await assert.rejects(db.query('select organization_assert_admin($1,$2)',[colleague,org]),/permission denied/)
          await assert.rejects(db.query('select organization_apply_member_grants($1,$2,$1,$3,true,$4)',[colleague,org,'admin',[]]),/permission denied/)
        } finally { await db.exec('reset role') }
      }
    })

    await t.test('immutable organization media cannot be overwritten, deleted, renamed or forged through a permissive legacy bucket policy', async () => {
      const signature = `profiles/${colleague}/organizations/${org}/signaturePath-${randomUUID()}.png`
      const logo = `organizations/${org}/logo-${randomUUID()}.png`
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('property-media',$1,$3),('property-media',$2,$3)",[signature,logo,JSON.stringify({immutable:'original'})])
      await authenticated(db,colleague,async()=>{
        assert.equal((await db.query('select * from storage.objects where name=any($1)',[[signature,logo]])).rows.length,2)
        assert.equal((await db.query("update storage.objects set metadata='{}' where name=any($1) returning id",[[signature,logo]])).rows.length,0)
        assert.equal((await db.query('delete from storage.objects where name=any($1) returning id',[[signature,logo]])).rows.length,0)
        await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('property-media',$1)",[signature]),/row-level security/)
        await db.query("insert into storage.objects(bucket_id,name) values('property-media','legacy-profile-test.png')")
        await assert.rejects(db.query("update storage.objects set name=$1 where name='legacy-profile-test.png'",[logo]),/row-level security/)
        assert.equal((await db.query("delete from storage.objects where name='legacy-profile-test.png' returning id")).rows.length,1)
      })
      await db.exec('set role service_role')
      try {
        await db.query("insert into storage.objects(bucket_id,name) values('property-media',$1)",[`organizations/${org}/logo-${randomUUID()}.png`])
        await company(db,colleague,org,2,{address:'Service RPC works'})
      } finally { await db.exec('reset role') }
    })
  } finally { await db.close() }
})

test('migration stops atomically on revoked admin grants and never alters platform administration', async () => {
  const db = await setup()
  try {
    const admin = await person(db), org = await organization(db,admin)
    await db.query(`insert into platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,is_active,expires_at)
      select $1,p.id,m.id,r.id,'global',true,now()+interval '10 days'
      from platform_products p join platform_modules m on m.product_id=p.id and m.key='technical_investigations'
      join platform_roles r on r.product_id=p.id and r.key='inspector' where p.key='dashboard'`,[admin])
    await db.query(`insert into platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id,is_active)
      select $1,p.id,m.id,r.id,'organization',$2,false
      from platform_products p join platform_modules m on m.product_id=p.id and m.key='admin'
      join platform_roles r on r.product_id=p.id and r.key='dashboard_admin' where p.key='dashboard'`,[admin,org])
    const platformGrant = (await db.query<{id:string}>(`insert into platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,is_active)
      select $1,p.id,m.id,r.id,'global',true from platform_products p
      join platform_modules m on m.product_id=p.id and m.key='access_management'
      join platform_roles r on r.product_id=p.id and r.key='hushub_superadmin' where p.key='hushub_admin' returning id`,[admin])).rows[0].id
    await assert.rejects(db.exec(migration),/ORG_MIGRATION_ACCESS_CONFLICT/)
    await db.exec('rollback')
    assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1 and is_active and scope_type=$2',[admin,'global'])).rows.length,2)
    assert.equal((await db.query("select column_name from information_schema.columns where table_name='organizations' and column_name='profile_version'")).rows.length,0)
    await db.query("update platform_access_assignments set is_active=true,expires_at=now()-interval '1 day' where profile_id=$1 and scope_type='organization'",[admin])
    await assert.rejects(db.exec(migration),/ORG_MIGRATION_ACCESS_CONFLICT/)
    await db.exec('rollback')
    await db.query("update platform_access_assignments set expires_at=null where profile_id=$1 and scope_type='organization'",[admin])
    await db.exec(migration)
    const grant = (await db.query<{is_active:boolean;scope_type:string;scope_id:string|null;source_system:string|null}>('select * from platform_access_assignments where id=$1',[platformGrant])).rows[0]
    assert.equal(grant.is_active,true); assert.equal(grant.scope_type,'global'); assert.equal(grant.scope_id,null); assert.equal(grant.source_system,null)
    await company(db,admin,org,1,{website:`https://example.test/${'a'.repeat(350)}`})
    await assert.rejects(company(db,admin,org,2,{website:`https://example.test/${'a'.repeat(500)}`}),/ORG_INPUT_INVALID/)
  } finally { await db.close() }
})
