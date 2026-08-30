-- Uppdrag: first login with a short email code followed by password creation.
--
-- The six-digit code and both browser/setup secrets are held only by the
-- delivery provider/browser. Postgres stores SHA-256/HMAC digests only.
-- Existing task_recipient_activation_tokens and their RPCs are deliberately
-- untouched so already delivered activation links continue to work.

-- ---------------------------------------------------------------------
-- Exact-task read-only bearer links for terminal notifications
-- ---------------------------------------------------------------------

-- Approved/cancelled tasks still need a personal /signe link for reading and
-- first-login setup. The viewer role is deliberate defense in depth:
-- task_access_link_covers excludes viewers, so workflow RPCs cannot use this
-- credential even if an application-level terminal guard regresses.
create or replace function public.issue_terminal_task_readonly_bearer_access_link(
  p_task_id uuid,
  p_contact_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by_profile_id uuid,
  p_issued_by_system boolean default false
)
returns public.task_access_links
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  contact_row public.organization_contacts%rowtype;
  identity_row public.task_recipient_identities%rowtype;
  link_row public.task_access_links%rowtype;
  creator_name text;
  active_bearer_count integer;
  revoked_bearer_count integer := 0;
  max_active_bearer_links constant integer := 8;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_TERMINAL_READONLY_ISSUE_FORBIDDEN';
  end if;

  if p_task_id is null
    or p_contact_id is null
    or p_created_by_profile_id is null
    or p_token_hash is null
    or char_length(p_token_hash) <> 64
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= now()
    or p_expires_at > now() + interval '180 days' + interval '1 hour'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_ACCESS_TERMINAL_READONLY_INPUT_INVALID';
  end if;

  -- Canonical task -> contact/identity -> bearer-link lock order serializes
  -- issuance with reassignment, contact disable and ordinary link rotation.
  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.archived_at is null
    and task.status in ('approved', 'cancelled')
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_ACCESS_TERMINAL_READONLY_TASK_INVALID';
  end if;

  identity_row := public.ensure_task_recipient_identity_for_contact(p_contact_id);

  select contact.*
  into contact_row
  from public.organization_contacts contact
  where contact.id = p_contact_id
    and contact.org_id = task_row.org_id
    and contact.recipient_identity_id = identity_row.id
    and contact.is_active = true
    and task_row.assignee_contact_id = contact.id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_TERMINAL_READONLY_ASSIGNEE_INVALID';
  end if;

  if identity_row.status = 'disabled' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_IDENTITY_DISABLED';
  end if;

  if not exists (
    select 1
    from public.org_members member
    where member.org_id = task_row.org_id
      and member.profile_id = p_created_by_profile_id
      and member.is_active = true
      and (
        task_row.issuer_profile_id = p_created_by_profile_id
        or member.role = 'admin'
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_TERMINAL_READONLY_CREATOR_FORBIDDEN';
  end if;

  -- Account activation must reveal every task assigned before first login,
  -- without creating a separate legacy activation credential per task.
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
    task_row.id,
    'assignee'
  )
  on conflict (task_id, recipient_identity_id, contact_id) do update
  set
    revoked_at = null,
    revocation_reason = null,
    granted_at = case
      when existing_grant.revoked_at is not null then now()
      else existing_grant.granted_at
    end,
    updated_at = now();

  update public.task_access_links access_link
  set revoked_at = coalesce(access_link.revoked_at, now())
  where access_link.task_id = task_row.id
    and access_link.contact_id = contact_row.id
    and access_link.portal_grant_id is null
    and access_link.revoked_at is null
    and access_link.expires_at <= now();

  select count(*)::integer
  into active_bearer_count
  from public.task_access_links access_link
  where access_link.task_id = task_row.id
    and access_link.contact_id = contact_row.id
    and access_link.portal_grant_id is null
    and access_link.revoked_at is null
    and access_link.expires_at > now();

  if active_bearer_count >= max_active_bearer_links then
    with keep_pinned as (
      select access_link.id
      from public.task_access_links access_link
      where access_link.task_id = task_row.id
        and access_link.contact_id = contact_row.id
        and access_link.portal_grant_id is null
        and access_link.revoked_at is null
        and access_link.expires_at > now()
        and access_link.sent_at is not null
      order by access_link.created_at asc, access_link.id asc
      limit 1
    ), keep_latest as (
      select access_link.id
      from public.task_access_links access_link
      where access_link.task_id = task_row.id
        and access_link.contact_id = contact_row.id
        and access_link.portal_grant_id is null
        and access_link.revoked_at is null
        and access_link.expires_at > now()
        and not exists (
          select 1
          from keep_pinned
          where keep_pinned.id = access_link.id
        )
      order by access_link.created_at desc, access_link.id desc
      limit (
        max_active_bearer_links - 1
        - case when exists (select 1 from keep_pinned) then 1 else 0 end
      )
    ), keep_rows as (
      select id from keep_pinned
      union
      select id from keep_latest
    )
    update public.task_access_links access_link
    set revoked_at = coalesce(access_link.revoked_at, now())
    where access_link.task_id = task_row.id
      and access_link.contact_id = contact_row.id
      and access_link.portal_grant_id is null
      and access_link.revoked_at is null
      and access_link.expires_at > now()
      and not exists (
        select 1
        from keep_rows
        where keep_rows.id = access_link.id
      );

    get diagnostics revoked_bearer_count = row_count;
  end if;

  insert into public.task_access_links (
    org_id,
    task_id,
    root_task_id,
    contact_id,
    role,
    scope,
    token_hash,
    expires_at,
    created_by_profile_id,
    portal_grant_id
  )
  values (
    task_row.org_id,
    task_row.id,
    task_row.root_task_id,
    contact_row.id,
    'viewer',
    'task',
    p_token_hash,
    p_expires_at,
    case when p_issued_by_system then null else p_created_by_profile_id end,
    null
  )
  returning * into link_row;

  select coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Uppdragsgivare')
  into creator_name
  from public.profiles profile
  where profile.id = p_created_by_profile_id;

  insert into public.task_events (
    org_id,
    task_id,
    event_type,
    actor_type,
    actor_profile_id,
    actor_name,
    message,
    metadata
  )
  values (
    task_row.org_id,
    task_row.id,
    'access_link_issued',
    case when p_issued_by_system then 'system' else 'profile' end,
    case when p_issued_by_system then null else p_created_by_profile_id end,
    case when p_issued_by_system then 'Signe' else coalesce(creator_name, 'Uppdragsgivare') end,
    'En personlig skrivskyddad extern uppdragslänk skapades.',
    jsonb_build_object(
      'accessLinkId', link_row.id,
      'contactId', contact_row.id,
      'role', 'viewer',
      'scope', 'task',
      'linkKind', 'bearer_readonly',
      'readOnly', true,
      'expiresAt', p_expires_at,
      'revokedBearerCount', revoked_bearer_count,
      'issuedBySystem', p_issued_by_system,
      'taskMutationApplied', true
    ) || case when p_issued_by_system
      then jsonb_build_object('authorizedByProfileId', p_created_by_profile_id)
      else '{}'::jsonb
    end
  );

  return link_row;
end;
$$;

comment on function public.issue_terminal_task_readonly_bearer_access_link(
  uuid, uuid, text, timestamptz, uuid, boolean
) is
  'Service-only exact-task read-only bearer issuance for the current external assignee of an approved/cancelled task. Uses viewer role so workflow authorization remains denied.';

revoke all on function public.issue_terminal_task_readonly_bearer_access_link(
  uuid, uuid, text, timestamptz, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.issue_terminal_task_readonly_bearer_access_link(
  uuid, uuid, text, timestamptz, uuid, boolean
) to service_role;

create table if not exists public.task_recipient_first_login_challenges (
  id uuid primary key,
  recipient_identity_id uuid not null
    references public.task_recipient_identities (id) on delete cascade,
  contact_id uuid not null
    references public.organization_contacts (id) on delete cascade,
  task_id uuid not null
    references public.operational_tasks (id) on delete cascade,
  access_link_id uuid not null
    references public.task_access_links (id) on delete cascade,
  browser_secret_hash text not null,
  setup_secret_hash text,
  code_hash text not null,
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 5,
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_recipient_first_login_browser_hash_check
    check (char_length(browser_secret_hash) = 64 and browser_secret_hash ~ '^[0-9a-f]{64}$'),
  constraint task_recipient_first_login_code_hash_check
    check (char_length(code_hash) = 64 and code_hash ~ '^[0-9a-f]{64}$'),
  constraint task_recipient_first_login_setup_hash_check
    check (
      setup_secret_hash is null
      or (char_length(setup_secret_hash) = 64 and setup_secret_hash ~ '^[0-9a-f]{64}$')
    ),
  constraint task_recipient_first_login_attempts_check
    check (
      max_attempts = 5
      and attempt_count >= 0
      and attempt_count <= max_attempts
    ),
  constraint task_recipient_first_login_expiry_check
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '15 minutes'
    ),
  constraint task_recipient_first_login_terminal_check
    check (
      consumed_at is null
      or (verified_at is not null and setup_secret_hash is not null)
    )
);

create index if not exists task_recipient_first_login_identity_created_idx
  on public.task_recipient_first_login_challenges (
    recipient_identity_id,
    created_at desc
  );

create index if not exists task_recipient_first_login_access_created_idx
  on public.task_recipient_first_login_challenges (
    access_link_id,
    created_at desc
  );

create index if not exists task_recipient_first_login_open_expiry_idx
  on public.task_recipient_first_login_challenges (expires_at)
  where consumed_at is null and revoked_at is null;

comment on table public.task_recipient_first_login_challenges is
  'Short-lived first-login challenges. Only hashes are stored; plaintext email codes and browser/setup secrets must never be persisted or logged.';

create or replace function public.begin_task_recipient_first_login(
  p_challenge_id uuid,
  p_access_link_id uuid,
  p_contact_id uuid,
  p_task_id uuid,
  p_browser_secret_hash text,
  p_code_hash text,
  p_expires_at timestamptz
)
returns table (
  challenge_id uuid,
  recipient_identity_id uuid,
  recipient_email text,
  recipient_display_name text,
  expires_at timestamptz,
  max_attempts integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  access_row public.task_access_links%rowtype;
  identity_row public.task_recipient_identities%rowtype;
  recent_access_count bigint;
  recent_identity_count bigint;
  latest_created_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_FORBIDDEN';
  end if;

  if p_challenge_id is null
    or p_access_link_id is null
    or p_contact_id is null
    or p_task_id is null
    or p_browser_secret_hash is null
    or char_length(p_browser_secret_hash) <> 64
    or p_browser_secret_hash !~ '^[0-9a-f]{64}$'
    or p_code_hash is null
    or char_length(p_code_hash) <> 64
    or p_code_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= now() + interval '5 minutes'
    or p_expires_at > now() + interval '15 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_INPUT_INVALID';
  end if;

  -- Canonical lock order: task, then the contact/identity locked by ensure,
  -- then the bearer link. Identity/activation maintenance uses the same order.
  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.assignee_contact_id = p_contact_id
    and task.archived_at is null
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_ACCESS_INVALID';
  end if;

  identity_row := public.ensure_task_recipient_identity_for_contact(p_contact_id);
  select identity.*
  into identity_row
  from public.task_recipient_identities identity
  where identity.id = identity_row.id
  for update;

  select access_link.*
  into access_row
  from public.task_access_links access_link
  join public.organization_contacts contact
    on contact.id = access_link.contact_id
   and contact.org_id = access_link.org_id
   and contact.recipient_identity_id = identity_row.id
   and contact.is_active = true
  where access_link.id = p_access_link_id
    and access_link.contact_id = p_contact_id
    and access_link.task_id = p_task_id
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
  for update of access_link;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_ACCESS_INVALID';
  end if;

  if identity_row.status = 'disabled' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_UNAVAILABLE';
  end if;
  if identity_row.auth_user_id is not null then
    raise exception using
      errcode = '23505',
      message = 'TASK_RECIPIENT_ACCOUNT_LOGIN_REQUIRED';
  end if;

  -- Opportunistic bounded retention for identities that actively use the
  -- flow. The identity/created index keeps this cleanup local and cheap.
  delete from public.task_recipient_first_login_challenges challenge
  where challenge.recipient_identity_id = identity_row.id
    and challenge.created_at < now() - interval '30 days'
    and (
      challenge.expires_at <= now()
      or challenge.consumed_at is not null
      or challenge.revoked_at is not null
    );

  if exists (
    select 1
    from public.task_recipient_first_login_challenges challenge
    where challenge.recipient_identity_id = identity_row.id
      and challenge.verified_at is not null
      and challenge.consumed_at is null
      and challenge.revoked_at is null
      and challenge.expires_at > now()
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_PENDING';
  end if;

  select
    count(*) filter (where challenge.access_link_id = p_access_link_id),
    count(*) filter (where challenge.recipient_identity_id = identity_row.id),
    max(challenge.created_at) filter (where challenge.access_link_id = p_access_link_id)
  into recent_access_count, recent_identity_count, latest_created_at
  from public.task_recipient_first_login_challenges challenge
  where challenge.created_at > now() - interval '1 hour'
    and (
      challenge.access_link_id = p_access_link_id
      or challenge.recipient_identity_id = identity_row.id
    );

  if recent_access_count >= 5
    or recent_identity_count >= 8
    or latest_created_at > now() - interval '60 seconds'
  then
    raise exception using
      errcode = 'P0001',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_RATE_LIMITED';
  end if;

  insert into public.task_recipient_first_login_challenges (
    id,
    recipient_identity_id,
    contact_id,
    task_id,
    access_link_id,
    browser_secret_hash,
    code_hash,
    expires_at
  )
  values (
    p_challenge_id,
    identity_row.id,
    p_contact_id,
    p_task_id,
    p_access_link_id,
    p_browser_secret_hash,
    p_code_hash,
    p_expires_at
  );

  update public.task_recipient_identities identity
  set
    status = case when identity.status = 'dormant' then 'invited' else identity.status end,
    invited_at = coalesce(identity.invited_at, now()),
    updated_at = now()
  where identity.id = identity_row.id
    and identity.status <> 'disabled';

  return query
  select
    p_challenge_id,
    identity_row.id,
    identity_row.email,
    coalesce(identity_row.display_name, ''),
    p_expires_at,
    5;
end;
$$;

create or replace function public.verify_task_recipient_first_login_code(
  p_challenge_id uuid,
  p_access_link_id uuid,
  p_browser_secret_hash text,
  p_code_hash text,
  p_setup_secret_hash text
)
returns table (
  outcome text,
  attempts_remaining integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  challenge_row public.task_recipient_first_login_challenges%rowtype;
  identity_id_value uuid;
  next_attempt_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_FORBIDDEN';
  end if;

  if p_challenge_id is null
    or p_access_link_id is null
    or p_browser_secret_hash is null
    or char_length(p_browser_secret_hash) <> 64
    or p_browser_secret_hash !~ '^[0-9a-f]{64}$'
    or p_code_hash is null
    or char_length(p_code_hash) <> 64
    or p_code_hash !~ '^[0-9a-f]{64}$'
    or p_setup_secret_hash is null
    or char_length(p_setup_secret_hash) <> 64
    or p_setup_secret_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_INPUT_INVALID';
  end if;

  select challenge.recipient_identity_id
  into identity_id_value
  from public.task_recipient_first_login_challenges challenge
  where challenge.id = p_challenge_id
    and challenge.access_link_id = p_access_link_id;

  if not found then
    return query select 'expired'::text, 0, now();
    return;
  end if;

  perform 1
  from public.task_recipient_identities identity
  where identity.id = identity_id_value
  for update;

  select challenge.*
  into challenge_row
  from public.task_recipient_first_login_challenges challenge
  where challenge.id = p_challenge_id
    and challenge.access_link_id = p_access_link_id
  for update;

  if not found
    or challenge_row.revoked_at is not null
    or challenge_row.consumed_at is not null
    or challenge_row.expires_at <= now()
  then
    return query select 'expired'::text, 0, coalesce(challenge_row.expires_at, now());
    return;
  end if;

  if challenge_row.verified_at is not null then
    if challenge_row.browser_secret_hash = p_browser_secret_hash
      and challenge_row.code_hash = p_code_hash
      and challenge_row.setup_secret_hash = p_setup_secret_hash
    then
      return query
      select
        'verified'::text,
        greatest(challenge_row.max_attempts - challenge_row.attempt_count, 0),
        challenge_row.expires_at;
      return;
    end if;

    return query
    select
      'locked'::text,
      0,
      challenge_row.expires_at;
    return;
  end if;

  if challenge_row.attempt_count >= challenge_row.max_attempts then
    return query
    select
      'locked'::text,
      0,
      challenge_row.expires_at;
    return;
  end if;

  if challenge_row.browser_secret_hash <> p_browser_secret_hash then
    return query
    select
      'expired'::text,
      0,
      challenge_row.expires_at;
    return;
  end if;

  next_attempt_count := challenge_row.attempt_count + 1;
  if challenge_row.code_hash <> p_code_hash then
    update public.task_recipient_first_login_challenges challenge
    set
      attempt_count = next_attempt_count,
      revoked_at = case
        when next_attempt_count >= challenge.max_attempts then now()
        else challenge.revoked_at
      end,
      updated_at = now()
    where challenge.id = challenge_row.id;

    return query
    select
      case when next_attempt_count >= challenge_row.max_attempts then 'locked' else 'invalid' end,
      greatest(challenge_row.max_attempts - next_attempt_count, 0),
      challenge_row.expires_at;
    return;
  end if;

  update public.task_recipient_first_login_challenges challenge
  set
    attempt_count = next_attempt_count,
    setup_secret_hash = p_setup_secret_hash,
    verified_at = now(),
    updated_at = now()
  where challenge.id = challenge_row.id;

  update public.task_recipient_first_login_challenges challenge
  set
    revoked_at = now(),
    updated_at = now()
  where challenge.recipient_identity_id = challenge_row.recipient_identity_id
    and challenge.id <> challenge_row.id
    and challenge.verified_at is null
    and challenge.consumed_at is null
    and challenge.revoked_at is null;

  return query
  select
    'verified'::text,
    greatest(challenge_row.max_attempts - next_attempt_count, 0),
    challenge_row.expires_at;
end;
$$;

-- Resume after a reload without sending another code. The caller must present
-- the bearer-derived access id, challenge id and the hash of the current
-- httpOnly cookie secret. No plaintext credential is returned.
create or replace function public.preview_task_recipient_first_login_status(
  p_challenge_id uuid,
  p_access_link_id uuid,
  p_cookie_secret_hash text
)
returns table (
  phase text,
  recipient_email text,
  expires_at timestamptz,
  attempts_remaining integer,
  max_attempts integer,
  resend_after_seconds integer,
  rotate_cookie_to_setup boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_FORBIDDEN';
  end if;

  if p_challenge_id is null
    or p_access_link_id is null
    or p_cookie_secret_hash is null
    or char_length(p_cookie_secret_hash) <> 64
    or p_cookie_secret_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_INPUT_INVALID';
  end if;

  return query
  select
    case
      when challenge.verified_at is null then 'code'::text
      else 'password'::text
    end,
    identity.email,
    challenge.expires_at,
    case
      when challenge.verified_at is null
        then greatest(challenge.max_attempts - challenge.attempt_count, 0)::integer
      else null::integer
    end,
    challenge.max_attempts::integer,
    case
      when challenge.verified_at is null then greatest(
        0,
        ceil(extract(epoch from (
          challenge.created_at + interval '60 seconds' - now()
        )))::integer
      )
      else null::integer
    end,
    challenge.verified_at is not null
      and challenge.browser_secret_hash = p_cookie_secret_hash
      and challenge.setup_secret_hash <> p_cookie_secret_hash
  from public.task_recipient_first_login_challenges challenge
  join public.task_recipient_identities identity
    on identity.id = challenge.recipient_identity_id
   and identity.status <> 'disabled'
   and identity.auth_user_id is null
  join public.task_access_links access_link
    on access_link.id = challenge.access_link_id
   and access_link.id = p_access_link_id
   and access_link.contact_id = challenge.contact_id
   and access_link.task_id = challenge.task_id
   and access_link.scope = 'task'
   and access_link.revoked_at is null
   and access_link.expires_at > now()
  join public.organization_contacts contact
    on contact.id = challenge.contact_id
   and contact.org_id = access_link.org_id
   and contact.recipient_identity_id = identity.id
   and contact.is_active = true
  join public.operational_tasks task
    on task.id = challenge.task_id
   and task.org_id = contact.org_id
   and task.assignee_contact_id = contact.id
   and task.archived_at is null
  where challenge.id = p_challenge_id
    and challenge.access_link_id = p_access_link_id
    and challenge.consumed_at is null
    and challenge.revoked_at is null
    and challenge.expires_at > now()
    and (
      challenge.verified_at is not null
      or challenge.attempt_count < challenge.max_attempts
    )
    and (
      (
        challenge.verified_at is null
        and challenge.browser_secret_hash = p_cookie_secret_hash
      )
      or (
        challenge.verified_at is not null
        and (
          challenge.setup_secret_hash = p_cookie_secret_hash
          or challenge.browser_secret_hash = p_cookie_secret_hash
        )
      )
    )
    and (
      access_link.role = 'assignee'
      or (
        access_link.role = 'viewer'
        and task.status in ('approved', 'cancelled')
      )
    );
end;
$$;

create or replace function public.preview_task_recipient_first_login_setup(
  p_challenge_id uuid,
  p_access_link_id uuid,
  p_setup_secret_hash text
)
returns table (
  recipient_identity_id uuid,
  recipient_email text,
  recipient_display_name text,
  contact_id uuid,
  task_id uuid,
  expires_at timestamptz,
  already_consumed boolean,
  recovery_auth_user_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_FORBIDDEN';
  end if;

  if p_challenge_id is null
    or p_access_link_id is null
    or p_setup_secret_hash is null
    or char_length(p_setup_secret_hash) <> 64
    or p_setup_secret_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_INPUT_INVALID';
  end if;

  return query
  select
    identity.id,
    identity.email,
    coalesce(identity.display_name, ''),
    challenge.contact_id,
    challenge.task_id,
    challenge.expires_at,
    challenge.consumed_at is not null,
    recovery_auth_user.id
  from public.task_recipient_first_login_challenges challenge
  join public.task_recipient_identities identity
    on identity.id = challenge.recipient_identity_id
   and identity.status <> 'disabled'
  join public.task_access_links access_link
    on access_link.id = challenge.access_link_id
   and access_link.contact_id = challenge.contact_id
   and access_link.task_id = challenge.task_id
   and access_link.scope = 'task'
   and access_link.revoked_at is null
   and access_link.expires_at > now()
  join public.organization_contacts contact
    on contact.id = challenge.contact_id
   and contact.recipient_identity_id = identity.id
   and contact.is_active = true
  join public.operational_tasks task
    on task.id = challenge.task_id
   and task.org_id = contact.org_id
   and task.assignee_contact_id = contact.id
   and task.archived_at is null
  left join lateral (
    select auth_user.id
    from auth.users auth_user
    where public.task_recipient_normalize_email(auth_user.email) = identity.email_normalized
      and auth_user.raw_app_meta_data ->> 'account_type' = 'task_recipient'
      and auth_user.raw_app_meta_data ->> 'first_login_challenge_id' = challenge.id::text
    order by auth_user.created_at desc
    limit 1
  ) recovery_auth_user on true
  where challenge.id = p_challenge_id
    and challenge.access_link_id = p_access_link_id
    and challenge.setup_secret_hash = p_setup_secret_hash
    and challenge.verified_at is not null
    and challenge.revoked_at is null
    and challenge.expires_at > now()
    and (
      access_link.role = 'assignee'
      or (
        access_link.role = 'viewer'
        and task.status in ('approved', 'cancelled')
      )
    )
    and (
      (
        challenge.consumed_at is null
        and identity.auth_user_id is null
      )
      or (
        challenge.consumed_at is not null
        and identity.auth_user_id is not null
        and identity.status = 'active'
      )
    );

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_INVALID';
  end if;
end;
$$;

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

alter table public.task_recipient_first_login_challenges enable row level security;

revoke all on table public.task_recipient_first_login_challenges
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.task_recipient_first_login_challenges
  to service_role;

revoke all on function public.begin_task_recipient_first_login(
  uuid, uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.verify_task_recipient_first_login_code(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.preview_task_recipient_first_login_status(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.preview_task_recipient_first_login_setup(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.accept_task_recipient_first_login(
  uuid, uuid, text, uuid
) from public, anon, authenticated;

grant execute on function public.begin_task_recipient_first_login(
  uuid, uuid, uuid, uuid, text, text, timestamptz
) to service_role;
grant execute on function public.verify_task_recipient_first_login_code(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.preview_task_recipient_first_login_status(
  uuid, uuid, text
) to service_role;
grant execute on function public.preview_task_recipient_first_login_setup(
  uuid, uuid, text
) to service_role;
grant execute on function public.accept_task_recipient_first_login(
  uuid, uuid, text, uuid
) to service_role;
