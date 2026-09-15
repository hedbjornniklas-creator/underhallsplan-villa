-- READ ONLY. One JSON result. No inspection rows, image paths, role passwords,
-- bucket contents or data mutations. This is NOT the security migration.
-- Requires Supabase's storage.buckets metadata table.
with relevant_tables as (
  select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
    and (c.relname in ('properties','buildings','inspections','building_media')
      or c.relname like 'inspection\_%' escape '\' or c.relname like 'ob\_%' escape '\')
), trigger_functions as (
  select distinct tgfoid from pg_trigger where tgrelid in (select oid from relevant_tables) and not tgisinternal
), routines as (
  select p.oid,p.oid::regprocedure::text as signature,p.prosecdef as security_definer,
    pg_get_userbyid(p.proowner) as owner,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
    md5(pg_get_functiondef(p.oid)) as definition_md5,
    case when p.oid in (select tgfoid from trigger_functions)
      or p.proname in ('raise_if_inspection_locked','ob_assignment_workflow_state','is_org_member','is_org_admin')
      then pg_get_functiondef(p.oid) else null end as guard_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and (p.prosecdef or p.oid in (select tgfoid from trigger_functions)
      or p.proname in ('raise_if_inspection_locked','ob_assignment_workflow_state','is_org_member','is_org_admin'))
), role_metadata as (
  select rolname,rolsuper,rolbypassrls,rolinherit,
    has_schema_privilege(rolname,'public','USAGE') as public_schema_usage
  from pg_roles where rolname in ('anon','authenticated','service_role','authenticator')
), table_access as (
  select t.relname as table_name,c.relrowsecurity as rls_enabled,
    pg_get_userbyid(c.relowner) as owner,
    has_table_privilege('anon',t.oid,'SELECT') as anon_select,
    has_table_privilege('anon',t.oid,'INSERT,UPDATE,DELETE') as anon_write,
    has_table_privilege('authenticated',t.oid,'SELECT') as authenticated_select,
    has_table_privilege('authenticated',t.oid,'INSERT,UPDATE,DELETE') as authenticated_write
  from relevant_tables t join pg_class c on c.oid=t.oid
), memberships as (
  select parent.rolname as granted_role,member.rolname as member_role,m.admin_option,m.inherit_option,m.set_option
  from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member
), column_grants as (
  select t.relname as table_name,a.attname as column_name,
    case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,acl.privilege_type
  from relevant_tables t join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
    cross join lateral aclexplode(a.attacl) acl
  where acl.grantee=0 or pg_get_userbyid(acl.grantee) in ('anon','authenticated','service_role')
), storage_policies as (
  select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
  from pg_policies where (schemaname='storage' and tablename in ('objects','buckets'))
    or (schemaname='public' and tablename='building_media')
), readable_views as (
  select c.relname as view_name,c.reloptions,
    has_table_privilege('anon',c.oid,'SELECT') as anon_select,
    has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('v','m')
), exposure_settings as (
  -- Select only API schema names, never JWT secrets or arbitrary role settings.
  select coalesce(r.rolname,'ALL') as role_name,setting
  from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole
    cross join lateral unnest(s.setconfig) setting
  where setting like 'pgrst.db_schemas=%' or setting like 'pgrst.db_extra_search_path=%'
)
select jsonb_build_object(
  'format_version',1,
  'roles',coalesce((select jsonb_agg(to_jsonb(r) order by rolname) from role_metadata r),'[]'::jsonb),
  'table_access',coalesce((select jsonb_agg(to_jsonb(t) order by table_name) from table_access t),'[]'::jsonb),
  'memberships',coalesce((select jsonb_agg(to_jsonb(m) order by member_role,granted_role) from memberships m),'[]'::jsonb),
  'functions',coalesce((select jsonb_agg(to_jsonb(f)-'oid' order by signature) from routines f),'[]'::jsonb),
  'column_grants',coalesce((select jsonb_agg(to_jsonb(g) order by table_name,column_name,grantee,privilege_type) from column_grants g),'[]'::jsonb),
  'storage_policies',coalesce((select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from storage_policies p),'[]'::jsonb),
  'buckets',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'public',b.public) order by b.id)
    from storage.buckets b where b.id in ('inspection-images','property-media','eb-project-attachments')),'[]'::jsonb),
  'readable_views',coalesce((select jsonb_agg(to_jsonb(v) order by view_name) from readable_views v),'[]'::jsonb),
  'exposure_settings',coalesce((select jsonb_agg(to_jsonb(s) order by role_name,setting) from exposure_settings s),'[]'::jsonb)
) as access_preflight;
