-- Run the preflight queries in 2026-09-05_00_renoapp_brf_preflight.sql first.
-- Requires the RenoApp onboarding, terms and platform access migrations.
begin;

alter table public.brf_associations
  add column if not exists onboarding_key uuid,
  add column if not exists onboarding_source text,
  add column if not exists internal_note text;
create unique index if not exists brf_onboarding_key_idx on public.brf_associations(onboarding_key);
alter table public.brf_requests add column if not exists external_message text;
alter table public.brf_member_invites
  add column if not exists accepted_by uuid references public.profiles(id),
  add column if not exists delivery_status text not null default 'unknown',
  add column if not exists delivery_error text,
  add column if not exists sent_at timestamptz;

create table if not exists public.renoapp_brf_events (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid references public.brf_associations(id),
  request_id uuid references public.brf_requests(id),
  actor_profile_id uuid references public.profiles(id),
  kind text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists renoapp_brf_events_brf_idx on public.renoapp_brf_events(brf_id, created_at desc);
alter table public.renoapp_brf_events enable row level security;
revoke all on public.renoapp_brf_events from anon, authenticated;
grant all on public.renoapp_brf_events to service_role;
-- These tables are only accessed through the server APIs.
alter table public.brf_associations enable row level security;
alter table public.brf_members enable row level security;
alter table public.brf_member_invites enable row level security;
alter table public.brf_requests enable row level security;
revoke all on public.brf_associations, public.brf_members, public.brf_member_invites, public.brf_requests from anon, authenticated;
grant all on public.brf_associations, public.brf_members, public.brf_member_invites, public.brf_requests to service_role;

create or replace function public.renoapp_guard_brf_org_number() returns trigger
language plpgsql set search_path = public as $$
declare digits text := regexp_replace(coalesce(new.org_number, ''), '[^0-9]', '', 'g');
begin
  if digits = '' then return new; end if;
  if tg_op = 'UPDATE' and digits = regexp_replace(coalesce(old.org_number, ''), '[^0-9]', '', 'g') then
    return new;
  end if;
  if length(digits) <> 10 then raise exception 'ORG_NUMBER_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('renoapp-org:' || digits, 0));
  if exists (select 1 from public.brf_associations where id <> new.id
      and regexp_replace(coalesce(org_number, ''), '[^0-9]', '', 'g') = digits) then
    raise exception 'BRF_ORG_NUMBER_EXISTS';
  end if;
  new.org_number := substr(digits, 1, 6) || '-' || substr(digits, 7);
  return new;
end $$;
drop trigger if exists renoapp_guard_brf_org on public.brf_associations;
create trigger renoapp_guard_brf_org before insert or update of org_number on public.brf_associations
for each row execute function public.renoapp_guard_brf_org_number();

create or replace function public.renoapp_sync_member_access() returns trigger
language plpgsql security definer set search_path = public as $$
declare product_id_value uuid; module_id_value uuid; role_id_value uuid;
begin
  if tg_op = 'UPDATE' and new.is_active = old.is_active and new.role = old.role
    and current_setting('renoapp.restore_access', true) is distinct from 'true' then return new; end if;
  select id into strict product_id_value from public.platform_products where key = 'renoapp';
  select id into strict module_id_value from public.platform_modules where product_id = product_id_value and key = 'board_portal';
  select id into strict role_id_value from public.platform_roles where product_id = product_id_value
    and key = case when new.role = 'admin' then 'renoapp_admin' else 'board_member' end;
  -- Removal must revoke every board grant for this BRF, including manually granted ones.
  update public.platform_access_assignments set is_active = false
    where profile_id = new.profile_id and product_id = product_id_value
      and scope_type = 'brf' and scope_id = new.brf_id::text
      and (module_id = module_id_value or module_id is null)
      and role_id in (select id from public.platform_roles where product_id = product_id_value
        and key in ('board_member', 'renoapp_admin'));
  if new.is_active then
    insert into public.platform_access_assignments(profile_id, product_id, module_id, role_id,
      scope_type, scope_id, is_active, source_system, source_record_id, granted_by_profile_id)
    values(new.profile_id, product_id_value, module_id_value, role_id_value, 'brf', new.brf_id::text,
      true, 'brf_members', new.id::text, nullif(current_setting('renoapp.actor_id', true), '')::uuid)
    on conflict (profile_id, product_id, (coalesce(module_id, '00000000-0000-0000-0000-000000000000'::uuid)),
      role_id, scope_type, (coalesce(scope_id, ''))) do update
    set is_active = true, expires_at = null, source_system = excluded.source_system,
      source_record_id = excluded.source_record_id, granted_by_profile_id = excluded.granted_by_profile_id;
  end if;
  return new;
end $$;
drop trigger if exists renoapp_sync_member_access on public.brf_members;
create trigger renoapp_sync_member_access after insert or update of is_active, role on public.brf_members
for each row execute function public.renoapp_sync_member_access();

-- Reconcile missing records only. Never re-enable an existing disabled or expired grant.
insert into public.platform_access_assignments(profile_id, product_id, module_id, role_id,
  scope_type, scope_id, is_active, source_system, source_record_id)
select b.profile_id, p.id, m.id, r.id, 'brf', b.brf_id::text, true, 'brf_members', b.id::text
from public.brf_members b
join public.platform_products p on p.key = 'renoapp'
join public.platform_modules m on m.product_id = p.id and m.key = 'board_portal'
join public.platform_roles r on r.product_id = p.id and r.key = case when b.role = 'admin' then 'renoapp_admin' else 'board_member' end
where b.is_active and not exists (
  select 1 from public.platform_access_assignments a where a.profile_id = b.profile_id
    and a.product_id = p.id and (a.module_id = m.id or a.module_id is null)
    and a.scope_type = 'brf' and a.scope_id = b.brf_id::text
) on conflict do nothing;
update public.platform_access_assignments a set is_active = false
from public.brf_members b, public.platform_products p, public.platform_modules m
where not b.is_active and p.key = 'renoapp' and m.product_id = p.id and m.key = 'board_portal'
  and a.product_id = p.id and (a.module_id = m.id or a.module_id is null)
  and a.profile_id = b.profile_id and a.scope_type = 'brf' and a.scope_id = b.brf_id::text
  and a.role_id in (select id from public.platform_roles where product_id = p.id and key in ('board_member', 'renoapp_admin'));

create or replace function public.renoapp_audit_brf_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare event_brf uuid; event_kind text; event_details jsonb; actor uuid;
begin
  actor := nullif(current_setting('renoapp.actor_id', true), '')::uuid;
  if tg_table_name = 'brf_associations' then
    event_brf := new.id;
    if tg_op = 'INSERT' then event_kind := 'brf_created';
    elsif old.onboarding_completed_at is null and new.onboarding_completed_at is not null then event_kind := 'brf_activated';
    elsif to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then return new;
    else event_kind := 'brf_updated'; end if;
    actor := coalesce(actor, case when tg_op = 'INSERT' then new.created_by else null end);
    event_details := jsonb_build_object('name', new.name, 'source', new.onboarding_source);
  elsif tg_table_name = 'brf_members' then
    event_brf := new.brf_id;
    if tg_op = 'UPDATE' and new.is_active = old.is_active and new.role = old.role then return new; end if;
    event_kind := case when new.is_active then 'member_added' else 'member_removed' end;
    event_details := jsonb_build_object('profileId', new.profile_id, 'role', new.role);
  else
    event_brf := new.brf_id;
    if tg_op = 'INSERT' then event_kind := 'invite_created';
    elsif old.accepted_at is null and new.accepted_at is not null then event_kind := 'invite_accepted';
    elsif old.revoked_at is null and new.revoked_at is not null then event_kind := 'invite_revoked';
    elsif new.delivery_status is distinct from old.delivery_status then event_kind := 'invite_delivery';
    else return new; end if;
    actor := coalesce(actor, new.accepted_by, new.created_by);
    event_details := jsonb_build_object('email', new.email, 'deliveryStatus', new.delivery_status, 'error', new.delivery_error);
  end if;
  insert into public.renoapp_brf_events(brf_id, actor_profile_id, kind, details)
    values(event_brf, actor, event_kind, event_details);
  return new;
end $$;
drop trigger if exists renoapp_audit_brf on public.brf_associations;
create trigger renoapp_audit_brf after insert or update on public.brf_associations for each row execute function public.renoapp_audit_brf_change();
drop trigger if exists renoapp_audit_member on public.brf_members;
create trigger renoapp_audit_member after insert or update on public.brf_members for each row execute function public.renoapp_audit_brf_change();
drop trigger if exists renoapp_audit_invite on public.brf_member_invites;
create trigger renoapp_audit_invite after insert or update on public.brf_member_invites for each row execute function public.renoapp_audit_brf_change();

create or replace function public.renoapp_start_brf_onboarding(
  p_actor uuid, p_input jsonb, p_token_hash text, p_expires_at timestamptz,
  p_request_id uuid default null, p_creation_key uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare req public.brf_requests; brf public.brf_associations; invite_id uuid;
  brf_name text; org text; email_address text; slug_base text; candidate text; suffix integer := 1;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  if p_request_id is not null then
    select * into req from public.brf_requests where id = p_request_id for update;
    if not found then raise exception 'BRF_REQUEST_NOT_FOUND'; end if;
    if req.status <> 'pending' then
      if req.status = p_input->>'decision' then
        select * into brf from public.brf_associations where id = req.approved_brf_id;
        return jsonb_build_object('request', to_jsonb(req), 'brf', case when brf.id is null then null else to_jsonb(brf) end, 'reused', true);
      end if;
      raise exception 'BRF_REQUEST_ALREADY_REVIEWED';
    end if;
    if p_input->>'decision' = 'rejected' then
      update public.brf_requests set status = 'rejected', review_note = p_input->>'internalNote',
        external_message = p_input->>'externalMessage', reviewed_by = p_actor, reviewed_at = now()
        where id = req.id returning * into req;
      insert into public.renoapp_brf_events(request_id, actor_profile_id, kind) values(req.id, p_actor, 'request_rejected');
      return jsonb_build_object('request', to_jsonb(req), 'brf', null, 'reused', false);
    end if;
    if p_input->>'decision' is distinct from 'approved' then raise exception 'INVALID_ACTION'; end if;
    brf_name := req.name; org := req.org_number; email_address := lower(trim(req.contact_email));
  else
    if p_creation_key is null then raise exception 'CREATION_KEY_REQUIRED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_creation_key::text, 0));
    select * into brf from public.brf_associations where onboarding_key = p_creation_key;
    if found then return jsonb_build_object('brf', to_jsonb(brf), 'reused', true); end if;
    brf_name := trim(p_input->>'name'); org := p_input->>'orgNumber'; email_address := lower(trim(p_input->>'email'));
  end if;
  if coalesce(brf_name, '') = '' then raise exception 'BRF_NAME_REQUIRED'; end if;
  if coalesce(email_address, '') = '' then raise exception 'BOARD_EMAIL_INVALID'; end if;
  slug_base := coalesce(nullif(p_input->>'slug', ''), 'brf'); candidate := slug_base;
  perform pg_advisory_xact_lock(hashtextextended('renoapp-slug:' || slug_base, 0));
  while exists(select 1 from public.brf_associations where slug = candidate) loop
    suffix := suffix + 1; candidate := slug_base || '-' || suffix;
  end loop;
  insert into public.brf_associations(name, slug, org_number, address, primary_contact_name,
    primary_contact_email, primary_contact_phone, created_by, is_public_apply_enabled,
    is_public_apply_listed, onboarding_key, onboarding_source)
  values(brf_name, candidate, org, coalesce(req.address, p_input->>'address'), req.contact_name,
    email_address, req.contact_phone, p_actor, false, false, p_creation_key,
    case when p_request_id is null then 'manual' else 'request' end) returning * into brf;
  insert into public.brf_member_invites(brf_id, email, full_name, role, token_hash, expires_at, created_by, delivery_status)
    values(brf.id, email_address, req.contact_name, 'board', p_token_hash, p_expires_at, p_actor, 'pending') returning id into invite_id;
  if p_request_id is not null then
    update public.brf_requests set status = 'approved', review_note = p_input->>'internalNote',
      external_message = p_input->>'externalMessage', reviewed_by = p_actor, reviewed_at = now(), approved_brf_id = brf.id
      where id = req.id returning * into req;
    insert into public.renoapp_brf_events(brf_id, request_id, actor_profile_id, kind)
      values(brf.id, req.id, p_actor, 'request_approved');
  end if;
  return jsonb_build_object('brf', to_jsonb(brf), 'request', case when req.id is null then null else to_jsonb(req) end,
    'inviteId', invite_id, 'reused', false);
end $$;

create or replace function public.renoapp_issue_brf_invite(
  p_actor uuid, p_brf_id uuid, p_email text, p_full_name text, p_token_hash text,
  p_expires_at timestamptz, p_replace boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  perform 1 from public.brf_associations where id = p_brf_id for update;
  if not found then raise exception 'BRF_NOT_FOUND'; end if;
  if exists(select 1 from public.brf_members m join public.profiles p on p.id = m.profile_id
    where m.brf_id = p_brf_id and m.is_active and lower(p.email) = lower(trim(p_email))) then
    raise exception 'EMAIL_ALREADY_MEMBER';
  end if;
  if not p_replace and exists(select 1 from public.brf_member_invites where brf_id = p_brf_id
    and lower(email) = lower(trim(p_email)) and accepted_at is null and revoked_at is null and expires_at > now()) then
    raise exception 'EMAIL_ALREADY_INVITED';
  end if;
  update public.brf_member_invites set revoked_at = now() where brf_id = p_brf_id
    and lower(email) = lower(trim(p_email)) and accepted_at is null and revoked_at is null;
  insert into public.brf_member_invites(brf_id, email, full_name, role, token_hash, expires_at, created_by, delivery_status)
    values(p_brf_id, lower(trim(p_email)), p_full_name, 'board', p_token_hash, p_expires_at, p_actor, 'pending') returning id into result_id;
  return result_id;
end $$;

create or replace function public.renoapp_accept_brf_invite(p_actor uuid, p_token_hash text, p_completion jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare invitation public.brf_member_invites; brf public.brf_associations; actor_email text; mode text;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  select * into invitation from public.brf_member_invites where token_hash = p_token_hash;
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  select * into brf from public.brf_associations where id = invitation.brf_id for update;
  select * into invitation from public.brf_member_invites where id = invitation.id for update;
  select email into actor_email from auth.users where id = p_actor;
  if lower(actor_email) is distinct from lower(invitation.email) then raise exception 'INVITE_EMAIL_MISMATCH'; end if;
  if invitation.accepted_at is not null then
    if invitation.accepted_by = p_actor then return jsonb_build_object('brfId', brf.id, 'reused', true); end if;
    raise exception 'INVITE_ALREADY_ACCEPTED';
  end if;
  if invitation.revoked_at is not null then raise exception 'INVITE_REVOKED'; end if;
  if invitation.expires_at <= now() then raise exception 'INVITE_EXPIRED'; end if;
  mode := case when brf.onboarding_completed_at is null then 'brf_onboarding' else 'member_invite' end;
  if mode = 'brf_onboarding' then
    if p_completion is null or coalesce(p_completion->>'termsVersion', '') = '' then raise exception 'TERMS_NOT_ACCEPTED'; end if;
    update public.brf_associations set name = p_completion->>'name', org_number = p_completion->>'orgNumber',
      property_designation = p_completion->>'propertyDesignation', address = p_completion->>'address',
      address_line_2 = p_completion->>'addressLine2', postal_code = p_completion->>'postalCode', city = p_completion->>'city',
      invoice_address = p_completion->>'invoiceAddress', invoice_email = p_completion->>'invoiceEmail',
      invoice_reference = p_completion->>'invoiceReference', primary_contact_name = p_completion->>'primaryContactName',
      primary_contact_email = p_completion->>'primaryContactEmail', primary_contact_phone = p_completion->>'primaryContactPhone',
      unit_count = (p_completion->>'unitCount')::integer, email = p_completion->>'generalEmail',
      phone = coalesce(p_completion->>'brfPhone', p_completion->>'primaryContactPhone'),
      technical_contact = p_completion->>'technicalContact', onboarding_comment = p_completion->>'onboardingComment',
      is_public_apply_enabled = true, is_public_apply_listed = p_completion->>'publicApplyMode' = 'listed',
      onboarding_completed_at = now(), onboarding_terms_version = p_completion->>'termsVersion',
      onboarding_terms_accepted_at = now(), onboarding_terms_accepted_by = p_actor
    where id = brf.id;
  end if;
  insert into public.brf_members(brf_id, profile_id, role, is_active, accepted_at)
    values(brf.id, p_actor, 'board', true, now())
    on conflict (brf_id, profile_id) do update set is_active = true, accepted_at = excluded.accepted_at;
  update public.brf_member_invites set accepted_at = now(), accepted_by = p_actor where id = invitation.id;
  return jsonb_build_object('brfId', brf.id, 'mode', mode, 'reused', false);
end $$;

create or replace function public.renoapp_remove_brf_member(p_actor uuid, p_brf_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  if p_actor = p_profile_id then raise exception 'CANNOT_REMOVE_SELF'; end if;
  perform 1 from public.brf_associations where id = p_brf_id for update;
  if not exists(select 1 from public.brf_members where brf_id = p_brf_id and profile_id = p_profile_id and is_active) then
    raise exception 'MEMBER_NOT_FOUND';
  end if;
  if (select count(*) from public.brf_members where brf_id = p_brf_id and is_active) <= 1 then
    raise exception 'CANNOT_REMOVE_LAST_MEMBER';
  end if;
  update public.brf_members set is_active = false where brf_id = p_brf_id and profile_id = p_profile_id;
end $$;

create or replace function public.renoapp_restore_brf_member(p_actor uuid, p_brf_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  perform 1 from public.brf_associations where id = p_brf_id for update;
  if not found then raise exception 'BRF_NOT_FOUND'; end if;
  perform set_config('renoapp.restore_access', 'true', true);
  update public.brf_members set is_active = true
    where brf_id = p_brf_id and profile_id = p_profile_id and is_active;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  perform set_config('renoapp.restore_access', 'false', true);
  insert into public.renoapp_brf_events(brf_id, actor_profile_id, kind, details)
    values(p_brf_id, p_actor, 'member_access_restored', jsonb_build_object('profileId', p_profile_id));
end $$;
revoke all on function public.renoapp_restore_brf_member(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.renoapp_restore_brf_member(uuid,uuid,uuid) to service_role;

create or replace function public.renoapp_update_brf(p_actor uuid, p_brf_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare row_value public.brf_associations;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  select * into row_value from public.brf_associations where id = p_brf_id for update;
  if not found then raise exception 'BRF_NOT_FOUND'; end if;
  if p_changes - array['name','org_number','property_designation','address','address_line_2','postal_code','city',
    'email','phone','invoice_address','invoice_email','invoice_reference','primary_contact_name','primary_contact_email',
    'primary_contact_phone','unit_count','technical_contact','apply_intro_text','is_public_apply_enabled','is_public_apply_listed','internal_note'] <> '{}'::jsonb
    then raise exception 'INVALID_BRF_FIELDS'; end if;
  row_value := jsonb_populate_record(row_value, p_changes);
  if row_value.onboarding_completed_at is null and row_value.is_public_apply_enabled then raise exception 'BRF_ACTIVATION_REQUIRED'; end if;
  update public.brf_associations set name = row_value.name, org_number = row_value.org_number,
    property_designation = row_value.property_designation, address = row_value.address, address_line_2 = row_value.address_line_2,
    postal_code = row_value.postal_code, city = row_value.city, email = row_value.email, phone = row_value.phone,
    invoice_address = row_value.invoice_address, invoice_email = row_value.invoice_email, invoice_reference = row_value.invoice_reference,
    primary_contact_name = row_value.primary_contact_name, primary_contact_email = row_value.primary_contact_email,
    primary_contact_phone = row_value.primary_contact_phone, unit_count = row_value.unit_count,
    technical_contact = row_value.technical_contact, apply_intro_text = row_value.apply_intro_text,
    is_public_apply_enabled = row_value.is_public_apply_enabled,
    is_public_apply_listed = row_value.is_public_apply_enabled and row_value.is_public_apply_listed,
    internal_note = row_value.internal_note where id = p_brf_id returning * into row_value;
  return to_jsonb(row_value);
end $$;

create or replace function public.renoapp_revoke_brf_invite(p_actor uuid, p_brf_id uuid, p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare invitation public.brf_member_invites;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  perform 1 from public.brf_associations where id = p_brf_id for update;
  select * into invitation from public.brf_member_invites where id = p_invite_id and brf_id = p_brf_id for update;
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  if invitation.accepted_at is not null then raise exception 'INVITE_ALREADY_ACCEPTED'; end if;
  update public.brf_member_invites set revoked_at = now() where id = invitation.id and revoked_at is null;
end $$;
revoke all on function public.renoapp_revoke_brf_invite(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.renoapp_revoke_brf_invite(uuid,uuid,uuid) to service_role;

-- All RPCs are server-only. Identity and BRF scope are verified by the application API.
revoke all on function public.renoapp_start_brf_onboarding(uuid,jsonb,text,timestamptz,uuid,uuid) from public, anon, authenticated;
revoke all on function public.renoapp_issue_brf_invite(uuid,uuid,text,text,text,timestamptz,boolean) from public, anon, authenticated;
revoke all on function public.renoapp_accept_brf_invite(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.renoapp_remove_brf_member(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.renoapp_update_brf(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.renoapp_sync_member_access() from public, anon, authenticated;
revoke all on function public.renoapp_audit_brf_change() from public, anon, authenticated;
grant execute on function public.renoapp_start_brf_onboarding(uuid,jsonb,text,timestamptz,uuid,uuid) to service_role;
grant execute on function public.renoapp_issue_brf_invite(uuid,uuid,text,text,text,timestamptz,boolean) to service_role;
grant execute on function public.renoapp_accept_brf_invite(uuid,text,jsonb) to service_role;
grant execute on function public.renoapp_remove_brf_member(uuid,uuid,uuid) to service_role;
grant execute on function public.renoapp_update_brf(uuid,uuid,jsonb) to service_role;
commit;
