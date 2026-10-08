-- ÖB + TU organization invitations and central administration (no EB).
-- Requires 2026-10-01_01, 2026-10-02_01_platform_organization_administration
-- and 2026-10-02_05_ob_organization_runtime.sql. Run the accompanying preflight first.
-- Installation changes no entitlements, memberships, invitations or user grants.
-- Existing absent ÖB entitlement stays legacy until an explicit reviewed activation.
-- Server derives p_actor from its session. Every entry point stays service-only.
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('public.ob_actor_has_organization_access(uuid,uuid)') is null
    or to_regprocedure('public.platform_organization_assert_managed_target(uuid)') is null then
    raise exception 'ORG_OB_INVITATIONS_PREREQUISITES_REQUIRED';
  end if;
end $$;

alter table public.organization_enabled_modules drop constraint if exists organization_enabled_modules_module_key_check;
alter table public.organization_enabled_modules add constraint organization_enabled_modules_module_key_check
  check(module_key in ('inspections','technical_investigations'));
alter table public.organization_invitations drop constraint if exists organization_invitations_modules_check;
alter table public.organization_invitations add constraint organization_invitations_modules_check check(
  coalesce(array_ndims(modules),1)=1 and coalesce(array_lower(modules,1),1)=1
  and cardinality(modules)<=2 and array_position(modules,null) is null
  and modules<@array['inspections','technical_investigations']::text[]
  and (cardinality(modules)<2 or modules[1]<>modules[2])
);

create or replace function public.platform_organization_validate_modules(p_modules text[])
returns text[] language plpgsql immutable set search_path='' as $$
declare result text[];
begin
  if p_modules is null or coalesce(array_ndims(p_modules),1)<>1 then raise exception 'ORG_INPUT_INVALID'; end if;
  if cardinality(p_modules)>2 or array_position(p_modules,null) is not null
    or not p_modules<@array['inspections','technical_investigations']::text[]
    or cardinality(p_modules)<>(select count(distinct k) from unnest(p_modules) k)
    then raise exception 'ORG_MODULE_NOT_ENABLED'; end if;
  select coalesce(array_agg(k order by k),array[]::text[]) into result from unnest(p_modules) k;
  return result;
end; $$;

create or replace function public.organization_validate_modules(p_org uuid,p_modules jsonb)
returns text[] language plpgsql security definer set search_path='' as $$
declare result text[];
begin
  result:=public.platform_organization_json_modules(p_modules);
  if exists(select 1 from unnest(result) k where not exists(select 1 from public.organization_enabled_modules e
    join public.platform_products p on p.key='dashboard' and p.is_active
    join public.platform_modules m on m.product_id=p.id and m.key=e.module_key and m.is_active
    where e.org_id=p_org and e.module_key=k and e.is_active)) then raise exception 'ORG_MODULE_NOT_ENABLED'; end if;
  return result;
end; $$;

-- Called under the organization row lock before first managed ÖB activation.
-- SQL05 changes access from legacy/global to exact scoped inspector grants once a
-- row exists. Refuse implicit loss of current access; never copy/promote grants.
create or replace function public.organization_assert_ob_activation_reviewed(p_org uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.organization_enabled_modules where org_id=p_org and module_key='inspections') then return; end if;
  if exists(
    select 1 from public.org_members member
    where member.org_id=p_org and member.is_active
      and (public.ob_actor_has_organization_access(p_org,member.profile_id) or exists(
        -- Product-wide assignments have historically been interpreted differently
        -- by generic access helpers. Review them instead of inferring ÖB rights.
        select 1 from public.platform_access_assignments broad
        join public.platform_products product on product.id=broad.product_id and product.key='dashboard'
        where broad.profile_id=member.profile_id and broad.module_id is null and broad.is_active
          and (broad.expires_at is null or broad.expires_at>now())
          and (broad.scope_type='global' or (broad.scope_type='organization' and broad.scope_id=p_org::text))
      ))
      and not exists(
        select 1 from public.platform_access_assignments a
        join public.platform_products p on p.id=a.product_id and p.key='dashboard' and p.is_active
        join public.platform_modules m on m.id=a.module_id and m.product_id=p.id and m.key='inspections' and m.is_active
        join public.platform_roles r on r.id=a.role_id and r.product_id=p.id and r.key='inspector' and r.is_active
        where a.profile_id=member.profile_id and a.scope_type='organization' and a.scope_id=p_org::text
          and a.is_active and (a.expires_at is null or a.expires_at>now())
      )
  ) then raise exception 'ORG_LEGACY_ACCESS_REVIEW_REQUIRED'; end if;
end; $$;

-- Every modification remains scoped to this organization only. An unmanaged ÖB
-- grant is not part of TU administration and is left alone until ÖB activation.
create or replace function public.organization_apply_member_grants(p_actor uuid,p_org uuid,p_profile uuid,p_role text,p_active boolean,p_modules text[])
returns void language plpgsql security definer set search_path='' as $$
declare product uuid; inspector uuid; administrator uuid; mod record; chosen_role uuid; ob_managed boolean;
begin
  select id into product from public.platform_products where key='dashboard' and is_active;
  select id into inspector from public.platform_roles where product_id=product and key='inspector' and is_active;
  select id into administrator from public.platform_roles where product_id=product and key='dashboard_admin' and is_active;
  if product is null or inspector is null or administrator is null
    or not exists(select 1 from public.platform_modules where product_id=product and key='technical_investigations')
    or not exists(select 1 from public.platform_modules where product_id=product and key='inspections')
    or not exists(select 1 from public.platform_modules where product_id=product and key='admin' and is_active)
    then raise exception 'ORG_CATALOG_REQUIRED'; end if;
  p_modules:=public.organization_validate_modules(p_org,to_jsonb(p_modules));
  select exists(select 1 from public.organization_enabled_modules where org_id=p_org and module_key='inspections') into ob_managed;
  update public.platform_access_assignments a set is_active=false
  where a.profile_id=p_profile and a.product_id=product and a.scope_type='organization' and a.scope_id=p_org::text
    and (not p_active or a.module_id in (select id from public.platform_modules where product_id=product
      and (key in ('technical_investigations','admin') or (ob_managed and key='inspections'))));
  -- An inactive marker distinguishes an intentional empty selection from legacy
  -- fallback. Do not create an ÖB marker for an unrelated TU-only edit.
  for mod in select id,key from public.platform_modules where product_id=product
    and (key='technical_investigations' or (ob_managed and key='inspections'))
  loop
    update public.platform_access_assignments set is_active=false,granted_by_profile_id=p_actor,
      granted_reason='Organization membership administration',source_system='organization_administration',source_record_id=p_org::text
    where profile_id=p_profile and product_id=product and module_id=mod.id and role_id=inspector
      and scope_type='organization' and scope_id=p_org::text;
    if not found then
      insert into public.platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id,is_active,
        granted_by_profile_id,granted_reason,source_system,source_record_id)
      values(p_profile,product,mod.id,inspector,'organization',p_org::text,false,p_actor,
        'Organization membership administration','organization_administration',p_org::text);
    end if;
  end loop;
  if not p_active then return; end if;
  for mod in select id,key from public.platform_modules where product_id=product and is_active
    and (key=any(p_modules) or (key='admin' and p_role='admin'))
  loop
    chosen_role:=case when mod.key='admin' then administrator else inspector end;
    update public.platform_access_assignments set is_active=true,expires_at=null,granted_by_profile_id=p_actor,
      granted_reason='Organization membership administration',source_system='organization_administration',source_record_id=p_org::text
    where profile_id=p_profile and product_id=product and module_id=mod.id and role_id=chosen_role
      and scope_type='organization' and scope_id=p_org::text;
    if not found then
      insert into public.platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id,is_active,
        granted_by_profile_id,granted_reason,source_system,source_record_id)
      values(p_profile,product,mod.id,chosen_role,'organization',p_org::text,true,p_actor,
        'Organization membership administration','organization_administration',p_org::text);
    end if;
  end loop;
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
  -- New organizations start managed for both modules, including explicit off rows.
  insert into public.organization_enabled_modules(org_id,module_key,is_active)
    select v_org,k,k=any(v_modules) from unnest(array['inspections','technical_investigations']::text[]) k;
  perform public.organization_validate_modules(v_org,to_jsonb(v_modules));
  insert into public.org_members(org_id,profile_id,role,is_active,is_default)
    values(v_org,v_admin,'admin',true,not exists(select 1 from public.org_members where profile_id=v_admin and is_default));
  -- Organization entitlement is not a personal module assignment. The first
  -- administrator gets admin only; personal module access is an explicit later choice.
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
    join public.platform_modules mod on mod.id=a.module_id and mod.key in ('inspections','technical_investigations')
      and (mod.key<>'inspections' or exists(select 1 from public.organization_enabled_modules e
        where e.org_id=p_org and e.module_key='inspections'))
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
  -- preserve unmanaged modules; deactivation revokes all access in this org only.
  perform public.organization_apply_member_grants(p_actor,p_org,p_profile,v_role,v_active,v_modules);
  insert into public.platform_organization_audit(actor_profile_id,organization_id,target_profile_id,action)
    values(p_actor,p_org,p_profile,case when v_exists then 'member_updated' else 'member_added' end);
  return jsonb_build_object('saved',true);
end; $$;

create or replace function public.organization_invitation_accept(p_actor uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.organization_invitations%rowtype; v_org uuid; v_email text; v_modules text[];
begin
  select org_id into v_org from public.organization_invitations where token_hash=p_token_hash;
  if not found then raise exception 'ORG_INVITE_INVALID'; end if;
  perform 1 from public.organizations where id=v_org for update;
  select * into invitation from public.organization_invitations where token_hash=p_token_hash and org_id=v_org for update;
  if not found then raise exception 'ORG_INVITE_INVALID'; end if;
  select lower(email) into v_email from auth.users where id=p_actor and email_confirmed_at is not null for update;
  if not found or v_email is distinct from invitation.email then raise exception 'ORG_INVITE_EMAIL_MISMATCH'; end if;
  if invitation.status='accepted' and invitation.accepted_by_profile_id=p_actor then
    if not exists(select 1 from public.org_members where org_id=v_org and profile_id=p_actor and is_active)
      then raise exception 'ORG_INVITE_INVALID'; end if;
    return jsonb_build_object('accepted',true,'reused',true,'organizationId',v_org,'profileId',p_actor);
  end if;
  if invitation.status<>'pending' or invitation.expires_at<=now() then raise exception 'ORG_INVITE_INVALID'; end if;
  -- An invitation cannot outlive the authority of its inviter.
  if not exists(select 1 from public.org_members where org_id=v_org and profile_id=invitation.created_by_profile_id and role='admin' and is_active)
    then raise exception 'ORG_INVITE_INVALID'; end if;
  v_modules:=public.organization_validate_modules(v_org,to_jsonb(invitation.modules));
  if exists(select 1 from public.org_members where org_id=v_org and profile_id=p_actor) then raise exception 'ORG_MEMBER_EXISTS'; end if;
  insert into public.profiles(id,email,full_name,is_admin) values(p_actor,invitation.email,invitation.full_name,false) on conflict(id) do nothing;
  perform public.platform_organization_assert_managed_target(p_actor);
  insert into public.org_members(org_id,profile_id,role,is_active,is_default)
    values(v_org,p_actor,invitation.role,true,not exists(select 1 from public.org_members where profile_id=p_actor and is_default));
  perform public.organization_apply_member_grants(invitation.created_by_profile_id,v_org,p_actor,invitation.role,true,v_modules);
  update public.organization_invitations set status='accepted',accepted_by_profile_id=p_actor,accepted_at=now(),revision=revision+1 where id=invitation.id;
  return jsonb_build_object('accepted',true,'reused',false,'organizationId',v_org,'profileId',p_actor);
end; $$;

create or replace function public.organization_member_update(p_actor uuid,p_org uuid,p_profile uuid,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.org_members%rowtype; v_role text; v_active boolean; v_modules text[];
begin
  perform public.organization_assert_admin(p_actor,p_org);
  perform public.organization_validate_values(p_values,array['role','isActive','modules']);
  v_role:=public.organization_text_value(p_values,'role',20,true);
  if v_role not in ('admin','inspector') or jsonb_typeof(p_values->'isActive') is distinct from 'boolean' then raise exception 'ORG_INPUT_INVALID'; end if;
  v_active:=(p_values->>'isActive')::boolean;
  v_modules:=public.organization_validate_modules(p_org,p_values->'modules');
  select * into member from public.org_members where org_id=p_org and profile_id=p_profile for update;
  if not found then raise exception 'ORG_MEMBER_REQUIRED'; end if;
  if member.is_active and member.role='admin' and (not v_active or v_role<>'admin') and not exists(
    select 1 from public.org_members where org_id=p_org and is_active and role='admin' and profile_id<>p_profile) then
    raise exception 'ORG_LAST_ADMIN';
  end if;
  if not v_active and cardinality(v_modules)>0 then raise exception 'ORG_INPUT_INVALID'; end if;
  perform public.platform_organization_assert_managed_target(p_profile);
  update public.org_members set role=v_role,is_active=v_active where org_id=p_org and profile_id=p_profile;
  perform public.organization_apply_member_grants(p_actor,p_org,p_profile,v_role,v_active,v_modules);
  return jsonb_build_object('saved',true);
end; $$;

create or replace function public.platform_organization_modules_save(p_actor uuid,p_org uuid,p_expected text[],p_modules text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_expected text[]; v_modules text[]; v_current text[]; v_product uuid; v_module uuid;
  v_key text; v_has_marker boolean; v_was_active boolean; v_changed boolean:=false;
begin
  perform public.platform_organization_assert_admin(p_actor);
  v_expected:=public.platform_organization_validate_modules(p_expected);
  v_modules:=public.platform_organization_validate_modules(p_modules);
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  select coalesce(array_agg(module_key order by module_key),array[]::text[]) into v_current
    from public.organization_enabled_modules where org_id=p_org and is_active and module_key in ('inspections','technical_investigations');
  if v_expected is distinct from v_current then raise exception 'ORG_CONFLICT'; end if;
  for v_key in select unnest(array['inspections','technical_investigations']::text[])
  loop
    select true,is_active into v_has_marker,v_was_active from public.organization_enabled_modules where org_id=p_org and module_key=v_key;
    -- Existing TU-only forms/organizations must not materialize an ÖB-off row.
    -- New organization creation, in contrast, creates both markers explicitly.
    if v_key='inspections' and v_has_marker is not true and not v_key=any(v_modules) then continue; end if;
    if v_has_marker is true and v_was_active=(v_key=any(v_modules)) then continue; end if;
    if v_key=any(v_modules) then
      if not exists(select 1 from public.platform_modules m join public.platform_products p on p.id=m.product_id
        where p.key='dashboard' and p.is_active and m.key=v_key and m.is_active) then raise exception 'ORG_CATALOG_REQUIRED'; end if;
      if v_key='inspections' then perform public.organization_assert_ob_activation_reviewed(p_org); end if;
      insert into public.organization_enabled_modules(org_id,module_key,is_active) values(p_org,v_key,true)
        on conflict(org_id,module_key) do update set is_active=true;
    else
      insert into public.organization_enabled_modules(org_id,module_key,is_active) values(p_org,v_key,false)
        on conflict(org_id,module_key) do update set is_active=false;
      select p.id,m.id into v_product,v_module from public.platform_products p
        join public.platform_modules m on m.product_id=p.id and m.key=v_key where p.key='dashboard';
      update public.platform_access_assignments set is_active=false,granted_by_profile_id=p_actor,
        granted_reason='Organization module disabled: '||v_key,source_system='organization_administration',source_record_id=p_org::text
        where product_id=v_product and module_id=v_module and scope_type='organization' and scope_id=p_org::text and is_active;
      update public.organization_invitations set status='revoked',revision=revision+1
        where org_id=p_org and status='pending' and v_key=any(modules);
    end if;
    v_changed:=true;
  end loop;
  if v_changed then
    insert into public.platform_organization_audit(actor_profile_id,organization_id,action) values(p_actor,p_org,'modules_updated');
  end if;
  return jsonb_build_object('saved',true);
end; $$;

-- Exact service-only entry points. Internal writers/validators remain private.
revoke all on function public.platform_organization_validate_modules(text[]),
  public.organization_validate_modules(uuid,jsonb),public.organization_assert_ob_activation_reviewed(uuid),
  public.organization_apply_member_grants(uuid,uuid,uuid,text,boolean,text[]) from public,anon,authenticated,service_role;
revoke all on function public.platform_organization_create(uuid,uuid,jsonb),
  public.platform_organization_member_save(uuid,uuid,uuid,jsonb,jsonb),
  public.platform_organization_modules_save(uuid,uuid,text[],text[]),
  public.organization_invitation_create(uuid,uuid,jsonb),public.organization_invitation_change(uuid,uuid,uuid,bigint,text,text,timestamptz),
  public.organization_invitation_accept(uuid,text),public.organization_member_update(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.platform_organization_create(uuid,uuid,jsonb),
  public.platform_organization_member_save(uuid,uuid,uuid,jsonb,jsonb),
  public.platform_organization_modules_save(uuid,uuid,text[],text[]),
  public.organization_invitation_create(uuid,uuid,jsonb),public.organization_invitation_change(uuid,uuid,uuid,bigint,text,text,timestamptz),
  public.organization_invitation_accept(uuid,text),public.organization_member_update(uuid,uuid,uuid,jsonb)
  to service_role;

-- An inherited privilege cannot be removed by a direct REVOKE. Fail the complete
-- transaction if role configuration exposes a boundary through inherited access.
do $$
declare routine text;
begin
  foreach routine in array array[
    'public.platform_organization_create(uuid,uuid,jsonb)',
    'public.platform_organization_member_save(uuid,uuid,uuid,jsonb,jsonb)',
    'public.platform_organization_modules_save(uuid,uuid,text[],text[])',
    'public.organization_invitation_create(uuid,uuid,jsonb)',
    'public.organization_invitation_change(uuid,uuid,uuid,bigint,text,text,timestamptz)',
    'public.organization_invitation_accept(uuid,text)',
    'public.organization_member_update(uuid,uuid,uuid,jsonb)'
  ] loop
    if has_function_privilege('anon',routine,'EXECUTE') or has_function_privilege('authenticated',routine,'EXECUTE')
      or not has_function_privilege('service_role',routine,'EXECUTE') then raise exception 'ORG_INVITATION_ACL_INVALID'; end if;
  end loop;
  foreach routine in array array[
    'public.platform_organization_validate_modules(text[])',
    'public.organization_validate_modules(uuid,jsonb)',
    'public.organization_assert_ob_activation_reviewed(uuid)',
    'public.organization_apply_member_grants(uuid,uuid,uuid,text,boolean,text[])'
  ] loop
    if has_function_privilege('anon',routine,'EXECUTE') or has_function_privilege('authenticated',routine,'EXECUTE')
      or has_function_privilege('service_role',routine,'EXECUTE') then raise exception 'ORG_INVITATION_ACL_INVALID'; end if;
  end loop;
end $$;
commit;
