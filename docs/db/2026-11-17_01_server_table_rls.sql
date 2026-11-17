-- Security Advisor remediation for the 25 audited server-only tables.
-- Application access uses authorized server APIs and the service_role client;
-- public applicant links are validated by those APIs, not by browser policies.
-- Before applying: review live grants (including columns), policies, dependent
-- views and SECURITY DEFINER functions, and verify the server/API usage audit.
-- This migration changes no rows, function permissions, views or Storage rules.
-- Do not replace these guards with IF EXISTS: unexpected schema/access state
-- needs review, rather than a partially effective security change.

begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $migration$
declare
  target_tables constant text[] := array[
    'renovation_document_types',
    'renovation_action_types',
    'renovation_case_documents',
    'case_access_links',
    'renovation_case_action_types',
    'renovation_cases',
    'renovation_action_categories',
    'renovation_action_document_requirements',
    'renoapp_terminology_groups',
    'renoapp_terminology_terms',
    'renoapp_terminology_aliases',
    'renoapp_apply_questions',
    'renoapp_terminology_rules',
    'renoapp_apply_question_options',
    'renoapp_action_type_questions',
    'renoapp_case_question_answers',
    'renoapp_participant_roles',
    'renoapp_action_type_participant_roles',
    'renoapp_review_flags',
    'renoapp_apply_option_triggers',
    'renoapp_case_participants',
    'renovation_case_messages',
    'contacts',
    'brf_units',
    'unit_contacts'
  ];
  browser_roles constant text[] := array['anon', 'authenticated'];
  service_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  target_name text;
  role_name text;
  privilege_name text;
  relation_id oid;
  service_role_id oid;
  anon_role_id oid;
  authenticated_role_id oid;
  relation_references text;
  column_names text;
  unexpected_tables text;
  table_privilege_list text;
begin
  if cardinality(target_tables) <> 25
     or (select count(distinct name) from unnest(target_tables) as t(name)) <> 25 then
    raise exception 'Server-table RLS migration must contain exactly 25 distinct tables';
  end if;

  select oid into service_role_id from pg_catalog.pg_roles where rolname = 'service_role';
  select oid into anon_role_id from pg_catalog.pg_roles where rolname = 'anon';
  select oid into authenticated_role_id from pg_catalog.pg_roles where rolname = 'authenticated';
  if service_role_id is null or anon_role_id is null or authenticated_role_id is null then
    raise exception 'Expected Supabase service_role, anon and authenticated roles are required';
  end if;
  if exists (
    select 1 from pg_catalog.pg_roles
    where oid in (anon_role_id, authenticated_role_id)
      and (rolsuper or rolbypassrls or rolcreaterole)
  ) or pg_catalog.pg_has_role(anon_role_id, authenticated_role_id, 'MEMBER')
    or pg_catalog.pg_has_role(anon_role_id, service_role_id, 'MEMBER')
    or pg_catalog.pg_has_role(authenticated_role_id, service_role_id, 'MEMBER')
    or pg_catalog.has_schema_privilege(anon_role_id, 'public', 'CREATE')
    or pg_catalog.has_schema_privilege(authenticated_role_id, 'public', 'CREATE')
    or pg_catalog.has_schema_privilege(anon_role_id, 'auth', 'CREATE')
    or pg_catalog.has_schema_privilege(authenticated_role_id, 'auth', 'CREATE') then
    raise exception 'Unsafe Supabase browser role or schema privileges require review';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where oid = service_role_id and (rolbypassrls or rolsuper)
  ) then
    raise exception 'service_role must bypass RLS for the audited server APIs';
  end if;
  -- PostgreSQL 17 added MAINTAIN; include it in effective/inherited privilege
  -- assertions whenever the server supports it, without breaking older hosts.
  if pg_catalog.current_setting('server_version_num')::integer >= 170000 then
    service_privileges := pg_catalog.array_append(service_privileges, 'MAINTAIN');
  end if;
  table_privilege_list := pg_catalog.array_to_string(service_privileges, ',');

  -- The audit covers ordinary, non-inherited tables. Do not silently harden
  -- only a parent or one child if the live schema has since been partitioned.
  select string_agg(t.name, ', ' order by t.name) into unexpected_tables
  from unnest(target_tables) as t(name)
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = t.name
  where c.oid is null or c.relkind <> 'r' or c.relispartition
     or pg_catalog.pg_get_userbyid(c.relowner) <> 'postgres'
     or c.relrowsecurity or c.relforcerowsecurity
     or pg_catalog.pg_has_role(anon_role_id, c.relowner, 'MEMBER')
     or pg_catalog.pg_has_role(authenticated_role_id, c.relowner, 'MEMBER')
     or exists (
       select 1 from pg_catalog.pg_inherits i
       where i.inhrelid = c.oid or i.inhparent = c.oid
     );
  if unexpected_tables is not null then
    raise exception 'Missing or unexpected server-table relations: %', unexpected_tables;
  end if;

  -- Keep schema/policy assertions valid until commit. Lock in a deterministic
  -- order, with the short lock timeout above, rather than waiting indefinitely.
  select string_agg(format('%I.%I', 'public', name), ', ' order by name)
  into relation_references from unnest(target_tables) as t(name);
  execute 'lock table ' || relation_references || ' in access exclusive mode';

  foreach target_name in array target_tables loop
    relation_id := pg_catalog.to_regclass(format('%I.%I', 'public', target_name));
    if not exists (
      select 1 from pg_catalog.pg_class c
      where c.oid = relation_id and c.relkind = 'r' and not c.relispartition
        and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
        and not c.relrowsecurity and not c.relforcerowsecurity
        and not pg_catalog.pg_has_role(anon_role_id, c.relowner, 'MEMBER')
        and not pg_catalog.pg_has_role(authenticated_role_id, c.relowner, 'MEMBER')
        and not exists (
          select 1 from pg_catalog.pg_inherits i
          where i.inhrelid = c.oid or i.inhparent = c.oid
        )
    ) then
      raise exception 'Unexpected locked server-table relation: public.%', target_name;
    end if;
    if exists (select 1 from pg_catalog.pg_policy where polrelid = relation_id) then
      raise exception 'Existing policies on public.% require review before server-only hardening', target_name;
    end if;
    foreach privilege_name in array service_privileges loop
      if not pg_catalog.has_table_privilege(service_role_id, relation_id, privilege_name) then
        raise exception 'service_role lacks % on public.% before migration', privilege_name, target_name;
      end if;
    end loop;
  end loop;

  foreach target_name in array target_tables loop
    relation_id := pg_catalog.to_regclass(format('%I.%I', 'public', target_name));
    execute format('alter table %I.%I enable row level security', 'public', target_name);
    execute format(
      'revoke all privileges on table %I.%I from public, anon, authenticated',
      'public', target_name
    );

    -- Table-level REVOKE does not remove separately granted column privileges.
    -- No CASCADE: delegated grants must be reviewed if RESTRICT rejects them.
    select string_agg(format('%I', attname), ', ' order by attnum) into column_names
    from pg_catalog.pg_attribute
    where attrelid = relation_id and attnum > 0 and not attisdropped;
    if column_names is null then
      raise exception 'No expected user columns on public.%', target_name;
    end if;
    execute format(
      'revoke all privileges (%s) on table %I.%I from public, anon, authenticated',
      column_names, 'public', target_name
    );
  end loop;

  -- Fail the whole transaction if direct, PUBLIC or inherited browser access
  -- remains, or if the server role would lose any existing table privilege.
  foreach target_name in array target_tables loop
    relation_id := pg_catalog.to_regclass(format('%I.%I', 'public', target_name));
    if not exists (
      select 1 from pg_catalog.pg_class where oid = relation_id and relrowsecurity
    ) or exists (select 1 from pg_catalog.pg_policy where polrelid = relation_id) then
      raise exception 'RLS without browser policies was not established on public.%', target_name;
    end if;

    if exists (
      select 1 from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) as acl
      where c.oid = relation_id and acl.grantee in (0, anon_role_id, authenticated_role_id)
    ) or exists (
      select 1 from pg_catalog.pg_attribute a
      cross join lateral pg_catalog.aclexplode(a.attacl) as acl
      where a.attrelid = relation_id and a.attnum > 0 and not a.attisdropped
        and acl.grantee in (0, anon_role_id, authenticated_role_id)
    ) then
      raise exception 'Direct browser/PUBLIC table or column grants remain on public.%', target_name;
    end if;

    foreach role_name in array browser_roles loop
      if pg_catalog.has_table_privilege(
        role_name, relation_id, table_privilege_list
      ) or pg_catalog.has_any_column_privilege(
        role_name, relation_id, 'SELECT,INSERT,UPDATE,REFERENCES'
      ) then
        raise exception 'Effective browser privileges remain for % on public.%', role_name, target_name;
      end if;
    end loop;
    foreach privilege_name in array service_privileges loop
      if not pg_catalog.has_table_privilege(service_role_id, relation_id, privilege_name) then
        raise exception 'service_role lost % on public.%', privilege_name, target_name;
      end if;
    end loop;
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
