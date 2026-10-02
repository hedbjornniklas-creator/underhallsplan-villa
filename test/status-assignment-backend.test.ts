import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'

const read = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8')
function load<T>(file: string, deps: Record<string, unknown>): T {
  const output = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('require','module','exports',output)((name: string) => {
    if (name in deps) return deps[name]
    throw new Error('Unexpected dependency ' + name)
  },mod,mod.exports)
  return mod.exports as T
}
const originals = load<Record<string, unknown>>('src/content/standardtexts/status/originals.ts', {
  './confirmation-2026.1.json': { default: JSON.parse(read('src/content/standardtexts/status/confirmation-2026.1.json')) },
  './report-2026.2.json': { default: JSON.parse(read('src/content/standardtexts/status/report-2026.2.json')) },
})
type Terms = { text:string; documentHash:string; version:string; role:string; confirmationTexts:Record<string,string>; sourceFileHash:string }
const termsModule = load<{getStatusAssignmentTermsDocument:(values?:{priceAmount:number;cancellationFee:number;scopeDescription:string})=>Terms}>('src/lib/assignments/statusTerms.ts', {
  'server-only': {}, 'node:crypto': {createHash}, '@/content/standardtexts/status/originals': originals,
})
const terms = termsModule.getStatusAssignmentTermsDocument({priceAmount:1500,cancellationFee:0,scopeDescription:'Badrum på övre plan'})
const source = { schemaVersion:'ob-confirmation-v1', statusScopeDescription:'Badrum på övre plan',statusPriceAmount:1500,terms, issuerName:'Test company', inspector:{
  fullName:'Inspector',email:'inspector@example.test',phone:null,companyName:'Test company',companyOrgNo:null,
  companyAddress:null,companyPostalCode:null,companyCity:null,sbrGroup:null,sbrStatus:null,
  membershipNumber:null,certificationNumber:null,certifications:[],
} }
const db = new PGlite()
const migration = read('docs/db/2026-09-10_02_ob_early_start.sql')
const reconciliationMigration = read('docs/db/2026-09-12_12_ob_assignment_reconciliation.sql')
const statusMigration = read('docs/db/2026-10-02_01_ob_status_assignment.sql')
const org = '00000000-0000-4000-8000-000000000001'
const actor = '00000000-0000-4000-8000-000000000002'
const stranger = '00000000-0000-4000-8000-000000000003'

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql as $$ select current_setting('role') $$;
    create function public.is_org_member(uuid) returns boolean language sql as $$ select true $$;
    -- Hash implementation is not under test; the real token consumer is tested below.
    create function public.digest(text,text) returns bytea language sql as $$ select convert_to(md5($1), 'UTF8') $$;
    create table public.profiles (id uuid primary key);
    create table public.organizations (id uuid primary key);
    create table public.org_members (org_id uuid, profile_id uuid, role text, is_active boolean);
    create table public.properties (id uuid primary key default gen_random_uuid(), owner uuid, name text,
      status text, address text, postal_code text, city text, municipality text, cadastral_id text,
      client_name text, owner_name text, created_at timestamptz default now());
    create table public.inspections (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id),
      type text, inspection_family text, inspection_variant text, status text, inspection_side text,
      date date, inspection_time time, client_name text, client_contact text, customer_name text,
      customer_email text, customer_phone text, customer_address text, customer_postal_code text,
      customer_city text, assignment_number text, assignment_confirmation_delivered_date date, scope text,
      locked_at timestamptz, locked_by uuid);
  `)
  await db.exec(readFileSync(new URL('../docs/db/2026-02-20_02_assignments_core.sql', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
  await db.exec(`
    alter table public.assignments drop constraint assignments_status_check;
    alter table public.assignments add constraint assignments_status_check check(status in ('draft','sent','ordered','booked','completed','expired','cancelled'));
    alter table public.assignments add column booked_at timestamptz, add column archived_at timestamptz,
      add column archived_by uuid, add column terms_document_hash text, add column customer_address text,
      add column customer_postal_code text, add column customer_city text, add column property_municipality text,
      add column property_owner_name text, add column brf_name text, add column apartment_number text,
      add column apartment_holder_name text, add column scope_description text, add column invoice_email text, add column assignment_details jsonb default '{}';
    alter table public.assignment_links add column terms_version text;
    alter table public.assignment_acceptances add column terms_document_hash text;
    create table public.settings_addon_services(id uuid primary key default gen_random_uuid(), key text, name text, sort_order int, is_active boolean);
    create table public.profile_addon_services(org_id uuid, profile_id uuid, addon_service_id uuid, price_amount numeric, currency text, is_enabled boolean);
    create table public.assignment_addon_orders(id uuid primary key default gen_random_uuid(), assignment_id uuid references public.assignments(id),
      org_id uuid, addon_service_id uuid, addon_key text, addon_name_snapshot text, price_amount_snapshot numeric,
      currency_snapshot text, created_at timestamptz default now(), constraint assignment_addon_orders_unique_per_assignment unique(assignment_id,addon_service_id));
    create table public.inspection_addon_orders(id uuid primary key default gen_random_uuid(), inspection_id uuid references public.inspections(id),
      org_id uuid, assignment_addon_order_id uuid references public.assignment_addon_orders(id) on delete set null,
      addon_service_id uuid, addon_key text, addon_name_snapshot text, sort_order int,
      price_amount_snapshot numeric, currency_snapshot text, is_selected boolean, selected_source text);
    create table public.inspection_conditions(inspection_id uuid primary key references public.inspections(id), furnishing_level text);
    create table public.inspection_images(id uuid primary key default gen_random_uuid(), inspection_id uuid references public.inspections(id), note text);
    create table public.inspection_round_quick_notes(id uuid primary key default gen_random_uuid(), inspection_id uuid references public.inspections(id), note_text text);
    create table public.inspection_report_links(id uuid primary key default gen_random_uuid(), inspection_id uuid references public.inspections(id), revoked_at timestamptz);
    create table public.ob_property_snapshot(inspection_id uuid primary key references public.inspections(id), source_property_id uuid,
      source_property_owner uuid, source_property_created_at timestamptz, name text, address text, postal_code text,
      city text, municipality text, cadastral_id text, client_name text, owner_name text, status text,
      brf_name text, apartment_number text, apartment_holder_name text);
    insert into public.organizations values ('${org}');
    insert into public.profiles values ('${actor}'), ('${stranger}');
    insert into public.org_members values ('${org}', '${actor}', 'inspector', true), ('${org}', '${stranger}', 'inspector', true);
  `)
  const acceptSql = readFileSync(new URL('../docs/db/2026-05-27_01_tu_module_foundation.sql', import.meta.url), 'utf8')
  await db.exec(acceptSql.slice(acceptSql.indexOf('create or replace function public.consume_assignment_token(')))
  await db.exec(readFileSync(new URL('../docs/db/2026-03-24_03_inspection_lock_write_guards.sql', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
  await db.exec(migration)
  await db.exec(migration)
  await db.exec(reconciliationMigration)
  await db.exec("alter table public.inspections add column created_at timestamptz default now(); create table public.assignment_link_incidents(assignment_id uuid,org_id uuid,resolved_at timestamptz);")
  await db.exec(readFileSync(new URL('../docs/db/2026-09-24_01_ob_assignment_pdf_archive.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../docs/db/2026-09-25_01_ob_overview_pagination.sql', import.meta.url), 'utf8'))
  await db.exec(statusMigration)
  await db.exec(statusMigration)
})

after(async () => { await db.close() })

async function draft(type = 'STATUS') {
  const result = await db.query<{id:string}>(`insert into assignments(org_id,responsible_profile_id,customer_email,customer_name,property_address,
    assignment_type,orderer_role,status,last_sent_at,preferred_date,price_amount,scope_description)
    values($1,$2,'customer@example.test','Customer','Test street',$3,$4,'sent',now(),'2026-10-02',1500,'Badrum på övre plan') returning id`,
    [org,actor,type,type === 'STATUS' ? 'Statusbesiktning' : 'Säljare'])
  const id=result.rows[0].id, token='status-assignment-test-token-'+id
  await db.query(`insert into assignment_links(assignment_id,org_id,token_hash,expires_at,terms_version,status_document_source)
    values($1,$2,encode(digest($3,'sha256'),'hex'),now()+interval '1 day',$4,$5::jsonb)`,
    [id,org,token,terms.version,type==='STATUS'?JSON.stringify(source):null])
  return {id,token}
}
async function approve(a:{id:string;token:string}) {
  await db.query('select * from consume_assignment_token($1,$2,$3::jsonb,null,null)',[a.token,terms.version,JSON.stringify({
    terms_document_hash:terms.documentHash,ob_document_source:source,customer_name:'Approved customer',
    orderer_role:'Statusbesiktning',scope_description:'Badrum på övre plan',price_amount:1500,preferred_date:'2026-10-02',addon_service_ids:[],
  })])
}
async function start(id:string,user=actor) {
  return (await db.query<{value:{inspectionId:string;propertyId:string}}>('select ob_start_status_assignment_inspection($1,$2,$3) as value',[id,org,user])).rows[0].value
}

test('status source preserves SBR paragraphs and substitutes only explicit numeric markers', () => {
  assert.equal(terms.role,'status')
  assert.equal(terms.sourceFileHash,'67b72e4f3264476ceeff1d722b958dfb6e21d9cde4c9bbd1b1b4e69a52e0f4be')
  assert.equal(terms.confirmationTexts.cancellation,'Avbokningar som sker inom 24 timmar före avtalad tid debiteras till en kostnad av 0 kr.')
  assert.ok(terms.text.endsWith(originals.STB_CONFIRMATION_TERMS as string))
  assert.ok(terms.text.includes('benämnd ”Statusbesiktning enligt SBR-modellen”.'))
  assert.ok(terms.text.includes('den Legala beskaffenheten'))
  assert.ok(!terms.text.includes('Ta bort den här texten'))
  assert.equal(createHash('sha256').update(terms.text).digest('hex'),terms.documentHash)
  assert.throws(()=>termsModule.getStatusAssignmentTermsDocument({priceAmount:1500,cancellationFee:-1,scopeDescription:'Badrum'}),/STATUS_CANCELLATION_FEE_REQUIRED/)
  const sourceData=originals.STB_CONFIRMATION_SOURCE as {paragraphs:string[]}
  const old=sourceData.paragraphs[0]
  sourceData.paragraphs[0]='Changed'
  assert.throws(()=>termsModule.getStatusAssignmentTermsDocument(),/STATUS_SOURCE_HASH_MISMATCH/)
  sourceData.paragraphs[0]=old
})

test('issued source is validated independently of current source version', () => {
  const loader=load<{requireStatusIssueSource:(source:unknown,version:string)=>unknown}>('src/lib/assignments/statusIssueSource.ts',{
    'server-only':{},'node:crypto':{createHash},
  })
  assert.deepEqual(loader.requireStatusIssueSource(source,terms.version),source)
  assert.throws(()=>loader.requireStatusIssueSource({...source,terms:{...terms,text:terms.text+'!'}},terms.version),/STATUS_ISSUED_SOURCE_INVALID/)
  assert.throws(()=>loader.requireStatusIssueSource(null,terms.version),/STATUS_ISSUED_SOURCE_INVALID/)
})

test('status cannot start early; approval, booking and authorized actor are required', async () => {
  const a=await draft()
  await assert.rejects(start(a.id),/OB_APPROVAL_REQUIRED/)
  await assert.rejects(start(a.id,stranger),/OB_ASSIGNMENT_FORBIDDEN/)
  await assert.rejects(db.query('select ob_start_assignment_inspection($1,$2,$3,$4)',[a.id,org,actor,'Customer has not replied']),/OB_ASSIGNMENT_FORBIDDEN/)
  await approve(a)
  await assert.rejects(start(a.id),/OB_APPROVAL_REQUIRED/)
  await db.query("update assignments set status='booked',booked_at=now() where id=$1",[a.id])
  const created=await start(a.id)
  assert.deepEqual(await start(a.id),created)
  const i=(await db.query<{type:string;inspection_family:string;inspection_variant:string;inspection_side:string;scope:string}>('select * from inspections where id=$1',[created.inspectionId])).rows[0]
  assert.equal(i.type,'STATUS');assert.equal(i.inspection_family,'OB');assert.equal(i.inspection_variant,'SB');assert.equal(i.inspection_side,'status')
  assert.equal(i.scope,'Badrum på övre plan')
  assert.equal((await db.query<{n:number}>('select count(*)::int n from ob_assignment_workflows where inspection_id=$1',[created.inspectionId])).rows[0].n,0)
  await assert.rejects(db.query("update inspections set type='OB',inspection_variant='OB',inspection_side='buyer' where id=$1",[created.inspectionId]),/OB_STATUS_PROFILE_AGREEMENT_LOCKED/)
  await assert.rejects(db.query("update inspections set inspection_family='TU' where id=$1",[created.inspectionId]),/OB_STATUS_PROFILE_AGREEMENT_LOCKED/)
})

test('issued and accepted status source is immutable, and original PDF archive accepts STATUS', async () => {
  const a=await draft()
  await assert.rejects(db.query("update assignment_links set status_document_source=null where assignment_id=$1",[a.id]),/immutable/)
  await assert.rejects(db.query("update assignments set assignment_type='OB' where id=$1",[a.id]),/OB_STATUS_PROFILE_AGREEMENT_LOCKED/)
  await approve(a)
  const snapshot=(await db.query<{snapshot_payload:{terms:Terms}}>('select snapshot_payload from assignment_confirmation_snapshots where assignment_id=$1',[a.id])).rows[0]
  assert.equal(snapshot.snapshot_payload.terms.text,terms.text)
  await assert.rejects(db.query("update assignment_confirmation_snapshots set snapshot_payload='{}' where assignment_id=$1",[a.id]),/immutable/)
  await db.query(`insert into assignment_confirmation_pdfs(assignment_id,org_id,acceptance_id,accepted_at,filename,pdf_base64)
    select assignment_id,org_id,id,accepted_at,'status-original.pdf',$2 from assignment_acceptances where assignment_id=$1`,
    [a.id,Buffer.from('%PDF-1.4\nOriginal STB\n%%EOF').toString('base64')])
  await assert.rejects(db.query("delete from assignment_confirmation_pdfs where assignment_id=$1",[a.id]),/immutable/)
})

test('STATUS conversion copies accepted frozen scope even when the live assignment scope changes', async () => {
  const a = await draft()
  await approve(a)
  await db.query("update assignments set status='booked',booked_at=now(),scope_description='Later mutable scope' where id=$1", [a.id])
  const created = await start(a.id)
  const inspection = (await db.query<{scope:string}>('select scope from inspections where id=$1', [created.inspectionId])).rows[0]
  assert.equal(inspection.scope, source.statusScopeDescription)
  const live = (await db.query<{scope_description:string}>('select scope_description from assignments where id=$1', [a.id])).rows[0]
  assert.equal(live.scope_description, 'Later mutable scope')
  const frozen = (await db.query<{scope:string}>("select snapshot_payload #>> '{assignment,scope_description}' scope from assignment_confirmation_snapshots where assignment_id=$1", [a.id])).rows[0]
  assert.equal(frozen.scope, source.statusScopeDescription)
})

test('source-less legacy STATUS cannot be silently accepted with a seller document', async () => {
  const a=await draft()
  await assert.rejects(db.query('select * from consume_assignment_token($1,$2,$3::jsonb,null,null)',[a.token,terms.version,JSON.stringify({terms_document_hash:terms.documentHash})]),/STATUS_ISSUED_SOURCE_INVALID/)
})

test('ordinary OB keeps its existing early-start policy after the additive migration', async () => {
  const a=await draft('OB')
  const created=(await db.query<{value:{inspectionId:string}}>('select ob_start_assignment_inspection($1,$2,$3,$4) value',[a.id,org,actor,'Customer has not replied'])).rows[0].value
  assert.ok(created.inspectionId)
  assert.equal((await db.query<{n:number}>('select count(*)::int n from ob_assignment_workflows where inspection_id=$1',[created.inspectionId])).rows[0].n,1)
})

test('public STATUS GET and acceptance use the issued exact source, never today\'s template or posted scope/price', async () => {
  let consumed: Record<string, unknown> | null = null
  const issued = { id:'link',assignment_id:'assignment',org_id:org,expires_at:'2099-01-01T00:00:00Z',
    used_at:null,revoked_at:null,terms_version:terms.version,status_document_source:source,issuer_identity_snapshot:null,
    assignments:{id:'assignment',assignment_type:'STATUS',status:'sent',responsible_profile_id:actor,
      customer_email:'customer@example.test',accepted_at:null,orderer_role:'Statusbesiktning',
      price_amount:99999,scope_description:'Later live scope',assignment_details:{statusCancellationFee:0}},
  }
  const sourceParser=load<Record<string, unknown>>('src/lib/assignments/statusIssueSource.ts',{'server-only':{},'node:crypto':{createHash}})
  const chain = {select:()=>chain,eq:()=>chain,update:()=>chain,
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)}
  const api=load<{GET:(r:Request,c:unknown)=>Promise<Response>;POST:(r:Request,c:unknown)=>Promise<Response>}>('src/app/api/assignments/accept/[token]/route.ts',{
    'next/server':{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)},after:()=>{}},
    'node:crypto':{randomUUID},'node:net':{isIP},
    '@/lib/assignments/statusIssueSource':sourceParser,
    '@/lib/assignments/server':{
      resolvePublicAssignmentByToken:async()=>issued,listAddonOffersForProfile:async()=>[],
      consumeAssignmentToken:async(input:{payload:Record<string,unknown>})=>{consumed=input.payload},
      getAssignmentById:async()=>null,
    },
    '@/lib/assignments/terms':{resolveAssignmentTermsRole:()=> 'status',
      getAssignmentTermsDocument:()=>assert.fail('must not read today\'s STATUS source'),
      getAllAssignmentTermsDocuments:()=>Object.fromEntries(['seller','buyer','apartment','technical','construction','constructionBusiness','constructionConsumer'].map(k=>[k,terms]))},
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>({from:()=>chain})},
    '@/lib/assignments/linkIncidents':{resolvePublicLinkFailures:()=>{},recordPublicLinkFailure:()=>{},publicLinkErrorCode:()=> 'TEST'},
    '@/lib/assignments/issuerIdentity':{},'@/lib/organizations/profileCard':{},
    '@/lib/assignments/addons':{isBaseAssignmentAddonKey:()=>false},
    '@/lib/certifications/profileResolver':{},'@/lib/assignments/consumer':{},
  })
  const context={params:Promise.resolve({token:'status-issue-test-token-long-enough'})}
  const get=await api.GET(new Request('https://example.test/accept'),context)
  assert.equal(get.status,200)
  const opened=await get.json()
  assert.equal(opened.terms.documents.status.text,terms.text)
  assert.equal(opened.assignment.scope_description,source.statusScopeDescription)
  assert.equal(opened.assignment.price_amount,1500)
  const accepted=await api.POST(new Request('https://example.test/accept',{method:'POST',body:JSON.stringify({
    termsAccepted:true,termsVersion:terms.version,termsDocumentHash:terms.documentHash,
    customerEmail:'customer@example.test',preferredDate:'2026-10-02',preferredTime:'10:00',
    cadastralId:'Example 1:2',propertyOwnerName:'Owner',scopeDescription:'Forged extent',priceAmount:1,
  })}),context)
  assert.equal(accepted.status,200)
  assert.equal((consumed as Record<string,unknown> | null)?.scope_description,source.statusScopeDescription)
  assert.equal((consumed as Record<string,unknown> | null)?.price_amount,1500)
  assert.deepEqual((consumed as Record<string,unknown> | null)?.ob_document_source,source)
})

test('STATUS booking receipt reads frozen text and recipient, not today\'s placeholders or mutable fields', async () => {
  let rendered = false, sent = false
  const frozenAssignment = {id:'assignment',org_id:org,assignment_type:'STATUS',accepted_at:'2026-10-02T10:00:00Z',
    terms_version:terms.version,responsible_profile_id:actor,customer_email:'original@example.test',assignment_details:{}}
  const chain = {insert:()=>chain,update:()=>chain,select:()=>chain,eq:()=>chain,
    single:async()=>({data:{id:'mail'},error:null}),
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)}
  const deps:Record<string,unknown> = {
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>({from:()=>chain})},
    '@/lib/assignments/terms':{resolveAssignmentTermsRole:()=> 'status',getAssignmentTermsDocument:()=>assert.fail('must not use today\'s source')},
    '@/lib/assignments/obConfirmationSnapshot':{getObConfirmationSnapshot:async()=>({assignment:frozenAssignment,issuerName:'Original company',inspector:{email:'original-inspector@example.test'},terms,addonOrders:[]})},
    '@/lib/assignments/emailTemplates':{buildAssignmentOrderReceiptEmail:(input:{assignment:unknown;orgName:string;termsText:string})=>{
      rendered=true;assert.deepEqual(input.assignment,frozenAssignment);assert.equal(input.orgName,'Original company');assert.equal(input.termsText,terms.text)
      return {subject:'Receipt',html:'Body',text:'Body'}
    }},
    '@/lib/assignments/mailer':{sendAssignmentEmail:async(input:{to:string;replyTo:string})=>{
      sent=true;assert.equal(input.to,'original@example.test');assert.equal(input.replyTo,'original-inspector@example.test')
      return {provider:'test',providerMessageId:'mail'}
    }},
  }
  for (const key of ['@/lib/supabase/server','@/lib/assignments/tokens','@/lib/assignments/addons','@/lib/assignments/acceptedConfirmationPdf',
    '@/lib/inspections/assignmentNumber','@/lib/ob/assignmentWorkflowServer','@/lib/certifications/profileResolver',
    '@/lib/organizations/profileCard','@/lib/assignments/issuerIdentity','@/lib/assignments/statusTerms']) deps[key]={}
  const server=load<{sendAssignmentOrderReceipt:(input:unknown)=>Promise<void>}>('src/lib/assignments/server.ts',deps)
  const previous=process.env.ASSIGNMENTS_MAIL_FROM
  process.env.ASSIGNMENTS_MAIL_FROM='test@example.test'
  try {
    await server.sendAssignmentOrderReceipt({assignment:{...frozenAssignment,customer_email:'changed@example.test'},orgName:'Changed company',responsibleEmail:'changed-inspector@example.test'})
    assert.equal(rendered,true);assert.equal(sent,true)
  } finally {
    if(previous===undefined) delete process.env.ASSIGNMENTS_MAIL_FROM
    else process.env.ASSIGNMENTS_MAIL_FROM=previous
  }
})
