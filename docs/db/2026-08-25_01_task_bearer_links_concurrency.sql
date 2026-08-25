-- ---------------------------------------------------------------------
-- Concurrent, hash-only bearer links for the public /signe task view
-- ---------------------------------------------------------------------
--
-- Portal actor rows and ordinary bearer links have different lifecycles:
-- portal login must be able to create its compatibility actor row without
-- revoking a link already delivered by e-mail or WhatsApp.  Keep those rows
-- distinguishable through portal_grant_id and enforce uniqueness only for a
-- live portal compatibility row.

drop index if exists public.task_access_links_active_task_contact_unique_idx;

create unique index if not exists task_access_links_active_portal_grant_unique_idx
  on public.task_access_links (portal_grant_id)
  where portal_grant_id is not null
    and revoked_at is null;

create index if not exists task_access_links_active_bearer_task_contact_idx
  on public.task_access_links (task_id, contact_id, created_at desc)
  where portal_grant_id is null
    and revoked_at is null;

comment on index public.task_access_links_active_portal_grant_unique_idx is
  'At most one live portal compatibility actor row per durable recipient grant; ordinary bearer links are intentionally not unique per task/contact.';

comment on index public.task_access_links_active_bearer_task_contact_idx is
  'Supports bounded, concurrent issuance of ordinary hash-only /signe links; at the cap the oldest sent link and six newest other links are retained.';

-- Issue a new ordinary bearer credential without rotating ordinary credentials
-- until the eight-link cap is reached. The caller generates the 256-bit plaintext token and
-- passes only its SHA-256 hash here; plaintext never enters the database.
-- At most eight active ordinary links are retained per exact task/contact
-- pair. When the bound is reached, the oldest rows are atomically revoked so
-- that the oldest still-valid *sent* link plus six newest other links remain
-- before the new link is inserted. If no sent link exists, the seven newest
-- links are retained. This keeps the first assignment e-mail and future
-- recent reminders usable while bounding the number of bearer secrets;
-- intermediate older reminder e-mails are expected to stop working.
create or replace function public.issue_task_bearer_access_link(
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
set search_path = public, pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  contact_row public.organization_contacts%rowtype;
  link_row public.task_access_links%rowtype;
  creator_name text;
  active_bearer_count integer;
  revoked_bearer_count integer := 0;
  max_active_bearer_links constant integer := 8;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_BEARER_ISSUE_FORBIDDEN';
  end if;

  if p_task_id is null
    or p_contact_id is null
    or p_created_by_profile_id is null
    or p_token_hash is null
    or char_length(p_token_hash) <> 64
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= now()
    -- Allow a small request/clock-skew margin when the caller computes a
    -- nominal 180-day expiry immediately before invoking this RPC.
    or p_expires_at > now() + interval '180 days' + interval '1 hour'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_ACCESS_BEARER_ISSUE_INPUT_INVALID';
  end if;

  -- The task lock serializes bearer issuance with portal actor resolution,
  -- reassignment and terminal/archive transitions. It also makes the count
  -- and insert below atomic for concurrent reminders.
  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.archived_at is null
    and task.status not in ('approved', 'cancelled')
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOT_FOUND';
  end if;

  select contact.*
  into contact_row
  from public.organization_contacts contact
  where contact.id = p_contact_id
    and contact.org_id = task_row.org_id
    and contact.is_active = true
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_CONTACT_NOT_FOUND';
  end if;

  if task_row.assignee_contact_id is distinct from contact_row.id then
    raise exception using
      errcode = '23514',
      message = 'TASK_ACCESS_LINK_ASSIGNEE_INVALID';
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
      message = 'TASK_ACCESS_ROTATION_CREATOR_FORBIDDEN';
  end if;

  -- Expired rows remain in the audit trail but stop participating in the
  -- active-link bound and partial indexes.
  update public.task_access_links access_link
  set revoked_at = coalesce(access_link.revoked_at, now())
  where access_link.task_id = task_row.id
    and access_link.contact_id = contact_row.id
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
    -- Keep the oldest still-valid ordinary link that was actually sent (the
    -- first assignment when available) and six newest links other than that
    -- pinned row. If no sent row exists, keep seven newest links. The task row
    -- lock above makes pruning and insert one serialized operation for a
    -- task, so concurrent reminders cannot exceed the cap.
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
    'assignee',
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
    'En personlig extern uppdragslänk skapades.',
    jsonb_build_object(
      'accessLinkId', link_row.id,
      'contactId', contact_row.id,
      'role', 'assignee',
      'scope', 'task',
      'linkKind', 'bearer',
      'expiresAt', p_expires_at,
      'revokedBearerCount', revoked_bearer_count,
      'preservesInitialBearer', exists (
        select 1
        from public.task_access_links access_link
        where access_link.task_id = task_row.id
          and access_link.contact_id = contact_row.id
          and access_link.portal_grant_id is null
          and access_link.revoked_at is null
          and access_link.expires_at > now()
          and access_link.sent_at is not null
      ),
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

comment on function public.issue_task_bearer_access_link(uuid, uuid, text, timestamptz, uuid, boolean) is
  'Service-only atomic issuance of a hash-only exact-task bearer link. Keeps the oldest sent prior link plus six newest other links (or seven newest when none was sent) and caps live ordinary links at eight per task/contact.';

revoke all on function public.issue_task_bearer_access_link(uuid, uuid, text, timestamptz, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.issue_task_bearer_access_link(uuid, uuid, text, timestamptz, uuid, boolean)
  to service_role;

-- Portal login needs a compatibility actor row for the existing external
-- write guards. It must never revoke ordinary bearer rows. The durable grant
-- row is locked before the compatibility link is inspected/inserted, while
-- the task lock is taken first to match the bearer RPC and the write-boundary
-- guard's canonical lock order.
create or replace function public.resolve_task_recipient_portal_actor(
  p_auth_user_id uuid,
  p_task_id uuid
)
returns table (
  recipient_identity_id uuid,
  org_id uuid,
  contact_id uuid,
  actor_access_link_id uuid
)
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  identity_id_value uuid;
  org_id_value uuid;
  contact_id_value uuid;
  grant_id_value uuid;
  access_link_id_value uuid;
  root_task_id_value uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTOR_RESOLVE_FORBIDDEN';
  end if;

  if p_auth_user_id is null or p_task_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_ACTOR_INPUT_INVALID';
  end if;

  perform 1
  from public.operational_tasks task
  where task.id = p_task_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTOR_FORBIDDEN';
  end if;

  select
    identity.id,
    portal_grant.org_id,
    portal_grant.contact_id,
    portal_grant.id,
    task.root_task_id
  into
    identity_id_value,
    org_id_value,
    contact_id_value,
    grant_id_value,
    root_task_id_value
  from public.task_recipient_identities identity
  join auth.users auth_user
    on auth_user.id = identity.auth_user_id
   and public.task_recipient_normalize_email(auth_user.email)
     = identity.email_normalized
   and auth_user.email_confirmed_at is not null
  join public.task_recipient_portal_grants portal_grant
    on portal_grant.recipient_identity_id = identity.id
   and portal_grant.task_id = p_task_id
   and portal_grant.revoked_at is null
  join public.organization_contacts contact
    on contact.id = portal_grant.contact_id
   and contact.org_id = portal_grant.org_id
   and contact.recipient_identity_id = identity.id
   and contact.is_active = true
  join public.operational_tasks task
    on task.id = portal_grant.task_id
   and task.org_id = portal_grant.org_id
   and task.assignee_contact_id = contact.id
  where identity.auth_user_id = p_auth_user_id
    and identity.status = 'active'
    and task.archived_at is null
    and task.status not in ('approved', 'cancelled')
  for update of portal_grant, task;

  if identity_id_value is null then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTOR_FORBIDDEN';
  end if;

  -- Expired links are already unusable and may prevent the partial unique
  -- portal-grant index from accepting a fresh compatibility row.
  update public.task_access_links access_link
  set revoked_at = coalesce(access_link.revoked_at, now())
  where access_link.task_id = p_task_id
    and access_link.contact_id = contact_id_value
    and access_link.revoked_at is null
    and access_link.expires_at <= now();

  select access_link.id
  into access_link_id_value
  from public.task_access_links access_link
  where access_link.task_id = p_task_id
    and access_link.contact_id = contact_id_value
    and access_link.portal_grant_id = grant_id_value
    and access_link.role = 'assignee'
    and access_link.scope = 'task'
    and access_link.revoked_at is null
    and access_link.expires_at > now()
    and public.task_access_link_covers(
      access_link.id,
      p_task_id,
      contact_id_value
    )
  order by access_link.created_at desc, access_link.id
  limit 1
  for update;

  if access_link_id_value is null then
    insert into public.task_access_links (
      org_id,
      task_id,
      root_task_id,
      contact_id,
      role,
      scope,
      token_hash,
      expires_at,
      portal_grant_id
    )
    values (
      org_id_value,
      p_task_id,
      root_task_id_value,
      contact_id_value,
      'assignee',
      'task',
      encode(
        digest(
          gen_random_uuid()::text
            || ':' || clock_timestamp()::text
            || ':' || grant_id_value::text,
          'sha256'
        ),
        'hex'
      ),
      now() + interval '30 days',
      grant_id_value
    )
    returning id into access_link_id_value;
  end if;

  update public.task_recipient_identities identity
  set last_login_at = now()
  where identity.id = identity_id_value
    and (
      identity.last_login_at is null
      or identity.last_login_at < now() - interval '5 minutes'
    );

  return query
  select
    identity_id_value,
    org_id_value,
    contact_id_value,
    access_link_id_value;
end;
$$;

comment on function public.resolve_task_recipient_portal_actor(uuid, uuid) is
  'Service-only portal actor resolver. Creates at most one compatibility row per grant and never revokes ordinary bearer /signe links.';

revoke all on function public.resolve_task_recipient_portal_actor(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_task_recipient_portal_actor(uuid, uuid)
  to service_role;

-- Rolling-deploy compatibility: older application instances still call the
-- historical rotate RPC. Keep its exact signature and service-only grant,
-- but make it safe by accepting only the exact assignee/task link shape and
-- delegating to the non-revoking issuer above. Branch/delegator rotation is
-- intentionally rejected until a separate bounded branch-link design exists.
create or replace function public.rotate_operational_task_access_link(
  p_task_id uuid,
  p_contact_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by_profile_id uuid,
  p_role text default 'assignee',
  p_scope text default 'branch'
)
returns public.task_access_links
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_ROTATION_FORBIDDEN';
  end if;

  if p_role is distinct from 'assignee'
    or p_scope is distinct from 'task'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_ACCESS_ROTATION_SCOPE_UNSUPPORTED';
  end if;

  return public.issue_task_bearer_access_link(
    p_task_id,
    p_contact_id,
    p_token_hash,
    p_expires_at,
    p_created_by_profile_id,
    false
  );
end;
$$;

comment on function public.rotate_operational_task_access_link(uuid, uuid, text, timestamptz, uuid, text, text) is
  'Rolling-deploy compatibility wrapper. Exact assignee/task calls delegate to issue_task_bearer_access_link; no revoke-all behavior remains.';

revoke all on function public.rotate_operational_task_access_link(uuid, uuid, text, timestamptz, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.rotate_operational_task_access_link(uuid, uuid, text, timestamptz, uuid, text, text)
  to service_role;
