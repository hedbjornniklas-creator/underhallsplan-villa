-- Per-member, opt-in READ access to colleagues' OB/STATUS assignments.
-- Requires organization administration, SQL05 OB runtime and latest STATUS overview.
-- No existing member is opted in. No inspection, owner, customer or report is changed.
-- Run the accompanying preflight first. Deploy SQL before the matching application.
begin;
set local lock_timeout='10s';

do $$ begin
  if to_regprocedure('public.organization_assert_admin(uuid,uuid)') is null
    or to_regprocedure('public.ob_actor_has_organization_access(uuid,uuid)') is null
    or to_regclass('public.ob_organization_bindings') is null then
    raise exception 'OB_VISIBILITY_PREREQUISITES_REQUIRED';
  end if;
end $$;

create table if not exists public.organization_member_ob_visibility (
  org_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  can_view_colleagues boolean not null default false,
  revision integer not null default 1 check(revision>0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(org_id,profile_id),
  foreign key(org_id,profile_id) references public.org_members(org_id,profile_id) on delete cascade
);
alter table public.organization_member_ob_visibility enable row level security;
revoke all on public.organization_member_ob_visibility from public,anon,authenticated,service_role;
grant select on public.organization_member_ob_visibility to service_role;
do $$ begin
  if has_table_privilege('anon','public.organization_member_ob_visibility','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.organization_member_ob_visibility','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role','public.organization_member_ob_visibility','INSERT,UPDATE,DELETE') then
    raise exception 'OB_VISIBILITY_INHERITED_TABLE_REVIEW_REQUIRED'; end if;
end $$;

-- An active membership or administrator role alone is not an OB module grant.
-- Managed organizations require their exact scoped inspector grant. The legacy
-- global inspector grant is accepted only while that organization's module is unmanaged.
create or replace function public.ob_actor_has_explicit_module_access(p_org uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_org is not null and p_actor is not null
    and exists(select 1 from public.org_members where org_id=p_org and profile_id=p_actor and is_active)
    and exists(
      select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard' and p.is_active
      join public.platform_modules m on m.id=a.module_id and m.product_id=p.id and m.key='inspections' and m.is_active
      join public.platform_roles r on r.id=a.role_id and r.product_id=p.id and r.key='inspector' and r.is_active
      where a.profile_id=p_actor and a.is_active and (a.expires_at is null or a.expires_at>now())
        and ((a.scope_type='organization' and a.scope_id=p_org::text)
          or (a.scope_type='global' and not exists(select 1 from public.organization_enabled_modules
            where org_id=p_org and module_key='inspections')))
        and not exists(select 1 from public.organization_enabled_modules
          where org_id=p_org and module_key='inspections' and not is_active))
$$;

create or replace function public.ob_actor_can_view_colleagues(p_org uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.ob_actor_has_explicit_module_access(p_org,p_actor) and exists(
    select 1 from public.organization_member_ob_visibility
    where org_id=p_org and profile_id=p_actor and can_view_colleagues)
$$;

-- The admin UI's editable module list deliberately hides unmanaged legacy
-- grants. Return visibility eligibility from the same strict predicate used by
-- the setter, in one bounded request, without changing module administration.
create or replace function public.organization_member_ob_visibility_list(p_actor uuid,p_org uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entries jsonb;
begin
  perform public.organization_assert_admin(p_actor,p_org);
  select coalesce(jsonb_agg(jsonb_build_object('profileId',member.profile_id,
    'canEnable',public.ob_actor_has_explicit_module_access(p_org,member.profile_id),
    'canViewColleagues',coalesce(v.can_view_colleagues,false),'revision',coalesce(v.revision,0))
    order by member.profile_id),'[]'::jsonb) into entries
  from (select profile_id from public.org_members where org_id=p_org order by profile_id limit 1001) member
  left join public.organization_member_ob_visibility v on v.org_id=p_org and v.profile_id=member.profile_id;
  if jsonb_array_length(entries)>1000 then raise exception 'ORG_DIRECTORY_TOO_LARGE'; end if;
  return entries;
end $$;

create or replace function public.organization_member_ob_visibility_set(
  p_actor uuid,p_org uuid,p_profile uuid,p_can_view boolean,p_revision integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved_row public.organization_member_ob_visibility; current_revision integer;
begin
  perform public.organization_assert_admin(p_actor,p_org);
  if p_profile is null or p_can_view is null or p_revision is null or p_revision<0 then
    raise exception 'ORG_INPUT_INVALID' using errcode='22023'; end if;
  perform 1 from public.org_members where org_id=p_org and profile_id=p_profile for update;
  if not found then raise exception 'ORG_MEMBER_REQUIRED' using errcode='42501'; end if;
  if p_can_view and not public.ob_actor_has_explicit_module_access(p_org,p_profile) then
    raise exception 'ORG_OB_VISIBILITY_MODULE_REQUIRED' using errcode='42501'; end if;
  select * into saved_row from public.organization_member_ob_visibility
    where org_id=p_org and profile_id=p_profile for update;
  current_revision:=coalesce(saved_row.revision,0);
  if p_revision<>current_revision then raise exception 'ORG_CONFLICT' using errcode='40001'; end if;
  insert into public.organization_member_ob_visibility(org_id,profile_id,can_view_colleagues,revision,updated_by,updated_at)
    values(p_org,p_profile,p_can_view,current_revision+1,p_actor,clock_timestamp())
    on conflict(org_id,profile_id) do update set can_view_colleagues=excluded.can_view_colleagues,
      revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at
    returning * into saved_row;
  return jsonb_build_object('saved',true,'canViewColleagues',saved_row.can_view_colleagues,'revision',saved_row.revision);
end $$;

-- Clearing retains the row/revision so an old browser cannot replay a stale opt-in.
-- Membership revocation is immediate. Grant edits are checked before and after:
-- BEFORE catches renewal after expiry; deferred AFTER checks final grants, avoiding
-- a false reset when the member editor temporarily disables and restores a grant.
create or replace function public.ob_visibility_reset_invalid()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_row jsonb; new_row jsonb;
begin
  if tg_op<>'INSERT' then old_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_row:=to_jsonb(new); end if;
  update public.organization_member_ob_visibility v set can_view_colleagues=false,
    revision=v.revision+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where v.can_view_colleagues and (
    (tg_table_name='org_members' and v.org_id=(old_row->>'org_id')::uuid
      and v.profile_id=(old_row->>'profile_id')::uuid
      and (tg_op='DELETE' or not coalesce((new_row->>'is_active')::boolean,false)))
    or (tg_table_name='platform_access_assignments'
      and v.profile_id in ((old_row->>'profile_id')::uuid,(new_row->>'profile_id')::uuid)
      and (tg_when<>'BEFORE' or exists(select 1 from public.platform_access_assignments expired
        join public.platform_modules module on module.id=expired.module_id and module.key='inspections'
        where expired.profile_id=v.profile_id and expired.expires_at<=now() and expired.expires_at>=v.updated_at
          and (expired.scope_type='global' or (expired.scope_type='organization' and expired.scope_id=v.org_id::text))))
      and not public.ob_actor_has_explicit_module_access(v.org_id,v.profile_id))
    or (tg_table_name='organization_enabled_modules' and tg_when<>'BEFORE'
      and v.org_id in ((old_row->>'org_id')::uuid,(new_row->>'org_id')::uuid)
      and not public.ob_actor_has_explicit_module_access(v.org_id,v.profile_id))
    or (tg_table_name in ('platform_products','platform_modules','platform_roles') and tg_when<>'BEFORE'
      and not public.ob_actor_has_explicit_module_access(v.org_id,v.profile_id))
  );
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists ob_visibility_member_reset on public.org_members;
create trigger ob_visibility_member_reset after update or delete on public.org_members
  for each row execute function public.ob_visibility_reset_invalid();
do $$ declare t text; begin
  foreach t in array array['platform_access_assignments','organization_enabled_modules','platform_products','platform_modules','platform_roles'] loop
    execute format('drop trigger if exists ob_visibility_before_reset on public.%I',t);
    execute format('create trigger ob_visibility_before_reset before insert or update or delete on public.%I for each row execute function public.ob_visibility_reset_invalid()',t);
    execute format('drop trigger if exists ob_visibility_after_reset on public.%I',t);
    execute format('create constraint trigger ob_visibility_after_reset after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.ob_visibility_reset_invalid()',t);
  end loop;
end $$;

create or replace function public.ob_inspection_visibility_access(p_inspection uuid,p_org uuid,p_actor uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select public.ob_actor_has_organization_access(p_org,p_actor) and exists(
    select 1 from public.ob_organization_bindings b join public.inspections i on i.id=b.inspection_id
    join public.properties p on p.id=i.property_id
    where b.inspection_id=p_inspection and b.org_id=p_org
      and (i.inspection_family='OB' or (i.inspection_family is null and i.type in ('OB','STATUS')))
      and (p.owner=p_actor or (not p_write and public.ob_actor_can_view_colleagues(p_org,p_actor))))
$$;

-- These two boolean-only client predicates derive identity from auth.uid().
-- The caller cannot supply another actor. Reads may include colleagues, writes
-- require both the responsible profile and the linked inspection's actual owner.
create or replace function public.ob_assignment_visibility_access(
  p_org uuid,p_responsible uuid,p_inspection uuid,p_write boolean
) returns boolean language sql stable security definer set search_path='' as $$
  select public.ob_actor_has_organization_access(p_org,auth.uid())
    and (p_responsible=auth.uid() or (not p_write and public.ob_actor_can_view_colleagues(p_org,auth.uid())))
    and (p_inspection is null or public.ob_inspection_visibility_access(p_inspection,p_org,auth.uid(),p_write))
$$;
create or replace function public.ob_assignment_link_visibility_access(p_assignment uuid,p_org uuid,p_write boolean)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.assignments a where a.id=p_assignment and a.org_id=p_org
    and (a.assignment_type not in ('OB','STATUS') or public.ob_assignment_visibility_access(
      a.org_id,a.responsible_profile_id,a.inspection_id,p_write)))
$$;

-- Preserve permissive policies and every other module's behavior. Restrictive
-- SELECT/INSERT/UPDATE/DELETE boundaries cannot be bypassed by older org policies.
alter table public.assignments enable row level security;
alter table public.assignment_links enable row level security;
do $$ declare t text; predicate text; begin
  -- Explicit reviewed inventory: optional outbound messages with no assignment
  -- retain their old rules. TU/EB-specific relations are not changed.
  foreach t in array array['assignments','assignment_links','assignment_acceptances','assignment_addon_orders',
    'assignment_confirmation_snapshots','assignment_confirmation_pdfs','assignment_link_incidents','outbound_messages'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    if t<>'assignments' and not array['assignment_id','org_id']::text[]<@array(
      select attname::text from pg_attribute where attrelid=to_regclass('public.'||t) and attnum>0 and not attisdropped) then
      raise exception 'OB_VISIBILITY_CHILD_SCHEMA_REVIEW_REQUIRED: %',t; end if;
    execute format('alter table public.%I enable row level security',t);
    predicate:=case t when 'assignments' then
      '(assignment_type not in (''OB'',''STATUS'') or public.ob_assignment_visibility_access(org_id,responsible_profile_id,inspection_id,%s))'
      else '(assignment_id is null or public.ob_assignment_link_visibility_access(assignment_id,org_id,%s))' end;
    execute format('drop policy if exists ob_visibility_select on public.%I',t);
    execute format('drop policy if exists ob_visibility_insert on public.%I',t);
    execute format('drop policy if exists ob_visibility_update on public.%I',t);
    execute format('drop policy if exists ob_visibility_delete on public.%I',t);
    execute format('create policy ob_visibility_select on public.%I as restrictive for select to anon,authenticated using(%s)',t,format(predicate,'false'));
    execute format('create policy ob_visibility_insert on public.%I as restrictive for insert to anon,authenticated with check(%s)',t,format(predicate,'true'));
    execute format('create policy ob_visibility_update on public.%I as restrictive for update to anon,authenticated using(%s) with check(%s)',t,format(predicate,'true'),format(predicate,'true'));
    execute format('create policy ob_visibility_delete on public.%I as restrictive for delete to anon,authenticated using(%s)',t,format(predicate,'true'));
  end loop;
end $$;

-- Prevent a client changing its own OB to another module and then using the
-- other module's organization-wide policies to transfer/reclassify ownership.
create or replace function public.ob_assignment_visibility_identity_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true) in ('anon','authenticated')
    and (old.assignment_type in ('OB','STATUS') or new.assignment_type in ('OB','STATUS'))
    and (new.org_id is distinct from old.org_id
      or new.responsible_profile_id is distinct from old.responsible_profile_id
      or (new.assignment_type in ('OB','STATUS')) is distinct from (old.assignment_type in ('OB','STATUS'))) then
    raise exception 'OB_ASSIGNMENT_OWNER_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists ob_assignment_visibility_identity_guard on public.assignments;
create trigger ob_assignment_visibility_identity_guard before update on public.assignments
  for each row execute function public.ob_assignment_visibility_identity_guard();

-- Service-only starts and reissues must enforce the same responsible owner as
-- direct writes. The older assertion admitted organization administrators.
create or replace function public.ob_assert_assignment_visibility_owner(p_assignment uuid,p_org uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.ob_actor_has_organization_access(p_org,p_actor) or not exists(
    select 1 from public.assignments a where a.id=p_assignment and a.org_id=p_org
      and a.assignment_type in ('OB','STATUS') and a.responsible_profile_id=p_actor
      and (a.inspection_id is null or public.ob_inspection_visibility_access(a.inspection_id,p_org,p_actor,true))) then
    raise exception 'OB_ASSIGNMENT_FORBIDDEN' using errcode='42501'; end if;
end $$;
create or replace function public.ob_assert_assignment_actor(p_assignment_id uuid,p_org_id uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.ob_assert_assignment_visibility_owner(p_assignment_id,p_org_id,p_actor);
  if not exists(select 1 from public.assignments where id=p_assignment_id and assignment_type='OB') then
    raise exception 'OB_ASSIGNMENT_FORBIDDEN' using errcode='42501'; end if;
end $$;
create or replace function public.ob_start_status_assignment_inspection(p_assignment_id uuid,p_org_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; expected uuid;
begin
  perform public.ob_assert_assignment_visibility_owner(p_assignment_id,p_org_id,p_actor);
  result:=public.ob_start_status_assignment_inspection_before_organization(p_assignment_id,p_org_id,p_actor);
  select inspection_id into expected from public.assignments where id=p_assignment_id and org_id=p_org_id;
  if expected is null or expected is distinct from (result->>'inspectionId')::uuid then raise exception 'OB_ORGANIZATION_MISMATCH'; end if;
  if not exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id
    where i.id=expected and p.owner=p_actor) then raise exception 'OB_ORGANIZATION_FORBIDDEN'; end if;
  perform public.ob_bind_created_inspection(expected,p_org_id);
  return result||jsonb_build_object('orgId',p_org_id);
end $$;

create or replace function public.ob_list_organization_inspections(p_org_id uuid,p_actor uuid,p_property_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.ob_actor_has_organization_access(p_org_id,p_actor) then
    raise exception 'OB_ORGANIZATION_FORBIDDEN' using errcode='42501'; end if;
  if p_property_id is not null and not exists(select 1 from public.properties where id=p_property_id and owner=p_actor)
    and not exists(select 1 from public.inspections i
    where i.property_id=p_property_id and public.ob_inspection_visibility_access(i.id,p_org_id,p_actor,false)) then
    raise exception 'OB_ORGANIZATION_FORBIDDEN' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(row_data order by created_at desc,id),'[]'::jsonb) from (
    select i.id,i.created_at,
      (select jsonb_object_agg(k,to_jsonb(i)->k) from unnest(array['id','property_id','date','type','status','inspector_name','created_at',
        'customer_name','client_name','client_contact','assignment_number','locked_at','locked_by']) k)
      ||jsonb_build_object('canEdit',p.owner=p_actor,
        'property',(select jsonb_object_agg(k,to_jsonb(p)->k) from unnest(array['id','name','address','postal_code','city']) k),
        'snapshot',case when s.inspection_id is null then null else (select jsonb_object_agg(k,to_jsonb(s)->k)
          from unnest(array['inspection_id','address','postal_code','city','client_name']) k) end,
        'hasReadyPdf',exists(select 1 from public.inspection_report_links r where r.inspection_id=i.id and r.org_id=p_org_id
          and r.revoked_at is null and (nullif(btrim(to_jsonb(r)->>'pdf_base64'),'') is not null or
            (nullif(btrim(to_jsonb(r)->>'pdf_storage_bucket'),'') is not null and
             nullif(btrim(to_jsonb(r)->>'pdf_storage_path'),'') is not null and
             lower(btrim(to_jsonb(r)->>'pdf_status'))='ready')))) as row_data
    from public.ob_organization_bindings b join public.inspections i on i.id=b.inspection_id
    join public.properties p on p.id=i.property_id left join public.ob_property_snapshot s on s.inspection_id=i.id
    where b.org_id=p_org_id and public.ob_inspection_visibility_access(i.id,p_org_id,p_actor,false)
      and (p_property_id is null or p.id=p_property_id)) rows);
end $$;

-- Promote only the reviewed latest STATUS overview. Every graph source now has
-- explicit visibility predicates; inspection/child table RLS remains owner-only.
-- Hash the complete normalized prior body before any definer promotion. Reruns
-- reverse precisely these changes and compare the same reviewed hash.
do $$ declare f record; source text; rewritten text; before_text text; after_text text; pair record;
begin
  for f in select p.oid,p.proname,p.prosrc from pg_proc p where p.oid in (
    to_regprocedure('public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)'),
    to_regprocedure('public.ob_overview_item_flags(uuid,uuid,uuid)')) loop
    source:=replace(f.prosrc,chr(13),'');
    -- Reverse an earlier installation of this exact migration for idempotency.
    for pair in select * from (values
      ('not coalesce(public.is_org_member(p_org_id), false)','not public.ob_actor_has_organization_access(p_org_id,auth.uid())'),
      ('from public.properties p where p.owner = auth.uid()', 'from public.properties p where p.owner = auth.uid() or public.ob_actor_can_view_colleagues(p_org_id,auth.uid())'),
      ('public.ob_inspection_matches_organization(i.id,p_org_id)', 'public.ob_inspection_visibility_access(i.id,p_org_id,auth.uid(),false)'),
      ('from public.assignments a where a.org_id = p_org_id and a.assignment_type in (''OB'', ''STATUS'')',
       'from public.assignments a where a.org_id = p_org_id and a.assignment_type in (''OB'', ''STATUS'') and public.ob_assignment_visibility_access(a.org_id,a.responsible_profile_id,a.inspection_id,false)'),
      ('from public.ob_assignment_workflows w where w.org_id = p_org_id and (',
       'from public.ob_assignment_workflows w where w.org_id = p_org_id and public.ob_inspection_visibility_access(w.inspection_id,p_org_id,auth.uid(),false) and ('),
      ('where id = p_assignment_id and org_id = p_org_id and assignment_type in (''OB'', ''STATUS'');',
       'where id = p_assignment_id and org_id = p_org_id and assignment_type in (''OB'', ''STATUS'') and public.ob_assignment_visibility_access(org_id,responsible_profile_id,inspection_id,false);'),
      ('and current_a.org_id = p_org_id and current_a.assignment_type = ''OB'';',
       'and current_a.org_id = p_org_id and current_a.assignment_type = ''OB'' and public.ob_assignment_visibility_access(current_a.org_id,current_a.responsible_profile_id,current_a.inspection_id,false) and public.ob_inspection_visibility_access(w.inspection_id,p_org_id,auth.uid(),false);'),
      ('''inspection'', p.inspection,', '''canEdit'', case when p.assignment_id is not null then exists(select 1 from public.assignments editable where editable.id=p.assignment_id and public.ob_assignment_visibility_access(editable.org_id,editable.responsible_profile_id,editable.inspection_id,true)) else public.ob_inspection_visibility_access(p.inspection_id,p_org_id,auth.uid(),true) end, ''inspection'', p.inspection,')
    ) changes(original,replacement) loop
      source:=replace(source,pair.replacement,pair.original);
    end loop;
    if md5(source)<>(case f.proname when 'ob_overview_page' then '0813cb2c6d2ff00e970c03978f77ce44'
      else 'ce04b1d630494aff0d3cf057d7ea909f' end) then
      raise exception 'OB_VISIBILITY_OVERVIEW_REVIEW_REQUIRED: %',f.proname;
    end if;
    rewritten:=source;
    -- The replacements are applied again only after verifying the whole body.
    for pair in select * from (values
      ('not coalesce(public.is_org_member(p_org_id), false)','not public.ob_actor_has_organization_access(p_org_id,auth.uid())'),
      ('from public.properties p where p.owner = auth.uid()', 'from public.properties p where p.owner = auth.uid() or public.ob_actor_can_view_colleagues(p_org_id,auth.uid())'),
      ('public.ob_inspection_matches_organization(i.id,p_org_id)', 'public.ob_inspection_visibility_access(i.id,p_org_id,auth.uid(),false)'),
      ('from public.assignments a where a.org_id = p_org_id and a.assignment_type in (''OB'', ''STATUS'')',
       'from public.assignments a where a.org_id = p_org_id and a.assignment_type in (''OB'', ''STATUS'') and public.ob_assignment_visibility_access(a.org_id,a.responsible_profile_id,a.inspection_id,false)'),
      ('from public.ob_assignment_workflows w where w.org_id = p_org_id and (',
       'from public.ob_assignment_workflows w where w.org_id = p_org_id and public.ob_inspection_visibility_access(w.inspection_id,p_org_id,auth.uid(),false) and ('),
      ('where id = p_assignment_id and org_id = p_org_id and assignment_type in (''OB'', ''STATUS'');',
       'where id = p_assignment_id and org_id = p_org_id and assignment_type in (''OB'', ''STATUS'') and public.ob_assignment_visibility_access(org_id,responsible_profile_id,inspection_id,false);'),
      ('and current_a.org_id = p_org_id and current_a.assignment_type = ''OB'';',
       'and current_a.org_id = p_org_id and current_a.assignment_type = ''OB'' and public.ob_assignment_visibility_access(current_a.org_id,current_a.responsible_profile_id,current_a.inspection_id,false) and public.ob_inspection_visibility_access(w.inspection_id,p_org_id,auth.uid(),false);'),
      ('''inspection'', p.inspection,', '''canEdit'', case when p.assignment_id is not null then exists(select 1 from public.assignments editable where editable.id=p.assignment_id and public.ob_assignment_visibility_access(editable.org_id,editable.responsible_profile_id,editable.inspection_id,true)) else public.ob_inspection_visibility_access(p.inspection_id,p_org_id,auth.uid(),true) end, ''inspection'', p.inspection,')
    ) changes(original,replacement) loop
      rewritten:=replace(rewritten,pair.original,pair.replacement);
    end loop;
    execute replace(pg_get_functiondef(f.oid),f.prosrc,rewritten);
    execute format('alter function %s security definer',f.oid::regprocedure);
  end loop;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace
    and proname in ('ob_overview_page','ob_overview_item_flags'))<>2 then
    raise exception 'OB_VISIBILITY_OVERVIEW_REVIEW_REQUIRED'; end if;
end $$;

revoke all on function public.ob_actor_has_explicit_module_access(uuid,uuid),public.ob_actor_can_view_colleagues(uuid,uuid),
  public.ob_inspection_visibility_access(uuid,uuid,uuid,boolean),public.ob_visibility_reset_invalid(),
  public.ob_assignment_visibility_identity_guard(),public.ob_assert_assignment_visibility_owner(uuid,uuid,uuid),
  public.ob_assert_assignment_actor(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.organization_member_ob_visibility_list(uuid,uuid),public.organization_member_ob_visibility_set(uuid,uuid,uuid,boolean,integer),
  public.ob_list_organization_inspections(uuid,uuid,uuid),public.ob_start_status_assignment_inspection(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.organization_member_ob_visibility_list(uuid,uuid),public.organization_member_ob_visibility_set(uuid,uuid,uuid,boolean,integer),
  public.ob_list_organization_inspections(uuid,uuid,uuid),public.ob_actor_can_view_colleagues(uuid,uuid),
  public.ob_start_status_assignment_inspection(uuid,uuid,uuid) to service_role;
revoke all on function public.ob_assignment_visibility_access(uuid,uuid,uuid,boolean),
  public.ob_assignment_link_visibility_access(uuid,uuid,boolean),
  public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer),
  public.ob_overview_item_flags(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ob_assignment_visibility_access(uuid,uuid,uuid,boolean),
  public.ob_assignment_link_visibility_access(uuid,uuid,boolean),
  public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer),
  public.ob_overview_item_flags(uuid,uuid,uuid) to authenticated;

-- Verify effective privileges too: unexpected inherited grants abort installation.
do $$ declare f record; client_allowed boolean; service_allowed boolean; begin
  for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in (
    'ob_actor_has_explicit_module_access','ob_actor_can_view_colleagues','ob_inspection_visibility_access',
    'ob_visibility_reset_invalid','ob_assignment_visibility_identity_guard','ob_assert_assignment_visibility_owner','ob_assert_assignment_actor',
    'ob_start_status_assignment_inspection','organization_member_ob_visibility_list','organization_member_ob_visibility_set',
    'ob_list_organization_inspections','ob_assignment_visibility_access','ob_assignment_link_visibility_access',
    'ob_overview_page','ob_overview_item_flags') loop
    client_allowed:=f.proname in ('ob_assignment_visibility_access','ob_assignment_link_visibility_access','ob_overview_page','ob_overview_item_flags');
    service_allowed:=f.proname in ('organization_member_ob_visibility_list','organization_member_ob_visibility_set','ob_list_organization_inspections','ob_actor_can_view_colleagues','ob_start_status_assignment_inspection');
    if has_function_privilege('anon',f.oid,'EXECUTE')
      or has_function_privilege('authenticated',f.oid,'EXECUTE')<>client_allowed
      or has_function_privilege('service_role',f.oid,'EXECUTE')<>service_allowed then
      raise exception 'OB_VISIBILITY_INHERITED_EXECUTE_REVIEW_REQUIRED: %',f.proname; end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
