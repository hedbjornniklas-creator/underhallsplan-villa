-- Fix a fail-open NULL comparison in the authenticated task-creation RPC.
-- A contact-assigned parent has no assignee_profile_id. Ordinary <> yielded
-- NULL and let an unrelated organization member pass the parent actor guard.
-- Only the two actor comparisons in that guard change to IS DISTINCT FROM.
-- All other source, arguments/defaults, attributes, ACLs and ownership remain.
-- Repeating is safe only for the exact reviewed old or corrected source.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  target_identity constant text := 'public.create_operational_task(uuid,text,timestamp with time zone,timestamp with time zone,text,text,text,uuid,uuid,uuid,integer,text,text,text,jsonb,uuid,uuid,uuid,uuid)';
  old_source_md5 constant text := '3d5d27e3cf99f352a9e9ed3864e368f2';
  new_source_md5 constant text := 'e9567246777362890c7599bdd5d42f3b';
  old_guard constant text := E'parent_row.issuer_profile_id <> effective_profile_id\r\n        and parent_row.assignee_profile_id <> effective_profile_id';
  new_guard constant text := E'parent_row.issuer_profile_id is distinct from effective_profile_id\r\n        and parent_row.assignee_profile_id is distinct from effective_profile_id';
  expected_acl constant jsonb := '[
    ["authenticated","postgres","EXECUTE",false],
    ["postgres","postgres","EXECUTE",false],
    ["service_role","postgres","EXECUTE",false]
  ]'::jsonb;
  function_oid oid;
  before_definition text;
  corrected_definition text;
  before_source text;
  current_acl jsonb;
  before_catalog jsonb;
  after_catalog jsonb;
begin
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated')
      and (rolsuper or rolbypassrls or rolcreaterole))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER') then
    raise exception 'TASK_PARENT_AUTHORIZATION_UNSAFE_ROLE';
  end if;
  function_oid := to_regprocedure(target_identity);
  if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=function_oid and p.prokind='f' and p.pronargs=19
        and p.pronargdefaults=12 and p.provariadic=0 and p.proargmodes is null
        and p.prorettype=to_regtype('public.operational_tasks') and not p.proretset
        and l.lanname='plpgsql' and pg_get_userbyid(p.proowner)='postgres'
        and p.prosecdef and not p.proisstrict and not p.proleakproof
        and p.provolatile='v' and p.proparallel='u' and p.procost=100
        and p.prorows=0 and p.prosupport=0
        and p.proconfig=array['search_path=public, pg_catalog']
        and md5(pg_get_function_arguments(p.oid))='45f01a3107680c59a84ea3f741d7833f'
        and md5(p.prosrc) in (old_source_md5,new_source_md5)
        and not pg_has_role('anon',p.proowner,'MEMBER')
        and not pg_has_role('authenticated',p.proowner,'MEMBER')
        and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
          and d.objid=p.oid and d.deptype='e')) then
    raise exception 'TASK_PARENT_AUTHORIZATION_FUNCTION_REVIEW_REQUIRED';
  end if;
  select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantee),
      pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
      order by pg_get_userbyid(a.grantee),pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
    into current_acl from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid=function_oid;
  if current_acl is distinct from expected_acl
    or has_function_privilege('anon',function_oid,'EXECUTE')
    or not has_function_privilege('authenticated',function_oid,'EXECUTE')
    or not has_function_privilege('service_role',function_oid,'EXECUTE') then
    raise exception 'TASK_PARENT_AUTHORIZATION_ACL_REVIEW_REQUIRED';
  end if;
  -- The other decision RPCs rely on this non-null issuer identity as reviewed.
  if not exists(select 1 from pg_attribute
      where attrelid='public.operational_tasks'::regclass and attname='issuer_profile_id'
        and attnum>0 and not attisdropped and atttypid='uuid'::regtype and attnotnull)
    or not exists(select 1 from pg_attribute
      where attrelid='public.operational_tasks'::regclass and attname='assignee_profile_id'
        and attnum>0 and not attisdropped and atttypid='uuid'::regtype and not attnotnull) then
    raise exception 'TASK_PARENT_AUTHORIZATION_SCHEMA_REVIEW_REQUIRED';
  end if;

  -- Re-parsing identical defaults can change their internal location offsets;
  -- compare their normalized SQL rather than the pg_node_tree serialization.
  select pg_get_functiondef(p.oid),p.prosrc,jsonb_build_object(
      'catalog',to_jsonb(p)-'prosrc'-'proargdefaults',
      'arguments',pg_get_function_arguments(p.oid))
    into before_definition,before_source,before_catalog from pg_proc p where p.oid=function_oid;
  if md5(before_source)=new_source_md5 then
    return;
  end if;
  if (length(before_source)-length(replace(before_source,old_guard,'')))<>length(old_guard)
    or md5(replace(before_source,old_guard,new_guard))<>new_source_md5 then
    raise exception 'TASK_PARENT_AUTHORIZATION_GUARD_REVIEW_REQUIRED';
  end if;
  corrected_definition := replace(before_definition,old_guard,new_guard);
  execute corrected_definition;

  select jsonb_build_object('catalog',to_jsonb(p)-'prosrc'-'proargdefaults',
    'arguments',pg_get_function_arguments(p.oid))
    into after_catalog from pg_proc p where p.oid=function_oid;
  if after_catalog is distinct from before_catalog
    or to_regprocedure(target_identity)::oid<>function_oid
    or (select md5(prosrc) from pg_proc where oid=function_oid) is distinct from new_source_md5
    or (select pg_get_functiondef(function_oid)) is distinct from corrected_definition then
    raise exception 'TASK_PARENT_AUTHORIZATION_UNEXPECTED_CHANGE';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
