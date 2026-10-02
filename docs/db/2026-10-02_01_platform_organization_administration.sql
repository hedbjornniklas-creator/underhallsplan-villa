-- Central HusHub organization administration. Requires organization SQL 2026-10-01_01.
-- Installs service-only RPCs; does not rewrite existing organizations, memberships,
-- module entitlements, grants, invitations or profile data at installation time.
-- Caller must derive p_actor from the authenticated server session, never a body field.
-- The RPC also verifies global HusHub access-management authority independently.
-- TU is the only supported organization entitlement in this rollout.
-- Disabling TU revokes scoped TU grants and pending TU organization invitations.
-- Global grants and other organizations/modules are not changed; re-enabling TU
-- does not restore revoked user grants or invitations. Legacy central invitations
-- are deliberately unchanged and must not be used for organization-admin onboarding.
-- A first managed grant for a profile relying on legacy dashboard fallback is
-- refused until that person's existing access has been reviewed separately.
begin;
set local lock_timeout = '10s';

create table if not exists public.platform_organization_create_requests (
  request_id uuid primary key,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.platform_organization_create_requests enable row level security;
revoke all on public.platform_organization_create_requests from public,anon,authenticated,service_role;
grant select on public.platform_organization_create_requests to service_role;

-- Minimal append-only audit: identifiers/action only, no names, email addresses,
-- company snapshots, secrets or invitation tokens. Writes occur inside the RPCs.
create table if not exists public.platform_organization_audit (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete restrict,
  action text not null check(action in ('organization_created','member_added','member_updated','modules_updated')),
  created_at timestamptz not null default now()
);
create index if not exists platform_organization_audit_org_created_idx
  on public.platform_organization_audit(organization_id,created_at desc);
alter table public.platform_organization_audit enable row level security;
revoke all on public.platform_organization_audit from public,anon,authenticated,service_role;
grant select on public.platform_organization_audit to service_role;

create or replace function public.platform_organization_assert_admin(p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare legacy_admin boolean;
begin
  select is_admin into legacy_admin from public.profiles where id=p_actor;
  if not found then raise exception 'ORG_PLATFORM_ADMIN_REQUIRED' using errcode='42501'; end if;
  -- Match hasCurrentUserAccess: a valid normalized grant for hushub_admin takes
  -- precedence over the legacy flag, even if its module/scope is insufficient.
  -- Catalog activation flags are not consulted by that existing application helper.
  if exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='hushub_admin'
      where a.profile_id=p_actor and a.is_active and (a.expires_at is null or a.expires_at>now())) then
    if not exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='hushub_admin'
      join public.platform_modules m on m.id=a.module_id and m.key='access_management'
      where a.profile_id=p_actor and a.is_active and (a.expires_at is null or a.expires_at>now())
        and a.scope_type='global') then
      raise exception 'ORG_PLATFORM_ADMIN_REQUIRED' using errcode='42501';
    end if;
  elsif legacy_admin is not true then
    raise exception 'ORG_PLATFORM_ADMIN_REQUIRED' using errcode='42501';
  end if;
end; $$;

create or replace function public.platform_organization_assert_managed_target(p_profile uuid)
returns void language plpgsql security definer set search_path='' as $$
declare legacy_admin boolean;
begin
  select is_admin into legacy_admin from public.profiles where id=p_profile;
  if not found then raise exception 'ORG_PROFILE_NOT_FOUND'; end if;
  -- The first managed dashboard grant disables profile-wide legacy fallback in
  -- the application. Never silently remove access in other legacy memberships.
  -- Require a separate access review instead of copying/promoting old grants.
  if not exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard'
      where a.profile_id=p_profile and a.is_active and (a.expires_at is null or a.expires_at>now()))
    and not exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard'
      where a.profile_id=p_profile and a.scope_type='organization'
        and a.source_system in ('organization_administration','organization_admin_migration'))
    and (legacy_admin is true or exists(select 1 from public.org_members
      where profile_id=p_profile and is_active)) then
    raise exception 'ORG_LEGACY_ACCESS_REVIEW_REQUIRED';
  end if;
end; $$;

create or replace function public.platform_organization_validate_modules(p_modules text[])
returns text[] language plpgsql immutable set search_path='' as $$
begin
  if p_modules is null or coalesce(array_ndims(p_modules),1)<>1 then raise exception 'ORG_INPUT_INVALID'; end if;
  if cardinality(p_modules)>1 or array_position(p_modules,null) is not null
    or not p_modules<@array['technical_investigations']::text[] then raise exception 'ORG_MODULE_NOT_ENABLED'; end if;
  return p_modules;
end; $$;

create or replace function public.platform_organization_json_modules(p_modules jsonb)
returns text[] language plpgsql immutable set search_path='' as $$
declare result text[];
begin
  if p_modules is null or jsonb_typeof(p_modules)<>'array' then raise exception 'ORG_INPUT_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(p_modules) item where jsonb_typeof(item)<>'string') then
    raise exception 'ORG_INPUT_INVALID';
  end if;
  select coalesce(array_agg(value),array[]::text[]) into result from jsonb_array_elements_text(p_modules);
  return public.platform_organization_validate_modules(result);
end; $$;

create or replace function public.platform_organization_create(p_actor uuid,p_request_id uuid,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text; v_number text; v_admin uuid; v_modules text[]; v_org uuid; v_fingerprint text;
  previous public.platform_organization_create_requests%rowtype;
begin
  perform public.platform_organization_assert_admin(p_actor);
  if p_request_id is null then raise exception 'ORG_INPUT_INVALID'; end if;
  perform public.organization_validate_values(p_values,array['name','organizationNumber','adminProfileId','modules']);
  v_name:=public.organization_text_value(p_values,'name',240,true);
  v_number:=public.organization_text_value(p_values,'organizationNumber',11);
  if v_number is not null and not public.is_valid_swedish_organization_number(v_number) then raise exception 'ORG_INPUT_INVALID'; end if;
  begin
    v_admin:=public.organization_text_value(p_values,'adminProfileId',36,true)::uuid;
  exception when invalid_text_representation then raise exception 'ORG_INPUT_INVALID'; end;
  v_modules:=public.platform_organization_json_modules(p_values->'modules');
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('name',v_name,'organizationNumber',v_number,
    'adminProfileId',v_admin,'modules',v_modules)::text,'UTF8')),'hex');
  -- Serializes retries for the same idempotency key, including concurrent calls.
  perform pg_advisory_xact_lock(hashtextextended('platform_org_create:'||p_request_id::text,0));
  select * into previous from public.platform_organization_create_requests where request_id=p_request_id;
  if found then
    if previous.actor_profile_id<>p_actor or previous.request_fingerprint<>v_fingerprint then raise exception 'ORG_CONFLICT'; end if;
    return jsonb_build_object('saved',true,'organizationId',previous.organization_id);
  end if;
  perform 1 from public.profiles where id=v_admin for update;
  if not found then raise exception 'ORG_PROFILE_NOT_FOUND'; end if;
  perform public.platform_organization_assert_managed_target(v_admin);
  -- No name/organization-number matching or merging: the chosen profile receives
  -- membership in this new UUID only; existing identity/defaults remain intact.
  insert into public.organizations(name,organization_number,created_by)
    values(v_name,v_number,p_actor) returning id into v_org;
  -- An explicit disabled row distinguishes new disabled organizations from
  -- untouched legacy organizations when the application checks TU entitlement.
  insert into public.organization_enabled_modules(org_id,module_key,is_active)
    values(v_org,'technical_investigations','technical_investigations'=any(v_modules));
  perform public.organization_validate_modules(v_org,to_jsonb(v_modules));
  insert into public.org_members(org_id,profile_id,role,is_active,is_default)
    values(v_org,v_admin,'admin',true,not exists(select 1 from public.org_members where profile_id=v_admin and is_default));
  -- Organization entitlement is not a personal module assignment. The first
  -- administrator gets admin only; their TU access is an explicit later choice.
  perform public.organization_apply_member_grants(p_actor,v_org,v_admin,'admin',true,array[]::text[]);
  insert into public.platform_organization_create_requests(request_id,actor_profile_id,organization_id,request_fingerprint)
    values(p_request_id,p_actor,v_org,v_fingerprint);
  insert into public.platform_organization_audit(actor_profile_id,organization_id,target_profile_id,action)
    values(p_actor,v_org,v_admin,'organization_created');
  return jsonb_build_object('saved',true,'organizationId',v_org);
end; $$;

create or replace function public.platform_organization_member_save(
  p_actor uuid,p_org uuid,p_profile uuid,p_expected jsonb,p_values jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.org_members%rowtype; v_exists boolean; v_role text; v_active boolean;
  v_modules text[]; v_current_modules text[]; v_expected_modules text[]; v_expected_role text;
begin
  perform public.platform_organization_assert_admin(p_actor);
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  perform 1 from public.profiles where id=p_profile for update;
  if not found then raise exception 'ORG_PROFILE_NOT_FOUND'; end if;
  perform public.organization_validate_values(p_values,array['role','isActive','modules']);
  v_role:=public.organization_text_value(p_values,'role',20,true);
  if v_role not in ('admin','inspector') or jsonb_typeof(p_values->'isActive') is distinct from 'boolean' then
    raise exception 'ORG_INPUT_INVALID';
  end if;
  v_active:=(p_values->>'isActive')::boolean;
  v_modules:=public.organization_validate_modules(p_org,p_values->'modules');
  if not v_active and cardinality(v_modules)>0 then raise exception 'ORG_INPUT_INVALID'; end if;
  select * into member from public.org_members where org_id=p_org and profile_id=p_profile for update;
  v_exists:=found;
  if p_expected is null then
    if v_exists then raise exception 'ORG_CONFLICT'; end if;
  else
    if not v_exists then raise exception 'ORG_CONFLICT'; end if;
    perform public.organization_validate_values(p_expected,array['role','isActive','modules']);
    v_expected_role:=public.organization_text_value(p_expected,'role',20,true);
    if v_expected_role not in ('admin','inspector') or jsonb_typeof(p_expected->'isActive') is distinct from 'boolean' then
      raise exception 'ORG_INPUT_INVALID';
    end if;
    v_expected_modules:=public.platform_organization_json_modules(p_expected->'modules');
    select coalesce(array_agg(distinct mod.key order by mod.key),array[]::text[]) into v_current_modules
    from public.platform_access_assignments a
    join public.platform_products product on product.id=a.product_id and product.key='dashboard'
    join public.platform_modules mod on mod.id=a.module_id and mod.key='technical_investigations'
    join public.platform_roles role on role.id=a.role_id and role.product_id=product.id and role.key='inspector'
    where a.profile_id=p_profile and a.scope_type='organization' and a.scope_id=p_org::text
      and member.is_active and a.is_active and (a.expires_at is null or a.expires_at>now());
    if member.role<>v_expected_role or member.is_active is distinct from (p_expected->>'isActive')::boolean
      or v_current_modules is distinct from v_expected_modules then raise exception 'ORG_CONFLICT'; end if;
  end if;
  if v_exists and member.is_active and member.role='admin' and (not v_active or v_role<>'admin')
    and not exists(select 1 from public.org_members where org_id=p_org and is_active and role='admin' and profile_id<>p_profile) then
    raise exception 'ORG_LAST_ADMIN';
  end if;
  perform public.platform_organization_assert_managed_target(p_profile);
  if v_exists then
    update public.org_members set role=v_role,is_active=v_active where org_id=p_org and profile_id=p_profile;
  else
    insert into public.org_members(org_id,profile_id,role,is_active,is_default)
      values(p_org,p_profile,v_role,v_active,v_active and not exists(select 1 from public.org_members where profile_id=p_profile and is_default));
  end if;
  -- Existing writer preserves other-org/global grants. Active role/module edits
  -- preserve non-TU modules; deactivation revokes all access in this org only.
  perform public.organization_apply_member_grants(p_actor,p_org,p_profile,v_role,v_active,v_modules);
  insert into public.platform_organization_audit(actor_profile_id,organization_id,target_profile_id,action)
    values(p_actor,p_org,p_profile,case when v_exists then 'member_updated' else 'member_added' end);
  return jsonb_build_object('saved',true);
end; $$;

create or replace function public.platform_organization_modules_save(p_actor uuid,p_org uuid,p_expected text[],p_modules text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_expected text[]; v_modules text[]; v_current text[]; v_product uuid; v_module uuid; v_has_marker boolean;
begin
  perform public.platform_organization_assert_admin(p_actor);
  v_expected:=public.platform_organization_validate_modules(p_expected);
  v_modules:=public.platform_organization_validate_modules(p_modules);
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  select coalesce(array_agg(module_key order by module_key),array[]::text[]) into v_current
    from public.organization_enabled_modules where org_id=p_org and is_active and module_key='technical_investigations';
  select exists(select 1 from public.organization_enabled_modules where org_id=p_org and module_key='technical_investigations') into v_has_marker;
  if v_expected is distinct from v_current then raise exception 'ORG_CONFLICT'; end if;
  if v_modules=v_current and v_has_marker then return jsonb_build_object('saved',true); end if;
  if 'technical_investigations'=any(v_modules) then
    if not exists(select 1 from public.platform_modules m join public.platform_products p on p.id=m.product_id
      where p.key='dashboard' and p.is_active and m.key='technical_investigations' and m.is_active) then
      raise exception 'ORG_CATALOG_REQUIRED';
    end if;
    insert into public.organization_enabled_modules(org_id,module_key,is_active) values(p_org,'technical_investigations',true)
      on conflict(org_id,module_key) do update set is_active=true;
  else
    insert into public.organization_enabled_modules(org_id,module_key,is_active) values(p_org,'technical_investigations',false)
      on conflict(org_id,module_key) do update set is_active=false;
    select p.id,m.id into v_product,v_module from public.platform_products p
      join public.platform_modules m on m.product_id=p.id and m.key='technical_investigations' where p.key='dashboard';
    update public.platform_access_assignments set is_active=false,granted_by_profile_id=p_actor,
      granted_reason='Organization TU disabled',source_system='organization_administration',source_record_id=p_org::text
      where product_id=v_product and module_id=v_module and scope_type='organization' and scope_id=p_org::text and is_active;
    update public.organization_invitations set status='revoked',revision=revision+1
      where org_id=p_org and status='pending' and 'technical_investigations'=any(modules);
  end if;
  insert into public.platform_organization_audit(actor_profile_id,organization_id,action) values(p_actor,p_org,'modules_updated');
  return jsonb_build_object('saved',true);
end; $$;

revoke all on function public.platform_organization_assert_admin(uuid),public.platform_organization_assert_managed_target(uuid),
  public.platform_organization_validate_modules(text[]),public.platform_organization_json_modules(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.platform_organization_create(uuid,uuid,jsonb),
  public.platform_organization_member_save(uuid,uuid,uuid,jsonb,jsonb),
  public.platform_organization_modules_save(uuid,uuid,text[],text[]) from public,anon,authenticated;
grant execute on function public.platform_organization_create(uuid,uuid,jsonb),
  public.platform_organization_member_save(uuid,uuid,uuid,jsonb,jsonb),
  public.platform_organization_modules_save(uuid,uuid,text[],text[]) to service_role;
commit;
