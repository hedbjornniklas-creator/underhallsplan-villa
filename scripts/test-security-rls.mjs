// PostgreSQL permission regressions against synthetic, in-memory databases only.
// Requires an existing @electric-sql/pglite installation; never reads env files,
// opens a network connection or uses a Supabase/production database.
// Usage: node scripts/test-security-rls.mjs [execution-artifact.sql] [results.json]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const sql01 = await readFile(new URL('../docs/db/2026-11-17_01_server_table_rls.sql', import.meta.url), 'utf8')
const sql02 = await readFile(new URL('../docs/db/2026-11-17_02_client_table_rls.sql', import.meta.url), 'utf8')
const sql03 = await readFile(new URL('../docs/db/2026-11-17_03_building_warning_boundaries.sql', import.meta.url), 'utf8')
const executionArtifact = process.argv[2] ? await readFile(process.argv[2], 'utf8') : null
const sha256 = value => createHash('sha256').update(value).digest('hex')
const privateTables = [
  'renovation_document_types', 'renovation_action_types', 'renovation_case_documents',
  'case_access_links', 'renovation_case_action_types', 'renovation_cases',
  'renovation_action_categories', 'renovation_action_document_requirements',
  'renoapp_terminology_groups', 'renoapp_terminology_terms', 'renoapp_terminology_aliases',
  'renoapp_apply_questions', 'renoapp_terminology_rules', 'renoapp_apply_question_options',
  'renoapp_action_type_questions', 'renoapp_case_question_answers', 'renoapp_participant_roles',
  'renoapp_action_type_participant_roles', 'renoapp_review_flags', 'renoapp_apply_option_triggers',
  'renoapp_case_participants', 'renovation_case_messages', 'contacts', 'brf_units', 'unit_contacts',
]
const clientTables = ['basic_fields', 'maintenance_templates', 'building_basic_values',
  'profile_certifications', 'profile_addon_services', 'platform_products', 'platform_modules', 'platform_roles']
const uuid = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`
const userA = uuid(1), userB = uuid(2), orgA = uuid(11), orgB = uuid(12), inactiveOrg = uuid(13)
const buildingA = uuid(21), buildingB = uuid(22), propertyA = uuid(31), propertyB = uuid(32)
const quoted = value => `'${value.replaceAll("'", "''")}'`
let checks = 0
let postgresVersion

async function bootstrap(db) {
  postgresVersion = (await db.query("select current_setting('server_version') version")).rows[0].version
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    revoke all on schema public,auth from public;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    revoke all on function auth.uid() from public;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `)
}

async function asRole(db, role, query, user = userA) {
  await db.exec(`begin; set local role ${role}; set local "request.jwt.claim.sub"=${quoted(user)};`)
  try { return await db.query(query) }
  finally { await db.exec('rollback') }
}

async function denied(db, role, query, user) {
  await assert.rejects(asRole(db, role, query, user), error => error.code === '42501')
  checks++
}

async function metadata(db) {
  return (await db.query(`
    select c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
      (select jsonb_agg(jsonb_build_array(a.attname,a.attacl::text) order by a.attnum)
       from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
      (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
         pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname)
       from pg_policy p where p.polrelid=c.oid) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname
  `)).rows
}

async function rejectedMigration(db, sql, message) {
  const before = await metadata(db)
  try { await assert.rejects(db.exec(sql), message) }
  finally { await db.exec('rollback') }
  assert.deepEqual(await metadata(db), before, 'Rejected migration must roll back all ACL/RLS changes')
  checks++
}

async function serviceAcl(db) {
  return (await db.query(`
    select c.relname,acl.privilege_type,acl.is_grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(c.relacl) acl
    where n.nspname='public' and acl.grantee=(select oid from pg_roles where rolname='service_role')
    order by c.relname,acl.privilege_type
  `)).rows
}

async function testServerTables() {
  const db = new PGlite()
  try {
    await bootstrap(db)
    await seedServerTables(db)
    await db.exec('alter table public.unit_contacts rename to missing_unit_contacts')
    await rejectedMigration(db, sql01, /Missing or unexpected/)
    await db.exec('alter table public.missing_unit_contacts rename to unit_contacts')
    await db.exec('create policy unexpected on public.renovation_cases for select using(true)')
    await rejectedMigration(db, sql01, /Existing policies/)
    await db.exec('drop policy unexpected on public.renovation_cases; alter role service_role nobypassrls')
    await rejectedMigration(db, sql01, /service_role must bypass/)
    await db.exec('alter role service_role bypassrls; alter role anon bypassrls')
    await rejectedMigration(db, sql01, /Unsafe Supabase browser role/)
    await db.exec('alter role anon nobypassrls; create role other_owner; alter table unit_contacts owner to other_owner')
    await rejectedMigration(db, sql01, /Missing or unexpected/)
    await db.exec('alter table unit_contacts owner to postgres; drop role other_owner')
    await db.exec('revoke update on renovation_cases from service_role')
    await rejectedMigration(db, sql01, /service_role lacks UPDATE/)
    await db.exec('grant update on renovation_cases to service_role; create role leaked_reader; grant leaked_reader to authenticated')
    for (const privilege of ['SELECT', 'MAINTAIN']) {
      await db.exec(`grant ${privilege} on renovation_cases to leaked_reader`)
      await rejectedMigration(db, sql01, /Effective browser privileges remain/)
      await db.exec(`revoke ${privilege} on renovation_cases from leaked_reader`)
    }
    await db.exec('revoke leaked_reader from authenticated; drop role leaked_reader')
    const beforeService = await serviceAcl(db)
    await db.exec(sql01)
    assert.deepEqual(await serviceAcl(db), beforeService)
    assert.equal((await db.query('select count(*)::int n from pg_class where relnamespace=\'public\'::regnamespace and relkind=\'r\' and relrowsecurity')).rows[0].n, 25)
    assert.equal((await db.query('select count(*)::int n from pg_policy')).rows[0].n, 0)
    assert.equal((await db.query(`select count(*)::int n from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relnamespace='public'::regnamespace and a.attacl is not null`)).rows[0].n, 0)
    checks += 4
    for (const name of privateTables) {
      for (const role of ['anon', 'authenticated']) await denied(db, role, `select id,payload from public.${name}`)
      assert.deepEqual((await asRole(db, 'service_role', `select payload from public.${name}`)).rows, [{ payload: 'unchanged' }])
      checks++
    }
    for (const query of ["insert into renovation_cases values(2,'new') returning id",
      "update renovation_cases set payload='edited' where id=1 returning id", 'delete from renovation_cases where id=1 returning id']) {
      await denied(db, 'authenticated', query)
      assert.equal((await asRole(db, 'service_role', query)).rows.length, 1)
      checks++
    }
    await rejectedMigration(db, sql01, /Missing or unexpected/)
  } finally { await db.close() }
}

async function seedServerTables(db) {
  await db.exec(privateTables.map(name => `
    create table public.${name}(id integer primary key,payload text not null);
    insert into public.${name} values(1,'unchanged');
    grant all on public.${name} to anon,authenticated,service_role;
    grant select on public.${name} to public;
    grant select(id),update(payload) on public.${name} to public,anon,authenticated;
  `).join('\n'))
}

async function seedClientTables(db) {
    await db.exec(`
      create table org_members(org_id uuid,profile_id uuid,is_active boolean);
      create table properties(id uuid primary key,owner uuid);
      create table buildings(id uuid primary key,property_id uuid references properties(id));
      alter table org_members enable row level security;
      alter table properties enable row level security;
      alter table buildings enable row level security;
      grant select on org_members,properties,buildings to authenticated,service_role;
      create policy own_membership on org_members for select to authenticated using(profile_id=auth.uid());
      create policy own_property on properties for select to authenticated using(owner=auth.uid());
      create policy own_building on buildings for all to authenticated using(exists(select 1 from properties p where p.id=property_id and p.owner=auth.uid()));
      create policy inspection_access_boundary on buildings as restrictive for all to authenticated
        using(exists(select 1 from properties p where p.id=property_id and p.owner=auth.uid()))
        with check(exists(select 1 from properties p where p.id=property_id and p.owner=auth.uid()));
      insert into org_members values('${orgA}','${userA}',true),('${orgB}','${userB}',true),('${inactiveOrg}','${userA}',false);
      insert into properties values('${propertyA}','${userA}'),('${propertyB}','${userB}');
      insert into buildings values('${buildingA}','${propertyA}'),('${buildingB}','${propertyB}');
      create table basic_fields(id uuid primary key,payload text);
      create table maintenance_templates(id uuid primary key,payload text);
      create table building_basic_values(id uuid primary key,building_id uuid,field_id uuid,payload text);
      create table profile_certifications(id uuid primary key,org_id uuid,profile_id uuid,payload text);
      create table profile_addon_services(id uuid primary key,org_id uuid,profile_id uuid,payload text);
      create table platform_products(id uuid primary key,payload text);
      create table platform_modules(id uuid primary key,payload text);
      create table platform_roles(id uuid primary key,payload text);
    `)
    await db.exec(clientTables.map(name => `grant all on ${name} to anon,authenticated,service_role`).join(';'))
    for (const name of ['basic_fields', 'maintenance_templates', 'platform_products', 'platform_modules', 'platform_roles']) {
      await db.exec(`insert into ${name} values('${uuid(100)}','catalogue')`)
    }
    for (const name of ['profile_certifications', 'profile_addon_services']) {
      await db.exec(`insert into ${name} values('${uuid(101)}','${orgA}','${userA}','own'),('${uuid(102)}','${orgB}','${userB}','foreign'),('${uuid(103)}','${inactiveOrg}','${userA}','inactive')`)
    }
    await db.exec(`insert into building_basic_values values('${uuid(101)}','${buildingA}','${uuid(100)}','own'),('${uuid(102)}','${buildingB}','${uuid(100)}','foreign')`)
}

async function testClientTables() {
  const db = new PGlite()
  try {
    await bootstrap(db)
    await seedClientTables(db)
    await db.exec('alter table org_members disable row level security')
    await rejectedMigration(db, sql02, /DEPENDENCY_REVIEW_REQUIRED/)
    await db.exec('alter table org_members enable row level security; drop policy inspection_access_boundary on buildings')
    await rejectedMigration(db, sql02, /BOUNDARY|DEPENDENCY/)
    await db.exec(`create policy inspection_access_boundary on buildings as restrictive for all to authenticated
      using(exists(select 1 from properties p where p.id=property_id and p.owner=auth.uid()))
      with check(exists(select 1 from properties p where p.id=property_id and p.owner=auth.uid()))`)
    await db.exec('grant select(payload) on profile_certifications to authenticated')
    await rejectedMigration(db, sql02, /COLUMN.*REVIEW_REQUIRED/)
    await db.exec('revoke select(payload) on profile_certifications from authenticated')
    const beforeService = await serviceAcl(db)
    await db.exec(sql02)
    assert.deepEqual(await serviceAcl(db), beforeService)
    assert.equal((await db.query(`select count(*)::int n from pg_class where relname in(${clientTables.map(quoted)}) and relrowsecurity`)).rows[0].n, 8)
    checks += 2
    for (const name of clientTables) {
      if (name.startsWith('platform_')) assert.equal((await asRole(db, 'anon', `select * from ${name}`)).rows.length, 1)
      else await denied(db, 'anon', `select * from ${name}`)
      await denied(db, 'authenticated', `delete from ${name}`)
      await denied(db, 'authenticated', `truncate ${name}`)
      if (!['building_basic_values', 'profile_certifications', 'profile_addon_services'].includes(name)) {
        assert.equal((await asRole(db, 'authenticated', `select * from ${name}`)).rows.length, 1)
        await denied(db, 'authenticated', `insert into ${name}(id,payload) values('${uuid(200)}','blocked')`)
        await denied(db, 'authenticated', `update ${name} set payload='blocked'`)
      }
      checks++
    }
    for (const name of ['profile_certifications', 'profile_addon_services']) {
      assert.deepEqual((await asRole(db, 'authenticated', `select payload from ${name}`)).rows, [{ payload: 'own' }])
      assert.equal((await asRole(db, 'authenticated', `insert into ${name} values('${uuid(200)}','${orgA}','${userA}','new') returning id`)).rows.length, 1)
      assert.equal((await asRole(db, 'authenticated', `update ${name} set payload='changed' where id='${uuid(101)}' returning id`)).rows.length, 1)
      assert.equal((await asRole(db, 'authenticated', `update ${name} set payload='blocked' where id='${uuid(102)}' returning id`)).rows.length, 0)
      assert.equal((await asRole(db, 'service_role', `select * from ${name}`)).rows.length, 3)
      checks += 5
      for (const [org, profile] of [[orgB, userB], [orgA, userB], [inactiveOrg, userA], [orgB, userA]]) {
        await denied(db, 'authenticated', `insert into ${name} values('${uuid(200)}','${org}','${profile}','blocked')`)
      }
      await denied(db, 'authenticated', `update ${name} set profile_id='${userB}' where id='${uuid(101)}'`)
      await denied(db, 'authenticated', `update ${name} set org_id='${inactiveOrg}' where id='${uuid(101)}'`)
    }
    assert.deepEqual((await asRole(db, 'authenticated', 'select payload from building_basic_values')).rows, [{ payload: 'own' }])
    assert.equal((await asRole(db, 'authenticated', `insert into building_basic_values values('${uuid(200)}','${buildingA}','${uuid(100)}','new') returning id`)).rows.length, 1)
    assert.equal((await asRole(db, 'authenticated', `update building_basic_values set payload='changed' where id='${uuid(101)}' returning id`)).rows.length, 1)
    assert.equal((await asRole(db, 'authenticated', `update building_basic_values set payload='blocked' where id='${uuid(102)}' returning id`)).rows.length, 0)
    assert.equal((await asRole(db, 'service_role', 'select * from building_basic_values')).rows.length, 2)
    checks += 5
    await denied(db, 'authenticated', `insert into building_basic_values values('${uuid(200)}','${buildingB}','${uuid(100)}','blocked')`)
    await denied(db, 'authenticated', `update building_basic_values set building_id='${buildingB}' where id='${uuid(101)}'`)
    await rejectedMigration(db, sql02, /RELATION_REVIEW_REQUIRED/)
    await testBuildingChildren(db)
  } finally { await db.close() }
}

async function seedBuildingChildren(db) {
  const children = [
    ['building_disclosures', 'title text,content text,link_url text,created_at timestamptz', ['disclosures select', 'disclosures ins', 'disclosures upd']],
    ['building_facts', 'key text,value text,created_at timestamptz', ['facts select', 'facts ins', 'facts upd']],
    ['spaces', 'name text,category text,notes text,cover_path text,created_at timestamptz,floor text', ['spaces select authed', 'spaces insert authed', 'spaces update authed']],
  ]
  for (const [name, columns, policies] of children) {
    await db.exec(`create table ${name}(id uuid primary key,building_id uuid references buildings(id),${columns});
      grant all on ${name} to anon,authenticated,service_role;
      alter table ${name} enable row level security;
      create policy "${policies[0]}" on ${name} for select to authenticated using(true);
      create policy "${policies[1]}" on ${name} for insert to authenticated with check(true);
      create policy "${policies[2]}" on ${name} for update to authenticated using(true);
      insert into ${name}(id,building_id) values('${uuid(101)}','${buildingA}'),('${uuid(102)}','${buildingB}');`)
    assert.equal((await asRole(db, 'authenticated', `select * from ${name}`)).rows.length, 2, 'Reproduce the previous cross-owner exposure')
    checks++
  }
  return children
}

async function testBuildingChildren(db) {
  const children = await seedBuildingChildren(db)
  await db.exec('alter policy "facts select" on building_facts using(false)')
  await rejectedMigration(db, sql03, /POLICY_REVIEW_REQUIRED/)
  await db.exec('alter policy "facts select" on building_facts using(true); alter table spaces add column unexpected text')
  await rejectedMigration(db, sql03, /COLUMN_REVIEW_REQUIRED/)
  await db.exec('alter table spaces drop column unexpected')
  const beforeService = await serviceAcl(db)
  await db.exec(sql03)
  assert.deepEqual(await serviceAcl(db), beforeService)
  checks++
  for (const [name] of children) {
    assert.equal((await asRole(db, 'authenticated', `select * from ${name}`)).rows.length, 1)
    assert.equal((await asRole(db, 'authenticated', `select * from ${name}`, userB)).rows.length, 1)
    assert.equal((await asRole(db, 'service_role', `select * from ${name}`)).rows.length, 2)
    assert.equal((await asRole(db, 'authenticated', `insert into ${name}(id,building_id) values('${uuid(200)}','${buildingA}') returning id`)).rows.length, 1)
    assert.equal((await asRole(db, 'authenticated', `update ${name} set building_id='${buildingA}' where id='${uuid(101)}' returning id`)).rows.length, 1)
    assert.equal((await asRole(db, 'authenticated', `update ${name} set building_id='${buildingA}' where id='${uuid(102)}' returning id`)).rows.length, 0)
    checks += 6
    await denied(db, 'authenticated', `insert into ${name}(id,building_id) values('${uuid(200)}','${buildingB}')`)
    await denied(db, 'authenticated', `update ${name} set building_id='${buildingB}' where id='${uuid(101)}'`)
    await denied(db, 'authenticated', `delete from ${name}`)
    await denied(db, 'authenticated', `truncate ${name}`)
    await denied(db, 'anon', `select * from ${name}`)
  }
  await rejectedMigration(db, sql03, /POLICY_REVIEW_REQUIRED/)
}

async function testExecutionArtifact() {
  const db = new PGlite()
  try {
    await bootstrap(db)
    await seedServerTables(db)
    await seedClientTables(db)
    const children = await seedBuildingChildren(db)
    const beforeService = await serviceAcl(db)
    await db.exec(executionArtifact)
    assert.deepEqual(await serviceAcl(db), beforeService)
    const targets = [...privateTables, ...clientTables, ...children.map(([name]) => name)]
    assert.equal((await db.query(`select count(*)::int n from pg_class
      where relname in(${targets.map(quoted)}) and relrowsecurity`)).rows[0].n, 36)
    checks += 2
    for (const name of privateTables) {
      for (const role of ['anon', 'authenticated']) await denied(db, role, `select * from ${name}`)
      assert.equal((await asRole(db, 'service_role', `select * from ${name}`)).rows.length, 1)
      checks++
    }
    for (const name of clientTables) {
      assert.equal((await asRole(db, 'authenticated', `select * from ${name}`)).rows.length, 1)
      if (name.startsWith('platform_')) assert.equal((await asRole(db, 'anon', `select * from ${name}`)).rows.length, 1)
      else await denied(db, 'anon', `select * from ${name}`)
      checks++
    }
    for (const [name] of children) {
      assert.equal((await asRole(db, 'authenticated', `select * from ${name}`)).rows.length, 1)
      await denied(db, 'anon', `select * from ${name}`)
      await denied(db, 'authenticated', `update ${name} set building_id='${buildingB}' where id='${uuid(101)}'`)
      checks++
    }
  } finally { await db.close() }
}

try {
  await testServerTables()
  await testClientTables()
  if (executionArtifact) await testExecutionArtifact()
  const result = { passed: true, checks, postgresVersion, syntheticOnly: true,
    sourceSha256: [sql01, sql02, sql03].map(sha256),
    executionArtifact: process.argv[2] ?? null,
    executionSha256: executionArtifact ? sha256(executionArtifact) : null,
    verifiedAt: new Date().toISOString() }
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n')
  console.log(`Security RLS migrations: ${checks} checks passed in synthetic in-memory PostgreSQL ${postgresVersion}.`)
  if (executionArtifact) console.log(`Execution artifact SHA256: ${result.executionSha256}`)
} catch (error) {
  console.error(`Security RLS migrations failed after ${checks} checks: ${error.message.slice(0, 1600)}`)
  const cause = error.actual ?? error
  console.error(JSON.stringify({ code: cause.code, position: cause.position, context: cause.where }))
  process.exitCode = 1
}
