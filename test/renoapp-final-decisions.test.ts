import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'

const db = new PGlite()
const actor = randomUUID(), legacyCase = randomUUID(), legacyDecision = randomUUID()
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table renovation_cases(id uuid primary key, status text not null);
    create table renovation_case_decisions(id uuid primary key, case_id uuid references renovation_cases on delete cascade,
      decision text, reason text, conditions text, decided_by uuid, decided_at timestamptz default now(),
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table renovation_case_messages(id uuid default gen_random_uuid(), case_id uuid references renovation_cases on delete cascade,
      type text, author_role text, author_profile_id uuid, message text, metadata jsonb);
  `)
  await db.query("insert into renovation_cases values($1,'approved')", [legacyCase])
  await db.query("insert into renovation_case_decisions(id,case_id,decision,reason) values($1,$2,'approved','Legacy reason')", [legacyDecision, legacyCase])
  await db.exec(read('docs/db/2026-10-08_01_renoapp_final_decisions.sql'))
})
after(() => db.close())
async function fixture(status = 'review') {
  const id = randomUUID()
  await db.query('insert into renovation_cases values($1,$2)', [id, status])
  return id
}
async function decide(caseId: string, status = 'approved', reason = 'Board assessment', conditions: string | null = null, id = randomUUID()) {
  await db.query('select renoapp_record_final_decision($1,$2,$3,$4,$5,$6)', [caseId,id,status,reason,conditions,actor])
  return id
}

test('approval, conditional approval and rejection are atomic, final and idempotent', async () => {
  for (const status of ['approved','conditional','rejected']) {
    const caseId = await fixture('need_info')
    const conditions = status === 'conditional' ? 'Before starting' : null
    const id = await decide(caseId,status,'Reason',conditions)
    await decide(caseId,status,'Reason',conditions,id)
    assert.equal((await db.query('select * from renovation_case_decisions where case_id=$1',[caseId])).rows.length, 1)
    assert.equal((await db.query('select * from renovation_case_messages where case_id=$1',[caseId])).rows.length, 1)
    assert.equal((await db.query<{status:string}>('select status from renovation_cases where id=$1',[caseId])).rows[0].status,status)
    await assert.rejects(decide(caseId,status,'Changed',conditions,id), /CASE_DECISION_LOCKED/)
    await assert.rejects(decide(caseId,status,'Reason',conditions), /CASE_DECISION_LOCKED/)
    for (const next of ['review','need_info','new_application','approved','conditional','rejected','draft'].filter(s=>s!==status)) {
      await assert.rejects(db.query('update renovation_cases set status=$1 where id=$2',[next,caseId]), /CASE_DECISION_LOCKED/)
    }
    await assert.rejects(db.query("update renovation_case_decisions set reason='Changed' where id=$1",[id]), /CASE_DECISION_LOCKED/)
    await assert.rejects(db.query('delete from renovation_case_decisions where id=$1',[id]), /CASE_DECISION_LOCKED/)
    await assert.rejects(db.query("insert into renovation_case_decisions(id,case_id,decision) values($1,$2,'rejected')",[randomUUID(),caseId]), /CASE_DECISION_LOCKED/)
  }
})

test('invalid decisions and a failing history write cannot leave an approved status behind', async () => {
  const draft = await fixture('draft')
  await assert.rejects(decide(draft), /DRAFT_CASE_LOCKED/)
  const caseId = await fixture()
  await assert.rejects(decide(caseId,'approved',' '), /DECISION_REASON_REQUIRED/)
  await assert.rejects(decide(caseId,'conditional','Reason'), /DECISION_CONDITIONS_REQUIRED/)
  await db.exec(`create function fail_decision_history() returns trigger language plpgsql as $$
    begin raise exception 'SIMULATED_HISTORY_FAILURE'; end $$;
    create trigger fail_history before insert on renovation_case_messages for each row execute function fail_decision_history();`)
  try { await assert.rejects(decide(caseId), /SIMULATED_HISTORY_FAILURE/) }
  finally { await db.exec('drop trigger fail_history on renovation_case_messages;') }
  assert.equal((await db.query<{status:string}>('select status from renovation_cases where id=$1',[caseId])).rows[0].status,'review')
  assert.equal((await db.query('select * from renovation_case_decisions where case_id=$1',[caseId])).rows.length,0)
})

test('legacy decisions are preserved, payload is immutable, delivery updates do not reopen decisions', async () => {
  const row = (await db.query<{delivery_status:string;reason:string}>('select * from renovation_case_decisions where id=$1',[legacyDecision])).rows[0]
  assert.equal(row.delivery_status,'unknown')
  assert.equal(row.reason,'Legacy reason')
  await assert.rejects(decide(legacyCase), /CASE_DECISION_LOCKED/)
  await db.query(`update renovation_case_decisions set email_payload='{"text":"first mail"}', delivery_status='failed' where id=$1`,[legacyDecision])
  await assert.rejects(db.query(`update renovation_case_decisions set email_payload='{"text":"changed"}' where id=$1`,[legacyDecision]), /DECISION_EMAIL_PAYLOAD_LOCKED/)
  await db.query("update renovation_case_decisions set delivery_status='sent', provider_message_id='provider-id' where id=$1",[legacyDecision])
  await assert.rejects(db.query("update renovation_case_decisions set delivery_status='failed' where id=$1",[legacyDecision]), /DECISION_EMAIL_ALREADY_SENT/)
  assert.equal((await db.query<{status:string}>('select status from renovation_cases where id=$1',[legacyCase])).rows[0].status,'approved')
})

test('case deletion still cascades, but cannot be used to remove only a decision', async () => {
  const caseId = await fixture()
  await decide(caseId)
  await db.query('delete from renovation_cases where id=$1',[caseId])
  assert.equal((await db.query('select * from renovation_case_decisions where case_id=$1',[caseId])).rows.length,0)
})

test('two competing decisions leave exactly one decision and one history event', async () => {
  const caseId = await fixture()
  const results = await Promise.allSettled([decide(caseId,'approved'),decide(caseId,'rejected')])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(results.filter(r=>r.status==='rejected').length,1)
  assert.equal((await db.query('select * from renovation_case_decisions where case_id=$1',[caseId])).rows.length,1)
  assert.equal((await db.query('select * from renovation_case_messages where case_id=$1',[caseId])).rows.length,1)
})

test('browser roles cannot access mail snapshots or invoke the decision transaction directly', async () => {
  await db.exec('set role authenticated;')
  try {
    await assert.rejects(db.query('select email_payload from renovation_case_decisions'), /permission denied/)
    await assert.rejects(decide(legacyCase), /permission denied/)
  } finally { await db.exec('reset role;') }
})

function mailFixture() {
  const row: Record<string, unknown> = { id:'decision',case_id:'case',decision:'approved',reason:'Reason',delivery_status:'pending',email_payload:null }
  const sent: Array<Record<string,unknown>> = []
  let fail = true
  const admin = { from: () => {
    let values: Record<string,unknown> | undefined
    const filters: Array<() => boolean> = []
    const execute = async () => {
      if (!filters.every(f=>f())) return { data:null,error:null }
      if (values) Object.assign(row,values)
      return { data:{...row},error:null }
    }
    const q = { select:()=>q, update:(v:Record<string,unknown>)=>{values=v;return q},
      eq:(k:string,v:unknown)=>{filters.push(()=>row[k]===v);return q},
      neq:(k:string,v:unknown)=>{filters.push(()=>row[k]!==v);return q},
      is:(k:string,v:unknown)=>{filters.push(()=>row[k]===v);return q},
      single:execute, maybeSingle:execute,
      then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>execute().then(resolve,reject),
    }
    return q
  } }
  const compiledModule = {exports:{} as {deliverDecisionEmail: (caseId:string,decisionId:string,prepare:()=>Promise<object>)=>Promise<void>}}
  const code = ts.transpileModule(read('src/lib/renoapp/decisionDelivery.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('require','exports',code)((name:string)=> {
    if (name.includes('supabase')) return {createSupabaseAdminClient:()=>admin}
    return {sendAssignmentEmail:async (mail:Record<string,unknown>)=>{
      sent.push(mail); if(fail) throw new Error('SIMULATED_PROVIDER_FAILURE')
      return {providerMessageId:'provider-id'}
    }}
  },compiledModule.exports)
  let prepared = 0
  return {row,sent,recover:()=>{fail=false},prepared:()=>prepared,
    deliver:()=>compiledModule.exports.deliverDecisionEmail('case','decision',async()=>{
      prepared++; return {to:'test@example.test',text:'Decision: approved; reason: Reason',html:'<p>Decision</p>'}
    })}
}

test('failed mail retries the identical saved payload, records acceptance and then stops sending', async () => {
  const f = mailFixture()
  await f.deliver()
  assert.equal(f.row.delivery_status,'failed')
  assert.match(String(f.row.delivery_error),/sparat och låst/)
  f.recover()
  await f.deliver()
  assert.equal(f.row.delivery_status,'sent')
  assert.equal(f.row.provider_message_id,'provider-id')
  assert.equal(f.prepared(),1)
  assert.deepEqual(f.sent[0],f.sent[1])
  assert.equal(f.sent[0].idempotencyKey,'renoapp-decision-decision')
  await f.deliver()
  assert.equal(f.sent.length,2)
  assert.equal(f.row.reason,'Reason')
})
