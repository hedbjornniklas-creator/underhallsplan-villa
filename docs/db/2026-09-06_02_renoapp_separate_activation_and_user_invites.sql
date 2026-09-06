-- Separate BRF activation links from personal board-portal invitations.
-- Run after 2026-09-06_01_renoapp_approve_rejected_request.sql.
begin;

alter table public.brf_member_invites
  add column if not exists invite_kind text not null default 'member_access';

alter table public.brf_member_invites
  drop constraint if exists brf_member_invites_kind_check;
alter table public.brf_member_invites
  add constraint brf_member_invites_kind_check
  check (invite_kind in ('brf_activation', 'member_access'));

-- Before this migration, every pending invite for an unfinished BRF acted as its
-- activation link. Preserve those links while making their purpose explicit.
update public.brf_member_invites invite
set invite_kind = 'brf_activation'
from public.brf_associations brf
where brf.id = invite.brf_id
  and brf.onboarding_completed_at is null;

create index if not exists brf_member_invites_kind_idx
  on public.brf_member_invites (brf_id, invite_kind, created_at desc);

alter table public.brf_associations
  add column if not exists onboarding_signatory_name text,
  add column if not exists onboarding_signatory_email text,
  add column if not exists onboarding_signatory_role text,
  add column if not exists onboarding_signatory_authority_confirmed boolean not null default false;

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
      if not (req.status = 'rejected' and p_input->>'decision' = 'approved') then
        raise exception 'BRF_REQUEST_ALREADY_REVIEWED';
      end if;
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
  insert into public.brf_member_invites(brf_id, email, full_name, role, invite_kind, token_hash, expires_at, created_by, delivery_status)
    values(brf.id, email_address, req.contact_name, 'board', 'brf_activation', p_token_hash, p_expires_at, p_actor, 'pending') returning id into invite_id;
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
declare result_id uuid; brf public.brf_associations;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  select * into brf from public.brf_associations where id = p_brf_id for update;
  if not found then raise exception 'BRF_NOT_FOUND'; end if;
  if brf.onboarding_completed_at is null then raise exception 'BRF_ACTIVATION_REQUIRED'; end if;
  if exists(select 1 from public.brf_members m join public.profiles p on p.id = m.profile_id
    where m.brf_id = p_brf_id and m.is_active and lower(p.email) = lower(trim(p_email))) then
    raise exception 'EMAIL_ALREADY_MEMBER';
  end if;
  if not p_replace and exists(select 1 from public.brf_member_invites where brf_id = p_brf_id
    and invite_kind = 'member_access' and lower(email) = lower(trim(p_email))
    and accepted_at is null and revoked_at is null and expires_at > now()) then
    raise exception 'EMAIL_ALREADY_INVITED';
  end if;
  update public.brf_member_invites set revoked_at = now() where brf_id = p_brf_id
    and invite_kind = 'member_access' and lower(email) = lower(trim(p_email))
    and accepted_at is null and revoked_at is null;
  insert into public.brf_member_invites(brf_id, email, full_name, role, invite_kind, token_hash, expires_at, created_by, delivery_status)
    values(p_brf_id, lower(trim(p_email)), p_full_name, 'board', 'member_access', p_token_hash, p_expires_at, p_actor, 'pending') returning id into result_id;
  return result_id;
end $$;

create or replace function public.renoapp_activate_brf(
  p_token_hash text, p_completion jsonb, p_users jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  invitation public.brf_member_invites;
  brf public.brf_associations;
  user_item jsonb;
  user_count integer;
  member_invite_id uuid;
  member_invites jsonb := '[]'::jsonb;
  user_email text;
  user_name text;
begin
  select * into invitation from public.brf_member_invites where token_hash = p_token_hash;
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  select * into brf from public.brf_associations where id = invitation.brf_id for update;
  select * into invitation from public.brf_member_invites where id = invitation.id for update;

  if invitation.invite_kind <> 'brf_activation' then raise exception 'INVITE_KIND_MISMATCH'; end if;
  if invitation.accepted_at is not null then
    return jsonb_build_object('brfId', brf.id, 'mode', 'brf_onboarding', 'reused', true, 'memberInvites', '[]'::jsonb);
  end if;
  if invitation.revoked_at is not null then raise exception 'INVITE_REVOKED'; end if;
  if invitation.expires_at <= now() then raise exception 'INVITE_EXPIRED'; end if;
  if brf.onboarding_completed_at is not null then raise exception 'ACTIVATION_ALREADY_COMPLETED'; end if;
  if p_completion is null or coalesce(p_completion->>'termsVersion', '') = '' then raise exception 'TERMS_NOT_ACCEPTED'; end if;
  if coalesce(trim(p_completion->>'signatoryName'), '') = '' then raise exception 'SIGNATORY_NAME_REQUIRED'; end if;
  if coalesce(trim(p_completion->>'signatoryRole'), '') = '' then raise exception 'SIGNATORY_ROLE_REQUIRED'; end if;
  if coalesce((p_completion->>'signatoryAuthorityConfirmed')::boolean, false) is not true then
    raise exception 'SIGNATORY_AUTHORITY_REQUIRED';
  end if;
  if jsonb_typeof(p_users) is distinct from 'array' then raise exception 'INITIAL_USERS_REQUIRED'; end if;
  user_count := jsonb_array_length(p_users);
  if user_count < 1 then raise exception 'INITIAL_USERS_REQUIRED'; end if;
  if user_count > 4 then raise exception 'TOO_MANY_INITIAL_USERS'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_users) item
    group by lower(trim(item->>'email')) having count(*) > 1
  ) then raise exception 'INITIAL_USER_DUPLICATE_EMAIL'; end if;

  for user_item in select value from jsonb_array_elements(p_users) loop
    user_email := lower(trim(user_item->>'email'));
    user_name := trim(user_item->>'fullName');
    if coalesce(user_name, '') = '' then raise exception 'INITIAL_USER_NAME_REQUIRED'; end if;
    if coalesce(user_email, '') = '' then raise exception 'INITIAL_USER_EMAIL_REQUIRED'; end if;
    if coalesce(user_item->>'tokenHash', '') = '' then raise exception 'INITIAL_USER_TOKEN_REQUIRED'; end if;
    if (user_item->>'expiresAt')::timestamptz <= now() then raise exception 'INITIAL_USER_EXPIRY_INVALID'; end if;

    insert into public.brf_member_invites(
      brf_id, email, full_name, role, invite_kind, token_hash, expires_at, created_by, delivery_status
    ) values (
      brf.id, user_email, user_name, 'board', 'member_access', user_item->>'tokenHash',
      (user_item->>'expiresAt')::timestamptz, invitation.created_by, 'pending'
    ) returning id into member_invite_id;
    member_invites := member_invites || jsonb_build_array(jsonb_build_object(
      'id', member_invite_id, 'email', user_email, 'fullName', user_name,
      'expiresAt', user_item->>'expiresAt'
    ));
  end loop;

  update public.brf_associations set
    name = p_completion->>'name', org_number = p_completion->>'orgNumber',
    property_designation = p_completion->>'propertyDesignation', address = p_completion->>'address',
    address_line_2 = p_completion->>'addressLine2', postal_code = p_completion->>'postalCode', city = p_completion->>'city',
    invoice_address = p_completion->>'invoiceAddress', invoice_email = p_completion->>'invoiceEmail',
    invoice_reference = p_completion->>'invoiceReference', primary_contact_name = p_completion->>'primaryContactName',
    primary_contact_email = p_completion->>'primaryContactEmail', primary_contact_phone = p_completion->>'primaryContactPhone',
    unit_count = nullif(p_completion->>'unitCount', '')::integer, email = p_completion->>'generalEmail',
    phone = coalesce(p_completion->>'brfPhone', p_completion->>'primaryContactPhone'),
    technical_contact = p_completion->>'technicalContact', onboarding_comment = p_completion->>'onboardingComment',
    is_public_apply_enabled = true, is_public_apply_listed = p_completion->>'publicApplyMode' = 'listed',
    onboarding_completed_at = now(), onboarding_terms_version = p_completion->>'termsVersion',
    onboarding_terms_accepted_at = now(), onboarding_terms_accepted_by = null,
    onboarding_signatory_name = trim(p_completion->>'signatoryName'),
    onboarding_signatory_email = invitation.email,
    onboarding_signatory_role = trim(p_completion->>'signatoryRole'),
    onboarding_signatory_authority_confirmed = true
  where id = brf.id;

  update public.brf_member_invites
  set accepted_at = now(), accepted_by = null
  where id = invitation.id;
  update public.brf_member_invites
  set revoked_at = now()
  where brf_id = brf.id and invite_kind = 'brf_activation' and id <> invitation.id
    and accepted_at is null and revoked_at is null;

  return jsonb_build_object('brfId', brf.id, 'mode', 'brf_onboarding', 'reused', false, 'memberInvites', member_invites);
end $$;

create or replace function public.renoapp_accept_brf_invite(
  p_actor uuid, p_token_hash text, p_completion jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare invitation public.brf_member_invites; brf public.brf_associations; actor_email text;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  select * into invitation from public.brf_member_invites where token_hash = p_token_hash;
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  select * into brf from public.brf_associations where id = invitation.brf_id for update;
  select * into invitation from public.brf_member_invites where id = invitation.id for update;
  if invitation.invite_kind <> 'member_access' then raise exception 'INVITE_KIND_MISMATCH'; end if;
  select email into actor_email from auth.users where id = p_actor;
  if lower(actor_email) is distinct from lower(invitation.email) then raise exception 'INVITE_EMAIL_MISMATCH'; end if;
  if invitation.accepted_at is not null then
    if invitation.accepted_by = p_actor then
      return jsonb_build_object('brfId', brf.id, 'mode', 'member_invite', 'reused', true);
    end if;
    raise exception 'INVITE_ALREADY_ACCEPTED';
  end if;
  if invitation.revoked_at is not null then raise exception 'INVITE_REVOKED'; end if;
  if invitation.expires_at <= now() then raise exception 'INVITE_EXPIRED'; end if;
  if brf.onboarding_completed_at is null then raise exception 'BRF_ACTIVATION_REQUIRED'; end if;
  insert into public.brf_members(brf_id, profile_id, role, is_active, accepted_at)
    values(brf.id, p_actor, 'board', true, now())
    on conflict (brf_id, profile_id) do update set is_active = true, accepted_at = excluded.accepted_at;
  update public.brf_member_invites set accepted_at = now(), accepted_by = p_actor where id = invitation.id;
  return jsonb_build_object('brfId', brf.id, 'mode', 'member_invite', 'reused', false);
end $$;

create or replace function public.renoapp_reissue_brf_activation(
  p_actor uuid, p_brf_id uuid, p_invite_id uuid, p_token_hash text, p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare invitation public.brf_member_invites; brf public.brf_associations;
begin
  perform set_config('renoapp.actor_id', p_actor::text, true);
  select * into brf from public.brf_associations where id = p_brf_id for update;
  if not found then raise exception 'BRF_NOT_FOUND'; end if;
  if brf.onboarding_completed_at is not null then raise exception 'ACTIVATION_ALREADY_COMPLETED'; end if;
  select * into invitation from public.brf_member_invites
    where id = p_invite_id and brf_id = p_brf_id for update;
  if not found or invitation.invite_kind <> 'brf_activation' then raise exception 'INVITE_NOT_FOUND'; end if;
  if invitation.accepted_at is not null then raise exception 'INVITE_ALREADY_ACCEPTED'; end if;
  update public.brf_member_invites set token_hash = p_token_hash, expires_at = p_expires_at,
    revoked_at = null, delivery_status = 'pending', delivery_error = null, sent_at = null
  where id = invitation.id;
  return invitation.id;
end $$;

revoke all on function public.renoapp_activate_brf(text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.renoapp_reissue_brf_activation(uuid,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.renoapp_activate_brf(text,jsonb,jsonb) to service_role;
grant execute on function public.renoapp_reissue_brf_activation(uuid,uuid,uuid,text,timestamptz) to service_role;

commit;
