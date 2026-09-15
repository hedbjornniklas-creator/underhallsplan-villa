-- SEPARATE SECURITY RELEASE. Review COMPONENTS_ACCESS_ROLLOUT.md first.
-- No application rows, calculation formulas, PDFs or Storage files are changed.
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog;
-- After review only, add this inside this transaction when executing:
-- set local app.components_access_hardening_approved = 'true';

do $$
declare
  target text;
  columns_list text;
  boundary constant text := 'exists (select 1 from public.properties p
    where p.id = components.property_id and p.owner = (select auth.uid()))';
begin
  if current_setting('app.components_access_hardening_approved', true) is distinct from 'true' then
    raise exception 'COMPONENTS_ACCESS_REVIEW_REQUIRED';
  end if;
  if current_setting('server_version_num')::int < 170000 then
    raise exception 'COMPONENTS_ACCESS_POSTGRES_17_REQUIRED';
  end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER') then
    raise exception 'COMPONENTS_ACCESS_UNSAFE_ROLE';
  end if;
  if not exists (select 1 from pg_class where oid='public.components'::regclass and relkind='r')
    or not exists (select 1 from pg_class where oid='public.components_calc'::regclass and relkind='v') then
    raise exception 'COMPONENTS_ACCESS_UNEXPECTED_RELATION';
  end if;
  if not exists (select 1 from pg_class where oid='public.properties'::regclass and relrowsecurity)
    or not has_table_privilege('authenticated','public.properties','SELECT')
    or not has_table_privilege('authenticated','public.component_types','SELECT') then
    raise exception 'COMPONENTS_ACCESS_PARENT_READ_REQUIRED';
  end if;

  lock table public.components, public.components_calc in access exclusive mode;
  -- Pinned pg_get_viewdef from the reviewed PG17 catalog, with pg_catalog search_path.
  if md5(replace(pg_get_viewdef('public.components_calc'::regclass),chr(13),''))
    <> '38bc1fab925f9f9e25764354522d46c1' then
    raise exception 'COMPONENTS_ACCESS_VIEW_REVIEW_REQUIRED';
  end if;

  foreach target in array array['components','components_calc'] loop
    if exists (select 1 from pg_class where oid=format('public.%I',target)::regclass
      and (pg_has_role('anon',relowner,'MEMBER') or pg_has_role('authenticated',relowner,'MEMBER'))) then
      raise exception 'COMPONENTS_ACCESS_UNSAFE_OWNER: %',target;
    end if;
    execute format('revoke all privileges on table public.%I from public,anon,authenticated',target);
    select string_agg(format('%I',attname),',') into columns_list from pg_attribute
      where attrelid=format('public.%I',target)::regclass and attnum>0 and not attisdropped;
    execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',
      columns_list,columns_list,columns_list,columns_list,target);
    execute format('grant select on public.%I to authenticated',target);
    if target='components' then
      grant insert,update,delete on public.components to authenticated;
    end if;
    if has_table_privilege('anon',format('public.%I',target),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('anon',format('public.%I',target),'SELECT,INSERT,UPDATE,REFERENCES')
      or has_table_privilege('authenticated',format('public.%I',target),'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege('authenticated',format('public.%I',target),'REFERENCES')
      or (target='components_calc' and (
        has_table_privilege('authenticated','public.components_calc','INSERT,UPDATE,DELETE')
        or has_any_column_privilege('authenticated','public.components_calc','INSERT,UPDATE'))) then
      raise exception 'COMPONENTS_ACCESS_INHERITED_GRANT: %',target;
    end if;
  end loop;

  alter table public.components enable row level security;
  drop policy if exists components_access_boundary on public.components;
  execute format('create policy components_access_boundary on public.components as restrictive for all
    to authenticated using (%s) with check (%s)',boundary,boundary);
  drop policy if exists components_access_owner on public.components;
  execute format('create policy components_access_owner on public.components for all
    to authenticated using (%s) with check (%s)',boundary,boundary);
  alter view public.components_calc set (security_invoker=true);
end $$;
notify pgrst,'reload schema';
commit;
