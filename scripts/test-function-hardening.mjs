// Runtime permission/name-resolution tests in synthetic in-memory PostgreSQL.
// No env files, production connections, credentials or application rows are used.
// Usage: node scripts/test-function-hardening.mjs [execution.sql] [results.json]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const fixture = JSON.parse(await readFile(new URL('../test/fixtures/function-hardening-before.json', import.meta.url), 'utf8'))
const migration04 = await readFile(new URL('../docs/db/2026-11-17_04_function_search_paths.sql', import.meta.url), 'utf8')
const migration05 = await readFile(new URL('../docs/db/2026-11-17_05_trigger_function_execute.sql', import.meta.url), 'utf8')
const migration06 = await readFile(new URL('../docs/db/2026-11-17_06_internal_function_execute.sql', import.meta.url), 'utf8')
const execution = process.argv[2] ? await readFile(process.argv[2], 'utf8') : null
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const hash = value => createHash('sha256').update(value).digest('hex')
const uuid = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`
const user = uuid(101), admin = uuid(102), unlocked = uuid(1), locked = uuid(2)
const obsA = uuid(201), obsB = uuid(202)
const mutable = fixture.functions.filter(fn => fixture.searchPathFunctions.includes(fn.identity))
const timestamps = mutable.filter(fn => fn.name.endsWith('_set_updated_at') || ['set_timestamp', 'set_updated_at', 'moddatetime'].includes(fn.name))
const covered = new Set()
let checks = 0, version
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
const tested = name => covered.add(name)

async function roleSession(db, work, identity = user, role = 'authenticated') {
  await db.exec(`begin; set local role ${role}; set local search_path=attacker,public,pg_catalog,pg_temp;
    set local "request.jwt.claim.sub"=${quote(identity)}`)
  try { return await work(db) }
  finally { await db.exec('rollback') }
}

async function denied(db, sql, code = 'P0001', message) {
  await assert.rejects(roleSession(db, tx => tx.query(sql)), error => error.code === code && (!message || error.message.includes(message)))
  checks++
}

async function state(db) {
  return (await db.query(`select p.oid::text id,p.proname name,to_jsonb(p) metadata,
      pg_get_functiondef(p.oid) definition,
      (select jsonb_agg(jsonb_build_array(t.tgrelid,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) order by t.tgrelid,t.tgname)
       from pg_trigger t where t.tgfoid=p.oid and not t.tgisinternal) bindings
    from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in(${fixture.functions.map(fn => quote(fn.name)).join(',')}) order by p.oid`)).rows
}

async function rejected(db, sql, pattern) {
  const before = await state(db)
  try { await assert.rejects(db.exec(sql), pattern) }
  finally { await db.exec('rollback') }
  equal(await state(db), before, 'Failure must roll back every function/ACL/config/trigger change')
}

async function setup(db) {
  version = (await db.query("select current_setting('server_version') version")).rows[0].version
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema fixture; create schema attacker;
    revoke all on schema public,auth from public;
    grant usage on schema public,auth,fixture,attacker to anon,authenticated,service_role;
    grant create on schema attacker to authenticated;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table public.operational_tasks(id uuid primary key,org_id uuid,root_task_id uuid,parent_task_id uuid);
    create table public.task_deadline_change_requests(id uuid primary key);
    create table public.task_requirements(id uuid primary key);
    create table public.task_conversation_reads(id uuid primary key);
    create table public.task_events(id uuid primary key);
    set check_function_bodies=false;`)
  for (const fn of fixture.functions) {
    assert.equal(fn.owner, 'postgres')
    assert.equal(fn.extension, null)
    await db.exec(fn.definition)
    if (fn.acl !== null) {
      await db.exec(`revoke all on function public.${fn.identity} from public,anon,authenticated,service_role`)
      for (const entry of fn.acl.slice(1, -1).split(',')) {
        const match = /^([^=]*)=(X\*?)\/postgres$/.exec(entry)
        assert.ok(match, `Unsupported fixture ACL: ${entry}`)
        const grantee = match[1] || 'public'
        assert.ok(['public', 'postgres', 'anon', 'authenticated', 'service_role'].includes(grantee))
        await db.exec(`grant execute on function public.${fn.identity} to ${grantee}${match[2].includes('*') ? ' with grant option' : ''}`)
      }
    }
  }
  await db.exec('reset check_function_bodies')
  for (const fn of mutable) {
    const row = (await db.query(`select md5(prosrc) source,md5(pg_get_functiondef(oid)) definition
      from pg_proc where oid=${quote(`public.${fn.identity}`)}::regprocedure`)).rows[0]
    equal(row, { source: fn.source_md5, definition: fn.definition_md5 }, `Portable original source/hash: ${fn.identity}`)
  }
  await seedBehavior(db)
  for (const fn of fixture.functions.filter(fn => fixture.triggerExecuteFunctions.includes(fn.identity) && fn.name !== 'handle_new_user')) {
    await db.exec(`create table fixture.bind_${fn.name}(id ${fn.name === 'ensure_task_organization_settings' ? 'uuid' : 'integer'},inspection_id uuid,building_id uuid);
      grant select,insert,update,delete on fixture.bind_${fn.name} to authenticated`)
    for (let index = 0; index < fn.trigger_count; index++) {
      await db.exec(`create trigger original_${index} before insert on fixture.bind_${fn.name}
        for each row execute function public.${fn.identity}`)
    }
  }
  await seedHelpers(db)
}

async function seedBehavior(db) {
  await db.exec(`
    create table public.profiles(id uuid primary key,is_admin boolean default false,marker text);
    insert into profiles values('${user}',false,'preserved'),('${admin}',true,'admin');
    create table auth.users(id uuid primary key);
    create trigger signup_profile after insert on auth.users for each row execute function public.handle_new_user();
    create table public.properties(id integer primary key,status text);
    create trigger normalize before insert or update on properties for each row execute function public.normalize_properties_status();
    create table public.inspections(id uuid primary key,locked_at timestamptz,locked_by uuid,updated_at timestamptz,property_id uuid,
      inspection_family text,inspection_variant text,payload text);
    insert into inspections(id,locked_at,payload) values('${unlocked}',null,'open'),('${locked}',now(),'frozen');
    update inspections set property_id='${uuid(501)}' where id='${unlocked}';
    create table public.buildings(id uuid primary key,property_id uuid);
    insert into buildings values('${uuid(601)}','${uuid(501)}'),('${uuid(602)}','${uuid(502)}');
    create table public.ob_inspection_buildings(building_id uuid);
    create table public.task_organization_settings(org_id uuid primary key);
    create table fixture.inspection_children(id integer primary key,inspection_id uuid,payload text);
    insert into fixture.inspection_children values(1,'${unlocked}','open'),(2,'${locked}','frozen');
    create trigger child_lock before insert or update or delete on fixture.inspection_children
      for each row execute function public.guard_locked_inspection_child_write();
    create trigger report_lock before update or delete on public.inspections
      for each row execute function public.guard_locked_inspections_write();
    create table public.tu_observations(id uuid primary key,note_text text,transcript_text text,
      original_note_text text,original_transcript_text text,review_status text);
    create trigger original_source before insert or update of note_text,transcript_text on tu_observations
      for each row execute function public.tu_observations_preserve_original_source();
    insert into tu_observations(id,note_text,transcript_text,review_status)
      values('${obsA}','first note','first transcript','reviewed'),('${obsB}',null,null,'reviewed');
    create table fixture.measurements(id integer primary key,observation_id uuid,value_text text);
    insert into fixture.measurements values(1,'${obsA}','10');
    create trigger source_changed after insert or update or delete on fixture.measurements
      for each row execute function public.tu_measurements_invalidate_observation_review();
    create table fixture.followup_orders(id integer primary key,billing_status text,withdrawal_requested_at timestamptz,payload text);
    insert into fixture.followup_orders values(1,'pending',null,'frozen'),(2,'paid','2026-01-01','frozen');
    create trigger immutable before update on fixture.followup_orders for each row execute function public.eb_follow_up_guard_order();
    create table fixture.remediation(id integer primary key,org_id uuid,eb_project_id uuid,inspection_id uuid,
      follow_up_order_id uuid,original_note_id uuid,note_snapshot jsonb,original_images jsonb,eb_note_id uuid,status text);
    insert into fixture.remediation(id,follow_up_order_id,note_snapshot,original_images,eb_note_id)
      values(1,'${uuid(401)}','{"text":"frozen"}','["original"]','${uuid(402)}'),(2,null,'{}','[]',null);
    create trigger immutable before update or delete on fixture.remediation
      for each row execute function public.eb_guard_paid_remediation_snapshot();
    create table fixture.offers(id integer primary key,org_id uuid,action_case_id uuid,participant_id uuid,version integer,
      draft_revision integer,snapshot jsonb,files jsonb,published_at timestamptz,published_by uuid,email_payload jsonb,
      status text,accepted_at timestamptz,accepted_by text,accepted_option_ids jsonb,accepted_total_ore bigint,delivery_status text);
    insert into fixture.offers(id,snapshot,status) values(1,'{}','published'),(2,'{}','accepted');
    create trigger immutable before update on fixture.offers for each row execute function public.guard_customer_offer_snapshot();
    create table fixture.billing(id integer primary key,payload text);
    insert into fixture.billing values(1,'frozen');
    create trigger immutable before update or delete on fixture.billing for each row execute function public.guard_project_billing_event();
    create function attacker.now() returns timestamptz language sql immutable as $$select '1900-01-01'::timestamptz$$;
    create function attacker.btrim(text) returns text language sql immutable as $$select ''::text$$;
    create temp table profiles(id uuid,is_admin boolean);
    insert into pg_temp.profiles values('${user}',true);
    create temp table inspections(id uuid,locked_at timestamptz);
    insert into pg_temp.inspections values('${locked}',null);
    create temp table tu_observations(id uuid,review_status text);
    insert into pg_temp.tu_observations values('${obsA}','reviewed'),('${obsB}','reviewed');
    create table fixture.new_trigger_target(id uuid); alter table fixture.new_trigger_target owner to authenticated;
    grant all on all tables in schema fixture to authenticated,service_role;
    grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
    revoke insert,update,delete on public.profiles from authenticated;
    revoke insert,update,delete on public.task_organization_settings from authenticated;
    grant insert,select on auth.users to authenticated,service_role;
    grant select,update on pg_temp.profiles,pg_temp.inspections,pg_temp.tu_observations to authenticated,service_role;
  `)
  for (const fn of timestamps) {
    await db.exec(`create table fixture.ts_${fn.name}(id integer primary key,updated_at timestamptz,payload text);
      insert into fixture.ts_${fn.name} values(1,'2000-01-01','old');
      grant select,update on fixture.ts_${fn.name} to authenticated;
      create trigger stamp before update on fixture.ts_${fn.name} for each row execute function public.${fn.identity}`)
  }
}

async function testPaths(db) {
  const drift = mutable.find(fn => fn.name === 'tu_report_revisions_set_updated_at')
  await db.exec(drift.definition.replace(/\$function\$\s*$/, '-- fixture drift\n$function$'))
  await rejected(db, migration04, /FUNCTION_PATH_DEFINITION_REVIEW_REQUIRED/)
  await db.exec(drift.definition)
  await db.exec('grant create on schema public to anon')
  await rejected(db, migration04, /FUNCTION_PATH_UNTRUSTED_SCHEMA/)
  await db.exec('revoke create on schema public from anon; alter role anon bypassrls')
  await rejected(db, migration04, /FUNCTION_PATH_UNSAFE_ROLE/)
  await db.exec('alter role anon nobypassrls')
  const before = await state(db)
  await db.exec(migration04)
  const after = await state(db)
  for (let index = 0; index < before.length; index++) {
    const old = structuredClone(before[index]), next = structuredClone(after[index])
    if (fixture.searchPathFunctions.some(identity => identity.startsWith(`${old.name}(`))) {
      equal(next.metadata.proconfig, ['search_path=pg_catalog, pg_temp'])
      delete old.metadata.proconfig; delete next.metadata.proconfig
      delete old.definition; delete next.definition
    }
    equal(next, old, `Only reviewed search_path changed: ${old.name}`)
  }
  await rejected(db, migration04, /FUNCTION_PATH_DEFINITION_REVIEW_REQUIRED/)
}

async function seedHelpers(db) {
  await db.exec(`
    create table public.org_members(org_id uuid,profile_id uuid,is_active boolean,role text);
    insert into org_members values('${uuid(11)}','${user}',true,'admin'),('${uuid(12)}','${user}',true,'member'),
      ('${uuid(13)}','${user}',false,'admin'),('${uuid(14)}','${admin}',true,'admin');
    create table public.platform_products(id uuid,key text);
    create table public.platform_modules(id uuid,key text);
    create table public.platform_roles(id uuid,key text);
    create table public.platform_access_assignments(profile_id uuid,product_id uuid,module_id uuid,role_id uuid,
      is_active boolean,expires_at timestamptz,scope_type text,scope_id uuid);
    insert into platform_products values('${uuid(901)}','hushub_admin');
    insert into platform_modules values('${uuid(902)}','besiktapp_admin'),('${uuid(903)}','renoapp_admin');
    insert into platform_roles values('${uuid(904)}','product_admin');
    insert into platform_access_assignments values('${user}','${uuid(901)}','${uuid(902)}','${uuid(904)}',true,null,'global',null),
      ('${user}','${uuid(901)}','${uuid(903)}','${uuid(904)}',true,'2000-01-01','global',null);
    create table public.organization_contacts(id uuid primary key,org_id uuid,is_active boolean);
    insert into organization_contacts values('${uuid(801)}','${uuid(11)}',true),('${uuid(802)}','${uuid(11)}',false);
    insert into operational_tasks values('${uuid(701)}','${uuid(11)}','${uuid(701)}',null),
      ('${uuid(702)}','${uuid(11)}','${uuid(701)}','${uuid(701)}'),('${uuid(703)}','${uuid(14)}','${uuid(703)}',null);
    create table public.task_access_links(id uuid primary key,org_id uuid,root_task_id uuid,contact_id uuid,task_id uuid,
      role text,scope text,revoked_at timestamptz,expires_at timestamptz);
    insert into task_access_links values
      ('${uuid(811)}','${uuid(11)}','${uuid(701)}','${uuid(801)}','${uuid(701)}','assignee','task',null,'2100-01-01'),
      ('${uuid(812)}','${uuid(11)}','${uuid(701)}','${uuid(801)}','${uuid(701)}','assignee','task',null,'2000-01-01'),
      ('${uuid(813)}','${uuid(11)}','${uuid(701)}','${uuid(801)}','${uuid(701)}','assignee','task','2026-01-01','2100-01-01'),
      ('${uuid(814)}','${uuid(11)}','${uuid(701)}','${uuid(801)}','${uuid(701)}','delegator','branch',null,'2100-01-01');
  `)
  for (const helper of fixture.helperDependencies.filter(helper => helper.policyCount)) {
    const table = `fixture.policy_${helper.name}`
    await db.exec(`create table ${table}(id integer,org_id uuid);
      insert into ${table} values(1,'${uuid(11)}'),(2,'${uuid(12)}'),(3,'${uuid(13)}'),(4,'${uuid(14)}');
      alter table ${table} enable row level security;
      grant select on ${table} to authenticated,anon,service_role`)
    const expression = helper.identity.endsWith('(uuid)') ? `public.${helper.name}(org_id)` : `public.${helper.identity}`
    for (let index = 0; index < helper.policyCount; index++) {
      await db.exec(`create policy original_${index} on ${table} for select to authenticated using(${expression})`)
    }
  }
}

async function testBehavior(db) {
  equal(timestamps.length, 19)
  for (const fn of timestamps) {
    const rows = await roleSession(db, async tx => (await tx.query(`update fixture.ts_${fn.name} set payload='new'
      where id=1 returning updated_at=pg_catalog.now() as correct`)).rows)
    equal(rows, [{ correct: true }], `Ignore attacker.now(): ${fn.name}`)
    tested(fn.name)
  }
  equal((await roleSession(db, tx => tx.query("select public.is_admin() value"))).rows, [{ value: false }])
  equal((await roleSession(db, tx => tx.query("select public.is_admin() value"), admin)).rows, [{ value: true }])
  tested('is_admin')
  // PGlite lacks the WIN1252 conversion module; the unchanged non-null path is
  // covered separately by read-only literal probes in the real PostgreSQL17.
  equal((await roleSession(db, tx => tx.query('select public.renoapp_fix_mojibake(null) value'))).rows,
    [{ value: null }]); tested('renoapp_fix_mojibake')
  await roleSession(db, tx => tx.query(`select public.raise_if_inspection_locked(null,'fixture'),public.raise_if_inspection_locked('${unlocked}','fixture')`))
  await denied(db, `select public.raise_if_inspection_locked('${locked}','fixture')`, '55000')
  tested('raise_if_inspection_locked')
  for (const sql of [
    `insert into fixture.inspection_children values(3,'${locked}','blocked')`,
    `update fixture.inspection_children set inspection_id='${locked}' where id=1`,
    `update fixture.inspection_children set inspection_id='${unlocked}' where id=2`,
    'delete from fixture.inspection_children where id=2',
  ]) await denied(db, sql, '55000')
  equal((await roleSession(db, tx => tx.query("update fixture.inspection_children set payload='changed' where id=1 returning id"))).rows, [{ id: 1 }])
  tested('guard_locked_inspection_child_write')
  await denied(db, `update public.inspections set payload='blocked' where id='${locked}'`, '55000')
  await denied(db, `delete from public.inspections where id='${locked}'`, '55000')
  equal((await roleSession(db, tx => tx.query(`update public.inspections set inspection_family='ob',updated_at=pg_catalog.now() where id='${locked}' returning id`))).rows.length, 1)
  tested('guard_locked_inspections_write')
  await roleSession(db, async tx => {
    await tx.query("insert into public.properties values(1,null),(2,'   '),(3,'Planerad')")
    const values = (await tx.query('select status from public.properties order by id')).rows
    equal(values, [{ status: 'Aktiv' }, { status: 'Aktiv' }, { status: 'Planerad' }])
  }); tested('normalize_properties_status')
  await roleSession(db, async tx => {
    await tx.query(`update public.tu_observations set note_text='edited',transcript_text='edited' where id='${obsA}'`)
    equal((await tx.query(`select original_note_text,original_transcript_text from public.tu_observations where id='${obsA}'`)).rows,
      [{ original_note_text: 'first note', original_transcript_text: 'first transcript' }])
    equal((await tx.query(`insert into public.tu_observations(id,note_text,transcript_text) values('${uuid(203)}',' initial ',' voice ')
      returning original_note_text,original_transcript_text`)).rows, [{ original_note_text: 'initial', original_transcript_text: 'voice' }])
  }); tested('tu_observations_preserve_original_source')
  for (const operation of [
    `insert into fixture.measurements values(2,'${obsA}','20')`,
    `update fixture.measurements set observation_id='${obsB}' where id=1`,
    'delete from fixture.measurements where id=1',
  ]) await roleSession(db, async tx => {
    await tx.query(operation)
    equal((await tx.query(`select review_status from public.tu_observations where id='${obsA}'`)).rows, [{ review_status: 'draft' }])
    if (operation.startsWith('update')) equal((await tx.query(`select review_status from public.tu_observations where id='${obsB}'`)).rows, [{ review_status: 'draft' }])
    equal((await tx.query(`select review_status from pg_temp.tu_observations where id='${obsA}'`)).rows, [{ review_status: 'reviewed' }])
  }); tested('tu_measurements_invalidate_observation_review')
  equal((await roleSession(db, tx => tx.query("update fixture.followup_orders set billing_status='paid',withdrawal_requested_at=pg_catalog.now() where id=1 returning id"))).rows, [{ id: 1 }])
  await denied(db, "update fixture.followup_orders set payload='blocked' where id=1", 'P0001', 'EB_FOLLOW_UP_ORDER_IMMUTABLE')
  await denied(db, 'update fixture.followup_orders set withdrawal_requested_at=null where id=2', 'P0001', 'EB_FOLLOW_UP_WITHDRAWAL_IMMUTABLE')
  tested('eb_follow_up_guard_order')
  equal((await roleSession(db, tx => tx.query("update fixture.remediation set eb_note_id=null,status='done' where id=1 returning id"))).rows, [{ id: 1 }])
  await denied(db, "update fixture.remediation set note_snapshot='{}' where id=1", 'P0001', 'EB_FOLLOW_UP_TASK_IMMUTABLE')
  await denied(db, 'delete from fixture.remediation where id=1', 'P0001', 'EB_FOLLOW_UP_TASK_IMMUTABLE')
  equal((await roleSession(db, tx => tx.query('delete from fixture.remediation where id=2 returning id'))).rows, [{ id: 2 }])
  tested('eb_guard_paid_remediation_snapshot')
  equal((await roleSession(db, tx => tx.query("update fixture.offers set status='accepted',accepted_by='fixture',delivery_status='sent' where id=1 returning id"))).rows, [{ id: 1 }])
  await denied(db, "update fixture.offers set snapshot='[1]' where id=1", 'P0001', 'CUSTOMER_OFFER_IMMUTABLE')
  await denied(db, "update fixture.offers set status='published' where id=2", 'P0001', 'CUSTOMER_OFFER_IMMUTABLE')
  tested('guard_customer_offer_snapshot')
  await denied(db, "update fixture.billing set payload='blocked'", 'P0001', 'BILLING_IMMUTABLE')
  await denied(db, 'delete from fixture.billing', 'P0001', 'BILLING_IMMUTABLE')
  tested('guard_project_billing_event')
  await testSignup(db)
  await testRepresentativeTriggers(db)
  equal([...covered].sort(), mutable.map(fn => fn.name).sort(), 'All 32 reviewed functions exercised with their real bodies')
}

async function testRepresentativeTriggers(db) {
  await roleSession(db, async tx => {
    await tx.query(`insert into fixture.bind_ensure_task_organization_settings(id) values('${uuid(998)}')`)
    equal((await tx.query(`select org_id from public.task_organization_settings where org_id='${uuid(998)}'`)).rows,
      [{ org_id: uuid(998) }], 'Existing task trigger inserts using its definer after EXECUTE revoke')
    equal((await tx.query(`insert into fixture.bind_ob_building_guard_identity values(1,'${unlocked}','${uuid(601)}') returning id`)).rows,
      [{ id: 1 }], 'Real OB guard accepts its matching property')
  })
  await denied(db, `insert into fixture.bind_ob_building_guard_identity values(1,'${unlocked}','${uuid(602)}')`, 'P0001', 'OB_ROUND_FOREIGN')
}

async function testSignup(db) {
  await roleSession(db, async tx => {
    await tx.query(`insert into auth.users values('${uuid(999)}'),('${user}')`)
    equal((await tx.query(`select id,marker from public.profiles where id in('${uuid(999)}','${user}') order by id`)).rows,
      [{ id: user, marker: 'preserved' }, { id: uuid(999), marker: null }])
  })
  tested('handle_new_user')
}

async function testTriggerExecute(db) {
  await roleSession(db, tx => tx.query('create trigger allowed_before before insert on fixture.new_trigger_target for each row execute function public.handle_new_user()'))
  await db.exec('create role inherited_executor; grant execute on function public.handle_new_user() to inherited_executor; grant inherited_executor to authenticated')
  await rejected(db, migration05, /EXECUTE|PRIVILEGE|BROWSER/)
  await db.exec('revoke inherited_executor from authenticated; drop owned by inherited_executor; drop role inherited_executor')
  const before = await state(db)
  await db.exec(migration05)
  const after = await state(db)
  for (let index = 0; index < before.length; index++) {
    const old = structuredClone(before[index]), next = structuredClone(after[index])
    if (fixture.triggerExecuteFunctions.some(identity => identity.startsWith(`${old.name}(`))) {
      delete old.metadata.proacl; delete next.metadata.proacl
      const allowed = (await db.query(`select has_function_privilege('anon',${quote(next.id)}::oid,'execute') anon,
        has_function_privilege('authenticated',${quote(next.id)}::oid,'execute') auth,
        has_function_privilege('service_role',${quote(next.id)}::oid,'execute') service,
        has_function_privilege('postgres',${quote(next.id)}::oid,'execute') owner`)).rows[0]
      equal(allowed, { anon: false, auth: false, service: true, owner: true })
    }
    equal(next, old, `Only reviewed trigger ACL changed: ${old.name}`)
  }
  await testSignup(db)
  await testRepresentativeTriggers(db)
  await denied(db, 'create trigger denied_after before insert on fixture.new_trigger_target for each row execute function public.handle_new_user()', '42501')
  await db.exec('drop trigger signup_profile on auth.users; create trigger signup_profile after insert on auth.users for each row execute function public.handle_new_user()')
  await testSignup(db)
  const repeat = await state(db)
  await db.exec(migration05)
  equal(await state(db), repeat, 'Trigger EXECUTE migration is repeat-safe')
}

async function testHelperBehavior(db) {
  await roleSession(db, async tx => {
    equal((await tx.query(`select public.is_org_member('${uuid(11)}') member,public.is_org_admin('${uuid(11)}') admin,
      public.is_org_member('${uuid(12)}') regular,public.is_org_admin('${uuid(12)}') regular_admin,
      public.is_org_member('${uuid(13)}') inactive,public.is_org_member('${uuid(14)}') foreign_org`)).rows,
      [{ member: true, admin: true, regular: true, regular_admin: false, inactive: false, foreign_org: false }])
    equal((await tx.query('select public.is_hushub_besiktapp_admin() besikt,public.is_hushub_renoapp_admin() reno')).rows,
      [{ besikt: true, reno: false }], 'Global active role works; expired role does not')
    for (const [name, count] of [['is_org_admin', 1], ['is_org_member', 2], ['is_hushub_besiktapp_admin', 4], ['is_hushub_renoapp_admin', 0]]) {
      equal((await tx.query(`select * from fixture.policy_${name}`)).rows.length, count, `Authenticated RLS still invokes ${name}`)
    }
  })
  equal((await roleSession(db, tx => tx.query('select public.is_hushub_besiktapp_admin() besikt,public.is_hushub_renoapp_admin() reno'), admin)).rows,
    [{ besikt: true, reno: true }], 'Legacy administrator access remains')
  const scope = (link, task, contact = uuid(801)) => `select public.task_access_link_covers('${link}','${task}','${contact}') allowed`
  for (const [link, task, contact, allowed] of [
    [uuid(811), uuid(701), uuid(801), true], [uuid(811), uuid(702), uuid(801), false],
    [uuid(814), uuid(702), uuid(801), true], [uuid(811), uuid(703), uuid(801), false],
    [uuid(812), uuid(701), uuid(801), false], [uuid(813), uuid(701), uuid(801), false],
    [uuid(811), uuid(701), uuid(802), false],
  ]) equal((await roleSession(db, tx => tx.query(scope(link, task, contact)), user, 'service_role')).rows, [{ allowed }])
}

async function testHelperExecute(db) {
  await db.exec("create function attacker.unknown_invoker() returns boolean language sql as $$select PUBLIC.IS_ORG_MEMBER('00000000-0000-0000-0000-000000000011'::uuid)$$")
  await rejected(db, migration06, /INTERNAL_EXECUTE_CALLER_REVIEW_REQUIRED/)
  await db.exec('drop function attacker.unknown_invoker(); alter policy original_0 on fixture.policy_is_org_member to public')
  await rejected(db, migration06, /INTERNAL_EXECUTE_POLICY_REVIEW_REQUIRED/)
  await db.exec(`alter policy original_0 on fixture.policy_is_org_member to authenticated;
    create view fixture.unknown_view as select public.is_org_member('${uuid(11)}') allowed`)
  await rejected(db, migration06, /INTERNAL_EXECUTE_OTHER_DEPENDENCY_REVIEW_REQUIRED/)
  await db.exec('drop view fixture.unknown_view')
  const before = await state(db)
  await db.exec(migration06)
  const after = await state(db)
  for (let index = 0; index < before.length; index++) {
    const old = structuredClone(before[index]), next = structuredClone(after[index])
    if (fixture.helperDependencies.some(helper => helper.name === old.name)) {
      delete old.metadata.proacl; delete next.metadata.proacl
      const access = (await db.query(`select has_function_privilege('anon',${quote(next.id)}::oid,'execute') anon,
        has_function_privilege('authenticated',${quote(next.id)}::oid,'execute') auth,
        has_function_privilege('service_role',${quote(next.id)}::oid,'execute') service,
        has_function_privilege('postgres',${quote(next.id)}::oid,'execute') owner`)).rows[0]
      equal(access, { anon: false, auth: old.name !== 'task_access_link_covers', service: true, owner: true })
    }
    equal(next, old, `Only reviewed helper ACL changed: ${old.name}`)
  }
  for (const helper of fixture.helperDependencies.filter(helper => helper.policyCount)) {
    const query = helper.identity.endsWith('(uuid)') ? `select public.${helper.name}('${uuid(11)}')` : `select public.${helper.identity}`
    await assert.rejects(roleSession(db, tx => tx.query(query), '', 'anon'), error => error.code === '42501')
    checks++
  }
  await denied(db, `select public.task_access_link_covers('${uuid(811)}','${uuid(701)}','${uuid(801)}')`, '42501')
  await testHelperBehavior(db)
  const repeat = await state(db)
  await db.exec(migration06)
  equal(await state(db), repeat, 'Helper EXECUTE migration is repeat-safe')
}

async function testExactArtifact() {
  const expected = [migration04, migration05, migration06].map(sql => sql.split(/\r?\n/)
    .filter(line => line.trim() && !line.trimStart().startsWith('--')).map(line => line.trim()).join('\n')).join('\n\n') + '\n'
  equal(execution, expected, 'Execution artifact must match the reviewed source without comment/blank lines')
  const db = new PGlite()
  try {
    await setup(db)
    const before = await state(db)
    await db.exec(execution)
    const after = await state(db)
    for (let index = 0; index < before.length; index++) {
      const old = structuredClone(before[index]), next = structuredClone(after[index])
      if (fixture.searchPathFunctions.some(identity => identity.startsWith(`${old.name}(`))) {
        equal(next.metadata.proconfig, ['search_path=pg_catalog, pg_temp'])
        delete old.metadata.proconfig; delete next.metadata.proconfig
        delete old.definition; delete next.definition
      }
      if (fixture.triggerExecuteFunctions.some(identity => identity.startsWith(`${old.name}(`)) || fixture.helperDependencies.some(helper => helper.name === old.name)) {
        delete old.metadata.proacl; delete next.metadata.proacl
      }
      equal(next, old, `Exact artifact preserves every other function property: ${old.name}`)
    }
    await testBehavior(db)
    await testHelperBehavior(db)
  } finally { await db.close() }
}

const db = new PGlite()
try {
  await setup(db)
  await testPaths(db)
  await testBehavior(db)
  await testTriggerExecute(db)
  await testHelperExecute(db)
  if (execution) await testExactArtifact()
  const result = { passed: true, checks, postgresVersion: version, functionsExercised: [...covered].sort(),
    syntheticOnly: true, fixtureSha256: hash(JSON.stringify(fixture)), sourceSha256: [migration04, migration05, migration06].map(hash),
    limitations: ['PGlite WIN1252 conversion is unavailable; mojibake non-null behavior is covered by separate read-only literal PostgreSQL17 probes.'],
    executionArtifact: process.argv[2] ?? null, executionSha256: execution ? hash(execution) : null, verifiedAt: new Date().toISOString() }
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n')
  console.log(`Function hardening: ${checks} checks passed; ${covered.size} real function bodies exercised in synthetic PostgreSQL ${version}.`)
  if (execution) console.log(`Execution artifact SHA256: ${hash(execution)}`)
} catch (error) {
  console.error(`Function hardening failed after ${checks} checks: ${error.message.slice(0, 1500)}`)
  const cause = error.actual ?? error
  console.error(JSON.stringify({ code: cause.code, position: cause.position, context: cause.where }))
  process.exitCode = 1
} finally { await db.close() }
