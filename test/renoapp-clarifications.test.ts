import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
// @ts-expect-error Node strip-types requires extensions.
import { rulesAcceptanceFields } from '../src/lib/renoapp/renovationRules.ts'
// @ts-expect-error Node strip-types requires extensions.
import { MUNICIPAL_QUESTION_KEY, clarificationItems, clarificationAnswerError, parseClarificationAnswers, type Clarification } from '../src/lib/renoapp/clarifications.ts'
// @ts-expect-error Node strip-types requires extensions.
import { completionMessage } from '../src/lib/renoapp/completion.ts'

const db = new PGlite()
const q = randomUUID(), yes = randomUUID(), no = randomUUID(), otherQ = randomUUID(), otherOption = randomUUID()
let unknown: string
const read = (name: string) => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
const foundation = read('2026-09-16_01_renoapp_clarifications.sql')
const pilot = read('2026-09-16_02_renoapp_municipal_clarification_pilot.sql')
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key);
    create table brf_associations(id uuid primary key);
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table renovation_cases(id uuid primary key, status text not null, applicant_contact_id uuid,
      brf_id uuid references brf_associations, description text, updated_at timestamptz default now());
    create table renovation_document_types(id uuid primary key, label text);
    create table renoapp_participant_roles(id uuid primary key, label text);
    create table renovation_case_messages(id uuid primary key default gen_random_uuid(), case_id uuid references renovation_cases on delete cascade,
      type text, author_role text, author_profile_id uuid, author_contact_id uuid, message text, metadata jsonb, created_at timestamptz default now());
    create table renoapp_case_requirement_decisions(case_id uuid references renovation_cases on delete cascade, document_type_id uuid, participant_role_id uuid, decision text);
    create table renoapp_case_participants(id uuid primary key default gen_random_uuid(), case_id uuid references renovation_cases on delete cascade,
      participant_role_id uuid, company_name text, org_number text, contact_name text, email text, phone text, certification_reference text,
      has_verified_authorization boolean, accepts_responsibility boolean);
    create table case_access_links(case_id uuid references renovation_cases on delete cascade, token_hash text unique,
      revoked_at timestamptz, expires_at timestamptz, scope text default 'answer_questions');
    create table renovation_case_documents(id uuid primary key default gen_random_uuid(), case_id uuid references renovation_cases on delete cascade,
      document_type_id uuid, participant_role_id uuid);
    create table renoapp_apply_questions(id uuid primary key, key text unique, label text, help_text text, is_active boolean);
    create table renoapp_apply_question_options(id uuid primary key default gen_random_uuid(), question_id uuid references renoapp_apply_questions,
      key text, label text, description text, sort_order integer, is_active boolean, unique(question_id,key));
    create table renoapp_case_question_answers(case_id uuid references renovation_cases on delete cascade, question_id uuid references renoapp_apply_questions,
      option_id uuid references renoapp_apply_question_options, unique(case_id,question_id,option_id));
  `)
  await db.query('insert into renoapp_apply_questions values($1,$2,$3,null,true),($4,$5,$6,null,true)', [q,MUNICIPAL_QUESTION_KEY,'Kommunens besked?',otherQ,'other','Other'])
  await db.query("insert into renoapp_apply_question_options(id,question_id,key,label,sort_order,is_active) values($1,$2,'yes','Ja',10,true),($3,$2,'no','Nej',20,true),($4,$5,'needs_investigation','Other unknown',10,true)", [yes,q,no,otherOption,otherQ])
  await db.exec(read('2026-09-07_03_renoapp_completion_rounds.sql'))
  await db.exec(foundation)
  await db.exec(pilot)
  await db.exec(read('2026-09-07_02_renoapp_renovation_rules.sql'))
  unknown = (await db.query<{id:string}>("select id from renoapp_apply_question_options where question_id=$1 and key='needs_investigation'", [q])).rows[0].id
})
after(async () => { await db.close() })
async function fixture(status = 'submitted', option?: string) {
  const id = randomUUID(), token = randomUUID()
  await db.query('insert into renovation_cases(id,status,description) values($1,$2,$3)', [id,status,'Original scope'])
  await db.query("insert into case_access_links(case_id,token_hash,expires_at) values($1,$2,now()+interval '14 days')", [id,token])
  await db.query('insert into renoapp_case_question_answers values($1,$2,$3),($1,$4,$5)', [id,q,option ?? unknown,otherQ,otherOption])
  return {id,token}
}
async function row(id: string) {
  return (await db.query<Clarification>('select * from renoapp_case_clarifications where case_id=$1', [id])).rows[0]
}
async function review(id:string, action = 'request', note = '', revision?:number) {
  await db.query('select renoapp_review_clarification($1,$2,$3,$4,$5,$6)', [id,q,revision ?? (await row(id)).revision,action,note,randomUUID()])
}
async function publish(id:string, previous:string|null = null, items?:ReturnType<typeof clarificationItems>, requestId = randomUUID()) {
  const status = (await db.query<{status:string}>('select status from renovation_cases where id=$1', [id])).rows[0].status
  const selected = items ?? clarificationItems([await row(id)])
  await db.query('select renoapp_publish_completion_clarifications($1,$2,$3,$4,$5,$6,$7,$8)',
    [id,requestId,previous,status,randomUUID(),JSON.stringify(selected),'[]',completionMessage(selected,'Test message')])
  return requestId
}
async function save(f:{id:string;token:string}, request:string, answers:unknown, submit = true, revision = 0) {
  return (await db.query<{result:{revision:number;submitted:boolean}}>('select renoapp_save_completion_clarifications($1,$2,$3,$4,$5,$6,$7,$8) result',
    [f.id,request,f.token,revision,'[]','Comment',submit,JSON.stringify(answers)])).rows[0].result
}
const answer = (optionId:string, note = '') => ({[q]:{optionId,note}})
const status = async (id:string, s:string) => db.query('update renovation_cases set status=$2 where id=$1', [id,s])

test('only the pilot unknown is captured, including atomic draft publication; No stays No', async () => {
  const f = await fixture()
  assert.equal((await row(f.id)).state,'pending')
  assert.equal((await row(f.id)).original_answer,'Jag behöver undersöka detta')
  assert.equal((await row(f.id)).requested,false)
  assert.equal((await db.query('select * from renoapp_case_clarifications where case_id=$1',[f.id])).rows.length,1)
  assert.equal(await row((await fixture('submitted',no)).id),undefined)
  const draft = await fixture('draft')
  assert.equal(await row(draft.id),undefined)
  await status(draft.id,'submitted')
  assert.equal((await row(draft.id)).state,'pending')
})

test('pilot submission publishes rules consent and clarification atomically, including stale-rule rollback', async () => {
  const source = readFileSync(new URL('../src/lib/renoapp/server.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
  let block = ''
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node) && node.expression.getText(ast) === 'needsClarificationCapture') {
      block = node.thenStatement.getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(block, 'Missing actual server publication block')
  const js = ts.transpileModule(`return async () => ${block}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const publishCase = new Function('admin', 'acceptanceFields', 'nextStatus', 'caseId', js)
  const admin = { from(table: string) {
    assert.equal(table, 'renovation_cases')
    return { update(fields: Record<string, unknown>) {
      const filters: Record<string, unknown> = {}
      const query = {
        eq(key: string, value: unknown) { filters[key] = value; return query },
        select(value: string) { assert.equal(value, 'id'); return query },
        async single() {
          const entries = Object.entries(fields)
          const assignments = entries.map(([key], i) => `${key}=$${i + 1}`).join(',')
          const params = [...entries.map(([, value]) => value), filters.id, filters.status]
          const result = await db.query(`update renovation_cases set ${assignments} where id=$${params.length - 1} and status=$${params.length} returning id`, params)
          return { data: result.rows[0], error: null }
        },
      }
      return query
    } }
  } }
  for (const format of ['text', 'pdf', 'none']) {
    const association = randomUUID(), actor = randomUUID()
    await db.query('insert into profiles values($1)', [actor])
    await db.query('insert into brf_associations values($1)', [association])
    const content = format === 'none' ? null : format === 'text' ? { format, body: 'Test rules' }
      : { format, file_name: 'Rules.pdf', file_path: `${association}/published/test.pdf` }
    const version = (await db.query<{id:string|null}>('select renoapp_publish_brf_rules($1,$2,null,$3) id', [actor,association,content])).rows[0].id
    const f = await fixture('draft')
    await db.query('update renovation_cases set brf_id=$2 where id=$1', [f.id,association])
    const consent = rulesAcceptanceFields({ mode: 'submit', isCompletion: false, versionId: version,
      accepted: format !== 'none', applicantName: 'Systemtest', applicantEmail: 'test@example.test' })
    // Reproduce the initial draft write: its trigger intentionally removes consent.
    await db.query('update renovation_cases set rules_version_id=$2,rules_accepted_at=now() where id=$1', [f.id,version])
    assert.equal((await db.query<{rules_version_id:string|null}>('select rules_version_id from renovation_cases where id=$1', [f.id])).rows[0].rules_version_id,null)
    if (version) {
      await assert.rejects(publishCase(admin, {...consent, rules_version_id: randomUUID()}, 'submitted', f.id)(), /RULES_VERSION_CHANGED/)
      await assert.rejects(publishCase(admin, {...consent, rules_accepted_at: null}, 'submitted', f.id)(), /RULES_ACCEPTANCE_REQUIRED/)
      assert.equal(await row(f.id),undefined)
    }
    await publishCase(admin, consent, 'submitted', f.id)()
    const receipt = (await db.query<{status:string;rules_version_id:string|null;rules_checked_at:string}>('select status,rules_version_id,rules_checked_at from renovation_cases where id=$1', [f.id])).rows[0]
    assert.equal(receipt.status,'submitted')
    assert.equal(receipt.rules_version_id,version)
    assert.ok(receipt.rules_checked_at)
    assert.equal((await row(f.id)).state,'pending')
    await assert.rejects(status(f.id,'approved'), /CLARIFICATION_REVIEW_REQUIRED/)
  }
})

test('open uncertainty blocks both approval types, not rejection, and requires explicit motivated assessment', async () => {
  const f = await fixture()
  for (const s of ['approved','conditional','approved_with_conditions']) await assert.rejects(status(f.id,s), /CLARIFICATION_REVIEW_REQUIRED/)
  await assert.rejects(review(f.id,'resolve','Reviewed'), /CLARIFICATION_REVIEW_REQUIRED/)
  await assert.rejects(review(f.id,'not_relevant',' '), /CLARIFICATION_NOTE_REQUIRED/)
  await review(f.id,'not_relevant','Municipal question does not apply to this work')
  await status(f.id,'approved')
  assert.equal((await row(f.id)).review_note,'Municipal question does not apply to this work')
  await status((await fixture()).id,'rejected')
})

test('board choices send nothing until published, freeze the request and reject stale revisions', async () => {
  const f = await fixture()
  await review(f.id)
  const selected = clarificationItems([await row(f.id)])
  assert.equal((await db.query("select * from renovation_case_messages where case_id=$1 and type='request_for_info'",[f.id])).rows.length,0)
  await review(f.id,'not_requested')
  await assert.rejects(publish(f.id,null,selected), /CLARIFICATION_CHANGED/)
  await review(f.id)
  await assert.rejects(publish(f.id,null,selected), /CLARIFICATION_CHANGED/)
  const request = await publish(f.id)
  await publish(f.id,null,[],request)
  await review(f.id,'not_requested')
  const frozen = (await db.query<{items:Array<{question:{options:unknown[]}}>}>('select items from renoapp_completion_requests where id=$1',[request])).rows[0].items
  assert.equal(frozen[0].question.options.length,3)
  assert.equal((await db.query("select * from renovation_case_messages where case_id=$1 and type='request_for_info'",[f.id])).rows.length,1)
  await assert.rejects(review(f.id,'not_relevant','No longer needed'), /CLARIFICATION_ROUND_OPEN/)
  await assert.rejects(review(f.id,'request','',0), /CLARIFICATION_CHANGED/)
})

test('drafts preserve base answers; submitted answer updates just the requested question and needs review', async () => {
  const f = await fixture(); await review(f.id); const request = await publish(f.id)
  assert.equal((await save(f,request,answer(yes,'Checked with municipality'),false)).revision,1)
  const old = await db.query<{option_id:string}>('select option_id from renoapp_case_question_answers where case_id=$1 and question_id=$2',[f.id,q])
  assert.equal(old.rows[0].option_id,unknown)
  await assert.rejects(save(f,request,answer(yes),true,0), /COMPLETION_DRAFT_CHANGED/)
  await save(f,request,answer(yes,'Checked with municipality'),true,1)
  assert.equal((await row(f.id)).state,'answered')
  assert.equal((await row(f.id)).answer_label,'Ja')
  assert.equal((await row(f.id)).original_answer,'Jag behöver undersöka detta')
  assert.equal((await db.query<{option_id:string}>('select option_id from renoapp_case_question_answers where case_id=$1 and question_id=$2',[f.id,otherQ])).rows[0].option_id,otherOption)
  assert.deepEqual((await db.query('select status,description from renovation_cases where id=$1',[f.id])).rows[0],{status:'review',description:'Original scope'})
  await assert.rejects(status(f.id,'approved'), /CLARIFICATION_REVIEW_REQUIRED/)
  await review(f.id,'resolve','Answer and basis checked')
  await status(f.id,'conditional')
  const history = (await db.query<{metadata:{previousAnswers:Array<{optionId:string}>}}>("select metadata from renovation_case_messages where case_id=$1 and message='Svar på klarläggande registrerat.'",[f.id])).rows[0]
  assert.equal(history.metadata.previousAnswers[0].optionId,unknown)
})

test('missing/forged answers roll back the entire submit and revision', async () => {
  const f = await fixture(); await review(f.id); const request = await publish(f.id)
  await assert.rejects(save(f,request,{}), /CLARIFICATION_ANSWER_REQUIRED/)
  await assert.rejects(save(f,request,answer(unknown)), /CLARIFICATION_ANSWER_REQUIRED/)
  await assert.rejects(save(f,request,{[otherQ]:{optionId:otherOption,note:''}}), /COMPLETION_BASE_FIELDS_LOCKED/)
  await assert.rejects(save(f,request,answer(otherOption)), /CLARIFICATION_CHANGED/)
  await assert.rejects(save(f,request,answer(yes,'x'.repeat(4001))), /CLARIFICATION_ANSWER_REQUIRED/)
  assert.deepEqual((await db.query('select revision,submitted_at from renoapp_completion_requests where id=$1',[request])).rows[0],{revision:0,submitted_at:null})
  assert.equal((await db.query("select * from renovation_case_messages where case_id=$1 and type='applicant_reply'",[f.id])).rows.length,0)
  await save(f,request,answer(unknown,'Waiting for a response'))
  assert.equal((await row(f.id)).state,'pending')
  assert.equal((await row(f.id)).answer_note,'Waiting for a response')
})

test('repeated rounds retain history, carry drafts and invalidate older links to rounds', async () => {
  const f = await fixture(); await review(f.id); const first = await publish(f.id)
  await save(f,first,answer(unknown,'Waiting'))
  await review(f.id); const second = await publish(f.id,first)
  await save(f,second,answer(no,'Draft answer'),false)
  const third = await publish(f.id,second)
  const draft = (await db.query<{draft:{clarificationAnswers:unknown}}>('select draft from renoapp_completion_requests where id=$1',[third])).rows[0].draft
  assert.deepEqual(draft.clarificationAnswers,answer(no,'Draft answer'))
  await assert.rejects(save(f,second,answer(no),true,1), /COMPLETION_CHANGED/)
  await save(f,third,answer(no,'Confirmed'))
  await review(f.id,'resolve','No municipal notification according to the response')
  await review(f.id,'reopen','New contradictory information')
  assert.equal((await row(f.id)).state,'answered')
  await assert.rejects(status(f.id,'approved'), /CLARIFICATION_REVIEW_REQUIRED/)
})

test('access tokens and database roles do not bypass the completion permissions', async () => {
  const f = await fixture(); await review(f.id); const request = await publish(f.id)
  await assert.rejects(save({...f,token:randomUUID()},request,answer(no)), /DRAFT_LINK_INVALID/)
  await db.query("update case_access_links set scope='read' where case_id=$1",[f.id])
  await assert.rejects(save(f,request,answer(no)), /DRAFT_LINK_INVALID/)
  await db.query("update case_access_links set scope='answer_questions',expires_at=now()-interval '1 second' where case_id=$1",[f.id])
  await assert.rejects(save(f,request,answer(no)), /DRAFT_LINK_INVALID/)
  await db.query("update case_access_links set expires_at=now()+interval '1 day',revoked_at=now() where case_id=$1",[f.id])
  await assert.rejects(save(f,request,answer(no)), /DRAFT_LINK_INVALID/)
  const privileges = await db.query("select has_table_privilege('anon','renoapp_case_clarifications','SELECT') readable, has_function_privilege('authenticated','renoapp_review_clarification(uuid,uuid,integer,text,text,uuid)','EXECUTE') executable")
  assert.deepEqual(privileges.rows[0],{readable:false,executable:false})
})

test('mixed completions remain atomic and ordinary completions retain company checks without requiring files', async () => {
  for (const withClarification of [true,false]) {
    const f = await fixture('submitted',withClarification ? unknown : no)
    if (withClarification) await review(f.id)
    const roleId=randomUUID(), documentId=randomUUID(), requestId=randomUUID()
    await db.query('insert into renoapp_participant_roles values($1,$2)',[roleId,'Contractor'])
    await db.query('insert into renovation_document_types values($1,$2)',[documentId,'Drawing'])
    await db.query("insert into renoapp_case_requirement_decisions values($1,$2,null,'requested'),($1,null,$3,'requested')",[f.id,documentId,roleId])
    const normalItems: ReturnType<typeof clarificationItems> = [{id:`document:${documentId}`,category:'document',label:'Drawing',correction:false},{id:`participant:${roleId}`,category:'participant',label:'Contractor',correction:false}]
    const items=[...normalItems,...(withClarification ? clarificationItems([await row(f.id)]) : [])]
    await db.query('select renoapp_publish_completion_clarifications($1,$2,null,$3,$4,$5,$6,$7)',[f.id,requestId,'submitted',randomUUID(),JSON.stringify(items),JSON.stringify(normalItems.map(item=>item.id)),completionMessage(items,'')])
    const submit=(confirmed:boolean,answers:unknown)=>db.query('select renoapp_save_completion_clarifications($1,$2,$3,0,$4,$5,true,$6)',[f.id,requestId,f.token,JSON.stringify([{participantRoleId:roleId,companyName:'Builder',hasVerifiedAuthorization:confirmed,acceptsResponsibility:confirmed}]),'',JSON.stringify(answers)])
    await assert.rejects(submit(false,withClarification ? answer(yes) : {}),/PARTICIPANT_CONFIRMATION_REQUIRED/)
    if (withClarification) {
      await assert.rejects(submit(true,{}),/CLARIFICATION_ANSWER_REQUIRED/)
      assert.equal((await db.query('select * from renoapp_case_participants where case_id=$1',[f.id])).rows.length,0)
      assert.equal((await db.query<{status:string}>('select status from renovation_cases where id=$1',[f.id])).rows[0].status,'need_info')
    }
    await submit(true,withClarification ? answer(yes) : {})
    assert.equal((await db.query('select * from renoapp_case_participants where case_id=$1',[f.id])).rows.length,1)
    assert.equal((await db.query('select * from renovation_case_documents where case_id=$1',[f.id])).rows.length,0)
  }
})

test('migrations are rerunnable without duplicating options or changing case history', async () => {
  const f = await fixture(); const before = await row(f.id)
  await db.exec(foundation); await db.exec(pilot)
  assert.deepEqual(await row(f.id),before)
  assert.equal((await db.query('select * from renoapp_apply_question_options where question_id=$1',[q])).rows.length,3)
})

test('answer parsing, required explanations and request text are explicit', () => {
  assert.deepEqual(parseClarificationAnswers(undefined),{})
  assert.deepEqual(parseClarificationAnswers(answer(no)),answer(no))
  for (const value of [null,[],{'__bad':{}},answer(no,'x'.repeat(4001)),{[q]:{optionId:no,note:2}}]) {
    assert.throws(() => parseClarificationAnswers(value), /INVALID_CLARIFICATION_ANSWERS/)
  }
  const questions = [{questionId:q,label:'Kommunens besked?',revision:0,options:[{id:unknown,key:'needs_investigation',label:'Undersöka'},{id:no,key:'no',label:'Nej'}]}]
  assert.ok(clarificationAnswerError(questions,{}))
  assert.ok(clarificationAnswerError(questions,answer(unknown)))
  assert.equal(clarificationAnswerError(questions,answer(unknown,'Waiting')),null)
  assert.equal(clarificationAnswerError(questions,answer(no)),null)
  assert.match(completionMessage([{id:`clarification:${q}`,category:'clarification',label:'Kommunens besked?',correction:false}],''),/Klarläggande: Kommunens besked/)
})
