-- SEPARATE SECURITY RELEASE. Review COMPONENT_CATALOGUE_ACCESS.md first.
-- Protects the existing admin predicate's inputs as well as catalogue writes.
-- No rows, role assignments, formulas, PDFs or Storage files are changed.
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog;
-- After review only, add this inside this transaction when executing:
-- set local app.component_catalogue_access_approved = 'true';

do $$
declare
  target text;
  columns_list text;
  column_name text;
  profile_columns constant text[] := array[
    'id','full_name','created_at','org_name','logo_url','phone','email','company_name',
    'company_orgno','company_address','company_postal_code','company_city',
    'avatar_path','logo_path','signature_path'
  ];
begin
  if current_setting('app.component_catalogue_access_approved',true) is distinct from 'true' then
    raise exception 'COMPONENT_CATALOGUE_REVIEW_REQUIRED';
  end if;
  if current_setting('server_version_num')::int < 170000 then
    raise exception 'COMPONENT_CATALOGUE_POSTGRES_17_REQUIRED';
  end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls or rolcreaterole))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER')
    or has_schema_privilege('anon','public','CREATE') or has_schema_privilege('authenticated','public','CREATE')
    or has_schema_privilege('anon','auth','CREATE') or has_schema_privilege('authenticated','auth','CREATE') then
    raise exception 'COMPONENT_CATALOGUE_UNSAFE_ROLE';
  end if;
  -- Do not silently replace this shared TU/admin helper or change its role semantics.
  if not exists (select 1 from pg_proc where oid=to_regprocedure('public.is_hushub_besiktapp_admin()')
    and prosecdef and pg_get_userbyid(proowner)='postgres'
    and md5(replace(pg_get_functiondef(oid),chr(13),''))='054a760b8f58c70e12e2aeb2c7fb214b') then
    raise exception 'COMPONENT_CATALOGUE_ADMIN_HELPER_REVIEW_REQUIRED';
  end if;
  if not exists (select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.profiles'::regclass and a.attname='is_admin'
    and a.atttypid='boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false') then
    raise exception 'COMPONENT_CATALOGUE_PROFILE_DEFAULT_REVIEW_REQUIRED';
  end if;

  foreach target in array array['profiles','platform_products','platform_modules','platform_roles','platform_access_assignments','component_types'] loop
    if not exists (select 1 from pg_class where oid=to_regclass(format('public.%I',target))
      and relkind='r' and pg_get_userbyid(relowner)='postgres'
      and not pg_has_role('anon',relowner,'MEMBER') and not pg_has_role('authenticated',relowner,'MEMBER')) then
      raise exception 'COMPONENT_CATALOGUE_UNSAFE_RELATION: %',target;
    end if;
    execute format('lock table public.%I in access exclusive mode',target);
    select string_agg(format('%I',attname),',') into columns_list from pg_attribute
      where attrelid=format('public.%I',target)::regclass and attnum>0 and not attisdropped;

    if target in ('platform_products','platform_modules','platform_roles') then
      -- Preserve existing public catalogue reads; only trusted server code edits roles.
      execute format('revoke insert,update,delete,truncate,references,trigger,maintain on public.%I from public,anon,authenticated',target);
      execute format('revoke insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',
        columns_list,columns_list,columns_list,target);
    else
      execute format('revoke all on public.%I from public,anon,authenticated',target);
      execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',
        columns_list,columns_list,columns_list,columns_list,target);
    end if;

    if target='profiles' then
      grant select on public.profiles to authenticated;
      select string_agg(format('%I',c),',') into columns_list from unnest(profile_columns) c;
      execute format('grant insert(%s),update(%s) on public.profiles to authenticated',columns_list,columns_list);
      alter table public.profiles enable row level security;
      drop policy if exists profile_identity_boundary on public.profiles;
      create policy profile_identity_boundary on public.profiles as restrictive for all to authenticated
        using (id=(select auth.uid())) with check (id=(select auth.uid()));
      -- Retain the existing permissive self-profile policies; do not add sharing.
      for column_name in select attname from pg_attribute where attrelid='public.profiles'::regclass
        and attnum>0 and not attisdropped and not (attname=any(profile_columns)) loop
        if has_column_privilege('authenticated','public.profiles',column_name,'INSERT,UPDATE,REFERENCES') then
          raise exception 'COMPONENT_CATALOGUE_INHERITED_PROFILE_GRANT: %',column_name;
        end if;
      end loop;
    elsif target='component_types' then
      grant select,insert,update,delete on public.component_types to authenticated;
    end if;

    if has_table_privilege('anon',format('public.%I',target),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('anon',format('public.%I',target),'INSERT,UPDATE,REFERENCES')
      or has_table_privilege('authenticated',format('public.%I',target),'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('authenticated',format('public.%I',target),'REFERENCES')
      or (target not in ('profiles','component_types') and (
        has_table_privilege('authenticated',format('public.%I',target),'INSERT,UPDATE,DELETE')
        or has_any_column_privilege('authenticated',format('public.%I',target),'INSERT,UPDATE')))
      or (target='profiles' and has_table_privilege('authenticated','public.profiles','INSERT,UPDATE,DELETE'))
      or (target in ('profiles','platform_access_assignments','component_types') and has_any_column_privilege('anon',format('public.%I',target),'SELECT'))
      or (target='platform_access_assignments' and has_any_column_privilege('authenticated','public.platform_access_assignments','SELECT')) then
      raise exception 'COMPONENT_CATALOGUE_INHERITED_GRANT: %',target;
    end if;
  end loop;

  grant execute on function public.is_hushub_besiktapp_admin() to authenticated;
  alter table public.component_types enable row level security;
  drop policy if exists component_catalogue_read on public.component_types;
  create policy component_catalogue_read on public.component_types for select to authenticated using (true);
  drop policy if exists component_catalogue_admin on public.component_types;
  create policy component_catalogue_admin on public.component_types for all to authenticated
    using ((select public.is_hushub_besiktapp_admin())) with check ((select public.is_hushub_besiktapp_admin()));
  -- Restrictive, command-specific boundaries contain old USING(true) policies without limiting reads.
  drop policy if exists component_catalogue_insert_boundary on public.component_types;
  create policy component_catalogue_insert_boundary on public.component_types as restrictive for insert to authenticated
    with check ((select public.is_hushub_besiktapp_admin()));
  drop policy if exists component_catalogue_update_boundary on public.component_types;
  create policy component_catalogue_update_boundary on public.component_types as restrictive for update to authenticated
    using ((select public.is_hushub_besiktapp_admin())) with check ((select public.is_hushub_besiktapp_admin()));
  drop policy if exists component_catalogue_delete_boundary on public.component_types;
  create policy component_catalogue_delete_boundary on public.component_types as restrictive for delete to authenticated
    using ((select public.is_hushub_besiktapp_admin()));
end $$;
notify pgrst,'reload schema';
commit;
