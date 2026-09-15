-- SEPARATE SECURITY RELEASE, not part of the building migration sequence.
-- Review 08 + the rollout checklist and rehearse against a staging clone first.
-- No inspection records, PDFs, Storage objects or rollout flags are changed.
begin;
set local lock_timeout = '5s';
-- After approval only, add this inside this transaction when executing:
-- set local app.inspection_access_hardening_approved = 'true';
do $$
declare
  t text; column_list text; scope_expression text; client_write boolean;
  client_tables constant text[] := array[
    'buildings','building_media','inspection_conditions','inspection_control_answers',
    'inspection_control_point_answers','inspection_exterior_observations',
    'inspection_exterior_selections','inspection_interior_observations',
    'inspection_interior_rooms','inspection_control_items','inspection_images',
    'inspection_overview_selections'];
  server_tables constant text[] := array[
    'inspection_addon_orders','inspection_area_measurements','inspection_area_measurement_rows',
    'inspection_moisture_controls','inspection_moisture_control_rows',
    'inspection_moisture_control_images','inspection_lock_events'];
begin
  if current_setting('app.inspection_access_hardening_approved',true) is distinct from 'true' then
    raise exception 'INSPECTION_ACCESS_REVIEW_REQUIRED';
  end if;
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER') then
    raise exception 'INSPECTION_ACCESS_UNSAFE_ROLE';
  end if;
  if not exists(select 1 from pg_class where oid='public.properties'::regclass and relrowsecurity)
    or not exists(select 1 from pg_class where oid='public.inspections'::regclass and relrowsecurity) then
    raise exception 'INSPECTION_ACCESS_PARENT_RLS_REQUIRED';
  end if;

  foreach t in array client_tables || server_tables loop
    -- Missing relations abort the whole transaction instead of partially securing a schema.
    execute format('lock table public.%I in access exclusive mode',t);
    if exists(select 1 from pg_class where oid=format('public.%I',t)::regclass
      and (pg_has_role('anon',relowner,'MEMBER') or pg_has_role('authenticated',relowner,'MEMBER'))) then
      raise exception 'INSPECTION_ACCESS_UNSAFE_OWNER: %',t;
    end if;
    client_write := t=any(client_tables);
    if t='buildings' then
      scope_expression := 'exists(select 1 from public.properties p where p.id=buildings.property_id and p.owner=(select auth.uid()))';
    elsif t='building_media' then
      scope_expression := 'exists(select 1 from public.buildings b join public.properties p on p.id=b.property_id
        where b.id=building_media.building_id and p.owner=(select auth.uid()))';
    else
      scope_expression := format('exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id
        where i.id=%I.inspection_id and p.owner=(select auth.uid()))',t);
    end if;

    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated',t);
    -- Table-level REVOKE does not remove pre-existing column grants.
    select string_agg(format('%I',attname),',') into column_list from pg_attribute
      where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped;
    execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',
      column_list,column_list,column_list,column_list,t);
    execute format('grant select on public.%I to authenticated',t);
    if client_write then
      execute format('grant insert,update,delete on public.%I to authenticated',t);
    end if;

    -- Restrictive AND boundary also contains any old USING(true) policies.
    -- Use invoker queries, not a SECURITY DEFINER helper that bypasses parent RLS.
    execute format('drop policy if exists inspection_access_boundary on public.%I',t);
    execute format('create policy inspection_access_boundary on public.%I as restrictive for all to authenticated
      using (%s) with check (%s)',t,scope_expression,scope_expression);
    execute format('drop policy if exists inspection_access_owner on public.%I',t);
    if client_write then
      execute format('create policy inspection_access_owner on public.%I for all to authenticated
        using (%s) with check (%s)',t,scope_expression,scope_expression);
    else
      execute format('create policy inspection_access_owner on public.%I for select to authenticated using (%s)',t,scope_expression);
    end if;

    if has_table_privilege('anon',format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege('anon',format('public.%I',t),'SELECT,INSERT,UPDATE,REFERENCES')
      or (not client_write and (has_table_privilege('authenticated',format('public.%I',t),'INSERT,UPDATE,DELETE')
        or has_any_column_privilege('authenticated',format('public.%I',t),'INSERT,UPDATE'))) then
      raise exception 'INSPECTION_ACCESS_INHERITED_GRANT: %',t;
    end if;
  end loop;

  -- Remove unused whole-table privileges in the exact inspection catalog scope.
  -- Preserve DML, service-role grants and all existing triggers outside the targets above.
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and (c.relname in ('properties','buildings','building_media','inspections')
        or c.relname like 'inspection\_%' escape '\' or c.relname like 'ob\_%' escape '\') loop
    execute format('revoke truncate,references,trigger on public.%I from public,anon,authenticated',t);
    if has_table_privilege('anon',format('public.%I',t),'TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated',format('public.%I',t),'TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'INSPECTION_ACCESS_INHERITED_GRANT: %',t;
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
