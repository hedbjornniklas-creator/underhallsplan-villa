-- READ ONLY: one SELECT, no migration, functions, temporary objects or backfill.
-- Run as a database administrator so RLS does not hide rows. It is also safe to
-- execute inside BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY.
-- Optional relations/columns are discovered first. query_to_xml runs only the
-- SELECT constructed below from this fixed table/column allowlist; XMLTABLE
-- decodes JSON text without losing escaped characters. PostgreSQL XML is needed.
-- Output contains counts, internal identifiers and schema/security metadata,
-- never customer names/emails, report snapshots, PDFs, tokens or image paths.
-- inspection_family takes precedence; canonical OB includes variant SB/STATUS.
-- Type-only SB is ambiguous (it was also legacy EB), never inferred to be OB.
-- Missing/unknown family
-- is reported separately, NOT assumed to be OB. Recorded organization sources
-- are evidence, not an automatic migration decision. Even one owner membership
-- or a default membership is NOT proof of historical organization ownership.
-- Includes revoked report links and both workflow assignment references.
-- Policy/function text indicators are review aids, NOT proof of authorization.
-- Table 'write' means ANY table-level INSERT/UPDATE/DELETE privilege, not all;
-- it does not evaluate policy outcomes or replace a column-grant security audit.
with source_specs(table_name, selected_columns) as (values
  ('inspections', array['id','property_id','inspection_family','type','org_id']),
  ('properties', array['id','owner']),
  ('org_members', array['org_id','profile_id','role','is_active','is_default']),
  ('assignments', array['id','inspection_id','org_id','assignment_type']),
  ('ob_assignment_workflows', array['inspection_id','org_id','initial_assignment_id','current_assignment_id']),
  ('inspection_report_links', array['id','inspection_id','org_id','assignment_id','revoked_at']),
  ('inspection_addon_orders', array['inspection_id','org_id']),
  ('inspection_environmental_protocols', array['inspection_id','org_id']),
  ('inspection_environmental_files', array['inspection_id','org_id']),
  ('organizations', array['id']),
  ('profiles', array['id','is_admin']),
  ('organization_enabled_modules', array['org_id','module_key','is_active']),
  ('platform_products', array['id','key','is_active']),
  ('platform_modules', array['id','product_id','key','is_active']),
  ('platform_roles', array['id','product_id','key','is_active']),
  ('platform_access_assignments', array['id','profile_id','product_id','module_id','role_id','scope_type','scope_id','is_active','expires_at','source_system'])
), source_catalog as materialized (
  select s.*, c.oid, c.relkind,
    coalesce((select array_agg(a.attname::text order by a.attnum) from pg_attribute a
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),array[]::text[]) as actual_columns
  from source_specs s left join pg_namespace n on n.nspname='public'
  left join pg_class c on c.relnamespace=n.oid and c.relname=s.table_name
), source_data as materialized (
  select c.table_name, x.payload::jsonb as payload
  from source_catalog c cross join lateral xmltable('/row' passing query_to_xml(
    case when c.relkind in ('r','p') then format(
      'select coalesce(jsonb_agg((select jsonb_object_agg(k,to_jsonb(t)->k) from unnest(%L::text[]) k)),''[]''::jsonb)::text as payload from public.%I t',
      c.selected_columns::text,c.table_name)
    else 'select ''[]''::text as payload' end, false, true, '') columns payload text path 'payload') x
), source_rows as materialized (
  select table_name, r from source_data cross join lateral jsonb_array_elements(payload) r
), inspections as materialized (
  select r->>'id' as id,r->>'property_id' as property_id,r->>'org_id' as org_id,
    r->>'inspection_family' is null and r->>'type'='SB' as ambiguous_sb,
    r->>'inspection_family' is not null and r->>'inspection_family' not in ('OB','EB','UHP','TU') as invalid_canonical_family,
    case when r->>'inspection_family' is not null then
        case when r->>'inspection_family' in ('OB','EB','UHP','TU') then r->>'inspection_family' else null end
      when r->>'type'='STATUS' then 'OB'
      when r->>'type' in ('OB','EB','UHP','TU','SLB','FB','GB','KSB','SAB') then r->>'type' else null end as family
  from source_rows where table_name='inspections'
), properties as (select r->>'id' as id,r->>'owner' as owner from source_rows where table_name='properties'),
members as materialized (
  select r->>'org_id' as org_id,r->>'profile_id' as profile_id,r->>'role' as role,
    r->>'is_active'='true' as active,r->>'is_default'='true' as is_default
  from source_rows where table_name='org_members'
), assignments as materialized (
  select r->>'id' as id,r->>'inspection_id' as inspection_id,r->>'org_id' as org_id,r->>'assignment_type' as family
  from source_rows where table_name='assignments'
), workflows as materialized (
  select r->>'inspection_id' as inspection_id,r->>'org_id' as org_id,
    r->>'initial_assignment_id' as initial_id,r->>'current_assignment_id' as current_id
  from source_rows where table_name='ob_assignment_workflows'
), reports as materialized (
  select r->>'id' as id,r->>'inspection_id' as inspection_id,r->>'org_id' as org_id,
    r->>'assignment_id' as assignment_id,r->>'revoked_at' as revoked_at
  from source_rows where table_name='inspection_report_links'
), recorded_sources as materialized (
  select id as inspection_id,org_id,'inspection.org_id' as source from inspections
  union all select inspection_id,org_id,'assignment.inspection_id' from assignments
  union all select inspection_id,org_id,'workflow.org_id' from workflows
  union all select w.inspection_id,a.org_id,'workflow.initial_assignment' from workflows w join assignments a on a.id=w.initial_id
  union all select w.inspection_id,a.org_id,'workflow.current_assignment' from workflows w join assignments a on a.id=w.current_id
  union all select inspection_id,org_id,'report.org_id' from reports
  union all select r.inspection_id,a.org_id,'report.assignment' from reports r join assignments a on a.id=r.assignment_id
), ob_cases as materialized (
  select i.id,p.owner,p.id is null as property_missing,
    (select count(distinct s.org_id) from recorded_sources s where s.inspection_id=i.id and s.org_id is not null) as recorded_org_count,
    coalesce((select jsonb_agg(distinct s.org_id) from recorded_sources s where s.inspection_id=i.id and s.org_id is not null),'[]'::jsonb) as recorded_org_ids,
    (select count(distinct m.org_id) from members m where m.profile_id=p.owner and m.active) as owner_active_org_count,
    (select count(distinct s.org_id) from recorded_sources s where s.inspection_id=i.id and s.org_id is not null
      and not exists(select 1 from members m where m.org_id=s.org_id and m.profile_id=p.owner and m.active)) as recorded_orgs_without_active_owner,
    (select count(distinct s.org_id) from recorded_sources s where s.inspection_id=i.id and s.org_id is not null
      and not exists(select 1 from source_rows o where o.table_name='organizations' and o.r->>'id'=s.org_id)) as recorded_orgs_missing
  from inspections i left join properties p on p.id=i.property_id where i.family='OB'
), dashboard_grants as materialized (
  select a.r->>'id' as id,a.r->>'profile_id' as profile_id,m.r->>'key' as module_key,
    a.r->>'module_id' as module_id,r.r->>'key' as role_key,a.r->>'scope_type' as scope_type,a.r->>'scope_id' as scope_id,
    a.r->>'is_active'='true' as active,a.r->>'expires_at' as expires_at,a.r->>'source_system' as source_system,
    a.r->>'is_active'='true' and (a.r->>'expires_at' is null or (a.r->>'expires_at')::timestamptz>now()) as current
  from source_rows a join source_rows p on p.table_name='platform_products' and p.r->>'id'=a.r->>'product_id' and p.r->>'key'='dashboard'
  left join source_rows m on m.table_name='platform_modules' and m.r->>'id'=a.r->>'module_id'
  left join source_rows r on r.table_name='platform_roles' and r.r->>'id'=a.r->>'role_id'
  where a.table_name='platform_access_assignments'
), relevant_tables as materialized (
  select c.oid,n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and
    ((n.nspname='public' and (c.relname in ('properties','buildings','building_media','inspections','assignments','org_members','organization_enabled_modules','organization_invitations')
      or c.relname like 'inspection\_%' escape '\' or c.relname like 'ob\_%' escape '\'))
    or (n.nspname='storage' and c.relname='objects'))
), routines as materialized (
  select p.oid,p.proname,p.oid::regprocedure::text as signature,p.prosecdef as security_definer,
    md5(pg_get_functiondef(p.oid)) as definition_md5,
    pg_get_functiondef(p.oid) ~* 'organization_enabled_modules' as mentions_entitlements,
    pg_get_functiondef(p.oid) ~* 'platform_access_assignments' as mentions_grants,
    pg_get_functiondef(p.oid) ~* '(org_members|is_org_member|is_org_admin)' as mentions_membership,
    pg_get_functiondef(p.oid) ~* '(\.owner|"owner")' as mentions_owner
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and
    (p.proname like 'ob\_%' escape '\' or p.proname like 'organization\_%' escape '\'
      or p.proname like 'platform_organization\_%' escape '\' or p.proname in ('is_org_member','is_org_admin','raise_if_inspection_locked')
      or p.oid in (select tgfoid from pg_trigger where tgrelid in(select oid from relevant_tables) and not tgisinternal))
)
select jsonb_build_object(
  'format_version',1,'read_only',true,
  'schema',coalesce((select jsonb_agg(jsonb_build_object('table',table_name,'available',coalesce(relkind in ('r','p'),false),
    'columns',actual_columns,'missing_requested_columns',array(select unnest(selected_columns) except select unnest(actual_columns)))
    order by table_name) from source_catalog),'[]'::jsonb),
  'classification',jsonb_build_object('total',(select count(*) from inspections),'ob',(select count(*) from ob_cases),
    'unknown_family',(select count(*) from inspections where family is null or btrim(family)=''),
    'ambiguous_legacy_sb',(select count(*) from inspections where ambiguous_sb),
    'invalid_canonical_family',(select count(*) from inspections where invalid_canonical_family),
    'other_family',(select count(*) from inspections where family is not null and btrim(family)<>'' and family<>'OB')),
  'ob_attribution',jsonb_build_object(
    'one_recorded_org',(select count(*) from ob_cases where recorded_org_count=1),
    'conflicting_recorded_orgs',(select count(*) from ob_cases where recorded_org_count>1),
    'no_recorded_org',(select count(*) from ob_cases where recorded_org_count=0),
    'unattributed_owner_no_active_org',(select count(*) from ob_cases where recorded_org_count=0 and owner_active_org_count=0),
    'unattributed_owner_one_active_org_not_proof',(select count(*) from ob_cases where recorded_org_count=0 and owner_active_org_count=1),
    'unattributed_owner_multiple_active_orgs',(select count(*) from ob_cases where recorded_org_count=0 and owner_active_org_count>1),
    'property_missing',(select count(*) from ob_cases where property_missing),
    'owner_missing',(select count(*) from ob_cases where owner is null),
    'recorded_org_missing',(select count(*) from ob_cases where recorded_orgs_missing>0),
    'owner_not_active_in_recorded_org',(select count(*) from ob_cases where recorded_orgs_without_active_owner>0),
    'multiple_direct_assignments',(select count(*) from (select a.inspection_id from assignments a join ob_cases i on i.id=a.inspection_id group by a.inspection_id having count(*)>1) s),
    'wrong_family_direct_assignments',(select count(*) from assignments a join ob_cases i on i.id=a.inspection_id where a.family is not null and a.family not in ('OB','STATUS')),
    'duplicate_workflows',(select count(*) from (select w.inspection_id from workflows w join ob_cases i on i.id=w.inspection_id group by w.inspection_id having count(*)>1) s),
    'dangling_workflow_assignment_refs',(select count(*) from workflows w join ob_cases i on i.id=w.inspection_id
      where not exists(select 1 from assignments a where a.id=w.initial_id) or not exists(select 1 from assignments a where a.id=w.current_id)),
    'ob_report_links',(select count(*) from reports r join ob_cases i on i.id=r.inspection_id),
    'ob_revoked_report_links',(select count(*) from reports r join ob_cases i on i.id=r.inspection_id where r.revoked_at is not null)),
  'recorded_source_counts',coalesce((select jsonb_agg(to_jsonb(s) order by source) from (
    select s.source,count(*) as rows,count(distinct s.inspection_id) as inspections from recorded_sources s
    join ob_cases i on i.id=s.inspection_id where s.org_id is not null group by s.source) s),'[]'::jsonb),
  -- Advisory only: historical default-org fallbacks can have put the wrong org
  -- on these child rows. Do not promote them to canonical attribution evidence.
  'advisory_child_orgs',coalesce((select jsonb_agg(to_jsonb(s) order by source) from (
    select r.table_name as source,count(*) as rows,
      count(*) filter(where i.recorded_org_count=0) as rows_without_recorded_parent_org,
      count(*) filter(where i.recorded_org_count>0 and not i.recorded_org_ids ? (r.r->>'org_id')) as rows_outside_recorded_parent_orgs
    from source_rows r join ob_cases i on i.id=r.r->>'inspection_id'
    where r.table_name in ('inspection_addon_orders','inspection_environmental_protocols','inspection_environmental_files')
      and r.r->>'org_id' is not null group by r.table_name) s),'[]'::jsonb),
  'manual_review_sample_limit',50,
  'manual_review_samples',coalesce((select jsonb_agg(to_jsonb(i) order by id) from (
    select * from ob_cases where recorded_org_count<>1 or recorded_orgs_without_active_owner>0 or recorded_orgs_missing>0 or property_missing or owner is null order by id limit 50) i),'[]'::jsonb),
  'ob_grants',coalesce((select jsonb_agg(to_jsonb(g) order by profile_id,scope_type,scope_id,id) from dashboard_grants g where module_key='inspections'),'[]'::jsonb),
  'dashboard_other_grant_summary',coalesce((select jsonb_agg(to_jsonb(g) order by module_key,role_key,scope_type) from (
    select module_key,role_key,scope_type,count(*) as total,count(*) filter(where current) as current_count from dashboard_grants
    where module_key is distinct from 'inspections' group by module_key,role_key,scope_type) g),'[]'::jsonb),
  'legacy_fallback_review',jsonb_build_object('profiles_with_membership_or_legacy_admin_but_no_current_or_managed_dashboard_grants',
    (select count(*) from source_rows p where p.table_name='profiles' and (p.r->>'is_admin'='true' or exists(select 1 from members m where m.profile_id=p.r->>'id' and m.active))
      and not exists(select 1 from dashboard_grants g where g.profile_id=p.r->>'id' and g.current)
      and not exists(select 1 from dashboard_grants g where g.profile_id=p.r->>'id' and g.scope_type='organization'
        and g.source_system in ('organization_administration','organization_admin_migration')))),
  'ob_entitlements',coalesce((select jsonb_agg(r order by r->>'org_id') from source_rows where table_name='organization_enabled_modules' and r->>'module_key'='inspections'),'[]'::jsonb),
  'module_constraints',coalesce((select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by c.conname)
    from pg_constraint c where c.contype='c' and c.conrelid in(select oid from pg_class where relnamespace='public'::regnamespace and relname in ('organization_enabled_modules','organization_invitations'))),'[]'::jsonb),
  'table_security',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('privileges',coalesce((select jsonb_agg(jsonb_build_object('role',r.rolname,
    'select',has_table_privilege(r.oid,t.oid,'SELECT'),'write',has_table_privilege(r.oid,t.oid,'INSERT,UPDATE,DELETE')) order by r.rolname)
    from pg_roles r where r.rolname in ('anon','authenticated','service_role')),'[]'::jsonb))-'oid' order by schema_name,table_name) from relevant_tables t),'[]'::jsonb),
  'policies',coalesce((select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p
    join relevant_tables t on t.schema_name=p.schemaname and t.table_name=p.tablename),'[]'::jsonb),
  'rpc_guards',coalesce((select jsonb_agg((to_jsonb(f)-'oid'-'proname')||jsonb_build_object('execute',coalesce((select jsonb_agg(jsonb_build_object('role',r.rolname,'allowed',has_function_privilege(r.oid,f.oid,'EXECUTE')) order by r.rolname)
    from pg_roles r where r.rolname in ('anon','authenticated','service_role')),'[]'::jsonb)) order by signature) from routines f),'[]'::jsonb)
) as ob_organization_preflight;
