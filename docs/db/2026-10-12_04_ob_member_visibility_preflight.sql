-- READ ONLY. Run as migration operator before 2026-10-12_04_ob_member_visibility.sql.
-- Every check must be true. No user/customer contents are returned.
with expected_overview(name,old_hash,new_hash) as (values
  ('ob_overview_page','0813cb2c6d2ff00e970c03978f77ce44','15a0f78ea242cfbc516d34be0f772c5f'),
  ('ob_overview_item_flags','ce04b1d630494aff0d3cf057d7ea909f','4e1d46eec55b3ab870c560aec3728125')
), expected_tables(name) as (values
  ('assignments'),('assignment_links'),('assignment_acceptances'),('assignment_addon_orders'),
  ('assignment_confirmation_snapshots'),('assignment_confirmation_pdfs'),('assignment_link_incidents'),('outbound_messages')
)
select 'runtime_and_administration_installed' check_name,
  to_regprocedure('public.organization_assert_admin(uuid,uuid)') is not null
  and to_regprocedure('public.ob_actor_has_organization_access(uuid,uuid)') is not null
  and to_regprocedure('public.ob_start_status_assignment_inspection_before_organization(uuid,uuid,uuid)') is not null
  and to_regclass('public.ob_organization_bindings') is not null ok
union all select 'reviewed_overview_bodies',not exists(
  select 1 from expected_overview e where (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
    and p.proname=e.name and md5(replace(p.prosrc,chr(13),'')) in (e.old_hash,e.new_hash))<>1)
union all select 'assignment_children_reviewed_shape',not exists(
  select 1 from expected_tables t where to_regclass('public.'||t.name) is null or not
    (case when t.name='assignments' then array['org_id','responsible_profile_id','inspection_id','assignment_type']::text[]
      else array['org_id','assignment_id']::text[] end)<@array(select a.attname::text from pg_attribute a
        where a.attrelid=to_regclass('public.'||t.name) and a.attnum>0 and not a.attisdropped))
union all select 'assignment_inspection_bindings_consistent',not exists(
  select 1 from public.assignments a where a.assignment_type in ('OB','STATUS') and a.inspection_id is not null and not exists(
    select 1 from public.ob_organization_bindings b join public.inspections i on i.id=b.inspection_id
    join public.properties p on p.id=i.property_id where b.inspection_id=a.inspection_id and b.org_id=a.org_id
      and p.owner=a.responsible_profile_id))
union all select 'private_actor_rpc_acl',not exists(
  select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
    'ob_list_organization_inspections','ob_start_assignment_inspection','ob_start_status_assignment_inspection',
    'ob_reissue_started_assignment','ob_assert_assignment_actor')
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')));
