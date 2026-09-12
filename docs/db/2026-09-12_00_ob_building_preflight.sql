-- READ ONLY. Run and retain results in the approved staging/database review.
-- Do not run historic dedupe scripts or enable either rollout flag as preflight.
begin read only;
select current_setting('server_version') as server_version;
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and (c.relname in ('buildings','inspections','inspection_conditions','ob_property_snapshot')
  or c.relname like 'inspection_%' or c.relname like 'ob_%') and c.relkind='r' order by c.relname;
select tablename,indexname,indexdef from pg_indexes where schemaname='public'
  and tablename in ('buildings','inspection_overview_selections','inspection_exterior_observations','inspection_conditions',
    'inspection_interior_rooms','inspection_control_items','inspection_images','inspection_round_quick_notes') order by tablename,indexname;
select c.conrelid::regclass as relation,c.conname,c.contype,pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.connamespace='public'::regnamespace
  and c.conrelid::regclass::text in ('buildings','inspections','inspection_conditions','inspection_overview_selections',
    'inspection_interior_rooms','inspection_exterior_observations','inspection_control_items','inspection_images','inspection_round_quick_notes')
order by relation,c.conname;
select t.tgrelid::regclass as relation,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t where not t.tgisinternal and t.tgrelid in
  (select oid from pg_class where relnamespace='public'::regnamespace and (relname like 'inspection_%' or relname like 'ob_%' or relname='buildings'))
order by relation,t.tgname;
select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public'
  and (tablename like 'inspection_%' or tablename like 'ob_%' or tablename='buildings') order by tablename,policyname;
select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public'
  and grantee in ('anon','authenticated','service_role') and (table_name like 'inspection_%' or table_name like 'ob_%' or table_name='buildings')
order by table_name,grantee,privilege_type;
rollback;
