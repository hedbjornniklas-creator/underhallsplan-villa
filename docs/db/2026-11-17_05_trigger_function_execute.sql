-- Remove browser EXECUTE grants from 31 reviewed SECURITY DEFINER triggers.
-- Existing triggers still fire: PostgreSQL checks this grant at CREATE TRIGGER,
-- not when an already-created trigger fires. No non-trigger RPC/helper changes.
-- Only ACLs change; source, configuration, owners and triggers are preserved.
-- Source hashes allow the separately reviewed search_path migration to run first.
-- Repeating is safe; unexpected identities, source or binding counts abort.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  -- [function name, exact live prosrc MD5, existing non-internal trigger count]
  reviewed constant jsonb := '[
    ["action_case_item_cost_state","e695c5f3f5e190c3cff51e67fff3834d",1],
    ["action_case_quote_price_guard","cc3950eb7abf925a891b9402d2eb8d7d",1],
    ["ensure_task_organization_settings","c568b1cdd304c77f154ef5f3be9ce63b",1],
    ["guard_action_case_grouped_price_selection","ad9b7b665e50d94b53c502a8f47e99c3",1],
    ["guard_action_case_grouped_quote","086874b30ca13d40c2a469b7776d333e",1],
    ["guard_project_manager","b1e6687c0b3196d0dbedd75b3469ccbe",1],
    ["guard_structured_contract_property","671457587f2a6f1c86aaf11bc2990323",2],
    ["handle_new_user","6333f7eecc7d0cbb9310634f082eb089",1],
    ["invalidate_action_case_file_evidence","2eac0f96a1cbceef77ee890ded7731fb",1],
    ["mark_tu_analysis_stale_after_source_write","3c5c7d2f650cd95e59195e98e2ded581",7],
    ["mark_tu_control_plan_stale_after_document_write","3da8b75c6e7127a8705600e8dcf42f06",1],
    ["mark_tu_control_plan_unapproved_after_item_write","05372397d199a5d292fb51bf0eb78c73",1],
    ["ob_building_guard_identity","c160728029e3c8212fbc7116984c0d8e",2],
    ["ob_building_guard_report","12a9dcf428995436ca07e007d9f9cf9c",1],
    ["ob_building_guard_row","4416f6e3510ae4703853c525268582f4",7],
    ["ob_building_guard_shared","7d53dda17713c0f0d9018699f7c356d7",15],
    ["ob_ensure_basement_room","14275c6b29befd5e8785619278e1c827",1],
    ["ob_guard_floor_key","71fb9864cd82fb04d16ef69b0ef7c6f3",3],
    ["ob_init_floor_model","18981db6b42022ad0daf841ddf35561f",1],
    ["prepare_tu_control_plan_case_update","137379684b0280688fd0db3ca06a76de",1],
    ["protect_question_original_file","752fe3dba4d569e84f5152caf32af5a2",1],
    ["register_task_completion_evidence","704487beb7349fbc6218c0f6fe197121",1],
    ["renoapp_guard_rules_acceptance","cf3b118b5fda38dda500f272aedd0564",1],
    ["renoapp_lock_decision_record","0abd51909f7e0d42a2c2f8e27e1ffa97",1],
    ["renoapp_lock_final_case_status","2fa1a97598335f5aecca5a350eb64b64",1],
    ["revoke_task_access_links_for_inactive_contact","516b07beb04e3108e7ea34fd7176aba3",1],
    ["sync_operational_task_followup_job","4fb145daa566ca68da0cd55fc2f69d1b",1],
    ["trg_inspections_ensure_default_other_room","d83ac1ad238774aacdbece9ab99a76b2",1],
    ["tu_accept_customer_details","6825d57ed9110db652e594393ad80eb8",1],
    ["tu_initialize_customer_details","637939225e7b6ccf23b9288db3308e62",1],
    ["withdraw_unpublished_tu_revision_after_unlock","a835e2567686573ba4afa4be3207cfe5",1]
  ]'::jsonb;
  expected jsonb;
  function_name text;
  function_oid oid;
  role_name text;
  lock_relations text;
  before_state jsonb := '{}'::jsonb;
  function_state jsonb;
begin
  if jsonb_array_length(reviewed)<>31 or
    (select count(distinct value->>0) from jsonb_array_elements(reviewed))<>31 then
    raise exception 'TRIGGER_EXECUTE_REVIEWED_SET_INVALID';
  end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated')
      and (rolsuper or rolbypassrls or rolcreaterole))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER') then
    raise exception 'TRIGGER_EXECUTE_UNSAFE_ROLE';
  end if;

  -- Validate every function before changing any ACL. No live OIDs are pinned.
  for expected in select value from jsonb_array_elements(reviewed) loop
    function_name := expected->>0;
    function_oid := to_regprocedure(format('public.%I()',function_name));
    if not exists (select 1 from pg_proc p join pg_language l on l.oid=p.prolang
        where p.oid=function_oid and p.prokind='f' and p.pronargs=0
          and p.prorettype='trigger'::regtype and p.prosecdef
          and pg_get_userbyid(p.proowner)='postgres' and l.lanname='plpgsql'
          and md5(p.prosrc)=expected->>1
          and not pg_has_role('anon',p.proowner,'MEMBER')
          and not pg_has_role('authenticated',p.proowner,'MEMBER')
          and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
            and d.objid=p.oid and d.deptype='e'))
      or (select count(*) from pg_trigger where tgfoid=function_oid and not tgisinternal)<>(expected->>2)::int
      or not has_function_privilege('service_role',function_oid,'EXECUTE') then
      raise exception 'TRIGGER_EXECUTE_FUNCTION_REVIEW_REQUIRED: %',function_name;
    end if;
  end loop;

  -- Freeze the existing trigger bindings until the after-state checks complete.
  select string_agg(format('%I.%I',n.nspname,c.relname),',' order by n.nspname,c.relname)
    into lock_relations from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where exists(select 1 from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal
      and t.tgfoid in (select to_regprocedure(format('public.%I()',value->>0))
        from jsonb_array_elements(reviewed)));
  if lock_relations is null then raise exception 'TRIGGER_EXECUTE_BINDINGS_MISSING'; end if;
  execute 'lock table '||lock_relations||' in share mode';

  for expected in select value from jsonb_array_elements(reviewed) loop
    function_name := expected->>0;
    function_oid := to_regprocedure(format('public.%I()',function_name));
    select jsonb_build_object('definition',pg_get_functiondef(p.oid),
      'owner',pg_get_userbyid(p.proowner),'config',p.proconfig,
      'triggers',(select jsonb_agg(jsonb_build_object(
        'relation',t.tgrelid::regclass::text,'name',t.tgname,
        'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
        order by t.tgrelid,t.tgname) from pg_trigger t
        where t.tgfoid=p.oid and not t.tgisinternal))
      into function_state from pg_proc p where p.oid=function_oid;
    if (select md5(prosrc) from pg_proc where oid=function_oid) is distinct from expected->>1
      or (select count(*) from pg_trigger where tgfoid=function_oid and not tgisinternal)<>(expected->>2)::int then
      raise exception 'TRIGGER_EXECUTE_CONCURRENT_DEFINITION_CHANGE: %',function_name;
    end if;
    before_state := before_state||jsonb_build_object(function_name,function_state);
    execute format('revoke execute on function public.%I() from public,anon,authenticated',function_name);
  end loop;

  for expected in select value from jsonb_array_elements(reviewed) loop
    function_name := expected->>0;
    function_oid := to_regprocedure(format('public.%I()',function_name));
    select jsonb_build_object('definition',pg_get_functiondef(p.oid),
      'owner',pg_get_userbyid(p.proowner),'config',p.proconfig,
      'triggers',(select jsonb_agg(jsonb_build_object(
        'relation',t.tgrelid::regclass::text,'name',t.tgname,
        'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
        order by t.tgrelid,t.tgname) from pg_trigger t
        where t.tgfoid=p.oid and not t.tgisinternal))
      into function_state from pg_proc p where p.oid=function_oid;
    if function_state is distinct from before_state->function_name
      or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
        where p.oid=function_oid and p.prokind='f' and p.pronargs=0
          and p.prorettype='trigger'::regtype and p.prosecdef
          and pg_get_userbyid(p.proowner)='postgres' and l.lanname='plpgsql'
          and md5(p.prosrc)=expected->>1) then
      raise exception 'TRIGGER_EXECUTE_DEFINITION_CHANGED: %',function_name;
    end if;
    foreach role_name in array array['anon','authenticated'] loop
      if has_function_privilege(role_name,function_oid,'EXECUTE') then
        raise exception 'TRIGGER_EXECUTE_INHERITED_CLIENT_GRANT: %.%',role_name,function_name;
      end if;
    end loop;
    if not has_function_privilege('service_role',function_oid,'EXECUTE')
      or not has_function_privilege('postgres',function_oid,'EXECUTE')
      or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
        where p.oid=function_oid and acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception 'TRIGGER_EXECUTE_EFFECTIVE_GRANT_REVIEW_REQUIRED: %',function_name;
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
