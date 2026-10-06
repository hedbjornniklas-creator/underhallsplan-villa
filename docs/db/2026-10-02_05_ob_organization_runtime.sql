-- OB organization runtime. Requires verified SQL03 ownership + latest STATUS SQL.
-- Deploy only with the explicit-org API/UI: older direct OB inserts will fail.
-- No module entitlement/grant is enabled; absent OB entitlement retains legacy
-- access. Existing snapshots, issued reports, tokens, buckets and files stay intact.
-- This adds an owner AND organization boundary, not organization-wide job sharing.
-- The three existing EB/TU lock RPCs also receive a parent-family boundary and
-- remain server-only. Their installed business logic and historical rows stay intact.
-- Shared property records/property-media and already-public asset URLs retain their
-- previous rules; this is not a private-media conversion or a full security audit.
begin;
set local lock_timeout='10s';
-- Stop rather than invent attribution for OBs created since the reviewed SQL03.
lock table public.inspections in share row exclusive mode;
do $$ begin
  if not exists(select 1 from pg_class where oid=to_regclass('storage.objects') and relrowsecurity) then
    raise exception 'OB_RUNTIME_STORAGE_RLS_REQUIRED'; end if;
  if exists(select 1 from public.inspections i where (i.inspection_family='OB' or
    (i.inspection_family is null and i.type in ('OB','STATUS'))) and not exists(
      select 1 from public.ob_organization_bindings b where b.inspection_id=i.id)) then
    raise exception 'OB_RUNTIME_UNBOUND_INSPECTIONS_REVIEW_REQUIRED'; end if;
end $$;

-- A detail row is not proof of module membership: historical inconsistent rows
-- must not let an EB/TU SECURITY DEFINER routine mutate an OB inspection. Explicit
-- family is authoritative; old EB records may retain type OB or the former SB.
-- Null-family SB is ambiguous with OB status and deliberately fails closed.
create or replace function public.inspection_report_module_matches(p_family text,p_type text,p_expected text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(case p_expected
    when 'EB' then p_family='EB' or (p_family is null and p_type in ('EB','SLB','FB','GB','KSB','SAB'))
    when 'TU' then p_family='TU' or (p_family is null and p_type='TU')
    else false end,false)
$$;

create or replace function public.assert_inspection_report_module(p_inspection uuid,p_expected text)
returns void language plpgsql security definer set search_path='' as $$
declare inspection_row public.inspections;
begin
  -- Serialize with reclassification and detail insertion/reparenting. A shared
  -- row lock would not exclude an UPDATE of non-key family/type columns.
  select * into inspection_row from public.inspections where id=p_inspection for update;
  if not found or not public.inspection_report_module_matches(inspection_row.inspection_family,inspection_row.type,p_expected)
    or exists(select 1 from public.ob_organization_bindings where inspection_id=p_inspection) then
    raise exception 'INSPECTION_REPORT_MODULE_MISMATCH' using errcode='42501';
  end if;
end $$;

-- Preserve exactly the reviewed installed definitions (CRLF or LF), changing
-- only the first executable statement. Unknown versions/overloads stop cutover.
-- Removing the precise injected prefix restores the reviewed definition on rerun.
do $$
declare f record; routine record; original text; prefix text; rewritten text; definition text;
begin
  for f in select * from (values
    ('public.lock_eb_inspection_report(uuid,uuid,uuid,uuid)','EB','df8bc722c26e1eb4075eb1c6f8395fb3','969ddc8a3601ba34410bb691fb169414'),
    ('public.unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid)','EB','7bbae76d009e1db0849283dd9c07cba3','8d469538d340ee09aba2476aef6b9a3d'),
    ('public.unlock_tu_investigation_report(uuid,uuid,text,uuid)','TU','8a7123812755f31745a7e3690a938354','3f1df97e3b7d4974c6759e39746c2ac8')
  ) reviewed(signature,family,crlf_hash,lf_hash) loop
    select p.oid,p.proname,p.prosrc into routine from pg_proc p where p.oid=to_regprocedure(f.signature);
    if not found then raise exception 'OB_RUNTIME_MODULE_FUNCTION_REVIEW_REQUIRED: %',f.signature; end if;
    if (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=routine.proname)<>1 then
      raise exception 'OB_RUNTIME_MODULE_FUNCTION_REVIEW_REQUIRED: %',f.signature; end if;
    prefix:=E'  -- inspection-report-module-boundary-v1\n  perform public.assert_inspection_report_module(p_inspection_id,'||quote_literal(f.family)||E');\n';
    original:=replace(routine.prosrc,prefix,'');
    definition:=replace(pg_get_functiondef(routine.oid),routine.prosrc,original);
    if md5(definition) not in (f.crlf_hash,f.lf_hash) then
      raise exception 'OB_RUNTIME_MODULE_FUNCTION_REVIEW_REQUIRED: %',f.signature; end if;
    rewritten:=regexp_replace(original,E'(^|\n|;)([ \t]*begin)([ \t]*\r?\n)',
      $backrefs$\1\2\3$backrefs$||prefix,'in');
    if rewritten=original or (original<>routine.prosrc and rewritten<>routine.prosrc) then
      raise exception 'OB_RUNTIME_MODULE_FUNCTION_REVIEW_REQUIRED: %',f.signature; end if;
    if rewritten<>routine.prosrc then execute replace(definition,original,rewritten); end if;
    execute format('revoke all on function %s from public,anon,authenticated',routine.oid::regprocedure);
    execute format('grant execute on function %s to service_role',routine.oid::regprocedure);
    if has_function_privilege('anon',routine.oid,'EXECUTE') or has_function_privilege('authenticated',routine.oid,'EXECUTE') then
      raise exception 'OB_RUNTIME_INHERITED_EXECUTE_REVIEW_REQUIRED: %',f.signature; end if;
  end loop;
end $$;

-- Prevent creating a fresh cross-module relation or creating one in two steps
-- by reclassifying its parent. Existing mismatched rows are not rewritten; the
-- RPC assertion above rejects them and SQL06 reports them for operator review.
create or replace function public.inspection_report_detail_module_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_inspection_report_module(new.inspection_id,tg_argv[0]);
  return new;
end $$;
create or replace function public.inspection_report_parent_module_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.inspection_family,new.type) is distinct from (old.inspection_family,old.type) and (
    (exists(select 1 from public.eb_inspection_details where inspection_id=old.id) and
      not public.inspection_report_module_matches(new.inspection_family,new.type,'EB')) or
    (exists(select 1 from public.technical_investigation_details where inspection_id=old.id) and
      not public.inspection_report_module_matches(new.inspection_family,new.type,'TU'))
  ) then raise exception 'INSPECTION_REPORT_MODULE_MISMATCH' using errcode='42501'; end if;
  return new;
end $$;
do $$ declare t text; family text; begin
  foreach t in array array['eb_inspection_details','technical_investigation_details'] loop
    if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||t)
      and attname='inspection_id' and atttypid='uuid'::regtype and attnum>0 and not attisdropped) then
      raise exception 'OB_RUNTIME_MODULE_DETAIL_SCHEMA_REVIEW_REQUIRED: %',t; end if;
    family:=case t when 'eb_inspection_details' then 'EB' else 'TU' end;
    execute format('drop trigger if exists inspection_report_detail_module_guard on public.%I',t);
    execute format('create trigger inspection_report_detail_module_guard before insert or update of inspection_id on public.%I for each row execute function public.inspection_report_detail_module_guard(%L)',t,family);
  end loop;
end $$;
drop trigger if exists inspection_report_parent_module_guard on public.inspections;
create trigger inspection_report_parent_module_guard before update of inspection_family,type on public.inspections
  for each row execute function public.inspection_report_parent_module_guard();
revoke all on function public.inspection_report_module_matches(text,text,text),public.assert_inspection_report_module(uuid,text),
  public.inspection_report_detail_module_guard(),public.inspection_report_parent_module_guard() from public,anon,authenticated,service_role;
do $$ declare f record; begin
  for f in select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
    'inspection_report_module_matches','assert_inspection_report_module','inspection_report_detail_module_guard','inspection_report_parent_module_guard') loop
    if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
      or has_function_privilege('service_role',f.oid,'EXECUTE') then
      raise exception 'OB_RUNTIME_INHERITED_EXECUTE_REVIEW_REQUIRED: %',f.proname; end if;
  end loop;
end $$;

alter table public.ob_organization_bindings drop constraint if exists ob_organization_bindings_attribution_source_check;
alter table public.ob_organization_bindings add constraint ob_organization_bindings_attribution_source_check
  check(attribution_source in ('recorded_sources','approved_legacy_bbsab','explicit_creation'));
alter table public.ob_organization_binding_audit drop constraint if exists ob_organization_binding_audit_attribution_source_check;
alter table public.ob_organization_binding_audit add constraint ob_organization_binding_audit_attribution_source_check
  check(attribution_source in ('recorded_sources','approved_legacy_bbsab','explicit_creation'));

create or replace function public.ob_actor_has_organization_access(p_org uuid,p_actor uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare managed boolean; enabled boolean;
begin
  if p_actor is null or p_org is null or not exists(select 1 from public.org_members
    where org_id=p_org and profile_id=p_actor and is_active) then return false; end if;
  select true,is_active into managed,enabled from public.organization_enabled_modules
    where org_id=p_org and module_key='inspections';
  if managed then
    return enabled and exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard' and p.is_active
      join public.platform_modules m on m.id=a.module_id and m.key='inspections' and m.is_active and m.product_id=p.id
      join public.platform_roles r on r.id=a.role_id and r.key='inspector' and r.is_active and r.product_id=p.id
      where a.profile_id=p_actor and a.is_active and (a.expires_at is null or a.expires_at>now())
        and a.scope_type='organization' and a.scope_id=p_org::text);
  end if;
  if exists(select 1 from public.platform_access_assignments a join public.platform_products p on p.id=a.product_id
    where p.key='dashboard' and a.profile_id=p_actor and a.is_active and (a.expires_at is null or a.expires_at>now())) then
    return exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard'
      join public.platform_modules m on m.id=a.module_id and m.key='inspections'
      where a.profile_id=p_actor and a.is_active and (a.expires_at is null or a.expires_at>now())
        and (a.scope_type='global' or (a.scope_type='organization' and a.scope_id=p_org::text)));
  end if;
  return not exists(select 1 from public.platform_access_assignments a join public.platform_products p on p.id=a.product_id
    where p.key='dashboard' and a.profile_id=p_actor and a.scope_type='organization'
      and a.source_system in ('organization_administration','organization_admin_migration'));
end $$;

create or replace function public.ob_assert_organization_inspection(p_inspection uuid,p_org uuid,p_actor uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not public.ob_actor_has_organization_access(p_org,p_actor) or not exists(
    select 1 from public.ob_organization_bindings b join public.inspections i on i.id=b.inspection_id
    join public.properties p on p.id=i.property_id where b.inspection_id=p_inspection and b.org_id=p_org and p.owner=p_actor
      and (to_jsonb(i)->>'inspection_family'='OB' or
        (to_jsonb(i)->>'inspection_family' is null and to_jsonb(i)->>'type' in ('OB','STATUS')))) then
    raise exception 'OB_ORGANIZATION_FORBIDDEN' using errcode='42501';
  end if;
end $$;

-- Boolean-only authenticated predicate. The private mapping itself stays private.
create or replace function public.ob_inspection_matches_organization(p_inspection uuid,p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.ob_organization_bindings b join public.inspections i on i.id=b.inspection_id
    join public.properties p on p.id=i.property_id where b.inspection_id=p_inspection and b.org_id=p_org
      and p.owner=auth.uid() and public.ob_actor_has_organization_access(b.org_id,auth.uid()))
$$;

create or replace function public.ob_organization_row_access(p_inspection uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare i public.inspections; bound_org uuid;
begin
  select * into i from public.inspections where id=p_inspection;
  if not found then return false; end if;
  select org_id into bound_org from public.ob_organization_bindings where inspection_id=p_inspection;
  if bound_org is null and not (to_jsonb(i)->>'inspection_family'='OB' or
    (to_jsonb(i)->>'inspection_family' is null and to_jsonb(i)->>'type' in ('OB','STATUS'))) then return true; end if;
  return bound_org is not null and exists(select 1 from public.properties p where p.id=i.property_id and p.owner=auth.uid())
    and public.ob_actor_has_organization_access(bound_org,auth.uid());
end $$;

create or replace function public.ob_bind_created_inspection(p_inspection uuid,p_org uuid)
returns void language plpgsql security definer set search_path='' as $$
declare b public.ob_organization_bindings; conflicting boolean; t text;
begin
  perform 1 from public.inspections where id=p_inspection for update;
  if not found then raise exception 'OB_INSPECTION_INVALID'; end if;
  if not exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id
    join public.org_members m on m.profile_id=p.owner and m.org_id=p_org and m.is_active
    where i.id=p_inspection and (to_jsonb(i)->>'inspection_family'='OB' or
      (to_jsonb(i)->>'inspection_family' is null and to_jsonb(i)->>'type' in ('OB','STATUS')))) then
    raise exception 'OB_ORGANIZATION_FORBIDDEN';
  end if;
  select * into b from public.ob_organization_bindings where inspection_id=p_inspection;
  if found then
    if b.org_id<>p_org then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
    return;
  end if;
  if exists(select 1 from public.ob_organization_binding_audit where inspection_id=p_inspection) then
    raise exception 'OB_BINDING_AUDIT_CONFLICT';
  end if;
  -- Assignment starts write their children before returning to this wrapper.
  -- Check those pre-binding sources too; nothing may establish a second org.
  foreach t in array array['assignments','ob_assignment_workflows','inspection_report_links','inspection_addon_orders',
    'inspection_area_measurements','inspection_moisture_controls','inspection_moisture_control_images',
    'inspection_environmental_protocols','inspection_environmental_files'] loop
    if to_regclass('public.'||t) is not null then
      execute format('select exists(select 1 from public.%I r where r.inspection_id=$1 and r.org_id is distinct from $2)',t)
        into conflicting using p_inspection,p_org;
      if conflicting then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
    end if;
  end loop;
  insert into public.ob_organization_bindings(inspection_id,org_id,attribution_source)
    values(p_inspection,p_org,'explicit_creation') returning * into b;
  insert into public.ob_organization_binding_audit values(b.inspection_id,b.org_id,b.attribution_source,b.created_at);
end $$;

create or replace function public.ob_create_organization_inspection(p_org_id uuid,p_actor uuid,p_property_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare property_row public.properties; inspection_id uuid;
begin
  if not public.ob_actor_has_organization_access(p_org_id,p_actor) then raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  if p_property_id is null then
    insert into public.properties(owner,name,status) values(p_actor,'Ny fastighet','Utkast') returning * into property_row;
  else
    select * into property_row from public.properties where id=p_property_id and owner=p_actor for update;
    if not found then raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  end if;
  insert into public.inspections(property_id,type,inspection_family,inspection_variant,status)
    values(property_row.id,'OB','OB','OB','draft') returning id into inspection_id;
  perform public.ob_bind_created_inspection(inspection_id,p_org_id);
  insert into public.inspection_conditions(inspection_id,furnishing_level) values(inspection_id,'fullt_moblerad');
  insert into public.ob_property_snapshot select (jsonb_populate_record(null::public.ob_property_snapshot,
    to_jsonb(property_row)||jsonb_build_object('inspection_id',inspection_id,'source_property_id',property_row.id,
      'source_property_owner',property_row.owner,'source_property_created_at',property_row.created_at,
      'imported_at',now(),'snapshot_version',1,'created_at',now(),'updated_at',now()))).*;
  return jsonb_build_object('inspectionId',inspection_id,'propertyId',property_row.id,'orgId',p_org_id);
end $$;

create or replace function public.ob_list_organization_inspections(p_org_id uuid,p_actor uuid,p_property_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.ob_actor_has_organization_access(p_org_id,p_actor) then raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  if p_property_id is not null and not exists(select 1 from public.properties where id=p_property_id and owner=p_actor) then
    raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(row_data order by created_at desc,id),'[]'::jsonb) from (
    select i.id,i.created_at,
      (select jsonb_object_agg(k,to_jsonb(i)->k) from unnest(array['id','property_id','date','type','status','inspector_name','created_at',
        'customer_name','client_name','client_contact','assignment_number','locked_at','locked_by']) k)
      ||jsonb_build_object('property',(select jsonb_object_agg(k,to_jsonb(p)->k) from unnest(array['id','name','address','postal_code','city']) k),
        'snapshot',case when s.inspection_id is null then null else (select jsonb_object_agg(k,to_jsonb(s)->k)
          from unnest(array['inspection_id','address','postal_code','city','client_name']) k) end,
        'hasReadyPdf',exists(select 1 from public.inspection_report_links r where r.inspection_id=i.id and r.org_id=p_org_id
          and r.revoked_at is null and (nullif(btrim(to_jsonb(r)->>'pdf_base64'),'') is not null or
            (nullif(btrim(to_jsonb(r)->>'pdf_storage_bucket'),'') is not null and
             nullif(btrim(to_jsonb(r)->>'pdf_storage_path'),'') is not null and
             lower(btrim(to_jsonb(r)->>'pdf_status'))='ready')))) as row_data
    from public.ob_organization_bindings b join public.inspections i on i.id=b.inspection_id
    join public.properties p on p.id=i.property_id left join public.ob_property_snapshot s on s.inspection_id=i.id
    where b.org_id=p_org_id and p.owner=p_actor and (p_property_id is null or p.id=p_property_id)) rows);
end $$;

-- Keep the installed OB/STATUS implementations (including their agreement and
-- snapshot logic). Private originals cannot be invoked directly by API roles.
do $$ begin
  if to_regprocedure('public.ob_start_assignment_inspection_before_organization(uuid,uuid,uuid,text)') is null then
    alter function public.ob_start_assignment_inspection(uuid,uuid,uuid,text) rename to ob_start_assignment_inspection_before_organization;
  end if;
  if to_regprocedure('public.ob_start_status_assignment_inspection_before_organization(uuid,uuid,uuid)') is null then
    alter function public.ob_start_status_assignment_inspection(uuid,uuid,uuid) rename to ob_start_status_assignment_inspection_before_organization;
  end if;
end $$;
create or replace function public.ob_start_assignment_inspection(p_assignment_id uuid,p_org_id uuid,p_actor uuid,p_early_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; expected uuid;
begin
  if not public.ob_actor_has_organization_access(p_org_id,p_actor) then raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  result:=public.ob_start_assignment_inspection_before_organization(p_assignment_id,p_org_id,p_actor,p_early_reason);
  select inspection_id into expected from public.assignments where id=p_assignment_id and org_id=p_org_id;
  if expected is null or expected is distinct from (result->>'inspectionId')::uuid then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
  if not exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id
    where i.id=expected and p.owner=p_actor) then raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  perform public.ob_bind_created_inspection(expected,p_org_id);
  return result||jsonb_build_object('orgId',p_org_id);
end $$;
create or replace function public.ob_start_status_assignment_inspection(p_assignment_id uuid,p_org_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; expected uuid;
begin
  if not public.ob_actor_has_organization_access(p_org_id,p_actor) then raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  result:=public.ob_start_status_assignment_inspection_before_organization(p_assignment_id,p_org_id,p_actor);
  select inspection_id into expected from public.assignments where id=p_assignment_id and org_id=p_org_id;
  if expected is null or expected is distinct from (result->>'inspectionId')::uuid then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
  if not exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id
    where i.id=expected and p.owner=p_actor) then raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  perform public.ob_bind_created_inspection(expected,p_org_id);
  return result||jsonb_build_object('orgId',p_org_id);
end $$;

-- Fail closed on schema drift rather than replacing newer function bodies with
-- copies from an older migration. Insert one explicit guard at the first BEGIN.
do $$
declare f record; source text; rewritten text; definition text; required text;
  marker constant text:='-- ob-organization-runtime-v1';
begin
  foreach required in array array['ob_round_mutate','ob_building_round_mutate','ob_save_floor_model','ob_round_image_trash',
    'ob_building_access','ob_building_get','ob_building_command','ob_building_write_row','ob_building_write_rows',
    'ob_environmental_command','ob_review_assignment_workflow','ob_reconcile_assignment_workflow'] loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      join pg_language l on l.oid=p.prolang where n.nspname='public' and l.lanname='plpgsql' and p.proname=required)<>1 then
      raise exception 'OB_RUNTIME_FUNCTION_REVIEW_REQUIRED: %',required; end if;
  end loop;
  for f in select p.oid,p.proname,p.prosrc,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_language l on l.oid=p.prolang where n.nspname='public' and l.lanname='plpgsql' and p.proname=any(array[
      'ob_round_mutate','ob_building_round_mutate','ob_save_floor_model','ob_round_image_trash',
      'ob_building_access','ob_building_get','ob_building_command','ob_building_write_row','ob_building_write_rows',
      'ob_environmental_command','ob_review_assignment_workflow','ob_reconcile_assignment_workflow']) loop
    -- Actor parameters are trusted only at a server-only entry point. Preserve
    -- function bodies, but never retain a PUBLIC/inherited client bypass.
    execute format('revoke all on function %s from public,anon,authenticated',f.oid::regprocedure);
    execute format('grant execute on function %s to service_role',f.oid::regprocedure);
    if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') then
      raise exception 'OB_RUNTIME_INHERITED_EXECUTE_REVIEW_REQUIRED: %',f.proname; end if;
    if position(marker in f.prosrc)>0 then continue; end if;
    source:=case when f.proname='ob_building_access' then 'p_inspection,p_org,p_actor' else 'p_inspection_id,p_org_id,p_actor' end;
    if not coalesce((case when f.proname='ob_building_access' then array['p_inspection','p_org','p_actor']
      else array['p_inspection_id','p_org_id','p_actor'] end)::text[]<@f.proargnames,false) then
      raise exception 'OB_RUNTIME_FUNCTION_REVIEW_REQUIRED: %',f.proname; end if;
    rewritten:=regexp_replace(f.prosrc,E'(^|\n|;)([ \t]*begin)([ \t]*\r?\n)',
      $backrefs$\1\2\3  $backrefs$||marker||E'\n  perform public.ob_assert_organization_inspection('||source||E');\n','in');
    if rewritten=f.prosrc then raise exception 'OB_RUNTIME_FUNCTION_REVIEW_REQUIRED: %',f.proname; end if;
    definition:=pg_get_functiondef(f.oid);
    execute replace(definition,f.prosrc,rewritten);
  end loop;
  -- Latest overview includes STATUS. Change only its owner-visible OB predicate.
  select p.oid,p.prosrc into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.oid=to_regprocedure('public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)');
  if not found then raise exception 'OB_RUNTIME_OVERVIEW_REQUIRED'; end if;
  if position('ob_inspection_matches_organization(i.id,p_org_id)' in f.prosrc)=0 then
    source:='where i.inspection_family = ''OB''';
    if (length(f.prosrc)-length(replace(f.prosrc,source,'')))/length(source)<>1 then
      raise exception 'OB_RUNTIME_OVERVIEW_REVIEW_REQUIRED'; end if;
    execute replace(pg_get_functiondef(f.oid),f.prosrc,replace(f.prosrc,source,
      source||' and public.ob_inspection_matches_organization(i.id,p_org_id)'));
  end if;
end $$;

-- The automatic initializer runs inside a definer trigger. It is not a public
-- repair API: direct client calls otherwise bypass every new row-level policy.
do $$ declare initializer oid:=to_regprocedure('public.ensure_inspection_default_other_room_and_points(uuid)'); begin
  if initializer is not null then
    execute format('revoke all on function %s from public,anon,authenticated',initializer::regprocedure);
    execute format('grant execute on function %s to service_role',initializer::regprocedure);
    if has_function_privilege('anon',initializer,'EXECUTE') or has_function_privilege('authenticated',initializer,'EXECUTE') then
      raise exception 'OB_RUNTIME_INHERITED_EXECUTE_REVIEW_REQUIRED: initializer'; end if;
  end if;
end $$;

create or replace function public.ob_organization_identity_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.ob_organization_bindings where inspection_id=old.id) and
    (new.id is distinct from old.id or new.property_id is distinct from old.property_id or
      new.inspection_family is distinct from old.inspection_family or
      not coalesce(new.inspection_family='OB' or (new.inspection_family is null and new.type in ('OB','STATUS')),false))
    then raise exception 'OB_ORGANIZATION_BINDING_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists ob_organization_identity_guard on public.inspections;
create trigger ob_organization_identity_guard before update on public.inspections
  for each row execute function public.ob_organization_identity_guard();

create or replace function public.ob_organization_binding_required()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.inspections i where i.id=new.id and (i.inspection_family='OB' or
    (i.inspection_family is null and i.type in ('OB','STATUS'))) and
    not exists(select 1 from public.ob_organization_bindings b where b.inspection_id=i.id)) then
    raise exception 'OB_ORGANIZATION_BINDING_REQUIRED'; end if;
  return null;
end $$;
drop trigger if exists ob_organization_binding_required on public.inspections;
create constraint trigger ob_organization_binding_required after insert or update on public.inspections
  deferrable initially deferred for each row execute function public.ob_organization_binding_required();

create or replace function public.ob_organization_source_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=to_jsonb(new); linked uuid; bound_org uuid; pointer uuid;
begin
  linked:=(row_data->>'inspection_id')::uuid;
  -- Reissue cancels/unlinks the previous assignment and creates a replacement.
  -- Its organization remains immutable after unlinking, including intermediate
  -- versions retained only in workflow events or historical report links.
  if tg_op='UPDATE' and tg_table_name='assignments' and
    row_data->>'org_id' is distinct from to_jsonb(old)->>'org_id' and (
      to_jsonb(old)->>'assignment_type' in ('OB','STATUS') or row_data->>'assignment_type' in ('OB','STATUS') or
      exists(select 1 from public.ob_assignment_workflows w join public.ob_organization_bindings b on b.inspection_id=w.inspection_id
        where (to_jsonb(old)->>'id')::uuid in (w.initial_assignment_id,w.current_assignment_id)) or
      exists(select 1 from public.ob_assignment_workflow_events e join public.ob_organization_bindings b on b.inspection_id=e.inspection_id
        where e.assignment_id=(to_jsonb(old)->>'id')::uuid) or
      exists(select 1 from public.inspection_report_links r join public.ob_organization_bindings b on b.inspection_id=r.inspection_id
        where r.assignment_id=(to_jsonb(old)->>'id')::uuid)
    ) then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
  if tg_op='UPDATE' and exists(select 1 from public.ob_organization_bindings b join public.inspections i on i.id=b.inspection_id where
    b.inspection_id=(to_jsonb(old)->>'inspection_id')::uuid and
    (row_data->>'org_id' is distinct from to_jsonb(old)->>'org_id' or
      (row_data->>'inspection_id' is distinct from to_jsonb(old)->>'inspection_id' and
        not (tg_table_name='assignments' and linked is null)))) then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
  select org_id into bound_org from public.ob_organization_bindings where inspection_id=linked;
  if bound_org is not null and (row_data->>'org_id')::uuid is distinct from bound_org then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
  if bound_org is not null and tg_table_name='assignments' and
    coalesce(row_data->>'assignment_type','') not in ('OB','STATUS') then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
  if bound_org is not null and tg_table_name in ('ob_assignment_workflows','inspection_report_links') then
    for pointer in select distinct value::uuid from jsonb_each_text(row_data)
      where key in ('assignment_id','initial_assignment_id','current_assignment_id') and value is not null loop
      if not exists(select 1 from public.assignments a where a.id=pointer and a.org_id=bound_org and
        a.assignment_type in ('OB','STATUS') and (a.inspection_id is null or a.inspection_id=linked)) then
        raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
    end loop;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['assignments','ob_assignment_workflows','inspection_report_links','inspection_addon_orders',
    'inspection_area_measurements','inspection_moisture_controls','inspection_moisture_control_images',
    'inspection_environmental_protocols','inspection_environmental_files'] loop
    if to_regclass('public.'||t) is not null then
      if not array['inspection_id','org_id']::text[]<@array(select attname::text from pg_attribute
        where attrelid=to_regclass('public.'||t) and attnum>0 and not attisdropped) then
        raise exception 'OB_RUNTIME_SOURCE_SCHEMA_REVIEW_REQUIRED: %',t; end if;
      execute format('drop trigger if exists ob_organization_source_guard on public.%I',t);
      execute format('create trigger ob_organization_source_guard before insert or update on public.%I for each row execute function public.ob_organization_source_guard()',t);
    end if;
  end loop;
end $$;

-- Restrictive policies retain every existing owner/lock policy. Non-OB resources
-- retain previous behavior. No grants are added to data tables.
alter table public.inspections enable row level security;
drop policy if exists ob_organization_boundary on public.inspections;
create policy ob_organization_boundary on public.inspections as restrictive for all to anon,authenticated
  using((inspection_family is not null and inspection_family<>'OB') or
    (inspection_family is null and type not in ('OB','STATUS')) or public.ob_organization_row_access(id)) with check(
    (inspection_family is not null and inspection_family<>'OB') or
    (inspection_family is null and type not in ('OB','STATUS')) or public.ob_organization_row_access(id));
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='inspection_id' and a.atttypid='uuid'::regtype and not a.attisdropped
    where n.nspname='public' and c.relkind in ('r','p') and
      (c.relname like 'inspection\_%' escape '\' or c.relname like 'ob\_%' escape '\')
      and c.relname not in ('ob_organization_bindings','ob_organization_binding_audit') loop
    execute format('alter table public.%I enable row level security',t.relname);
    execute format('drop policy if exists ob_organization_boundary on public.%I',t.relname);
    execute format('create policy ob_organization_boundary on public.%I as restrictive for all to anon,authenticated using(inspection_id is null or public.ob_organization_row_access(inspection_id)) with check(inspection_id is null or public.ob_organization_row_access(inspection_id))',t.relname);
  end loop;
end $$;

-- Storage enforcement for the existing inspection-id-prefixed OB image paths.
-- Property-media is shared and deliberately not reassigned to an organization.
create or replace function public.ob_organization_storage_access(p_bucket text,p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare id_text text;
begin
  if p_bucket<>'inspection-images' then return true; end if;
  id_text:=split_part(p_name,'/',1);
  if id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.ob_organization_row_access(id_text::uuid);
end $$;
drop policy if exists ob_organization_boundary on storage.objects;
create policy ob_organization_boundary on storage.objects as restrictive for all to anon,authenticated
  using(public.ob_organization_storage_access(bucket_id,name)) with check(public.ob_organization_storage_access(bucket_id,name));

revoke all on function public.ob_actor_has_organization_access(uuid,uuid),public.ob_assert_organization_inspection(uuid,uuid,uuid),
  public.ob_bind_created_inspection(uuid,uuid),public.ob_organization_identity_guard(),public.ob_organization_binding_required(),
  public.ob_organization_source_guard() from public,anon,authenticated,service_role;
revoke all on function public.ob_create_organization_inspection(uuid,uuid,uuid),public.ob_list_organization_inspections(uuid,uuid,uuid),
  public.ob_start_assignment_inspection(uuid,uuid,uuid,text),public.ob_start_status_assignment_inspection(uuid,uuid,uuid),
  public.ob_start_assignment_inspection_before_organization(uuid,uuid,uuid,text),
  public.ob_start_status_assignment_inspection_before_organization(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ob_create_organization_inspection(uuid,uuid,uuid),public.ob_list_organization_inspections(uuid,uuid,uuid),
  public.ob_start_assignment_inspection(uuid,uuid,uuid,text),public.ob_start_status_assignment_inspection(uuid,uuid,uuid) to service_role;
revoke all on function public.ob_inspection_matches_organization(uuid,uuid),public.ob_organization_row_access(uuid),
  public.ob_organization_storage_access(text,text) from public,anon,authenticated,service_role;
grant execute on function public.ob_inspection_matches_organization(uuid,uuid),public.ob_organization_row_access(uuid),
  public.ob_organization_storage_access(text,text) to anon,authenticated;
-- Inherited execution cannot be removed by revoking a direct grant. Stop the
-- transaction for an operator review instead of accepting such a client bypass.
do $$ declare f record; begin
  for f in select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any(array[
    'ob_actor_has_organization_access','ob_assert_organization_inspection','ob_bind_created_inspection',
    'ob_create_organization_inspection','ob_list_organization_inspections',
    'ob_start_assignment_inspection','ob_start_status_assignment_inspection',
    'ob_start_assignment_inspection_before_organization','ob_start_status_assignment_inspection_before_organization']) loop
    if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') then
      raise exception 'OB_RUNTIME_INHERITED_EXECUTE_REVIEW_REQUIRED: %',f.proname; end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
