import assert from 'node:assert/strict'
import { before, after, beforeEach, afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import type { FlowNode } from '../src/lib/renoapp/flowEditor'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const commonModule = { exports: {} } as { exports: typeof import('../src/lib/renoapp/flowEditor') }
new Function('module', 'exports', ts.transpileModule(read('src/lib/renoapp/flowEditor.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(commonModule, commonModule.exports)
const { canDropFlowNode, flattenFlow, flowSubtreeIds, flowTarget, parseFlowMove } = commonModule.exports
const sql = read('docs/db/2026-09-08_03_renoapp_flow_editor.sql')
const db = new PGlite()
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table renovation_action_types (id uuid primary key default gen_random_uuid(), label text, is_active boolean default true);
    create table renovation_document_types (id uuid primary key default gen_random_uuid(), label text, default_phase text default 'before_required', is_active boolean default true);
    create table renoapp_participant_roles (id uuid primary key default gen_random_uuid(), label text, is_active boolean default true);
    create table renoapp_review_flags (id uuid primary key default gen_random_uuid(), label text, is_active boolean default true);
    create table renoapp_apply_questions (id uuid primary key default gen_random_uuid(), label text, is_active boolean default true);
    create table renoapp_apply_question_options (id uuid primary key default gen_random_uuid(), question_id uuid references renoapp_apply_questions, label text, is_active boolean default true);
    create table renoapp_action_type_questions (id uuid primary key default gen_random_uuid(), action_type_id uuid references renovation_action_types,
      question_id uuid references renoapp_apply_questions, is_required boolean default true, sort_order integer default 100, is_active boolean default true,
      unique(action_type_id, question_id));
    create table renovation_action_document_requirements (id uuid primary key default gen_random_uuid(), action_type_id uuid references renovation_action_types,
      document_type_id uuid references renovation_document_types, brf_id uuid, is_required boolean default true, note text, phase text default 'before_required', sort_order integer default 100);
    create unique index requirements_unique on renovation_action_document_requirements (coalesce(brf_id, '${id(0)}'), action_type_id, document_type_id);
    create table renoapp_action_type_participant_roles (id uuid primary key default gen_random_uuid(), action_type_id uuid references renovation_action_types,
      participant_role_id uuid references renoapp_participant_roles, is_required boolean default true, sort_order integer default 100, is_active boolean default true,
      unique(action_type_id, participant_role_id));
    create table renoapp_apply_option_triggers (id uuid primary key default gen_random_uuid(), option_id uuid references renoapp_apply_question_options,
      trigger_type text, question_id uuid references renoapp_apply_questions, document_type_id uuid references renovation_document_types,
      participant_role_id uuid references renoapp_participant_roles, review_flag_id uuid references renoapp_review_flags, sort_order integer default 100, is_active boolean default true);
    create unique index trigger_doc on renoapp_apply_option_triggers (option_id,document_type_id) where document_type_id is not null;
    create unique index trigger_question on renoapp_apply_option_triggers (option_id,question_id) where question_id is not null;
    create table renoapp_review_flag_links (id uuid primary key default gen_random_uuid(), review_flag_id uuid references renoapp_review_flags,
      action_type_id uuid references renovation_action_types, document_type_id uuid references renovation_document_types,
      participant_role_id uuid references renoapp_participant_roles, sort_order integer default 100, is_active boolean default true);
    create table renovation_cases (id uuid primary key, title text, documents jsonb);
  `)
  await db.exec(sql)
  await db.exec(sql)
})
after(() => db.close())
beforeEach(async () => {
  await db.exec(`begin;
    insert into renovation_action_types values ('${id(1)}','Wall',true), ('${id(2)}','Kitchen',true);
    insert into renovation_document_types (id,label) values ('${id(3)}','Drawing');
    insert into renoapp_participant_roles (id,label) values ('${id(4)}','Engineer');
    insert into renoapp_review_flags (id,label) values ('${id(5)}','Check');
    insert into renoapp_apply_questions (id,label) values ('${id(6)}','Water?'), ('${id(7)}','Second question');
    insert into renoapp_apply_question_options (id,question_id,label) values ('${id(8)}','${id(6)}','Yes'), ('${id(9)}','${id(6)}','No'), ('${id(10)}','${id(7)}','Yes');
    insert into renoapp_action_type_questions (id,action_type_id,question_id) values ('${id(11)}','${id(1)}','${id(6)}');
    insert into renovation_action_document_requirements (id,action_type_id,document_type_id) values ('${id(12)}','${id(1)}','${id(3)}');
    insert into renoapp_action_type_participant_roles (id,action_type_id,participant_role_id) values ('${id(13)}','${id(1)}','${id(4)}');
    insert into renoapp_review_flag_links (id,action_type_id,review_flag_id) values ('${id(14)}','${id(1)}','${id(5)}');
    insert into renovation_cases values ('${id(20)}','Existing case','{"uploaded": true}');
  `)
})
afterEach(async () => { await db.exec('rollback') })

async function move(kind: string, sourceId: string, parentId: string, targetKind: string, targetId: string, version?: string) {
  const result = await db.query<{ result: { version: string; saved?: boolean; shared: boolean } }>(
    'select renoapp_move_flow_connection($1,$2,$3,$4,$5,$6,$7) as result',
    [kind, sourceId, parentId, targetKind, targetId, version ?? null, Boolean(version)])
  return result.rows[0].result
}

test('preview does not mutate, move preserves the child and existing case data', async () => {
  const preview = await move('action_document', id(12), id(1), 'option', id(8))
  assert.equal(preview.shared, true)
  assert.equal((await db.query('select * from renovation_action_document_requirements')).rows.length, 1)
  const result = await move('action_document', id(12), id(1), 'option', id(8), preview.version)
  assert.equal(result.saved, true)
  assert.equal((await db.query('select * from renovation_action_document_requirements')).rows.length, 0)
  assert.deepEqual((await db.query('select option_id,document_type_id from renoapp_apply_option_triggers')).rows, [{ option_id: id(8), document_type_id: id(3) }])
  assert.deepEqual((await db.query('select title,documents from renovation_cases')).rows, [{ title: 'Existing case', documents: { uploaded: true } }])
  assert.equal((await db.query('select * from renovation_document_types')).rows.length, 1)
})

test('moving from Yes to No preserves the entire multi-level descendant branch', async () => {
  await db.exec(`insert into renoapp_apply_option_triggers (id,option_id,trigger_type,question_id) values ('${id(21)}','${id(8)}','question','${id(7)}');
    insert into renoapp_apply_option_triggers (id,option_id,trigger_type,document_type_id) values ('${id(22)}','${id(10)}','document','${id(3)}');
    insert into renoapp_apply_questions (id,label) values ('${id(40)}','Third question');
    insert into renoapp_apply_question_options (id,question_id,label) values ('${id(41)}','${id(40)}','Yes');
    insert into renoapp_apply_option_triggers (id,option_id,trigger_type,question_id) values ('${id(42)}','${id(10)}','question','${id(40)}');
    insert into renoapp_apply_option_triggers (id,option_id,trigger_type,participant_role_id) values ('${id(43)}','${id(41)}','participant','${id(4)}');`)
  const descendants = async () => (await db.query('select * from renoapp_apply_option_triggers where option_id in ($1,$2) order by id',[id(10),id(41)])).rows
  const before = await descendants()
  const optionsBefore = (await db.query('select * from renoapp_apply_question_options order by id')).rows
  const preview = await move('option_trigger', id(21), id(8), 'option', id(9))
  await move('option_trigger', id(21), id(8), 'option', id(9), preview.version)
  assert.equal((await db.query('select * from renoapp_apply_option_triggers where option_id=$1 and question_id=$2',[id(9),id(7)])).rows.length, 1)
  assert.deepEqual(await descendants(),before)
  assert.deepEqual((await db.query('select * from renoapp_apply_question_options order by id')).rows,optionsBefore)
})

for (const [kind, sourceId, targetKind, targetId] of [
  ['action_question', 11, 'option', 10], ['action_participant', 13, 'option', 8],
  ['flag_link', 14, 'option', 8], ['flag_link', 14, 'document', 3], ['flag_link', 14, 'participant', 4],
  ['action_question', 11, 'action', 2], ['action_document', 12, 'action', 2], ['action_participant', 13, 'action', 2], ['flag_link', 14, 'action', 2],
] as const) test(`moves ${kind} to ${targetKind}`, async () => {
  const preview = await move(kind,id(sourceId),id(1),targetKind,id(targetId))
  await move(kind,id(sourceId),id(1),targetKind,id(targetId),preview.version)
  assert.equal((await db.query('select * from renoapp_flow_connections where parent_kind=$1 and parent_id=$2',[targetKind,id(targetId)])).rows.length, 1)
})

test('move back from an answer uses document defaults and preserves sibling triggers', async () => {
  await db.exec(`delete from renovation_action_document_requirements;
    update renovation_document_types set default_phase='after_completion';
    insert into renoapp_apply_option_triggers (id,option_id,trigger_type,document_type_id) values ('${id(21)}','${id(8)}','document','${id(3)}');`)
  const preview = await move('option_trigger',id(21),id(8),'action',id(1))
  await move('option_trigger',id(21),id(8),'action',id(1),preview.version)
  assert.deepEqual((await db.query('select phase,is_required from renovation_action_document_requirements')).rows,[{phase:'after_completion',is_required:true}])
})

for (const mutation of ["note='Special note'", 'is_required=false', "phase='after_completion'"]) {
  test(`does not silently lose custom requirement settings: ${mutation}`, async () => {
    await db.exec(`update renovation_action_document_requirements set ${mutation}`)
    await assert.rejects(move('action_document',id(12),id(1),'option',id(8)), /FLOW_MOVE_CUSTOM_SETTINGS/)
  })
}

test('duplicate, invalid target and stale source are rejected', async () => {
  await db.exec(`insert into renoapp_apply_option_triggers (option_id,trigger_type,document_type_id) values ('${id(8)}','document','${id(3)}')`)
  await assert.rejects(move('action_document',id(12),id(1),'option',id(8)), /FLOW_MOVE_DUPLICATE/)
})
test('invalid target is rejected', async () => {
  await assert.rejects(move('action_document',id(12),id(1),'participant',id(4)), /FLOW_MOVE_INVALID_TARGET/)
})
test('an old source ID cannot move a replacement connection', async () => {
  await assert.rejects(move('action_question',id(11),id(2),'option',id(10)), /FLOW_MOVE_STALE/)
})
test('direct self-cycle is rejected', async () => {
  await assert.rejects(move('action_question',id(11),id(1),'option',id(8)), /FLOW_MOVE_CYCLE/)
})
test('indirect cycle across shared questions is rejected', async () => {
  await db.exec(`insert into renoapp_apply_option_triggers (option_id,trigger_type,question_id) values ('${id(8)}','question','${id(7)}')`)
  await assert.rejects(move('action_question',id(11),id(1),'option',id(10)), /FLOW_MOVE_CYCLE/)
})
test('a change between preview and apply prevents the move', async () => {
  const preview = await move('action_document',id(12),id(1),'option',id(8))
  await db.exec("update renoapp_apply_questions set label='Changed question'")
  await assert.rejects(move('action_document',id(12),id(1),'option',id(8),preview.version), /FLOW_MOVE_STALE/)
})
test('insert and delete roll back together on a failure', async () => {
  await db.exec(`create function refuse_flow_delete() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
    create trigger refuse_delete before delete on renovation_action_document_requirements for each row execute function refuse_flow_delete();`)
  const preview = await move('action_document',id(12),id(1),'option',id(8))
  await db.exec('savepoint before_move')
  await assert.rejects(move('action_document',id(12),id(1),'option',id(8),preview.version), /test failure/)
  await db.exec('rollback to savepoint before_move')
  assert.equal((await db.query('select * from renoapp_apply_option_triggers')).rows.length,0)
  assert.equal((await db.query('select * from renovation_action_document_requirements')).rows.length,1)
})
test('database entry points are not granted to browser roles', async () => {
  for (const role of ['anon','authenticated']) {
    assert.equal((await db.query<{allowed:boolean}>(`select has_function_privilege('${role}', 'renoapp_move_flow_connection(text,uuid,uuid,text,uuid,text,boolean)', 'execute') as allowed`)).rows[0].allowed,false)
    assert.equal((await db.query<{allowed:boolean}>(`select has_table_privilege('${role}', 'renoapp_flow_connections', 'select') as allowed`)).rows[0].allowed,false)
  }
})

test('shared graph occurrences get distinct IDs; invalid card targets are excluded', () => {
  const node = (name: string, children: FlowNode[] = []): FlowNode => ({ id:name, kind:'question', title:name, badges:[], tone:'stone', children, ref:{type:'question',questionId:name} })
  const shared = node('shared',[node('child')])
  const rows = flattenFlow(node('root',[node('a',[shared]),node('b',[shared])]),['a','b','shared'])
  assert.equal(rows.length,7)
  assert.equal(new Set(rows.map(row=>row.id)).size,7)
  const branch = rows.find(row => row.node.id === 'a')!
  const subtree = flowSubtreeIds(rows, branch.id)
  assert.equal(subtree.size, 3)
  assert.ok(rows.filter(row => subtree.has(row.id)).every(row => !row.id.includes('"b"')))
  assert.equal(flattenFlow(node('root',[node('a',[shared]),node('b',[shared])]),null).length,7)
  const source: FlowNode = {...node('document'),kind:'document',ref:{type:'rootRequirement',actionTypeId:id(1),documentTypeId:id(3)},source:{kind:'action_document',id:id(12),parentId:id(1)}}
  const answer: FlowNode = {...node('answer'),kind:'option',ref:{type:'option',questionId:id(6),optionId:id(8)}}
  assert.equal(canDropFlowNode(source,answer),true)
  assert.equal(canDropFlowNode(answer,source),false)
  assert.deepEqual(flowTarget(answer),{kind:'option',id:id(8)})
})

test('request parsing rejects missing confirmation and invalid source types', () => {
  const body={source:{kind:'action_document',id:id(12),parentId:id(1)},target:{kind:'option',id:id(8)}}
  assert.equal(parseFlowMove(body).apply,false)
  assert.throws(()=>parseFlowMove({...body,apply:true}),/FLOW_MOVE_INVALID/)
  assert.throws(()=>parseFlowMove({...body,apply:'false'}),/FLOW_MOVE_INVALID/)
  assert.throws(()=>parseFlowMove({...body,source:{...body.source,kind:'renovation_cases'}}),/FLOW_MOVE_INVALID/)
})

test('route authorizes before RPC and sends preview/apply to the transactional function', async () => {
  const require=createRequire(import.meta.url)
  const routeModule={exports:{}} as {exports:typeof import('../src/app/api/renoapp/admin/flow-move/route')}
  let denied: string | null='MODULE_ACCESS_REQUIRED', calls=0, rpcError: unknown=null
  const dependencies: Record<string,unknown>={
    'next/server':require('next/server'), '@/lib/renoapp/flowEditor':{parseFlowMove},
    '@/lib/renoapp/brfAdminAccess':{requireBrfAdminContext:async()=>{if(denied)throw new Error(denied)}},
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>({rpc:async(name:string,args:Record<string,unknown>)=>{
      calls++; assert.equal(name,'renoapp_move_flow_connection'); assert.equal(args.p_apply,false)
      return {data:{version:'abc'},error:rpcError}
    }})},
  }
  const compiled=ts.transpileModule(read('src/app/api/renoapp/admin/flow-move/route.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in dependencies);return dependencies[name]},routeModule,routeModule.exports)
  const request=()=>new Request('http://localhost/api/renoapp/admin/flow-move',{method:'POST',body:JSON.stringify({source:{kind:'action_document',id:id(12),parentId:id(1)},target:{kind:'option',id:id(8)}})})
  assert.equal((await routeModule.exports.POST(request())).status,403); assert.equal(calls,0)
  denied=null
  assert.equal((await routeModule.exports.POST(request())).status,200); assert.equal(calls,1)
  rpcError={code:'PGRST202',message:'missing function'}
  assert.equal((await routeModule.exports.POST(request())).status,503)
  rpcError={message:'FLOW_MOVE_STALE'}
  assert.equal((await routeModule.exports.POST(request())).status,409)
})
