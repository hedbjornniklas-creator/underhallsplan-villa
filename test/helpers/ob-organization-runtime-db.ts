import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

export const sql = (file:string) => readFileSync(new URL(`../../docs/db/${file}`,import.meta.url),'utf8').replace(/^\uFEFF/u,'')
export const runtimeSql = sql('2026-10-02_05_ob_organization_runtime.sql')
export const ORG = '10000000-0000-4000-8000-000000000001'
export const OTHER = '10000000-0000-4000-8000-000000000002'
export const ACTOR = '20000000-0000-4000-8000-000000000001'
export const COLLEAGUE = '20000000-0000-4000-8000-000000000002'
export const guardedFunctions = ['ob_round_mutate','ob_building_round_mutate','ob_save_floor_model','ob_round_image_trash',
  'ob_building_get','ob_building_command','ob_building_write_row','ob_environmental_command']

// Real OB/STATUS starts, confirmation snapshots, review/reconciliation and the
// latest overview are installed. Round subsystems use explicit side-effect
// sentinels: those tests exercise the new guard, not the already-tested editor.
export async function runtimeDb(install=true) {
  const db=new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.role() returns text language sql as $$ select current_setting('role') $$;
    grant usage on schema auth,storage to anon,authenticated,service_role;`)
  await db.exec(`create table profiles(id uuid primary key);
    create table organizations(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,role text,is_active boolean,primary key(org_id,profile_id));
    create function public.is_org_member(uuid) returns boolean language sql security definer as $$
      select exists(select 1 from org_members where org_id=$1 and profile_id=auth.uid() and is_active) $$;
    create function public.digest(text,text) returns bytea language sql as $$ select sha256(convert_to($1,'UTF8')) $$;
    create table platform_products(id uuid primary key default gen_random_uuid(),key text unique,is_active boolean default true);
    create table platform_modules(id uuid primary key default gen_random_uuid(),key text unique,is_active boolean default true,product_id uuid);
    create table platform_roles(id uuid primary key default gen_random_uuid(),key text unique,is_active boolean default true,product_id uuid);
    create table platform_access_assignments(id uuid primary key default gen_random_uuid(),profile_id uuid,product_id uuid,module_id uuid,
      role_id uuid,scope_type text,scope_id text,is_active boolean default true,expires_at timestamptz,source_system text);
    create table organization_enabled_modules(org_id uuid,module_key text,is_active boolean,primary key(org_id,module_key));
    insert into platform_products(key) values('dashboard'),('hushub_admin');
    insert into platform_modules(key) values('inspections'),('technical_investigations');
    insert into platform_roles(key) values('inspector'),('dashboard_admin');
    update platform_modules set product_id=(select id from platform_products where key='dashboard');
    update platform_roles set product_id=(select id from platform_products where key='dashboard');
    create table properties(id uuid primary key default gen_random_uuid(),owner uuid,name text,status text,address text,postal_code text,
      city text,municipality text,cadastral_id text,client_name text,owner_name text,created_at timestamptz default now());
    create table inspections(id uuid primary key default gen_random_uuid(),property_id uuid references properties(id),type text,
      inspection_family text,inspection_variant text,status text,inspection_side text,date date,inspection_time time,client_name text,
      client_contact text,customer_name text,customer_email text,customer_phone text,customer_address text,customer_postal_code text,
      customer_city text,assignment_number text,assignment_confirmation_delivered_date date,scope text,locked_at timestamptz,
      locked_by uuid,created_at timestamptz default now(),inspector_name text);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create policy existing_storage on storage.objects for all to authenticated using(true) with check(true);
    grant all on storage.objects to authenticated,service_role;`)
  await db.exec(sql('2026-02-20_02_assignments_core.sql'))
  await db.exec(`alter table assignments drop constraint assignments_status_check;
    alter table assignments add constraint assignments_status_check check(status in('draft','sent','ordered','booked','completed','expired','cancelled'));
    alter table assignments add column booked_at timestamptz,add column archived_at timestamptz,add column archived_by uuid,
      add column terms_document_hash text,add column customer_address text,add column customer_postal_code text,
      add column customer_city text,add column property_municipality text,add column property_owner_name text,
      add column brf_name text,add column apartment_number text,add column apartment_holder_name text,
      add column scope_description text,add column invoice_email text,add column assignment_details jsonb default '{}';
    alter table assignment_links add column terms_version text;
    alter table assignment_acceptances add column terms_document_hash text;
    create table settings_addon_services(id uuid primary key default gen_random_uuid(),key text,name text,sort_order int,is_active boolean);
    create table profile_addon_services(org_id uuid,profile_id uuid,addon_service_id uuid,price_amount numeric,currency text,is_enabled boolean);
    create table assignment_addon_orders(id uuid primary key default gen_random_uuid(),assignment_id uuid references assignments(id),org_id uuid,
      addon_service_id uuid,addon_key text,addon_name_snapshot text,price_amount_snapshot numeric,currency_snapshot text,
      created_at timestamptz default now(),constraint assignment_addon_orders_unique_per_assignment unique(assignment_id,addon_service_id));
    create table inspection_addon_orders(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id) on delete cascade,
      org_id uuid,assignment_addon_order_id uuid references assignment_addon_orders(id) on delete set null,addon_service_id uuid,
      addon_key text,addon_name_snapshot text,sort_order int,price_amount_snapshot numeric,currency_snapshot text,is_selected boolean,selected_source text);
    create table inspection_conditions(inspection_id uuid primary key references inspections(id) on delete cascade,furnishing_level text);
    create table settings_interior_room_types(id uuid primary key,key text,label text,is_active boolean,sort_order int,created_at timestamptz);
    create table settings_control_points(id uuid primary key,key text,title text,label text,scope text,is_active boolean,sort_order int,trigger_room_types jsonb);
    create table inspection_interior_rooms(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id) on delete cascade,
      floor_label text,order_index int,room_type_key text,room_label text,values jsonb,note text,created_at timestamptz default now());
    create table inspection_control_items(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id) on delete cascade,
      interior_room_id uuid,control_point_id uuid,title text,status text,note text,sort_order int,selected_outcome_id uuid);
    create table inspection_optional_fixture(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),note text);
    alter table inspection_optional_fixture enable row level security;
    create policy existing_optional_fixture on inspection_optional_fixture for all to authenticated using(true) with check(true);
    grant all on inspection_optional_fixture to authenticated;
    create table inspection_images(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id) on delete cascade,note text);
    create table inspection_round_quick_notes(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id) on delete cascade,note_text text);
    create table inspection_report_links(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id) on delete cascade,
      org_id uuid,assignment_id uuid,revoked_at timestamptz,pdf_status text,pdf_base64 text,pdf_storage_bucket text,pdf_storage_path text,snapshot_payload jsonb);
    create table eb_inspection_details(inspection_id uuid primary key references inspections(id) on delete cascade,org_id uuid,
      eb_project_id uuid,report_locked_at timestamptz);
    create table technical_investigation_details(inspection_id uuid primary key references inspections(id) on delete cascade,org_id uuid,
      report_locked_at timestamptz,report_locked_by uuid);
    create table inspection_lock_events(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      org_id uuid,action text,reason text,performed_by uuid);
    create table ob_property_snapshot(inspection_id uuid primary key references inspections(id) on delete cascade,source_property_id uuid,
      source_property_owner uuid,source_property_created_at timestamptz,name text,address text,postal_code text,city text,municipality text,
      cadastral_id text,client_name text,owner_name text,status text,brf_name text,apartment_number text,apartment_holder_name text,
      imported_at timestamptz,snapshot_version int,created_at timestamptz,updated_at timestamptz);
    create table assignment_link_incidents(assignment_id uuid,org_id uuid,resolved_at timestamptz);
    create table runtime_guard_sentinel(id uuid primary key default gen_random_uuid(),inspection_id uuid,operation text);
    insert into organizations values('${ORG}'),('${OTHER}');
    insert into profiles values('${ACTOR}'),('${COLLEAGUE}');
    insert into org_members values('${ORG}','${ACTOR}','inspector',true),('${OTHER}','${ACTOR}','inspector',true),
      ('${ORG}','${COLLEAGUE}','inspector',true);`)
  const accept=sql('2026-05-27_01_tu_module_foundation.sql')
  await db.exec(accept.slice(accept.indexOf('create or replace function public.consume_assignment_token(')))
  await db.exec(sql('2026-09-10_02_ob_early_start.sql'))
  await db.exec(sql('2026-09-12_12_ob_assignment_reconciliation.sql'))
  await db.exec(sql('2026-09-24_01_ob_assignment_pdf_archive.sql'))
  await db.exec(sql('2026-09-25_01_ob_overview_pagination.sql'))
  await db.exec(sql('2026-10-02_01_ob_status_assignment.sql'))
  await db.exec(sql('2026-10-02_04_ob_status_object_type.sql'))
  await db.exec(sql('2026-02-25_02_insida_default_other_room_guard.sql'))
  // Install the real lock guards and complete EB/TU routines, not simplified
  // substitutes: family enforcement must retain their lock/event/link semantics.
  await db.exec(sql('2026-03-24_03_inspection_lock_write_guards.sql'))
  await db.exec(sql('2026-06-08_02_eb_report_locking.sql'))
  await db.exec(sql('2026-06-09_02_eb_report_unlocking_keep_links.sql'))
  await db.exec(sql('2026-06-09_01_tu_report_unlocking.sql'))
  const foundation=sql('2026-10-02_03_ob_organization_bindings.sql')
  await db.exec(foundation.slice(foundation.indexOf('create table if not exists public.ob_organization_bindings'),
    foundation.indexOf('create temporary table ob_binding_approved_ids')))
  for(const fn of guardedFunctions) await db.exec(`create function public.${fn}(p_inspection_id uuid,p_org_id uuid,p_actor uuid,
    p_operation text default 'test',p_payload jsonb default '{}') returns jsonb language plpgsql security definer as $$
    declare original_marker text := 'preserve-original-function-body';
    begin
      insert into runtime_guard_sentinel(inspection_id,operation) values(p_inspection_id,p_operation);
      return jsonb_build_object('original',original_marker);
    end $$;
    revoke all on function ${fn}(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
    grant execute on function ${fn}(uuid,uuid,uuid,text,jsonb) to service_role;`)
  const building=sql('2026-09-12_02_ob_building_commands.sql')
  await db.exec(building.slice(building.indexOf('create or replace function public.ob_building_access'),building.indexOf('create or replace function public.ob_building_activation_data')))
  await db.exec(building.slice(building.indexOf('create or replace function public.ob_building_write_rows'),building.indexOf('do $$ declare f regprocedure')))
  await db.exec(`revoke all on function ob_building_access(uuid,uuid,uuid,boolean) from public,anon,authenticated;
    grant execute on function ob_building_access(uuid,uuid,uuid,boolean) to service_role;
    alter table inspections enable row level security;
    create policy existing_inspection_owner on inspections for all to authenticated using(
      exists(select 1 from properties p where p.id=property_id and p.owner=auth.uid())) with check(
      exists(select 1 from properties p where p.id=property_id and p.owner=auth.uid()));
    alter table inspection_conditions enable row level security;
    create policy existing_conditions_owner on inspection_conditions for all to authenticated using(true) with check(true);
    grant select on all tables in schema public to authenticated;
    grant insert,update,delete on inspections,inspection_conditions to authenticated;
    revoke all on ob_organization_bindings,ob_organization_binding_audit from authenticated;
    grant all on properties,inspections,inspection_conditions,assignments to service_role;`)
  if(install) await db.exec(runtimeSql)
  return db
}

export async function asRole<T>(db:PGlite,role:'authenticated'|'anon'|'service_role',work:()=>Promise<T>,actor=ACTOR) {
  await db.query("select set_config('test.uid',$1,false)",[actor])
  await db.exec(`set role ${role}`)
  try {return await work()} finally {await db.exec('reset role')}
}

export async function create(db:PGlite,org=ORG,actor=ACTOR,property:string|null=null) {
  return asRole(db,'service_role',async()=>(await db.query<{value:{inspectionId:string;propertyId:string;orgId:string}}>(
    'select ob_create_organization_inspection($1,$2,$3) value',[org,actor,property])).rows[0].value)
}
