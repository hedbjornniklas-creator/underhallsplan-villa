-- READ ONLY: catalog metadata only, never inspection records or stored files.
-- One SELECT returns one row/column named preflight. Export that entire result;
-- this avoids SQL editors returning only the last of several SELECT results.
-- No migrations or rollout flags are executed by this file.
with selected_tables as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity,
    pg_catalog.pg_get_userbyid(c.relowner) as table_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and (c.relname in ('properties', 'buildings', 'inspections')
      or c.relname like 'inspection_%' or c.relname like 'ob_%')
), table_metadata as (
  select relname as table_name, table_owner, relrowsecurity as rls_enabled,
    relforcerowsecurity as rls_forced
  from selected_tables
), column_metadata as (
  select t.relname as table_name, a.attnum as ordinal_position,
    a.attname as column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
    a.attnotnull as not_null, pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expression
  from selected_tables t
  join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
), index_metadata as (
  select i.tablename as table_name, i.indexname as index_name, i.indexdef as definition
  from pg_catalog.pg_indexes i
  join selected_tables t on t.relname = i.tablename
  where i.schemaname = 'public'
), constraint_metadata as (
  select t.relname as table_name, c.conname as constraint_name,
    c.contype as constraint_type, pg_catalog.pg_get_constraintdef(c.oid) as definition
  from pg_catalog.pg_constraint c
  join selected_tables t on t.oid = c.conrelid
), trigger_metadata as (
  select s.relname as table_name, t.tgname as trigger_name, t.tgenabled as enabled,
    pg_catalog.pg_get_triggerdef(t.oid) as definition
  from pg_catalog.pg_trigger t
  join selected_tables s on s.oid = t.tgrelid
  where not t.tgisinternal
), policy_metadata as (
  select p.tablename as table_name, p.policyname as policy_name,
    p.permissive, p.roles, p.cmd as command, p.qual as using_expression, p.with_check
  from pg_catalog.pg_policies p
  join selected_tables t on t.relname = p.tablename
  where p.schemaname = 'public'
), privilege_metadata as (
  select p.table_name, p.grantee, p.privilege_type
  from information_schema.role_table_grants p
  join selected_tables t on t.relname = p.table_name
  where p.table_schema = 'public'
    and p.grantee in ('anon', 'authenticated', 'service_role')
)
select jsonb_build_object(
  'format_version', 2,
  'server_version', current_setting('server_version'),
  'tables', coalesce((select jsonb_agg(to_jsonb(t) order by table_name) from table_metadata t), '[]'::jsonb),
  'columns', coalesce((select jsonb_agg(to_jsonb(t) order by table_name, ordinal_position) from column_metadata t), '[]'::jsonb),
  'indexes', coalesce((select jsonb_agg(to_jsonb(t) order by table_name, index_name) from index_metadata t), '[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(to_jsonb(t) order by table_name, constraint_name) from constraint_metadata t), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(to_jsonb(t) order by table_name, trigger_name) from trigger_metadata t), '[]'::jsonb),
  'policies', coalesce((select jsonb_agg(to_jsonb(t) order by table_name, policy_name) from policy_metadata t), '[]'::jsonb),
  'privileges', coalesce((select jsonb_agg(to_jsonb(t) order by table_name, grantee, privilege_type) from privilege_metadata t), '[]'::jsonb)
) as preflight;
