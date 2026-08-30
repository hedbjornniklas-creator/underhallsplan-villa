-- Uppdrag: fix ambiguous task recipient first-login grant conflict target.
-- Date: 2026-08-28
-- Prerequisite:
--  - 2026-08-28_01_task_recipient_first_login_code.sql
--
-- The function returns columns named task_id, recipient_identity_id and
-- contact_id. In PL/pgSQL those output parameters are variables, making a
-- column-list ON CONFLICT target with the same names ambiguous at runtime.

create or replace function public.accept_task_recipient_first_login(
  p_challenge_id uuid,
  p_access_link_id uuid,
  p_setup_secret_hash text,
  p_auth_user_id uuid
)
returns table (
  recipient_identity_id uuid,
  task_id uuid,
  contact_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  challenge_row public.task_recipient_first_login_challenges%rowtype;
  identity_row public.task_recipient_identities%rowtype;
  task_row public.operational_tasks%rowtype;
  contact_row public.organization_contacts%rowtype;
  access_row public.task_access_links%rowtype;
  identity_id_value uuid;
  task_id_value uuid;
  contact_id_value uuid;
  auth_email_normalized text;
  auth_email_confirmed boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_FORBIDDEN';
  end if;

  if p_challenge_id is null
    or p_access_link_id is null
    or p_auth_user_id is null
    or p_setup_secret_hash is null
    or char_length(p_setup_secret_hash) <> 64
    or p_setup_secret_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_INPUT_INVALID';
  end if;

  -- Read immutable foreign keys first, then follow the repository-wide lock
  -- order: task -> contact -> identity -> access link -> challenge.
  select
    challenge.recipient_identity_id,
    challenge.task_id,
    challenge.contact_id
  into identity_id_value, task_id_value, contact_id_value
  from public.task_recipient_first_login_challenges challenge
  where challenge.id = p_challenge_id
    and challenge.access_link_id = p_access_link_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_INVALID';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = task_id_value
    and task.assignee_contact_id = contact_id_value
    and task.archived_at is null
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_ACCESS_INVALID';
  end if;

  select contact.*
  into contact_row
  from public.organization_contacts contact
  where contact.id = contact_id_value
    and contact.org_id = task_row.org_id
    and contact.recipient_identity_id = identity_id_value
    and contact.is_active = true
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_ACCESS_INVALID';
  end if;

  select identity.*
  into identity_row
  from public.task_recipient_identities identity
  where identity.id = identity_id_value
  for update;

  if not found or identity_row.status = 'disabled' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_UNAVAILABLE';
  end if;

  select access_link.*
  into access_row
  from public.task_access_links access_link
  where access_link.id = p_access_link_id
    and access_link.org_id = task_row.org_id
    and access_link.contact_id = contact_row.id
    and access_link.task_id = task_row.id
    and (
      access_link.role = 'assignee'
      or (
        access_link.role = 'viewer'
        and task_row.status in ('approved', 'cancelled')
      )
    )
    and access_link.scope = 'task'
    and access_link.revoked_at is null
    and access_link.expires_at > now()
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_ACCESS_INVALID';
  end if;

  select challenge.*
  into challenge_row
  from public.task_recipient_first_login_challenges challenge
  where challenge.id = p_challenge_id
    and challenge.access_link_id = p_access_link_id
  for update;

  if not found
    or challenge_row.setup_secret_hash <> p_setup_secret_hash
    or challenge_row.verified_at is null
    or challenge_row.revoked_at is not null
  then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_INVALID';
  end if;

  if challenge_row.consumed_at is not null then
    if identity_row.auth_user_id = p_auth_user_id then
      return query
      select identity_row.id, challenge_row.task_id, challenge_row.contact_id;
      return;
    end if;
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_INVALID';
  end if;

  if challenge_row.expires_at <= now() then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_INVALID';
  end if;

  select
    public.task_recipient_normalize_email(auth_user.email),
    auth_user.email_confirmed_at is not null
  into auth_email_normalized, auth_email_confirmed
  from auth.users auth_user
  where auth_user.id = p_auth_user_id;

  if auth_email_normalized is null
    or auth_email_normalized <> identity_row.email_normalized
  then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_EMAIL_MISMATCH';
  end if;
  if auth_email_confirmed is distinct from true then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_EMAIL_NOT_VERIFIED';
  end if;
  if identity_row.auth_user_id is not null
    and identity_row.auth_user_id <> p_auth_user_id
  then
    raise exception using
      errcode = '23505',
      message = 'TASK_RECIPIENT_ACCOUNT_LOGIN_REQUIRED';
  end if;

  if exists (
    select 1
    from public.task_recipient_identities other_identity
    where other_identity.auth_user_id = p_auth_user_id
      and other_identity.id <> identity_row.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'TASK_RECIPIENT_AUTH_USER_ALREADY_BOUND';
  end if;

  insert into public.task_recipient_portal_grants as existing_grant (
    recipient_identity_id,
    org_id,
    contact_id,
    task_id,
    grant_role
  )
  values (
    identity_row.id,
    contact_row.org_id,
    contact_row.id,
    challenge_row.task_id,
    'assignee'
  )
  on conflict on constraint task_recipient_portal_grants_exact_unique do update
  set
    revoked_at = null,
    revocation_reason = null,
    updated_at = now();

  update public.task_recipient_identities identity
  set
    auth_user_id = p_auth_user_id,
    status = 'active',
    activated_at = coalesce(identity.activated_at, now()),
    last_login_at = now(),
    updated_at = now()
  where identity.id = identity_row.id;

  update public.task_recipient_first_login_challenges challenge
  set
    consumed_at = now(),
    updated_at = now()
  where challenge.id = challenge_row.id
    and challenge.consumed_at is null
    and challenge.revoked_at is null;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_RACE';
  end if;

  update public.task_recipient_first_login_challenges challenge
  set
    revoked_at = now(),
    updated_at = now()
  where challenge.recipient_identity_id = identity_row.id
    and challenge.id <> challenge_row.id
    and challenge.consumed_at is null
    and challenge.revoked_at is null;

  return query
  select identity_row.id, challenge_row.task_id, challenge_row.contact_id;
end;
$$;

revoke all on function public.accept_task_recipient_first_login(
  uuid, uuid, text, uuid
) from public, anon, authenticated;

grant execute on function public.accept_task_recipient_first_login(
  uuid, uuid, text, uuid
) to service_role;
