-- Requires organizations/org_members and platform_access foundation.
-- Deploy separately; does not enable invitations or modify existing memberships.
begin;
create table public.besiktapp_invitations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  email text not null check (char_length(email) between 3 and 254),
  full_name text not null check (char_length(full_name) between 1 and 160),
  organization_id uuid references public.organizations(id),
  organization_name text not null check (char_length(organization_name) between 1 and 160),
  modules text[] not null check (cardinality(modules) between 1 and 3 and modules <@ array['inspections','construction_inspections','technical_investigations']::text[]),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  notification_state text not null default 'pending' check (notification_state in ('pending','accepted','failed')),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now()
);
alter table public.besiktapp_invitations enable row level security;
revoke all on public.besiktapp_invitations from public, anon, authenticated;
grant select, insert, update on public.besiktapp_invitations to service_role;

create function public.besiktapp_accept_invitation(p_actor uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  invitation public.besiktapp_invitations%rowtype;
  actor_email text;
  v_org_id uuid;
  v_product_id uuid;
  v_role_id uuid;
  v_module_id uuid;
  module_key text;
begin
  select * into invitation from public.besiktapp_invitations where token_hash = p_token_hash for update;
  if not found then raise exception 'INVITE_INVALID'; end if;
  select lower(email) into actor_email from auth.users where id = p_actor and email_confirmed_at is not null for update;
  if not found or actor_email <> lower(invitation.email) then raise exception 'INVITE_EMAIL_MISMATCH'; end if;
  if invitation.status = 'accepted' and invitation.accepted_by = p_actor then
    return jsonb_build_object('accepted', true, 'reused', true, 'organizationId', invitation.organization_id);
  end if;
  if invitation.status <> 'pending' or invitation.expires_at <= now() then raise exception 'INVITE_INVALID'; end if;
  select id into v_product_id from public.platform_products where key = 'dashboard' and is_active;
  select id into v_role_id from public.platform_roles where product_id = v_product_id and key = 'inspector' and is_active;
  if v_product_id is null or v_role_id is null or
    (select count(*) from public.platform_modules where product_id = v_product_id and key = any(invitation.modules) and is_active) <> cardinality(invitation.modules)
    then raise exception 'INVITE_CATALOG_REQUIRED'; end if;
  -- First version never merges or silently changes pre-existing BesiktApp access.
  if exists(select 1 from public.platform_access_assignments where profile_id = p_actor and product_id = v_product_id)
    or exists(select 1 from public.profiles where id = p_actor and is_admin = true)
    then raise exception 'INVITE_ACCESS_CONFLICT'; end if;
  if exists(select 1 from public.org_members where profile_id = p_actor and
      (invitation.organization_id is null or org_id <> invitation.organization_id or not is_active or role <> 'inspector'))
    then raise exception 'INVITE_ORG_CONFLICT'; end if;
  -- Do not overwrite existing names/company details (including existing RenoApp users).
  insert into public.profiles(id, email, full_name, is_admin)
    values(p_actor, invitation.email, invitation.full_name, false) on conflict(id) do nothing;
  v_org_id := invitation.organization_id;
  if v_org_id is null then
    insert into public.organizations(name, created_by) values(invitation.organization_name, p_actor) returning id into v_org_id;
  end if;
  insert into public.org_members(org_id, profile_id, role, is_active, is_default)
    values(v_org_id, p_actor, 'inspector', true, true)
    on conflict on constraint org_members_unique_org_profile do update set is_default = true;
  foreach module_key in array invitation.modules loop
    select id into v_module_id from public.platform_modules where product_id = v_product_id and key = module_key and is_active;
    insert into public.platform_access_assignments(profile_id, product_id, module_id, role_id, scope_type, scope_id,
      is_active, granted_by_profile_id, granted_reason, source_system, source_record_id)
      values(p_actor, v_product_id, v_module_id, v_role_id, 'global', null, true, invitation.created_by,
        'BesiktApp-inbjudan accepterad', 'besiktapp_invite', invitation.id::text);
  end loop;
  update public.besiktapp_invitations set status = 'accepted', accepted_by = p_actor, accepted_at = now(),
    organization_id = v_org_id, revision = revision + 1 where id = invitation.id;
  return jsonb_build_object('accepted', true, 'reused', false, 'organizationId', v_org_id);
end;
$$;
revoke all on function public.besiktapp_accept_invitation(uuid,text) from public, anon, authenticated;
grant execute on function public.besiktapp_accept_invitation(uuid,text) to service_role;
commit;
