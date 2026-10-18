-- READ ONLY. Run as migration operator after SQL and matching application release.
-- Every check must be true. Existing enabled flags are not asserted: explicit
-- administrators may already have opted in members after the default-off rollout.
with expected_rpc(name,client_execute,service_execute) as (values
  ('ob_actor_has_explicit_module_access',false,false),('ob_actor_can_view_colleagues',false,true),
  ('ob_inspection_visibility_access',false,false),('ob_visibility_reset_invalid',false,false),
  ('ob_assignment_visibility_identity_guard',false,false),('ob_assert_assignment_visibility_owner',false,false),
  ('ob_assert_assignment_actor',false,false),('organization_member_ob_visibility_set',false,true),('organization_member_ob_visibility_list',false,true),
  ('ob_list_organization_inspections',false,true),('ob_start_status_assignment_inspection',false,true),
  ('ob_assignment_visibility_access',true,false),('ob_assignment_link_visibility_access',true,false),
  ('ob_overview_page',true,false),('ob_overview_item_flags',true,false)
), expected_tables(name) as (values
  ('assignments'),('assignment_links'),('assignment_acceptances'),('assignment_addon_orders'),
  ('assignment_confirmation_snapshots'),('assignment_confirmation_pdfs'),('assignment_link_incidents'),('outbound_messages')
), expected_overview(name,body_hash) as (values
  ('ob_overview_page','15a0f78ea242cfbc516d34be0f772c5f'),('ob_overview_item_flags','4e1d46eec55b3ab870c560aec3728125')
)
select 'visibility_table_private' check_name,
  coalesce((select c.relrowsecurity from pg_class c where c.oid=to_regclass('public.organization_member_ob_visibility')),false)
  and not has_table_privilege('authenticated','public.organization_member_ob_visibility','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon','public.organization_member_ob_visibility','SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role','public.organization_member_ob_visibility','SELECT')
  and not has_table_privilege('service_role','public.organization_member_ob_visibility','INSERT,UPDATE,DELETE') ok
union all select 'rpc_effective_acl_and_definer',not exists(select 1 from expected_rpc e where (
  select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=e.name and p.prosecdef
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and has_function_privilege('authenticated',p.oid,'EXECUTE')=e.client_execute
    and has_function_privilege('service_role',p.oid,'EXECUTE')=e.service_execute)<>1)
union all select 'reviewed_overview_visibility_bodies',not exists(select 1 from expected_overview e where not exists(
  select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=e.name
    and md5(replace(p.prosrc,chr(13),''))=e.body_hash))
union all select 'assignment_child_rls_boundaries',not exists(select 1 from expected_tables e where not exists(
  select 1 from pg_class c where c.oid=to_regclass('public.'||e.name) and c.relrowsecurity
    and 4=(select count(*) from pg_policy p where p.polrelid=c.oid and not p.polpermissive
      and p.polname in ('ob_visibility_select','ob_visibility_insert','ob_visibility_update','ob_visibility_delete')
      and (p.polcmd='a' or position(case e.name when 'assignments' then 'ob_assignment_visibility_access'
        else 'ob_assignment_link_visibility_access' end in pg_get_expr(p.polqual,p.polrelid))>0)
      and (p.polcmd not in ('a','w') or position(case e.name when 'assignments' then 'ob_assignment_visibility_access'
        else 'ob_assignment_link_visibility_access' end in pg_get_expr(p.polwithcheck,p.polrelid))>0))))
union all select 'inspection_rls_stays_owner_only',exists(select 1 from pg_policy p
  where p.polrelid='public.inspections'::regclass and p.polname='ob_organization_boundary' and not p.polpermissive
    and position('ob_organization_row_access' in pg_get_expr(p.polqual,p.polrelid))>0)
union all select 'visibility_revocation_triggers',11=(select count(*) from pg_trigger t
  where not t.tgisinternal and t.tgenabled='O' and t.tgfoid=to_regprocedure('public.ob_visibility_reset_invalid()'))
union all select 'assignment_identity_trigger',exists(select 1 from pg_trigger t where t.tgrelid='public.assignments'::regclass
  and t.tgname='ob_assignment_visibility_identity_guard' and t.tgenabled='O'
  and t.tgfoid=to_regprocedure('public.ob_assignment_visibility_identity_guard()'));
