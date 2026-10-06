-- READ ONLY, after SQL05. Run as the migration operator; contains no customer data.
-- Cutover order: backup + reviewed SQL04 foundation checks; stop old OB creation;
-- deploy SQL05 and immediately promote the matching explicit-org API/UI; run this
-- check, then test BBSAB/Hushub1 switching, new OB + STATUS, PDF preview/delivery.
-- SQL05 refuses newly unbound OBs: re-audit those IDs; never assign via default org.
-- Older cached clients cannot create OB directly after SQL05. Reload the app.
-- Do not replay older OB RPC migrations after SQL05 without repeating guard review.
-- Existing grants/TU admin flows are unchanged. Shared property media/public URLs
-- and unreviewed RPCs are not certified by these checks. No test emails are sent.
-- Every row except informative totals must show ok=true. Existing invalid EB/TU
-- detail relations require review, never automatic reclassification or deletion.
with required_rpc(signature) as (values
  ('public.ob_create_organization_inspection(uuid,uuid,uuid)'),
  ('public.ob_list_organization_inspections(uuid,uuid,uuid)'),
  ('public.ob_start_assignment_inspection(uuid,uuid,uuid,text)'),
  ('public.ob_start_status_assignment_inspection(uuid,uuid,uuid)')
), guarded_name(name) as (values
  ('ob_round_mutate'),('ob_building_round_mutate'),('ob_save_floor_model'),('ob_round_image_trash'),
  ('ob_building_access'),('ob_building_get'),('ob_building_command'),('ob_building_write_row'),
  ('ob_building_write_rows'),('ob_environmental_command'),('ob_review_assignment_workflow'),('ob_reconcile_assignment_workflow')
), guarded as (
  select n.name,p.oid,p.prosrc from guarded_name n left join pg_proc p
    on p.pronamespace='public'::regnamespace and p.proname=n.name
), child_tables as (
  select c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='inspection_id' and a.atttypid='uuid'::regtype and not a.attisdropped
    where n.nspname='public' and c.relkind in ('r','p') and
      (c.relname like 'inspection\_%' escape '\' or c.relname like 'ob\_%' escape '\')
      and c.relname not in ('ob_organization_bindings','ob_organization_binding_audit')
), legacy_rpc(signature) as (values
  ('public.ensure_inspection_default_other_room_and_points(uuid)'),
  ('public.lock_eb_inspection_report(uuid,uuid,uuid,uuid)'),
  ('public.unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid)'),
  ('public.unlock_tu_investigation_report(uuid,uuid,text,uuid)')
), module_rpc(signature,family,crlf_hash,lf_hash) as (values
  ('public.lock_eb_inspection_report(uuid,uuid,uuid,uuid)','EB','df8bc722c26e1eb4075eb1c6f8395fb3','969ddc8a3601ba34410bb691fb169414'),
  ('public.unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid)','EB','7bbae76d009e1db0849283dd9c07cba3','8d469538d340ee09aba2476aef6b9a3d'),
  ('public.unlock_tu_investigation_report(uuid,uuid,text,uuid)','TU','8a7123812755f31745a7e3690a938354','3f1df97e3b7d4974c6759e39746c2ac8')
), module_definitions as (
  select r.*,p.oid,p.prosrc,p.prosecdef,
    E'  -- inspection-report-module-boundary-v1\n  perform public.assert_inspection_report_module(p_inspection_id,'||quote_literal(r.family)||E');\n' as prefix
    from module_rpc r left join pg_proc p on p.oid=to_regprocedure(r.signature)
), module_triggers(relation,name,function_signature,argument) as (values
  ('public.inspections','inspection_report_parent_module_guard','public.inspection_report_parent_module_guard()',''),
  ('public.eb_inspection_details','inspection_report_detail_module_guard','public.inspection_report_detail_module_guard()','EB'),
  ('public.technical_investigation_details','inspection_report_detail_module_guard','public.inspection_report_detail_module_guard()','TU')
), checks(check_name,observed,expected,ok) as (
  select 'bound_OB_total',count(*)::bigint,'informative',true from public.ob_organization_bindings
  union all select 'explicit_creation_total',count(*),'informative',true from public.ob_organization_bindings where attribution_source='explicit_creation'
  union all select 'unbound_OB',count(*),'0',count(*)=0 from public.inspections i
    where (i.inspection_family='OB' or (i.inspection_family is null and i.type in ('OB','STATUS')))
      and not exists(select 1 from public.ob_organization_bindings b where b.inspection_id=i.id)
  union all select 'binding_audit_mismatch',count(*),'0',count(*)=0 from public.ob_organization_bindings b
    left join public.ob_organization_binding_audit a on a.inspection_id=b.inspection_id
    where a.inspection_id is null or (a.org_id,a.attribution_source,a.created_at) is distinct from (b.org_id,b.attribution_source,b.created_at)
  union all select 'binding_wrong_family',count(*),'0',count(*)=0 from public.ob_organization_bindings b join public.inspections i on i.id=b.inspection_id
    where not coalesce(i.inspection_family='OB' or (i.inspection_family is null and i.type in ('OB','STATUS')),false)
  union all select 'service_entrypoints_ready',count(*),'4',count(*)=4 from required_rpc r
    join pg_proc p on p.oid=to_regprocedure(r.signature) where p.prosecdef
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  union all select 'guarded_RPC_ready',count(*),'12',count(*)=12 from guarded g where g.oid is not null
    and position('-- ob-organization-runtime-v1' in g.prosrc)>0
    and has_function_privilege('service_role',g.oid,'EXECUTE')
    and not has_function_privilege('anon',g.oid,'EXECUTE') and not has_function_privilege('authenticated',g.oid,'EXECUTE')
  union all select 'overview_bound_filter',count(*),'1',count(*)=1 from pg_proc p
    where p.oid=to_regprocedure('public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)')
      and position('ob_inspection_matches_organization(i.id,p_org_id)' in p.prosrc)>0 and not p.prosecdef
  union all select 'private_original_start_client_execute',count(*),'0',count(*)=0 from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in
      ('ob_start_assignment_inspection_before_organization','ob_start_status_assignment_inspection_before_organization')
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE'))
  union all select 'private_internal_helper_client_execute',count(*),'0',count(*)=0 from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in
      ('ob_actor_has_organization_access','ob_assert_organization_inspection','ob_bind_created_inspection')
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE'))
  union all select 'private_binding_tables_ready',count(*),'2',count(*)=2 from pg_class c where c.oid in
    ('public.ob_organization_bindings'::regclass,'public.ob_organization_binding_audit'::regclass) and c.relrowsecurity
    and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
    and has_table_privilege('service_role',c.oid,'SELECT') and not has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE')
  union all select 'child_boundaries_missing',count(*),'0',count(*)=0 from child_tables c where not c.relrowsecurity or not exists(
    select 1 from pg_policy p where p.polrelid=c.oid and p.polname='ob_organization_boundary' and not p.polpermissive)
  union all select 'parent_and_storage_boundaries',count(*),'2',count(*)=2 from pg_policy p
    where p.polrelid in('public.inspections'::regclass,'storage.objects'::regclass) and p.polname='ob_organization_boundary' and not p.polpermissive
      and exists(select 1 from pg_class c where c.oid=p.polrelid and c.relrowsecurity)
  union all select 'parent_runtime_triggers',count(*),'2',count(*)=2 from pg_trigger t where t.tgrelid='public.inspections'::regclass
    and t.tgname in('ob_organization_identity_guard','ob_organization_binding_required') and t.tgenabled='O'
  union all select 'source_guard_missing',count(*),'0',count(*)=0 from pg_class c where c.relnamespace='public'::regnamespace
    and c.relname in('assignments','ob_assignment_workflows','inspection_report_links','inspection_addon_orders',
      'inspection_area_measurements','inspection_moisture_controls','inspection_moisture_control_images',
      'inspection_environmental_protocols','inspection_environmental_files') and not exists(select 1 from pg_trigger t
        where t.tgrelid=c.oid and t.tgname='ob_organization_source_guard' and t.tgenabled='O')
  union all select 'legacy_RPC_client_execute_review',count(*),'0',count(*)=0 from legacy_rpc l join pg_proc p on p.oid=to_regprocedure(l.signature)
    where has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
  union all select 'module_RPC_guards_ready',count(*),'3',count(*)=3 from module_definitions m where m.prosecdef
    and position(m.prefix in m.prosrc)>0
    and md5(replace(pg_get_functiondef(m.oid),m.prosrc,replace(m.prosrc,m.prefix,''))) in (m.crlf_hash,m.lf_hash)
    and has_function_privilege('service_role',m.oid,'EXECUTE')
    and not has_function_privilege('anon',m.oid,'EXECUTE') and not has_function_privilege('authenticated',m.oid,'EXECUTE')
    and (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=(select proname from pg_proc where oid=m.oid))=1
  union all select 'module_private_helpers_ready',count(*),'4',count(*)=4 from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('inspection_report_module_matches','assert_inspection_report_module',
      'inspection_report_detail_module_guard','inspection_report_parent_module_guard')
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE')
  union all select 'module_relation_guards_ready',count(*),'3',count(*)=3 from module_triggers m join pg_trigger t
    on t.tgrelid=to_regclass(m.relation) and t.tgname=m.name and t.tgfoid=to_regprocedure(m.function_signature)
    where t.tgenabled='O' and (case when m.argument='' then t.tgnargs=0 else
      t.tgnargs=1 and encode(t.tgargs,'escape')=m.argument||E'\\000' end)
  union all select 'module_detail_family_mismatch',count(*),'0',count(*)=0 from (
    select d.inspection_id,'EB'::text family from public.eb_inspection_details d
    union all select d.inspection_id,'TU' from public.technical_investigation_details d
  ) d left join public.inspections i on i.id=d.inspection_id
    where i.id is null or not public.inspection_report_module_matches(i.inspection_family,i.type,d.family)
      or exists(select 1 from public.ob_organization_bindings b where b.inspection_id=d.inspection_id)
)
select check_name,observed,expected,ok from checks order by check_name;
