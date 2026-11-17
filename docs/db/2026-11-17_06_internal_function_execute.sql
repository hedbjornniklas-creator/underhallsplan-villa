-- Narrow EXECUTE on five separately reviewed boolean helpers.
-- Four helpers serve authenticated-only policies; anonymous grants are removed.
-- task_access_link_covers is called only by reviewed postgres-owned definers.
-- Existing authenticated policy/RPC grants and owner/service access are retained.
-- No GRANT, function body, search_path, policy or application data changes.
-- Dependency/source drift aborts the transaction; rerunning is safe.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  reviewed constant jsonb := '[
    {"identity":"is_hushub_besiktapp_admin()","name":"is_hushub_besiktapp_admin",
      "md5":"4b9c49ddbec11e72e6f0de71091bf14a","policies":83,"callers":[]},
    {"identity":"is_hushub_renoapp_admin()","name":"is_hushub_renoapp_admin",
      "md5":"542c7032688c5c8965031260775d06e6","policies":15,"callers":[]},
    {"identity":"is_org_admin(uuid)","name":"is_org_admin",
      "md5":"a5b5c14041ed17f3624dcc95f640bec2","policies":19,"callers":[
        "can_view_operational_task(uuid)","can_work_operational_task(uuid)",
        "can_manage_operational_task(uuid)"]},
    {"identity":"is_org_member(uuid)","name":"is_org_member",
      "md5":"765547493884db8a0fc01d569a821ef9","policies":67,"callers":[
        "has_operational_task_module_access(uuid)"]},
    {"identity":"task_access_link_covers(uuid,uuid,uuid)","name":"task_access_link_covers",
      "md5":"3db03fd06914c10d77ce900cbef97af2","policies":0,"callers":[
        "create_operational_task(uuid,text,timestamp with time zone,timestamp with time zone,text,text,text,uuid,uuid,uuid,integer,text,text,text,jsonb,uuid,uuid,uuid,uuid)",
        "request_operational_task_deadline_change(uuid,timestamp with time zone,text,uuid,uuid,uuid)",
        "transition_operational_task(uuid,text,text,timestamp with time zone,integer,uuid,uuid,uuid)",
        "register_operational_task_transcription_attempt(uuid,uuid,uuid,uuid,uuid,bigint)",
        "guard_task_recipient_access_link_write()",
        "resolve_task_recipient_portal_actor(uuid,uuid)",
        "mark_task_conversation_read(uuid,uuid,uuid,uuid,uuid)"]}
  ]'::jsonb;
  expected jsonb;
  phase text;
  function_oid oid;
  authenticated_oid oid;
  function_identity text;
  function_name text;
  caller record;
  caller_oids oid[];
  caller_count integer;
  policy_count integer;
  internal_only boolean;
  before_state jsonb := '{}'::jsonb;
  function_state jsonb;
begin
  if jsonb_array_length(reviewed)<>5 or
    (select count(distinct value->>'identity') from jsonb_array_elements(reviewed))<>5 then
    raise exception 'INTERNAL_EXECUTE_REVIEWED_SET_INVALID';
  end if;
  select oid into authenticated_oid from pg_roles where rolname='authenticated';
  if authenticated_oid is null
    or exists(select 1 from pg_roles where rolname in ('anon','authenticated')
      and (rolsuper or rolbypassrls or rolcreaterole))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER')
    or has_schema_privilege('anon','public','CREATE')
    or has_schema_privilege('authenticated','public','CREATE')
    or has_schema_privilege('anon','auth','CREATE')
    or has_schema_privilege('authenticated','auth','CREATE') then
    raise exception 'INTERNAL_EXECUTE_UNSAFE_ROLE';
  end if;

  -- Check the same source/dependency boundaries before and after the ACL change.
  foreach phase in array array['before','after'] loop
    for expected in select value from jsonb_array_elements(reviewed) loop
      function_identity := expected->>'identity';
      function_name := expected->>'name';
      function_oid := to_regprocedure('public.'||function_identity);
      internal_only := function_name='task_access_link_covers';
      if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
          where p.oid=function_oid and p.prokind='f' and p.prosecdef
            and p.prorettype='boolean'::regtype and l.lanname='sql'
            and pg_get_userbyid(p.proowner)='postgres'
            and md5(p.prosrc)=expected->>'md5'
            and not pg_has_role('anon',p.proowner,'MEMBER')
            and not pg_has_role('authenticated',p.proowner,'MEMBER')
            and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
              and d.objid=p.oid and d.deptype='e')) then
        raise exception 'INTERNAL_EXECUTE_FUNCTION_REVIEW_REQUIRED: %',function_identity;
      end if;

      select count(distinct pol.oid) into policy_count
        from pg_depend d join pg_policy pol on d.classid='pg_policy'::regclass and d.objid=pol.oid
        where d.refclassid='pg_proc'::regclass and d.refobjid=function_oid;
      if policy_count<>(expected->>'policies')::int
        or exists(select 1 from pg_depend d
          join pg_policy pol on d.classid='pg_policy'::regclass and d.objid=pol.oid
          where d.refclassid='pg_proc'::regclass and d.refobjid=function_oid
            and pol.polroles is distinct from array[authenticated_oid]) then
        raise exception 'INTERNAL_EXECUTE_POLICY_REVIEW_REQUIRED: %',function_identity;
      end if;
      -- Reject views, defaults, constraints, triggers and other unreviewed users.
      if exists(select 1 from pg_depend d
          where d.refclassid='pg_proc'::regclass and d.refobjid=function_oid
            and d.classid not in ('pg_policy'::regclass,'pg_proc'::regclass)) then
        raise exception 'INTERNAL_EXECUTE_OTHER_DEPENDENCY_REVIEW_REQUIRED: %',function_identity;
      end if;

      select coalesce(array_agg(to_regprocedure('public.'||value)::oid),'{}'::oid[])
        into caller_oids from jsonb_array_elements_text(expected->'callers');
      if array_position(caller_oids,null) is not null then
        raise exception 'INTERNAL_EXECUTE_CALLER_MISSING: %',function_identity;
      end if;
      caller_count := 0;
      -- pg_depend covers parsed SQL dependencies. A source scan also covers
      -- PL/pgSQL and string-form SQL calls; this is not a dynamic-SQL proof.
      for caller in select p.oid,p.prosecdef,pg_get_userbyid(p.proowner) as owner
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where p.prokind='f' and p.oid<>function_oid
          and n.nspname not in ('pg_catalog','information_schema')
          and (p.prosrc ~* ('(^|[^[:alnum:]_])'||function_name||'"?[[:space:]]*[(]')
            or exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
              and d.objid=p.oid and d.refclassid='pg_proc'::regclass and d.refobjid=function_oid)) loop
        caller_count := caller_count+1;
        if not caller.oid=any(caller_oids) or not caller.prosecdef or caller.owner<>'postgres' then
          raise exception 'INTERNAL_EXECUTE_CALLER_REVIEW_REQUIRED: % calls %',
            caller.oid::regprocedure,function_identity;
        end if;
      end loop;
      if caller_count<>cardinality(caller_oids) then
        raise exception 'INTERNAL_EXECUTE_CALLER_SET_CHANGED: %',function_identity;
      end if;

      if not has_function_privilege('service_role',function_oid,'EXECUTE')
        or not has_function_privilege('postgres',function_oid,'EXECUTE')
        or (not internal_only and not has_function_privilege('authenticated',function_oid,'EXECUTE'))
        or ((phase='after' or internal_only) and (
          has_function_privilege('anon',function_oid,'EXECUTE')
          or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
            where p.oid=function_oid and acl.grantee=0 and acl.privilege_type='EXECUTE')))
        or (phase='after' and internal_only and has_function_privilege('authenticated',function_oid,'EXECUTE')) then
        raise exception 'INTERNAL_EXECUTE_EFFECTIVE_GRANT_REVIEW_REQUIRED: %',function_identity;
      end if;
      select jsonb_build_object('definition',pg_get_functiondef(p.oid),
        'owner',pg_get_userbyid(p.proowner),'config',p.proconfig)
        into function_state from pg_proc p where p.oid=function_oid;
      if phase='before' then
        before_state := before_state||jsonb_build_object(function_identity,function_state);
      elsif function_state is distinct from before_state->function_identity then
        raise exception 'INTERNAL_EXECUTE_DEFINITION_CHANGED: %',function_identity;
      end if;
    end loop;

    if phase='before' then
      for expected in select value from jsonb_array_elements(reviewed) loop
        if expected->>'name'='task_access_link_covers' then
          execute 'revoke execute on function public.task_access_link_covers(uuid,uuid,uuid) from authenticated';
        else
          execute format('revoke execute on function public.%s from public,anon',expected->>'identity');
        end if;
      end loop;
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
