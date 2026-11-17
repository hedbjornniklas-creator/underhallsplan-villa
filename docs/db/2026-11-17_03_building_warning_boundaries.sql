-- Contain legacy permissive policies on three reviewed building child tables.
-- Permissions only: existing SELECT/INSERT/UPDATE policies and rows are retained.
-- No GRANT is added. The authenticated property owner retains existing access;
-- server-role access remains unchanged. Preconditions stop on unreviewed drift.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog;

do $$
declare
  target text;
  relation_oid oid;
  column_list text;
  boundary text;
  required record;
  actual_columns text[];
  targets constant text[] := array['building_disclosures','building_facts','spaces'];
begin
  if current_setting('server_version_num')::int < 170000 then
    raise exception 'BUILDING_WARNING_POSTGRES_17_REQUIRED';
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
    raise exception 'BUILDING_WARNING_UNSAFE_ROLE';
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role' and rolbypassrls)
    or not has_function_privilege('authenticated','auth.uid()','EXECUTE') then
    raise exception 'BUILDING_WARNING_REQUIRED_ROLE_ACCESS_MISSING';
  end if;

  -- Freeze the reviewed parent definitions while installing the child boundary.
  foreach target in array array['buildings','properties'] loop
    relation_oid := to_regclass(format('public.%I',target));
    if relation_oid is null then
      raise exception 'BUILDING_WARNING_DEPENDENCY_REVIEW_REQUIRED: %',target;
    end if;
    execute format('lock table public.%I in share mode',target);
    if not exists (select 1 from pg_class where oid=relation_oid and relkind='r'
        and relrowsecurity and pg_get_userbyid(relowner)='postgres'
        and not pg_has_role('anon',relowner,'MEMBER')
        and not pg_has_role('authenticated',relowner,'MEMBER'))
      or not has_table_privilege('authenticated',relation_oid,'SELECT')
      or exists (select 1 from pg_inherits
        where inhrelid=relation_oid or inhparent=relation_oid) then
      raise exception 'BUILDING_WARNING_DEPENDENCY_REVIEW_REQUIRED: %',target;
    end if;
  end loop;
  if not exists (select 1 from pg_policy
      where polrelid='public.buildings'::regclass
        and polname='inspection_access_boundary' and not polpermissive
        and polcmd='*'
        and polroles=array[(select oid from pg_roles where rolname='authenticated')]) then
    raise exception 'BUILDING_WARNING_PARENT_BOUNDARY_REVIEW_REQUIRED';
  end if;
  for required in select * from (values
    ('properties','id','uuid'), ('properties','owner','uuid'),
    ('buildings','id','uuid'), ('buildings','property_id','uuid')
  ) as expected(table_name,column_name,type_name) loop
    if not exists (select 1 from pg_attribute
        where attrelid=to_regclass(format('public.%I',required.table_name))
          and attname=required.column_name and attnum>0 and not attisdropped
          and atttypid=to_regtype(required.type_name)) then
      raise exception 'BUILDING_WARNING_PARENT_COLUMN_REVIEW_REQUIRED: %.%',
        required.table_name,required.column_name;
    end if;
  end loop;
  if not exists (select 1 from pg_constraint fk
      where fk.conrelid='public.buildings'::regclass and fk.contype='f'
        and fk.confrelid='public.properties'::regclass
        and fk.conkey=array[(select attnum from pg_attribute
          where attrelid='public.buildings'::regclass and attname='property_id')]
        and fk.confkey=array[(select attnum from pg_attribute
          where attrelid='public.properties'::regclass and attname='id')]) then
    raise exception 'BUILDING_WARNING_PARENT_FK_REVIEW_REQUIRED';
  end if;

  -- Acquire all target locks and validate every definition before any mutation.
  foreach target in array targets loop
    relation_oid := to_regclass(format('public.%I',target));
    if relation_oid is null then
      raise exception 'BUILDING_WARNING_RELATION_REVIEW_REQUIRED: %',target;
    end if;
    execute format('lock table public.%I in access exclusive mode',target);
    if not exists (select 1 from pg_class where oid=relation_oid and relkind='r'
        and relrowsecurity and not relforcerowsecurity
        and pg_get_userbyid(relowner)='postgres'
        and not pg_has_role('anon',relowner,'MEMBER')
        and not pg_has_role('authenticated',relowner,'MEMBER'))
      or exists (select 1 from pg_inherits
        where inhrelid=relation_oid or inhparent=relation_oid) then
      raise exception 'BUILDING_WARNING_RELATION_REVIEW_REQUIRED: %',target;
    end if;
    select array_agg(attname||':'||format_type(atttypid,atttypmod) order by attnum)
      into actual_columns from pg_attribute
      where attrelid=relation_oid and attnum>0 and not attisdropped;
    if actual_columns is distinct from (case target
      when 'building_disclosures' then array['id:uuid','building_id:uuid','title:text',
        'content:text','link_url:text','created_at:timestamp with time zone']
      when 'building_facts' then array['id:uuid','building_id:uuid','key:text',
        'value:text','created_at:timestamp with time zone']
      when 'spaces' then array['id:uuid','building_id:uuid','name:text','category:text',
        'notes:text','cover_path:text','created_at:timestamp with time zone','floor:text'] end) then
      raise exception 'BUILDING_WARNING_COLUMN_REVIEW_REQUIRED: %',target;
    end if;
    if exists (select 1 from pg_attribute where attrelid=relation_oid
        and attnum>0 and not attisdropped and attacl is not null) then
      raise exception 'BUILDING_WARNING_COLUMN_GRANT_REVIEW_REQUIRED: %',target;
    end if;
    if not exists (select 1 from pg_constraint fk
        where fk.conrelid=relation_oid and fk.contype='f'
          and fk.confrelid='public.buildings'::regclass
          and fk.conkey=array[(select attnum from pg_attribute
            where attrelid=relation_oid and attname='building_id')]
          and fk.confkey=array[(select attnum from pg_attribute
            where attrelid='public.buildings'::regclass and attname='id')]) then
      raise exception 'BUILDING_WARNING_FK_REVIEW_REQUIRED: %',target;
    end if;
    if (select count(*) from pg_policy where polrelid=relation_oid)<>3 then
      raise exception 'BUILDING_WARNING_POLICY_REVIEW_REQUIRED: %',target;
    end if;
    for required in select * from (values
      ('building_disclosures','disclosures ins','a',null::text,'true'),
      ('building_disclosures','disclosures select','r','true',null::text),
      ('building_disclosures','disclosures upd','w','true',null::text),
      ('building_facts','facts ins','a',null::text,'true'),
      ('building_facts','facts select','r','true',null::text),
      ('building_facts','facts upd','w','true',null::text),
      ('spaces','spaces insert authed','a',null::text,'true'),
      ('spaces','spaces select authed','r','true',null::text),
      ('spaces','spaces update authed','w','true',null::text)
    ) as expected(table_name,policy_name,command,qual,with_check)
      where table_name=target loop
      if not exists (select 1 from pg_policy p where p.polrelid=relation_oid
          and p.polname=required.policy_name and p.polcmd::text=required.command
          and p.polpermissive
          and p.polroles=array[(select oid from pg_roles where rolname='authenticated')]
          and pg_get_expr(p.polqual,p.polrelid) is not distinct from required.qual
          and pg_get_expr(p.polwithcheck,p.polrelid) is not distinct from required.with_check) then
        raise exception 'BUILDING_WARNING_POLICY_REVIEW_REQUIRED: %.%',target,required.policy_name;
      end if;
    end loop;
    if not has_table_privilege('authenticated',relation_oid,'SELECT')
      or not has_table_privilege('authenticated',relation_oid,'INSERT')
      or not has_table_privilege('authenticated',relation_oid,'UPDATE')
      or not has_table_privilege('service_role',relation_oid,'SELECT')
      or not has_table_privilege('service_role',relation_oid,'INSERT')
      or not has_table_privilege('service_role',relation_oid,'UPDATE')
      or not has_table_privilege('service_role',relation_oid,'DELETE') then
      raise exception 'BUILDING_WARNING_REQUIRED_GRANT_MISSING: %',target;
    end if;
  end loop;

  foreach target in array targets loop
    relation_oid := to_regclass(format('public.%I',target));
    select string_agg(format('%I',attname),',' order by attnum) into column_list
      from pg_attribute where attrelid=relation_oid and attnum>0 and not attisdropped;
    execute format('revoke all on public.%I from public,anon',target);
    execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.%I from public,anon',
      column_list,column_list,column_list,column_list,target);
    execute format('revoke delete,truncate,references,trigger,maintain on public.%I from authenticated',target);
    execute format('revoke references(%s) on public.%I from authenticated',column_list,target);
    boundary := format('exists (select 1 from public.buildings building
      join public.properties property on property.id=building.property_id
      where building.id=%I.building_id and property.owner=(select auth.uid()))',target);
    execute format('create policy building_warning_owner_boundary on public.%I
      as restrictive for all to authenticated using (%s) with check (%s)',target,boundary,boundary);

    if has_table_privilege('anon',relation_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('anon',relation_oid,'SELECT,INSERT,UPDATE,REFERENCES')
      or has_table_privilege('authenticated',relation_oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('authenticated',relation_oid,'REFERENCES')
      or not has_table_privilege('authenticated',relation_oid,'SELECT')
      or not has_table_privilege('authenticated',relation_oid,'INSERT')
      or not has_table_privilege('authenticated',relation_oid,'UPDATE')
      or not has_table_privilege('service_role',relation_oid,'SELECT')
      or not has_table_privilege('service_role',relation_oid,'INSERT')
      or not has_table_privilege('service_role',relation_oid,'UPDATE')
      or not has_table_privilege('service_role',relation_oid,'DELETE') then
      raise exception 'BUILDING_WARNING_EFFECTIVE_GRANT_REVIEW_REQUIRED: %',target;
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
