-- SEPARATE SECURITY RELEASE. See OB_SETTINGS_ACCESS.md and release gates.
-- Requires the admin-input protection in 2026-09-13_04 first.
-- Permissions only: no catalogue rows, inspection data, PDFs or files are changed.
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog;
-- After review only, add inside this transaction:
-- set local app.ob_settings_access_approved = 'true';

do $$
declare
  target text;
  columns_list text;
  targets constant text[] := array[
    'document_types','settings_disclosure_items','settings_basinfo_fields',
    'settings_condition_options','settings_overview_items','settings_overview_groups',
    'settings_overview_options','settings_exterior_items','settings_exterior_groups',
    'settings_exterior_options','settings_interior_room_types','settings_interior_groups',
    'settings_interior_options','settings_control_points','settings_control_point_options',
    'settings_text_snippets','settings_control_point_outcomes','settings_addon_services',
    'settings_certifications'
  ];
begin
  if current_setting('app.ob_settings_access_approved',true) is distinct from 'true' then
    raise exception 'OB_SETTINGS_REVIEW_REQUIRED';
  end if;
  if current_setting('server_version_num')::int < 170000 then
    raise exception 'OB_SETTINGS_POSTGRES_17_REQUIRED';
  end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls or rolcreaterole))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER')
    or has_schema_privilege('anon','public','CREATE') or has_schema_privilege('authenticated','public','CREATE')
    or has_schema_privilege('anon','auth','CREATE') or has_schema_privilege('authenticated','auth','CREATE') then
    raise exception 'OB_SETTINGS_UNSAFE_ROLE';
  end if;
  if not exists (select 1 from pg_proc where oid=to_regprocedure('public.is_hushub_besiktapp_admin()')
    and prosecdef and pg_get_userbyid(proowner)='postgres'
    and md5(replace(pg_get_functiondef(oid),chr(13),''))='054a760b8f58c70e12e2aeb2c7fb214b') then
    raise exception 'OB_SETTINGS_ADMIN_HELPER_REVIEW_REQUIRED';
  end if;
  -- The helper must not depend on browser-editable authority inputs.
  foreach target in array array['profiles','platform_products','platform_modules','platform_roles','platform_access_assignments'] loop
    if not exists (select 1 from pg_class where oid=to_regclass(format('public.%I',target))
      and relkind='r' and pg_get_userbyid(relowner)='postgres'
      and not pg_has_role('anon',relowner,'MEMBER') and not pg_has_role('authenticated',relowner,'MEMBER')) then
      raise exception 'OB_SETTINGS_ADMIN_INPUT_REVIEW_REQUIRED: %',target;
    end if;
    execute format('lock table public.%I in share mode',target);
    if has_table_privilege('anon',format('public.%I',target),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('anon',format('public.%I',target),'INSERT,UPDATE,REFERENCES')
      or has_table_privilege('authenticated',format('public.%I',target),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or (target<>'profiles' and has_any_column_privilege('authenticated',format('public.%I',target),'INSERT,UPDATE,REFERENCES')) then
      raise exception 'OB_SETTINGS_ADMIN_INPUT_REVIEW_REQUIRED: %',target;
    end if;
  end loop;
  if has_column_privilege('authenticated','public.profiles','is_admin','INSERT,UPDATE,REFERENCES')
    or not exists (select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.profiles'::regclass and a.attname='is_admin'
      and a.atttypid='boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false') then
    raise exception 'OB_SETTINGS_PROFILE_AUTHORITY_REVIEW_REQUIRED';
  end if;

  foreach target in array targets loop
    if not exists (select 1 from pg_class where oid=to_regclass(format('public.%I',target))
      and relkind='r' and pg_get_userbyid(relowner)='postgres'
      and not pg_has_role('anon',relowner,'MEMBER') and not pg_has_role('authenticated',relowner,'MEMBER')) then
      raise exception 'OB_SETTINGS_UNSAFE_RELATION: %',target;
    end if;
    execute format('lock table public.%I in access exclusive mode',target);
    select string_agg(format('%I',attname),',') into columns_list from pg_attribute
      where attrelid=format('public.%I',target)::regclass and attnum>0 and not attisdropped;
    execute format('revoke all on public.%I from public,anon,authenticated',target);
    execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',
      columns_list,columns_list,columns_list,columns_list,target);
    execute format('grant select,insert,update,delete on public.%I to authenticated',target);
    execute format('alter table public.%I enable row level security',target);
    execute format('drop policy if exists ob_settings_read on public.%I',target);
    execute format('create policy ob_settings_read on public.%I for select to authenticated using (true)',target);
    execute format('drop policy if exists ob_settings_admin on public.%I',target);
    execute format('create policy ob_settings_admin on public.%I for all to authenticated using ((select public.is_hushub_besiktapp_admin())) with check ((select public.is_hushub_besiktapp_admin()))',target);
    -- Restrictive command policies also contain old permissive USING(true) policies.
    execute format('drop policy if exists ob_settings_insert_boundary on public.%I',target);
    execute format('create policy ob_settings_insert_boundary on public.%I as restrictive for insert to authenticated with check ((select public.is_hushub_besiktapp_admin()))',target);
    execute format('drop policy if exists ob_settings_update_boundary on public.%I',target);
    execute format('create policy ob_settings_update_boundary on public.%I as restrictive for update to authenticated using ((select public.is_hushub_besiktapp_admin())) with check ((select public.is_hushub_besiktapp_admin()))',target);
    execute format('drop policy if exists ob_settings_delete_boundary on public.%I',target);
    execute format('create policy ob_settings_delete_boundary on public.%I as restrictive for delete to authenticated using ((select public.is_hushub_besiktapp_admin()))',target);

    if has_table_privilege('anon',format('public.%I',target),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('anon',format('public.%I',target),'SELECT,INSERT,UPDATE,REFERENCES')
      or has_table_privilege('authenticated',format('public.%I',target),'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('authenticated',format('public.%I',target),'REFERENCES') then
      raise exception 'OB_SETTINGS_INHERITED_GRANT: %',target;
    end if;
  end loop;
  grant execute on function public.is_hushub_besiktapp_admin() to authenticated;
end $$;
notify pgrst,'reload schema';
commit;
