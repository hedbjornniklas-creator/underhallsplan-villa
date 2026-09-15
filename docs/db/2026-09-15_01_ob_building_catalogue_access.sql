-- Forward correction for Supabase default table/column grants on the new catalogue.
-- Requires building parts 2026-09-12_01. No data, RLS policies or rollout changes.
begin;
set local lock_timeout = '5s';
-- After approval, set app.ob_building_catalogue_access_approved='true' in this transaction.
do $$
declare columns_sql text;
begin
  if current_setting('app.ob_building_catalogue_access_approved',true) is distinct from 'true' then
    raise exception 'OB_BUILDING_CATALOGUE_ACCESS_REVIEW_REQUIRED';
  end if;
  lock table public.settings_ob_building_categories in access exclusive mode;
  if not exists(select 1 from pg_class where oid='public.settings_ob_building_categories'::regclass and relrowsecurity)
    or exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls))
    or exists(select 1 from pg_class where oid='public.settings_ob_building_categories'::regclass
      and (pg_has_role('anon',relowner,'MEMBER') or pg_has_role('authenticated',relowner,'MEMBER'))) then
    raise exception 'OB_BUILDING_CATALOGUE_UNSAFE_ACCESS';
  end if;
  select string_agg(format('%I',attname),',') into columns_sql from pg_attribute
    where attrelid='public.settings_ob_building_categories'::regclass and attnum>0 and not attisdropped;
  revoke all on public.settings_ob_building_categories from public,anon,authenticated;
  execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.settings_ob_building_categories from public,anon,authenticated',
    columns_sql,columns_sql,columns_sql,columns_sql);
  grant select on public.settings_ob_building_categories to authenticated;
  if has_table_privilege('anon','public.settings_ob_building_categories','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege('anon','public.settings_ob_building_categories','SELECT,INSERT,UPDATE,REFERENCES')
    or has_table_privilege('authenticated','public.settings_ob_building_categories','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege('authenticated','public.settings_ob_building_categories','INSERT,UPDATE,REFERENCES')
    or not has_table_privilege('service_role','public.settings_ob_building_categories','SELECT') then
    raise exception 'OB_BUILDING_CATALOGUE_UNEXPECTED_GRANT';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
