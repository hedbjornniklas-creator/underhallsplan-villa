import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import { settingsTables, settingsProbeRows, settingsEditorPaths } from '../scripts/lib/ob-settings-rehearsal.mjs'

const db = new PGlite()
const read = (path: string) => readFileSync(new URL(path,import.meta.url),'utf8')
const migration = read('../docs/db/2026-09-14_01_ob_settings_access.sql')
const ordinary=randomUUID(), legacy=randomUUID(), admin=randomUUID()
const product=randomUUID(), moduleId=randomUUID(), roleId=randomUUID(), assignment=randomUUID()
const rows = settingsProbeRows()
async function asRole(role: string, id: string, fn: () => Promise<void>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])
  await db.exec('set role '+role)
  try { await fn() } finally { await db.exec('reset role') }
}
async function insert(table: string, row: Record<string,unknown>) {
  const fields=Object.keys(row)
  await db.query(`insert into public.${table}(${fields.join(',')}) values(${fields.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row))
}
async function snapshot() {
  const data: Record<string,unknown> = {}
  for (const table of [...settingsTables,'profiles','platform_access_assignments']) data[table]=(await db.query('select * from public.'+table+' order by id')).rows
  return data
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    grant usage on schema public,auth,extensions to anon,authenticated,service_role;`)
  await db.exec(read('./fixtures/components-access.sql'))
  await db.exec(read('./fixtures/component-catalogue-access.sql'))
  const helper=read('../docs/db/2026-06-04_03_tu_report_section_types_rls.sql')
  await db.exec(helper.slice(helper.indexOf('create or replace function'),helper.indexOf('grant execute')))
  await db.exec(read('./fixtures/ob-settings-access.sql'))
  await db.query('insert into public.profiles(id,is_admin) values($1,false),($2,true),($3,false)',[ordinary,legacy,admin])
  await db.query("insert into public.platform_products values($1,'hushub_admin')",[product])
  await db.query("insert into public.platform_modules values($1,$2,'besiktapp_admin')",[moduleId,product])
  await db.query("insert into public.platform_roles values($1,$2,'product_admin')",[roleId,product])
  await db.query("insert into public.platform_access_assignments(id,profile_id,product_id,module_id,role_id,scope_type) values($1,$2,$3,$4,$5,'global')",[assignment,admin,product,moduleId,roleId])
  for(const table of settingsTables) await insert(table,rows[table])
})
after(()=>db.close())

test('reproduces anonymous writes to non-RLS settings and authenticated open document catalogue',async () => {
  await db.exec('begin')
  try {
    await asRole('anon','',async () => {
      assert.equal((await db.query('update settings_interior_room_types set label=$1 returning id',['WRONG'])).rows.length,1)
    })
    await asRole('authenticated',ordinary,async () => {
      assert.equal((await db.query('update document_types set label=$1 returning id',['WRONG'])).rows.length,1)
    })
  } finally { await db.exec('rollback') }
})

test('requires reviewed admin-input prerequisite; repeat application preserves rows and service grants',async () => {
  const before=await snapshot()
  await assert.rejects(db.exec(migration),/OB_SETTINGS_REVIEW_REQUIRED/)
  await db.exec("rollback; set app.ob_settings_access_approved='true'")
  await assert.rejects(db.exec(migration),/OB_SETTINGS_ADMIN_INPUT_REVIEW_REQUIRED/)
  await db.exec("rollback; set app.component_catalogue_access_approved='true'")
  await db.exec(read('../docs/db/2026-09-13_04_component_catalogue_access.sql'))
  const grants=async ()=>(await db.query("select relname,privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a where a.grantee='service_role'::regrole order by 1,2")).rows
  const saved=await grants()
  await db.exec(migration)
  await db.exec(migration)
  assert.deepEqual(await snapshot(),before)
  assert.deepEqual(await grants(),saved)
  assert.equal((await db.query<{n: number}>("select count(*)::int n from pg_policy where polname='ob_settings_insert_boundary'")).rows[0].n,settingsTables.length)
})

test('every catalogue remains readable by inspectors but rejects all browser mutation methods',async () => {
  const before=await snapshot()
  await asRole('authenticated',ordinary,async () => {
    for(const table of settingsTables) {
      const id=rows[table].id
      assert.equal((await db.query(`select * from ${table} where id=$1`,[id])).rows.length,1,table)
      await assert.rejects(insert(table,{...rows[table],id:randomUUID()}),/row-level security/,table)
      assert.equal((await db.query(`update ${table} set is_active=true where id=$1 returning id`,[id])).rows.length,0,table)
      assert.equal((await db.query(`delete from ${table} where id=$1 returning id`,[id])).rows.length,0,table)
      const fields=Object.keys(rows[table])
      await assert.rejects(db.query(`insert into ${table}(${fields.join(',')}) values(${fields.map((_,i)=>'$'+(i+1)).join(',')}) on conflict(id) do update set is_active=true`,Object.values(rows[table])),/row-level security/,table)
      await assert.rejects(db.exec(`truncate ${table} cascade`),/permission denied/,table)
    }
  })
  assert.deepEqual(await snapshot(),before)
})

test('anonymous reads and writes are denied even with a forged global-admin subject',async () => {
  await asRole('anon',legacy,async () => {
    for(const table of settingsTables) {
      await assert.rejects(db.query('select * from '+table),/permission denied/,table)
      await assert.rejects(db.query(`update ${table} set is_active=true`),/permission denied/,table)
      await assert.rejects(insert(table,{...rows[table],id:randomUUID()}),/permission denied/,table)
    }
  })
})

test('legacy admins, assigned global admins and service retain real CRUD through all parent/child catalogues',async () => {
  for(const [role,id] of [['authenticated',legacy],['authenticated',admin],['service_role','']]) {
    const added=settingsProbeRows()
    await asRole(role,id,async () => {
      for(const table of settingsTables) {
        await insert(table,added[table])
        assert.equal((await db.query(`update ${table} set is_active=true where id=$1 returning id`,[added[table].id])).rows.length,1,table)
      }
      for(const table of [...settingsTables].reverse()) assert.equal((await db.query(`delete from ${table} where id=$1 returning id`,[added[table].id])).rows.length,1,table)
    })
  }
})

test('revocation, expiry, non-global scope, ordinary role and other module deny every catalogue',async () => {
  for(const change of ["is_active=false","expires_at=now()-interval '1 second'","scope_type='organization'","scope_id=gen_random_uuid()"]){
    await db.exec('begin; update platform_access_assignments set '+change)
    try { await asRole('authenticated',admin,async () => {
      for(const table of settingsTables) assert.equal((await db.query(`update ${table} set is_active=true returning id`)).rows.length,0,table)
    }) } finally { await db.exec('rollback') }
  }
  for(const change of ["update platform_roles set key='inspector'","update platform_modules set key='renoapp_admin'"]){
    await db.exec('begin; '+change)
    try { await asRole('authenticated',admin,async () => {
      for(const table of settingsTables) assert.equal((await db.query(`delete from ${table} returning id`)).rows.length,0,table)
    }) } finally { await db.exec('rollback') }
  }
})

test('unexpected inherited privileges and changed helper/default abort the entire transaction',async () => {
  await db.exec('create role unexpected; grant unexpected to authenticated,anon')
  for(const [change,expected] of [
    ['grant select on settings_certifications to unexpected',/OB_SETTINGS_INHERITED_GRANT/],
    ['grant truncate on document_types to unexpected',/OB_SETTINGS_INHERITED_GRANT/],
    ['grant update(is_admin) on profiles to authenticated',/OB_SETTINGS_PROFILE_AUTHORITY_REVIEW_REQUIRED/],
    ['alter table profiles alter is_admin set default true',/OB_SETTINGS_PROFILE_AUTHORITY_REVIEW_REQUIRED/],
    ['alter function is_hushub_besiktapp_admin() security invoker',/OB_SETTINGS_ADMIN_HELPER_REVIEW_REQUIRED/],
  ] as const){
    await db.exec('begin; '+change)
    try { await assert.rejects(db.exec(migration),expected) } finally { await db.exec('rollback') }
  }
})

test('normal inspection/report code has no direct catalogue writes and all five editors have a guard',() => {
  const allowed=new Set([
    'src/app/(app)/admin/AdminClient.tsx',
    ...settingsEditorPaths.map(path=>'src/app/(app)'+path+'/page.tsx'),
  ])
  for(const path of readdirSync(new URL('../src/',import.meta.url),{recursive:true,encoding:'utf8'}).filter(p=>/\.tsx?$/.test(p))) {
    const file='src/'+path.replaceAll('\\','/')
    const source=ts.createSourceFile(file,read('../'+file),ts.ScriptTarget.Latest,true)
    function walk(node: ts.Node) {
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='from'
        &&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&settingsTables.includes(node.arguments[0].text)) {
        let root: ts.Node=node
        while(root.parent&&(ts.isCallExpression(root.parent)||ts.isPropertyAccessExpression(root.parent))) root=root.parent
        if(/\.(insert|update|upsert|delete)\(/.test(root.getText(source))) assert.ok(allowed.has(file),'Unreviewed catalogue writer: '+file)
      }
      ts.forEachChild(node,walk)
    }
    walk(source)
  }
  for(const path of settingsEditorPaths) assert.match(read('../src/app/(app)'+path+'/layout.tsx'),/BesiktAppCatalogueGuard/)
  assert.match(read('../src/app/(app)/admin/besiktapp/page.tsx'),/<BesiktAppCatalogueGuard>/)
})
