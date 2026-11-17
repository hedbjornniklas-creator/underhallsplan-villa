-- Security Advisor remediation for eight reviewed client/catalogue tables.
-- Permissions only: no application rows or existing dependency policies change.
-- Preconditions deliberately stop on unexpected schema, policies or privileges.
-- Review org_members/buildings/properties RLS in the target before execution:
-- authenticated callers must see their own active membership/owned buildings.
-- This migration never adds a grant; service-role access is retained.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog;

do $$
declare
  target text;
  column_list text;
  boundary text;
  relation_oid oid;
  expected record;
  targets constant text[] := array[
    'basic_fields','maintenance_templates','building_basic_values',
    'profile_certifications','profile_addon_services',
    'platform_products','platform_modules','platform_roles'
  ];
  public_catalogues constant text[] := array[
    'platform_products','platform_modules','platform_roles'
  ];
  personal_tables constant text[] := array[
    'building_basic_values','profile_certifications','profile_addon_services'
  ];
begin
  if current_setting('server_version_num')::int < 170000 then
    raise exception 'CLIENT_TABLE_RLS_POSTGRES_17_REQUIRED';
  end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated')
    and (rolsuper or rolbypassrls or rolcreaterole))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER')
    or has_schema_privilege('anon','public','CREATE')
    or has_schema_privilege('authenticated','public','CREATE')
    or has_schema_privilege('anon','auth','CREATE')
    or has_schema_privilege('authenticated','auth','CREATE') then
    raise exception 'CLIENT_TABLE_RLS_UNSAFE_ROLE';
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role' and rolbypassrls)
    or not has_function_privilege('authenticated','auth.uid()','EXECUTE') then
    raise exception 'CLIENT_TABLE_RLS_REQUIRED_ROLE_ACCESS_MISSING';
  end if;

  -- Hold the dependency definitions stable without changing their policies.
  foreach target in array array['org_members','buildings','properties'] loop
    relation_oid := to_regclass(format('public.%I',target));
    if relation_oid is null then
      raise exception 'CLIENT_TABLE_RLS_DEPENDENCY_REVIEW_REQUIRED: %',target;
    end if;
    execute format('lock table public.%I in share mode',target);
    if not exists (select 1 from pg_class where oid=relation_oid and relkind='r'
      and relrowsecurity and pg_get_userbyid(relowner)='postgres'
      and not pg_has_role('anon',relowner,'MEMBER')
      and not pg_has_role('authenticated',relowner,'MEMBER'))
      or not has_table_privilege('authenticated',relation_oid,'SELECT') then
      raise exception 'CLIENT_TABLE_RLS_DEPENDENCY_REVIEW_REQUIRED: %',target;
    end if;
  end loop;
  if not exists (select 1 from pg_policy
    where polrelid='public.buildings'::regclass
      and polname='inspection_access_boundary' and not polpermissive
      and polcmd='*'
      and (select oid from pg_roles where rolname='authenticated')=any(polroles)) then
    raise exception 'CLIENT_TABLE_RLS_BUILDING_BOUNDARY_REVIEW_REQUIRED';
  end if;

  -- These identity columns define the reviewed authorization boundary.
  for expected in select * from (values
    ('org_members','org_id','uuid'),
    ('org_members','profile_id','uuid'),
    ('org_members','is_active','boolean'),
    ('properties','id','uuid'),
    ('properties','owner','uuid'),
    ('buildings','id','uuid'),
    ('buildings','property_id','uuid'),
    ('building_basic_values','building_id','uuid'),
    ('building_basic_values','field_id','uuid'),
    ('profile_certifications','org_id','uuid'),
    ('profile_certifications','profile_id','uuid'),
    ('profile_addon_services','org_id','uuid'),
    ('profile_addon_services','profile_id','uuid')
  ) as required(table_name,column_name,type_name) loop
    if not exists (select 1 from pg_attribute
      where attrelid=to_regclass(format('public.%I',expected.table_name))
      and attname=expected.column_name and attnum>0 and not attisdropped
      and atttypid=to_regtype(expected.type_name)) then
      raise exception 'CLIENT_TABLE_RLS_COLUMN_REVIEW_REQUIRED: %.%',
        expected.table_name,expected.column_name;
    end if;
  end loop;

  -- Acquire every target lock before changing any permissions. Existing policies
  -- must be reviewed explicitly instead of being dropped or silently combined.
  foreach target in array targets loop
    relation_oid := to_regclass(format('public.%I',target));
    if relation_oid is null then
      raise exception 'CLIENT_TABLE_RLS_RELATION_REVIEW_REQUIRED: %',target;
    end if;
    execute format('lock table public.%I in access exclusive mode',target);
    if not exists (select 1 from pg_class where oid=relation_oid and relkind='r'
      and pg_get_userbyid(relowner)='postgres' and not relrowsecurity
      and not relforcerowsecurity
      and not pg_has_role('anon',relowner,'MEMBER')
      and not pg_has_role('authenticated',relowner,'MEMBER')) then
      raise exception 'CLIENT_TABLE_RLS_RELATION_REVIEW_REQUIRED: %',target;
    end if;
    if exists (select 1 from pg_policy where polrelid=relation_oid) then
      raise exception 'CLIENT_TABLE_RLS_EXISTING_POLICY_REVIEW_REQUIRED: %',target;
    end if;
    if exists (select 1 from pg_attribute where attrelid=relation_oid
      and attnum>0 and not attisdropped and attacl is not null) then
      raise exception 'CLIENT_TABLE_RLS_COLUMN_GRANT_REVIEW_REQUIRED: %',target;
    end if;
    if not has_table_privilege('authenticated',relation_oid,'SELECT')
      or not has_table_privilege('service_role',relation_oid,'SELECT')
      or not has_table_privilege('service_role',relation_oid,'INSERT')
      or not has_table_privilege('service_role',relation_oid,'UPDATE')
      or not has_table_privilege('service_role',relation_oid,'DELETE')
      or (target=any(public_catalogues) and not has_table_privilege('anon',relation_oid,'SELECT'))
      or (target=any(personal_tables) and (
        not has_table_privilege('authenticated',relation_oid,'INSERT')
        or not has_table_privilege('authenticated',relation_oid,'UPDATE'))) then
      raise exception 'CLIENT_TABLE_RLS_REQUIRED_GRANT_MISSING: %',target;
    end if;
  end loop;

  foreach target in array targets loop
    relation_oid := to_regclass(format('public.%I',target));
    select string_agg(format('%I',attname),',' order by attnum) into column_list
      from pg_attribute where attrelid=relation_oid and attnum>0 and not attisdropped;

    if target=any(public_catalogues) then
      -- Retain the public catalogue reads explicitly preserved by the previous
      -- component-catalogue security release. Authority inputs stay server-only.
      execute format('revoke insert,update,delete,truncate,references,trigger,maintain on public.%I from public,anon,authenticated',target);
      execute format('revoke insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',
        column_list,column_list,column_list,target);
      execute format('create policy client_table_read on public.%I for select to anon,authenticated using (true)',target);
    else
      execute format('revoke all on public.%I from public,anon',target);
      execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.%I from public,anon',
        column_list,column_list,column_list,column_list,target);
      if target=any(personal_tables) then
        execute format('revoke delete,truncate,references,trigger,maintain on public.%I from authenticated',target);
        execute format('revoke references(%s) on public.%I from authenticated',column_list,target);
        if target='building_basic_values' then
          boundary := 'exists (select 1 from public.buildings building join public.properties property on property.id=building.property_id where building.id=building_basic_values.building_id and property.owner=(select auth.uid()))';
        else
          boundary := format('profile_id=(select auth.uid()) and exists (select 1 from public.org_members membership where membership.org_id=%I.org_id and membership.profile_id=(select auth.uid()) and membership.is_active)',target);
        end if;
        execute format('create policy client_table_read on public.%I for select to authenticated using (%s)',target,boundary);
        execute format('create policy client_table_insert on public.%I for insert to authenticated with check (%s)',target,boundary);
        execute format('create policy client_table_update on public.%I for update to authenticated using (%s) with check (%s)',target,boundary,boundary);
      else
        execute format('revoke insert,update,delete,truncate,references,trigger,maintain on public.%I from authenticated',target);
        execute format('revoke insert(%s),update(%s),references(%s) on public.%I from authenticated',
          column_list,column_list,column_list,target);
        execute format('create policy client_table_read on public.%I for select to authenticated using (true)',target);
      end if;
    end if;
    execute format('alter table public.%I enable row level security',target);

    -- Effective privilege checks catch unexpected inheritance and PUBLIC grants.
    if has_table_privilege('anon',relation_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('anon',relation_oid,'INSERT,UPDATE,REFERENCES')
      or has_table_privilege('authenticated',relation_oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('authenticated',relation_oid,'REFERENCES')
      or (not target=any(public_catalogues) and (
        has_table_privilege('anon',relation_oid,'SELECT')
        or has_any_column_privilege('anon',relation_oid,'SELECT')))
      or (not target=any(personal_tables) and (
        has_table_privilege('authenticated',relation_oid,'INSERT,UPDATE')
        or has_any_column_privilege('authenticated',relation_oid,'INSERT,UPDATE')))
      or not has_table_privilege('authenticated',relation_oid,'SELECT')
      or (target=any(personal_tables) and (
        not has_table_privilege('authenticated',relation_oid,'INSERT')
        or not has_table_privilege('authenticated',relation_oid,'UPDATE')))
      or (target=any(public_catalogues) and not has_table_privilege('anon',relation_oid,'SELECT'))
      or not has_table_privilege('service_role',relation_oid,'SELECT')
      or not has_table_privilege('service_role',relation_oid,'INSERT')
      or not has_table_privilege('service_role',relation_oid,'UPDATE')
      or not has_table_privilege('service_role',relation_oid,'DELETE') then
      raise exception 'CLIENT_TABLE_RLS_EFFECTIVE_GRANT_REVIEW_REQUIRED: %',target;
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
