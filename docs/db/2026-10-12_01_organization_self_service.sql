-- Self-service NEW organizations; requires organization administration SQL 2026-10-01_01,
-- central administration 2026-10-02_01 and OB/TU administration 2026-10-08_03.
-- Installation never changes existing organizations, memberships, defaults or grants.
-- The server must derive p_actor from auth.getUser(), never from request data.
-- No organization lookup/claim by name/number; duplicates require an invitation.
-- Existing historical duplicate organization numbers remain untouched.
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regprocedure('public.platform_organization_assert_managed_target(uuid)') is null
    or to_regprocedure('public.organization_assert_ob_activation_reviewed(uuid)') is null
    or to_regprocedure('public.organization_apply_member_grants(uuid,uuid,uuid,text,boolean,text[])') is null then
    raise exception 'ORG_SELF_SERVICE_PREREQUISITES_REQUIRED';
  end if;
end $$;

create table if not exists public.organization_self_service_requests (
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(actor_profile_id,request_id),
  unique(organization_id)
);
create index if not exists organization_self_service_requests_actor_created_idx
  on public.organization_self_service_requests(actor_profile_id,created_at desc);
alter table public.organization_self_service_requests enable row level security;
revoke all on public.organization_self_service_requests from public,anon,authenticated,service_role;
grant select on public.organization_self_service_requests to service_role;

create or replace function public.organization_self_service_create(p_actor uuid,p_request_id uuid,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='10s' as $$
declare v_name text; v_number text; v_org uuid; v_fingerprint text; v_email text;
  previous public.organization_self_service_requests%rowtype;
begin
  -- Defense in depth: mutable profiles.email is never proof of verification.
  if p_actor is null or not exists(select 1 from auth.users where id=p_actor) then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;
  select email into v_email from auth.users where id=p_actor and email is not null
    and btrim(email)<>'' and email_confirmed_at is not null;
  if not found then
    raise exception 'ORG_EMAIL_UNVERIFIED' using errcode='42501';
  end if;
  if p_request_id is null or p_values is null or jsonb_typeof(p_values)<>'object'
    or not p_values ?& array['name','organizationNumber']
    or (select count(*) from jsonb_object_keys(p_values))<>2
    or jsonb_typeof(p_values->'name') is distinct from 'string'
    or jsonb_typeof(p_values->'organizationNumber') is distinct from 'string' then
    raise exception 'ORG_INPUT_INVALID';
  end if;
  v_name:=btrim(p_values->>'name');
  v_number:=btrim(p_values->>'organizationNumber');
  if v_name='' or char_length(p_values->>'name')>240
    or (p_values->>'name') ~ '[\x00-\x1F\x7F]'
    or v_number !~ '^[0-9]{6}-?[0-9]{4}$' then raise exception 'ORG_INPUT_INVALID'; end if;
  v_number:=replace(v_number,'-','');
  v_number:=substring(v_number from 1 for 6)||'-'||substring(v_number from 7 for 4);
  if not public.is_valid_swedish_organization_number(v_number) then raise exception 'ORG_INPUT_INVALID'; end if;
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('name',v_name,'organizationNumber',v_number)::text,'UTF8')),'hex');

  -- The advisory lock also covers confirmed Auth accounts without a profile yet.
  -- As in invitation acceptance, bootstrap only a minimal non-admin profile;
  -- never overwrite an existing profile or use browser-supplied Auth metadata.
  perform pg_advisory_xact_lock(hashtextextended('organization_self_service:'||p_actor::text,0));
  insert into public.profiles(id,email,is_admin) values(p_actor,v_email,false) on conflict(id) do nothing;
  -- This lock serializes this actor's retries, rate limit and access review.
  -- Match central creation's profile-before-organization-write lock ordering.
  perform 1 from public.profiles where id=p_actor for update;
  if not found then raise exception 'ORG_PROFILE_NOT_FOUND'; end if;
  select * into previous from public.organization_self_service_requests
    where actor_profile_id=p_actor and request_id=p_request_id;
  if found then
    if previous.request_fingerprint<>v_fingerprint then raise exception 'ORG_CONFLICT'; end if;
    if not exists(select 1 from public.org_members where org_id=previous.organization_id
      and profile_id=p_actor and is_active and role='admin') then raise exception 'ORG_MEMBERSHIP_REQUIRED'; end if;
    return jsonb_build_object('saved',true,'organizationId',previous.organization_id);
  end if;
  if (select count(*) from public.organization_self_service_requests where actor_profile_id=p_actor
      and created_at>now()-interval '24 hours')>=3 then raise exception 'ORG_CREATE_LIMIT'; end if;
  -- A first normalized grant can disable legacy access in OTHER organizations.
  -- Do not silently migrate or grant new operational rights to resolve that.
  perform public.platform_organization_assert_managed_target(p_actor);

  -- A per-number advisory lock alone cannot coordinate existing central creation
  -- and organization-profile writers. This short table lock serializes the check
  -- with every INSERT/UPDATE/DELETE while leaving ordinary reads unblocked.
  -- Central administration may still deliberately create historical/test duplicates
  -- later; this endpoint never does so or attaches a caller to an existing org.
  lock table public.organizations in share row exclusive mode;
  if exists(select 1 from public.organizations
    where replace(organization_number,'-','')=replace(v_number,'-','')) then raise exception 'ORG_NUMBER_EXISTS'; end if;
  insert into public.organizations(name,organization_number,created_by)
    values(v_name,v_number,p_actor) returning id into v_org;
  insert into public.organization_enabled_modules(org_id,module_key,is_active)
    values(v_org,'inspections',false),(v_org,'technical_investigations',false);
  -- Never change the user's default organization, including during onboarding.
  insert into public.org_members(org_id,profile_id,role,is_active,is_default)
    values(v_org,p_actor,'admin',true,false);
  -- Admin for THIS org only. The existing writer also records disabled module
  -- markers so revocation cannot restore legacy fallback access.
  perform public.organization_apply_member_grants(p_actor,v_org,p_actor,'admin',true,array[]::text[]);
  insert into public.organization_self_service_requests(actor_profile_id,request_id,organization_id,request_fingerprint)
    values(p_actor,p_request_id,v_org,v_fingerprint);
  insert into public.platform_organization_audit(actor_profile_id,organization_id,target_profile_id,action)
    values(p_actor,v_org,p_actor,'organization_created');
  return jsonb_build_object('saved',true,'organizationId',v_org);
end; $$;

revoke all on function public.organization_self_service_create(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.organization_self_service_create(uuid,uuid,jsonb) to service_role;
do $$ begin
  if has_function_privilege('anon','public.organization_self_service_create(uuid,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.organization_self_service_create(uuid,uuid,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.organization_self_service_create(uuid,uuid,jsonb)','EXECUTE')
    or has_table_privilege('anon','public.organization_self_service_requests','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.organization_self_service_requests','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'ORG_SELF_SERVICE_ACL_INVALID';
  end if;
end $$;
commit;
