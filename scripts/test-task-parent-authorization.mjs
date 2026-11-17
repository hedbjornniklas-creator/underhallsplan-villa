// Focused regression against the real RPC source in synthetic PostgreSQL only.
// No environment files, production connections or production rows are used.
// Usage: node scripts/test-task-parent-authorization.mjs [execution.sql] [results.json]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const functions = JSON.parse(await readFile(new URL('../test/fixtures/function-hardening-before.json', import.meta.url), 'utf8')).functions
const schema = await readFile(new URL('../test/fixtures/task-parent-authorization.sql', import.meta.url), 'utf8')
const migration = await readFile(new URL('../docs/db/2026-11-17_07_task_parent_authorization.sql', import.meta.url), 'utf8')
const execution = process.argv[2] ? await readFile(process.argv[2], 'utf8') : migration
const sha = text => createHash('sha256').update(text).digest('hex')
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const uuid = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`
const org = uuid(11), foreignOrg = uuid(12)
const issuer = uuid(101), assignee = uuid(102), unrelated = uuid(103), orgAdmin = uuid(104)
const foreign = uuid(105), noModule = uuid(106), inactive = uuid(107)
const contact = uuid(201), otherContact = uuid(202), contactParent = uuid(301), profileParent = uuid(302)
const selected = ['is_org_member', 'has_operational_task_module_access', 'task_access_link_covers', 'create_operational_task']
  .map(name => functions.find(fn => fn.name === name))
assert(selected.every(Boolean), 'The reviewed helper and RPC definitions must be present')
const original = selected.find(fn => fn.name === 'create_operational_task')
const target = `public.${original.identity}`
let checks = 0, version
const equal = (a, b, message) => { assert.deepEqual(a, b, message); checks++ }

async function state(db) {
  return (await db.query(`select p.oid::text id,p.proname name,to_jsonb(p) metadata,
    pg_get_function_arguments(p.oid) arguments from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in(${selected.map(fn => quote(fn.name))}) order by p.oid`)).rows
}

async function rejected(db, pattern) {
  const before = await state(db)
  try { await assert.rejects(db.exec(execution), pattern) }
  finally { await db.exec('rollback') }
  equal(await state(db), before, 'Rejected migration must leave every helper and RPC unchanged')
}

function request({ parent = contactParent, organization = org, actorContact, link, actorProfile } = {}) {
  return `select * from public.create_operational_task(
    p_org_id=>${quote(organization)}::uuid,p_title=>'Synthetic authorization test',
    p_due_at=>'2090-01-01'::timestamptz,p_next_followup_at=>'2080-01-01'::timestamptz,
    p_primary_channel=>'in_app',p_task_kind=>'simple',p_evidence_requirement=>'optional',
    p_assignee_contact_id=>${quote(contact)}::uuid,p_parent_task_id=>${quote(parent)}::uuid,
    p_expected_parent_version=>1,
    p_requirements=>'[{"requirement_key":"fixture","label":"Synthetic requirement"}]'::jsonb
    ${actorContact ? `,p_actor_contact_id=>${quote(actorContact)}::uuid` : ''}
    ${link ? `,p_actor_access_link_id=>${quote(link)}::uuid` : ''}
    ${actorProfile ? `,p_actor_profile_id=>${quote(actorProfile)}::uuid` : ''})`
}

async function invoke(db, actor, options = {}, role = 'authenticated') {
  await db.exec(`begin;set local role ${role};set local "request.jwt.claim.sub"=${quote(actor ?? '')};
    set local "request.jwt.claim.role"=${quote(role)}`)
  try { return (await db.query(request(options))).rows[0] }
  finally { await db.exec('rollback') }
}

async function forbidden(db, actor, options, message, role) {
  const before = (await db.query('select (select count(*) from operational_tasks)::int tasks,(select count(*) from task_events)::int events,(select count(*) from task_requirements)::int requirements')).rows
  await assert.rejects(invoke(db, actor, options, role), error => error.code === (message === 'TASK_PARENT_NOT_FOUND' ? 'P0002' : '42501') && error.message.includes(message))
  checks++
  equal((await db.query('select (select count(*) from operational_tasks)::int tasks,(select count(*) from task_events)::int events,(select count(*) from task_requirements)::int requirements')).rows, before)
}

async function allowed(db, actor, options = {}, role) {
  const row = await invoke(db, actor, options, role)
  equal({ parent: row.parent_task_id, root: row.root_task_id, depth: row.depth, issuer: row.issuer_profile_id,
    contact: row.assignee_contact_id, profile: row.assignee_profile_id }, {
    parent: options.parent ?? contactParent, root: options.parent ?? contactParent, depth: 1,
    issuer: actor ?? issuer, contact, profile: null,
  })
  return row
}

async function setup(db) {
  version = (await db.query("select current_setting('server_version') version")).rows[0].version
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;revoke all on schema public,auth from public;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as
      $$select current_setting('request.jwt.claim.role',true)$$;`)
  await db.exec(schema)
  for (const fn of selected) {
    await db.exec(fn.definition)
    await db.exec(`revoke all on function public.${fn.identity} from public,anon,authenticated,service_role;
      grant execute on function public.${fn.identity} to service_role`)
    if (fn.name !== 'task_access_link_covers') await db.exec(`grant execute on function public.${fn.identity} to authenticated`)
  }
  const actors = [issuer, assignee, unrelated, orgAdmin, foreign, noModule, inactive]
  await db.exec(`insert into organizations values('${org}'),('${foreignOrg}');
    insert into profiles(id,full_name,email) values ${actors.map((id, index) => `('${id}','Synthetic ${index}','fixture${index}@example.test')`)};
    insert into org_members values
      ('${org}','${issuer}',true,'member'),('${org}','${assignee}',true,'member'),
      ('${org}','${unrelated}',true,'member'),('${org}','${orgAdmin}',true,'admin'),
      ('${foreignOrg}','${foreign}',true,'member'),('${org}','${noModule}',true,'member'),('${org}','${inactive}',false,'member');
    insert into organization_contacts values('${contact}','${org}','Synthetic contact',true),('${otherContact}','${org}','Other synthetic contact',true);
    insert into task_organization_settings(org_id) values('${org}'),('${foreignOrg}');
    insert into platform_products values('${uuid(501)}','dashboard',true);
    insert into platform_modules values('${uuid(502)}','${uuid(501)}','tasks',true);
    insert into platform_access_assignments(profile_id,product_id,module_id,is_active,scope_type)
      values ${actors.filter(id => id !== noModule).map(id => `('${id}','${uuid(501)}','${uuid(502)}',true,'global')`)};
    insert into operational_tasks(id,org_id,root_task_id,issuer_profile_id,assignee_contact_id,title,due_at,next_followup_at)
      values('${contactParent}','${org}','${contactParent}','${issuer}','${contact}','Synthetic contact parent','2100-01-01','2095-01-01');
    insert into operational_tasks(id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,title,due_at,next_followup_at)
      values('${profileParent}','${org}','${profileParent}','${issuer}','${assignee}','Synthetic profile parent','2100-01-01','2095-01-01');
    insert into task_access_links values('${uuid(401)}','${org}','${contactParent}','${contact}','${contactParent}',
      'delegator','branch',null,'2100-01-01');`)
  const hashes = (await db.query(`select md5(prosrc) source,md5(pg_get_function_arguments(oid)) arguments
    from pg_proc where oid=${quote(target)}::regprocedure`)).rows[0]
  equal(hashes, { source: '3d5d27e3cf99f352a9e9ed3864e368f2', arguments: '45f01a3107680c59a84ea3f741d7833f' })
}

const db = new PGlite()
try {
  if (process.argv[2]) equal(execution, migration.split(/\r?\n/).filter(line => line.trim() && !line.trimStart().startsWith('--')).map(line => line.trim()).join('\n') + '\n')
  await setup(db)
  // Reproduce the exact bug using the unchanged real RPC and real module helper:
  // a valid active member with module access can create under a contact parent.
  await allowed(db, unrelated)
  await forbidden(db, unrelated, { parent: profileParent }, 'TASK_SUBTASK_CREATE_FORBIDDEN')
  const drift = original.definition.replace(/\$function\$\s*$/, '-- synthetic drift\n$function$')
  await db.exec(drift)
  await rejected(db, /TASK_PARENT_AUTHORIZATION_FUNCTION_REVIEW_REQUIRED/)
  await db.exec(original.definition)
  await db.exec(`grant execute on function ${target} to anon`)
  await rejected(db, /TASK_PARENT_AUTHORIZATION_ACL_REVIEW_REQUIRED/)
  await db.exec(`revoke execute on function ${target} from anon;alter table operational_tasks alter column issuer_profile_id drop not null`)
  await rejected(db, /TASK_PARENT_AUTHORIZATION_SCHEMA_REVIEW_REQUIRED/)
  await db.exec('alter table operational_tasks alter column issuer_profile_id set not null')
  const before = await state(db)
  await db.exec(execution)
  const after = await state(db)
  for (let index = 0; index < before.length; index++) {
    const old = structuredClone(before[index]), next = structuredClone(after[index])
    if (old.name === 'create_operational_task') {
      const oldGuard = 'parent_row.issuer_profile_id <> effective_profile_id\r\n        and parent_row.assignee_profile_id <> effective_profile_id'
      const newGuard = 'parent_row.issuer_profile_id is distinct from effective_profile_id\r\n        and parent_row.assignee_profile_id is distinct from effective_profile_id'
      equal(next.metadata.prosrc, old.metadata.prosrc.replace(oldGuard, newGuard), 'Exactly the reviewed parent guard changes')
      delete old.metadata.prosrc; delete next.metadata.prosrc
      delete old.metadata.proargdefaults; delete next.metadata.proargdefaults
    }
    equal(next, old, 'OID, ACLs, defaults, flags, owner, configuration and every helper remain unchanged')
  }
  equal((await db.query(`select md5(prosrc) source from pg_proc where oid=${quote(target)}::regprocedure`)).rows[0],
    { source: 'e9567246777362890c7599bdd5d42f3b' })
  await forbidden(db, unrelated, {}, 'TASK_SUBTASK_CREATE_FORBIDDEN')
  await forbidden(db, unrelated, { parent: profileParent }, 'TASK_SUBTASK_CREATE_FORBIDDEN')
  await allowed(db, issuer)
  await allowed(db, issuer, { parent: profileParent })
  await allowed(db, assignee, { parent: profileParent })
  await allowed(db, orgAdmin)
  await forbidden(db, assignee, {}, 'TASK_SUBTASK_CREATE_FORBIDDEN')
  await forbidden(db, foreign, {}, 'TASK_ACTOR_NOT_IN_ORG')
  await forbidden(db, foreign, { organization: foreignOrg }, 'TASK_PARENT_NOT_FOUND')
  await forbidden(db, noModule, {}, 'TASK_MODULE_ACCESS_REQUIRED')
  await forbidden(db, inactive, {}, 'TASK_ACTOR_NOT_IN_ORG')
  await forbidden(db, unrelated, { actorProfile: issuer }, 'TASK_ACTOR_SPOOFING_FORBIDDEN')
  await forbidden(db, null, { actorContact: otherContact, link: uuid(401) }, 'TASK_EXTERNAL_DELEGATION_FORBIDDEN', 'service_role')
  await allowed(db, null, { actorContact: contact, link: uuid(401) }, 'service_role')
  const repeated = await state(db)
  await db.exec(execution)
  equal(await state(db), repeated, 'Exact corrected source is repeat-safe')
  const result = { passed: true, checks, postgresVersion: version, syntheticOnly: true,
    reproducedBefore: true, deniedAfter: true, legitimateIssuerAssigneeAdminPreserved: true,
    sourceSha256: sha(migration), executionSha256: sha(execution), schemaFixtureSha256: sha(schema), verifiedAt: new Date().toISOString() }
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n')
  console.log(`Task parent authorization: ${checks} checks passed; original vulnerability reproduced and corrected in synthetic PostgreSQL ${version}.`)
  console.log(`Execution artifact SHA256: ${sha(execution)}`)
} catch (error) {
  console.error(`Task parent authorization failed after ${checks} checks: ${error.message.slice(0, 1500)}`)
  const cause = error.actual ?? error
  console.error(JSON.stringify({ code: cause.code, position: cause.position, context: cause.where }))
  process.exitCode = 1
} finally { await db.close() }
