-- Pin name resolution for the 32 reviewed mutable-search_path functions.
-- Reviewed against functions-before.json from 2026-11-17, PostgreSQL 17.6.
-- 28 bodies match tracked migrations/fixtures; four older live-only bodies were
-- reviewed explicitly (handle_new_user, is_admin, moddatetime, normalize_properties_status).
-- All application references are already public/auth-qualified. Only built-ins
-- need lookup: pg_catalog first, with pg_temp explicitly last. No public or
-- extensions search is needed, including for the PL/pgSQL moddatetime trigger.
-- ALTER FUNCTION SET only: bodies, ACLs, owners, signatures and other attributes
-- are preserved and checked. No application rows or permission grants change.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog;

do $$
declare
  reviewed record;
  actual pg_proc%rowtype;
  function_oid oid;
  reviewed_oids oid[] := array[]::oid[];
  baselines jsonb := '[]'::jsonb;
  metadata_before jsonb;
  metadata_after jsonb;
  schema_name text;
begin
  if current_setting('server_version_num')::int < 170000 then
    raise exception 'FUNCTION_PATH_POSTGRES_17_REQUIRED';
  end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated')
      and (rolsuper or rolcreaterole or rolbypassrls))
    or pg_has_role('anon','authenticated','MEMBER')
    or pg_has_role('anon','service_role','MEMBER')
    or pg_has_role('authenticated','service_role','MEMBER')
    or pg_has_role('anon','postgres','MEMBER')
    or pg_has_role('authenticated','postgres','MEMBER') then
    raise exception 'FUNCTION_PATH_UNSAFE_ROLE';
  end if;
  foreach schema_name in array array['pg_catalog','public','auth'] loop
    if to_regnamespace(schema_name) is null
      or has_schema_privilege('anon',schema_name,'CREATE')
      or has_schema_privilege('authenticated',schema_name,'CREATE') then
      raise exception 'FUNCTION_PATH_UNTRUSTED_SCHEMA: %',schema_name;
    end if;
  end loop;

  -- Exact identities and raw PostgreSQL hashes pin the reviewed definitions,
  -- including CRLF in prosrc. Stop on drift rather than overwrite newer work.
  -- The 19 timestamp-only functions use now(); the other guards use built-ins
  -- and qualified public dependencies. No body contains dynamic SQL.
  for reviewed in select * from (values
    ('addon_services_set_updated_at()', '3dd8b818581db891c452b0bd337c95b3', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('assignments_set_updated_at()', 'bd5671fdb27791678ad2ccf7a76da587', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('eb_follow_up_guard_order()', '3612c9fb8abab3e7b07927165424c0c7', '5690ab560e6a955dd793d44c09c44e87', 'plpgsql', 'trigger', false),
    ('eb_guard_paid_remediation_snapshot()', '579c47fe585449d04c9abea9c0a88a8f', '078cfb2a6bf3e1ca832b4bfdd2879b7b', 'plpgsql', 'trigger', false),
    ('eb_set_updated_at()', '26b4e3621f0dc77d8aef0e2b77bd75a7', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('guard_customer_offer_snapshot()', 'b45823c32e187440d46a66ae8ebc86d4', 'a51598b8cd018678cb93e68f37e232b3', 'plpgsql', 'trigger', false),
    ('guard_locked_inspection_child_write()', '92dce4b84a7b023ed389a075bdbff9ed', '0ac0d79397b0c481a3e7011d14821c79', 'plpgsql', 'trigger', false),
    ('guard_locked_inspections_write()', 'cc69bc53d465948cb57989ba9dce58eb', '00fcc32ec92a6a9c32b6bed403852001', 'plpgsql', 'trigger', false),
    ('guard_project_billing_event()', 'e11cabe87bdf6da46f42f38972f2aaa8', '35f5d77f14d6942d6b350be1e66d7ce4', 'plpgsql', 'trigger', false),
    ('handle_new_user()', 'eb66aa204154e14ad21d2d10e227229b', '6333f7eecc7d0cbb9310634f082eb089', 'plpgsql', 'trigger', true),
    ('inspection_moisture_control_images_set_updated_at()', 'f0283c8768f68890d2e08d38a2d442ab', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('inspection_round_quick_notes_set_updated_at()', 'a43b4fa7959d4126878afe2c33dd255f', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('is_admin()', '43795b93de14bb20451f2deef1d6dba5', 'd88cd7b4983afe087cc53708fb699898', 'sql', 'boolean', false),
    ('moddatetime()', 'f6e073c1a95a75761c7d5b9fbe518f9f', '87a85540c77347aaa7913b63b3f3af91', 'plpgsql', 'trigger', false),
    ('normalize_properties_status()', '341d3613f9c86f2a7340c97476c95a8b', 'eb61404ad1ec7e05a4a98b7bc13724c2', 'plpgsql', 'trigger', false),
    ('ob_property_snapshot_set_updated_at()', '1aaf2a0a4f33379c6f511d8d220c0131', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('org_members_set_updated_at()', 'a189ec666dc7469bf92549b389805744', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('organizations_set_updated_at()', 'd32caaf4fc5f6a1c3f0dd070134f8fdd', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('platform_set_updated_at()', 'cd57e6072da7b2ebacd954c34407d843', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('profile_certifications_set_updated_at()', 'c2b54d356649c7f7bfd7b299adda331e', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('raise_if_inspection_locked(uuid,text)', '0b69a9ee9ca8ead3339c15fc967f000c', '2d59377719ba130bed141ff1d440c193', 'plpgsql', 'void', false),
    ('renoapp_fix_mojibake(text)', '44b60c1c87d29e092709ed008d48de0d', 'e6aee7e523c2a38ca80a4431040b0cb1', 'sql', 'text', false),
    ('renoapp_set_updated_at()', '2aad34149c3bb27ae94c2980d0294ef9', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('set_timestamp()', 'c3a58425533be41085429ff9e2b1105f', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('set_updated_at()', '8de7ae383447503e8949149bfb3f0efb', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('settings_certifications_set_updated_at()', '1358bc664628b8e49dc69589ef50f516', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('settings_tu_report_section_types_set_updated_at()', '397f9db77aa71e1e2dc5ba5e55beb1b0', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('settings_tu_report_templates_set_updated_at()', 'fd5950f7c730c032163fd726fd42fdae', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('technical_investigations_set_updated_at()', '7f29a1fc78abb61b5db3b07c1766f887', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false),
    ('tu_measurements_invalidate_observation_review()', '812bf5786484f8a7938419c07ce24202', '32b740a5a767c4ea536ffd0681755b92', 'plpgsql', 'trigger', false),
    ('tu_observations_preserve_original_source()', '12806651039d0ea444a6993aabb49841', 'b5d5c1affb14a096d40391d23ea705b2', 'plpgsql', 'trigger', false),
    ('tu_report_revisions_set_updated_at()', 'de15608eedd31e29bd4b68fe09463071', '204b9b9355e61b7541bc0633bbc9294c', 'plpgsql', 'trigger', false)
  ) as pinned(signature,definition_hash,source_hash,language_name,result_type,is_definer) loop
    function_oid := to_regprocedure('public.'||reviewed.signature);
    if function_oid is null or function_oid=any(reviewed_oids) then
      raise exception 'FUNCTION_PATH_IDENTITY_REVIEW_REQUIRED: %',reviewed.signature;
    end if;
    select p.* into actual from pg_proc p where p.oid=function_oid;
    if actual.pronamespace<>'public'::regnamespace
      or actual.prokind<>'f'
      or pg_get_userbyid(actual.proowner)<>'postgres'
      or pg_has_role('anon',actual.proowner,'MEMBER')
      or pg_has_role('authenticated',actual.proowner,'MEMBER')
      or actual.proconfig is not null
      or actual.prosecdef is distinct from reviewed.is_definer
      or actual.prorettype<>to_regtype(reviewed.result_type)
      or not exists (select 1 from pg_language
        where oid=actual.prolang and lanname=reviewed.language_name)
      or exists (select 1 from pg_depend where classid='pg_proc'::regclass
        and objid=function_oid and deptype='e')
      or md5(actual.prosrc)<>reviewed.source_hash
      or md5(pg_get_functiondef(function_oid))<>reviewed.definition_hash then
      raise exception 'FUNCTION_PATH_DEFINITION_REVIEW_REQUIRED: %',reviewed.signature;
    end if;
    reviewed_oids := array_append(reviewed_oids,function_oid);
    baselines := baselines||jsonb_build_array(jsonb_build_object(
      'signature',reviewed.signature,'oid',function_oid,
      'definition_hash',reviewed.definition_hash,
      'metadata',to_jsonb(actual)-'proconfig'));
  end loop;
  if cardinality(reviewed_oids)<>32 then
    raise exception 'FUNCTION_PATH_TARGET_COUNT_MISMATCH';
  end if;

  -- Validate all targets first, then recheck each immediately before ALTER.
  -- Comparing the entire pg_proc row except proconfig also protects ACLs,
  -- owners, argument defaults/names, security mode and execution attributes.
  for reviewed in select * from jsonb_to_recordset(baselines)
      as checked(signature text,oid oid,definition_hash text,metadata jsonb) loop
    select p.* into actual from pg_proc p where p.oid=reviewed.oid;
    metadata_before := to_jsonb(actual)-'proconfig';
    if metadata_before is distinct from reviewed.metadata
      or actual.proconfig is not null
      or to_regprocedure('public.'||reviewed.signature) is distinct from reviewed.oid
      or md5(pg_get_functiondef(reviewed.oid))<>reviewed.definition_hash then
      raise exception 'FUNCTION_PATH_CONCURRENT_DEFINITION_CHANGE: %',reviewed.signature;
    end if;
    execute format('alter function public.%s set search_path = pg_catalog, pg_temp',reviewed.signature);
    select p.* into actual from pg_proc p where p.oid=reviewed.oid;
    metadata_after := to_jsonb(actual)-'proconfig';
    if metadata_after is distinct from metadata_before
      or actual.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[] then
      raise exception 'FUNCTION_PATH_UNEXPECTED_METADATA_CHANGE: %',reviewed.signature;
    end if;
  end loop;
end $$;
commit;
