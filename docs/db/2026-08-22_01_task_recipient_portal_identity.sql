-- Uppdrag recipient portal: global identities, activation and exact task grants
-- Date: 2026-08-22
-- Prerequisites:
--  - 2026-08-20_01_operational_tasks_foundation.sql
--  - 2026-08-20_02_operational_task_initial_attachments.sql
--
-- Security model:
-- 1) An organization contact keeps its existing organization-scoped profile_id
--    semantics. recipient_identity_id is a separate, global portal identity.
-- 2) Activation credentials are stored as SHA-256 hashes only and are single-use.
-- 3) A portal identity receives durable grants for exact tasks, never an
--    organization-wide or implicit branch grant.
-- 4) Portal tables have RLS enabled and no browser policies. A trusted API must
--    resolve the authenticated auth user through the service-role-only RPCs.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Canonical email helpers
-- ---------------------------------------------------------------------

create or replace function public.task_recipient_normalize_email(p_email text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select nullif(lower(btrim(p_email)), '');
$$;

create or replace function public.task_recipient_email_is_valid(p_email text)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(
    char_length(public.task_recipient_normalize_email(p_email)) between 3 and 320
    and public.task_recipient_normalize_email(p_email)
      ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$',
    false
  );
$$;

-- ---------------------------------------------------------------------
-- Global recipient identity
-- ---------------------------------------------------------------------

create table if not exists public.task_recipient_identities (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  display_name text,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  status text not null default 'dormant',
  invited_at timestamptz,
  activated_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_recipient_identities_email_normalized_unique
    unique (email_normalized),
  constraint task_recipient_identities_email_check
    check (
      public.task_recipient_email_is_valid(email)
      and email_normalized = public.task_recipient_normalize_email(email)
    ),
  constraint task_recipient_identities_display_name_check
    check (display_name is null or btrim(display_name) <> ''),
  constraint task_recipient_identities_status_check
    check (status in ('dormant', 'invited', 'active', 'disabled')),
  constraint task_recipient_identities_active_account_check
    check (status <> 'active' or auth_user_id is not null)
);

create index if not exists task_recipient_identities_status_idx
  on public.task_recipient_identities (status, updated_at desc);

create index if not exists task_recipient_identities_auth_active_idx
  on public.task_recipient_identities (auth_user_id, status)
  where auth_user_id is not null;

comment on table public.task_recipient_identities is
  'Global Uppdrag portal identities shared across organizations. Email and a future BankID identifier are login attributes, not tenant membership.';

comment on column public.task_recipient_identities.auth_user_id is
  'The Supabase Auth user bound after activation. This does not make the recipient an org_members row.';

create or replace function public.guard_task_recipient_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  new.email := btrim(new.email);
  new.email_normalized := public.task_recipient_normalize_email(new.email);

  if not public.task_recipient_email_is_valid(new.email) then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_EMAIL_INVALID';
  end if;

  -- auth.users deletion uses ON DELETE SET NULL. Do not leave an identity in
  -- an impossible active-without-account state if that happens.
  if new.auth_user_id is null and new.status = 'active' then
    new.status := 'dormant';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_task_recipient_identity
  on public.task_recipient_identities;
create trigger trg_guard_task_recipient_identity
before insert or update on public.task_recipient_identities
for each row execute function public.guard_task_recipient_identity();

-- Internal upsert used by the contact trigger and the service RPC. It binds an
-- already existing Auth account only when exactly one account has the same
-- normalized email and that account is not bound to another recipient identity.
create or replace function public.task_recipient_identity_upsert(
  p_email text,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  normalized_email_value text;
  matched_auth_user_id uuid;
  matched_auth_user_count bigint;
  result_id uuid;
begin
  normalized_email_value := public.task_recipient_normalize_email(p_email);

  if not public.task_recipient_email_is_valid(p_email) then
    return null;
  end if;

  select
    count(*),
    min(auth_user.id::text)::uuid
  into matched_auth_user_count, matched_auth_user_id
  from auth.users auth_user
  where public.task_recipient_normalize_email(auth_user.email) = normalized_email_value
    and auth_user.email_confirmed_at is not null;

  if matched_auth_user_count <> 1
    or exists (
      select 1
      from public.task_recipient_identities existing_identity
      where existing_identity.auth_user_id = matched_auth_user_id
        and existing_identity.email_normalized <> normalized_email_value
    )
  then
    matched_auth_user_id := null;
  end if;

  insert into public.task_recipient_identities as existing_identity (
    email,
    email_normalized,
    display_name,
    auth_user_id,
    status,
    activated_at
  )
  values (
    btrim(p_email),
    normalized_email_value,
    nullif(btrim(coalesce(p_display_name, '')), ''),
    matched_auth_user_id,
    case when matched_auth_user_id is null then 'dormant' else 'active' end,
    case when matched_auth_user_id is null then null else now() end
  )
  on conflict (email_normalized) do update
  set
    display_name = coalesce(
      nullif(btrim(existing_identity.display_name), ''),
      excluded.display_name
    ),
    auth_user_id = coalesce(
      existing_identity.auth_user_id,
      excluded.auth_user_id
    ),
    status = case
      when existing_identity.status = 'disabled' then 'disabled'
      when coalesce(existing_identity.auth_user_id, excluded.auth_user_id) is not null
        then 'active'
      else existing_identity.status
    end,
    activated_at = case
      when coalesce(existing_identity.auth_user_id, excluded.auth_user_id) is not null
        then coalesce(existing_identity.activated_at, now())
      else existing_identity.activated_at
    end,
    updated_at = now()
  returning existing_identity.id into result_id;

  return result_id;
end;
$$;

-- The portal identity is deliberately independent of profile_id. The latter
-- continues to mean an internal, active member of this exact organization.
alter table public.organization_contacts
  add column if not exists recipient_identity_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'organization_contacts_recipient_identity_id_fkey'
      and constraint_row.conrelid = 'public.organization_contacts'::regclass
  ) then
    alter table public.organization_contacts
      add constraint organization_contacts_recipient_identity_id_fkey
      foreign key (recipient_identity_id)
      references public.task_recipient_identities (id)
      on delete restrict;
  end if;
end
$$;

create index if not exists organization_contacts_recipient_identity_idx
  on public.organization_contacts (recipient_identity_id, org_id, is_active)
  where recipient_identity_id is not null;

comment on column public.organization_contacts.recipient_identity_id is
  'Global portal identity resolved from a valid contact email. profile_id keeps its original organization-member meaning.';

-- Safe backfill: only syntactically valid, normalized email addresses are
-- linked. Phone-only contacts and malformed legacy values remain unlinked.
with resolved_contacts as materialized (
  select
    contact.id,
    public.task_recipient_identity_upsert(
      contact.email,
      contact.name
    ) as recipient_identity_id
  from public.organization_contacts contact
  where public.task_recipient_email_is_valid(contact.email)
)
update public.organization_contacts contact
set recipient_identity_id = resolved.recipient_identity_id
from resolved_contacts resolved
where contact.id = resolved.id
  and contact.recipient_identity_id is distinct from resolved.recipient_identity_id;

update public.organization_contacts contact
set recipient_identity_id = null
where contact.recipient_identity_id is not null
  and not public.task_recipient_email_is_valid(contact.email);

create or replace function public.assign_task_recipient_identity_to_contact()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  if public.task_recipient_email_is_valid(new.email) then
    new.recipient_identity_id := public.task_recipient_identity_upsert(
      new.email,
      new.name
    );
  else
    new.recipient_identity_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assign_task_recipient_identity_to_contact
  on public.organization_contacts;
create trigger trg_assign_task_recipient_identity_to_contact
before insert or update of email, name on public.organization_contacts
for each row execute function public.assign_task_recipient_identity_to_contact();

create or replace function public.ensure_task_recipient_identity_for_contact(
  p_contact_id uuid
)
returns public.task_recipient_identities
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  contact_row public.organization_contacts%rowtype;
  identity_id_value uuid;
  result public.task_recipient_identities%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_IDENTITY_ENSURE_FORBIDDEN';
  end if;

  if p_contact_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_CONTACT_REQUIRED';
  end if;

  select contact.*
  into contact_row
  from public.organization_contacts contact
  where contact.id = p_contact_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_CONTACT_NOT_FOUND';
  end if;

  if not public.task_recipient_email_is_valid(contact_row.email) then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_EMAIL_INVALID';
  end if;

  identity_id_value := public.task_recipient_identity_upsert(
    contact_row.email,
    contact_row.name
  );

  update public.organization_contacts contact
  set recipient_identity_id = identity_id_value
  where contact.id = contact_row.id
    and contact.recipient_identity_id is distinct from identity_id_value;

  select identity.*
  into result
  from public.task_recipient_identities identity
  where identity.id = identity_id_value;

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- Durable exact-task grants
-- ---------------------------------------------------------------------

create table if not exists public.task_recipient_portal_grants (
  id uuid primary key default gen_random_uuid(),
  recipient_identity_id uuid not null
    references public.task_recipient_identities (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.organization_contacts (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  grant_role text not null default 'assignee',
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_recipient_portal_grants_exact_unique
    unique (task_id, recipient_identity_id, contact_id),
  constraint task_recipient_portal_grants_role_check
    check (grant_role = 'assignee'),
  constraint task_recipient_portal_grants_revocation_reason_check
    check (revocation_reason is null or btrim(revocation_reason) <> '')
);

create index if not exists task_recipient_portal_grants_identity_active_idx
  on public.task_recipient_portal_grants (
    recipient_identity_id,
    granted_at desc,
    task_id
  )
  where revoked_at is null;

create index if not exists task_recipient_portal_grants_contact_active_idx
  on public.task_recipient_portal_grants (contact_id, task_id)
  where revoked_at is null;

comment on table public.task_recipient_portal_grants is
  'Durable, revocable authorization for one recipient identity, one organization contact and one exact operational task. No branch inheritance.';

create or replace function public.validate_task_recipient_portal_grant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Historical revoked grants remain valid audit records after reassignment.
  if new.revoked_at is null and not exists (
    select 1
    from public.operational_tasks task
    join public.organization_contacts contact
      on contact.id = new.contact_id
     and contact.org_id = task.org_id
     and contact.is_active = true
     and contact.recipient_identity_id = new.recipient_identity_id
    join public.task_recipient_identities identity
      on identity.id = contact.recipient_identity_id
     and identity.status <> 'disabled'
    where task.id = new.task_id
      and task.org_id = new.org_id
      and task.assignee_contact_id = new.contact_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_RECIPIENT_GRANT_SCOPE_INVALID';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_task_recipient_portal_grant
  on public.task_recipient_portal_grants;
create trigger trg_validate_task_recipient_portal_grant
before insert or update on public.task_recipient_portal_grants
for each row execute function public.validate_task_recipient_portal_grant();

create or replace function public.sync_task_recipient_grant_for_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  identity_id_value uuid;
begin
  if tg_op = 'UPDATE'
    and old.assignee_contact_id is distinct from new.assignee_contact_id
  then
    update public.task_recipient_portal_grants portal_grant
    set
      revoked_at = coalesce(portal_grant.revoked_at, now()),
      revocation_reason = coalesce(
        portal_grant.revocation_reason,
        'task_reassigned'
      )
    where portal_grant.task_id = new.id
      and portal_grant.revoked_at is null;

    update public.task_access_links access_link
    set revoked_at = coalesce(access_link.revoked_at, now())
    where access_link.task_id = new.id
      and access_link.revoked_at is null;
  end if;

  if new.assignee_contact_id is null then
    return new;
  end if;

  select contact.recipient_identity_id
  into identity_id_value
  from public.organization_contacts contact
  join public.task_recipient_identities identity
    on identity.id = contact.recipient_identity_id
   and identity.status <> 'disabled'
  where contact.id = new.assignee_contact_id
    and contact.org_id = new.org_id
    and contact.is_active = true
    and contact.recipient_identity_id is not null;

  if identity_id_value is null then
    return new;
  end if;

  insert into public.task_recipient_portal_grants as existing_grant (
    recipient_identity_id,
    org_id,
    contact_id,
    task_id,
    grant_role
  )
  values (
    identity_id_value,
    new.org_id,
    new.assignee_contact_id,
    new.id,
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

  -- Revoke any stale grant that might remain from manually repaired legacy data.
  update public.task_recipient_portal_grants portal_grant
  set
    revoked_at = coalesce(portal_grant.revoked_at, now()),
    revocation_reason = coalesce(
      portal_grant.revocation_reason,
      'task_recipient_changed'
    )
  where portal_grant.task_id = new.id
    and portal_grant.revoked_at is null
    and (
      portal_grant.contact_id <> new.assignee_contact_id
      or portal_grant.recipient_identity_id <> identity_id_value
    );

  return new;
end;
$$;

drop trigger if exists trg_sync_task_recipient_grant_for_task
  on public.operational_tasks;
create trigger trg_sync_task_recipient_grant_for_task
after insert or update of assignee_contact_id on public.operational_tasks
for each row execute function public.sync_task_recipient_grant_for_task();

create or replace function public.ensure_task_recipient_portal_grant(
  p_contact_id uuid,
  p_task_id uuid
)
returns public.task_recipient_portal_grants
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  identity_row public.task_recipient_identities%rowtype;
  contact_row public.organization_contacts%rowtype;
  result public.task_recipient_portal_grants%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_GRANT_ENSURE_FORBIDDEN';
  end if;

  if p_contact_id is null or p_task_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_GRANT_INPUT_INVALID';
  end if;

  -- Keep the same task-first lock order as the write-boundary guard. The
  -- identity helper locks the contact and may update its identity link.
  perform 1
  from public.operational_tasks task
  where task.id = p_task_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_GRANT_TASK_FORBIDDEN';
  end if;

  identity_row := public.ensure_task_recipient_identity_for_contact(p_contact_id);

  select contact.*
  into contact_row
  from public.organization_contacts contact
  join public.operational_tasks task
    on task.id = p_task_id
   and task.org_id = contact.org_id
   and task.assignee_contact_id = contact.id
  where contact.id = p_contact_id
    and contact.is_active = true
    and contact.recipient_identity_id = identity_row.id
  for update of contact, task;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_GRANT_TASK_FORBIDDEN';
  end if;

  if identity_row.status = 'disabled' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_IDENTITY_DISABLED';
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
    p_task_id,
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
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.sync_task_recipient_grants_for_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and (
    old.is_active is distinct from new.is_active
    or old.recipient_identity_id is distinct from new.recipient_identity_id
  ) then
    update public.task_recipient_portal_grants portal_grant
    set
      revoked_at = coalesce(portal_grant.revoked_at, now()),
      revocation_reason = coalesce(
        portal_grant.revocation_reason,
        case
          when new.is_active = false then 'contact_disabled'
          else 'contact_identity_changed'
        end
      )
    where portal_grant.contact_id = new.id
      and portal_grant.revoked_at is null;

    update public.task_access_links access_link
    set revoked_at = coalesce(access_link.revoked_at, now())
    where access_link.contact_id = new.id
      and access_link.revoked_at is null;
  end if;

  if new.is_active = true and new.recipient_identity_id is not null then
    insert into public.task_recipient_portal_grants as existing_grant (
      recipient_identity_id,
      org_id,
      contact_id,
      task_id,
      grant_role
    )
    select
      new.recipient_identity_id,
      task.org_id,
      new.id,
      task.id,
      'assignee'
    from public.operational_tasks task
    where task.assignee_contact_id = new.id
      and task.org_id = new.org_id
      and exists (
        select 1
        from public.task_recipient_identities identity
        where identity.id = new.recipient_identity_id
          and identity.status <> 'disabled'
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
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_task_recipient_grants_for_contact
  on public.organization_contacts;
-- email must be listed explicitly: PostgreSQL UPDATE OF does not consider a
-- recipient_identity_id change made by the BEFORE email-normalization trigger.
create trigger trg_sync_task_recipient_grants_for_contact
after insert or update of email, is_active, recipient_identity_id
on public.organization_contacts
for each row execute function public.sync_task_recipient_grants_for_contact();

create or replace function public.sync_disabled_task_recipient_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'disabled' and old.status is distinct from new.status then
    update public.task_recipient_portal_grants portal_grant
    set
      revoked_at = coalesce(portal_grant.revoked_at, now()),
      revocation_reason = coalesce(
        portal_grant.revocation_reason,
        'recipient_disabled'
      )
    where portal_grant.recipient_identity_id = new.id
      and portal_grant.revoked_at is null;

    update public.task_access_links access_link
    set revoked_at = coalesce(access_link.revoked_at, now())
    from public.organization_contacts contact
    where contact.recipient_identity_id = new.id
      and access_link.contact_id = contact.id
      and access_link.revoked_at is null;
  elsif old.status = 'disabled' and new.status <> 'disabled' then
    insert into public.task_recipient_portal_grants as existing_grant (
      recipient_identity_id,
      org_id,
      contact_id,
      task_id,
      grant_role
    )
    select
      new.id,
      task.org_id,
      contact.id,
      task.id,
      'assignee'
    from public.organization_contacts contact
    join public.operational_tasks task
      on task.assignee_contact_id = contact.id
     and task.org_id = contact.org_id
    where contact.recipient_identity_id = new.id
      and contact.is_active = true
    on conflict (task_id, recipient_identity_id, contact_id) do update
    set
      revoked_at = null,
      revocation_reason = null,
      granted_at = case
        when existing_grant.revoked_at is not null then now()
        else existing_grant.granted_at
      end,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_disabled_task_recipient_identity
  on public.task_recipient_identities;
create trigger trg_sync_disabled_task_recipient_identity
after update of status on public.task_recipient_identities
for each row execute function public.sync_disabled_task_recipient_identity();

-- Durable-grant backfill for existing external assignments.
insert into public.task_recipient_portal_grants as existing_grant (
  recipient_identity_id,
  org_id,
  contact_id,
  task_id,
  grant_role
)
select
  contact.recipient_identity_id,
  task.org_id,
  contact.id,
  task.id,
  'assignee'
from public.operational_tasks task
join public.organization_contacts contact
  on contact.id = task.assignee_contact_id
 and contact.org_id = task.org_id
join public.task_recipient_identities identity
  on identity.id = contact.recipient_identity_id
 and identity.status <> 'disabled'
where contact.is_active = true
  and contact.recipient_identity_id is not null
on conflict (task_id, recipient_identity_id, contact_id) do update
set
  revoked_at = null,
  revocation_reason = null,
  updated_at = now();

-- Preserve portal actor provenance while retaining the existing external
-- actor constraints used by events, uploads, comments and workflow RPCs.
alter table public.task_access_links
  add column if not exists portal_grant_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'task_access_links_portal_grant_id_fkey'
      and constraint_row.conrelid = 'public.task_access_links'::regclass
  ) then
    alter table public.task_access_links
      add constraint task_access_links_portal_grant_id_fkey
      foreign key (portal_grant_id)
      references public.task_recipient_portal_grants (id)
      on delete set null;
  end if;
end
$$;

create index if not exists task_access_links_portal_grant_idx
  on public.task_access_links (portal_grant_id)
  where portal_grant_id is not null;

comment on column public.task_access_links.portal_grant_id is
  'Non-null only on a dedicated hash-only portal compatibility actor row; never assigned retroactively to an ordinary bearer/Signe link.';

-- A portal request resolves its actor in one transaction and writes an event
-- or attachment in a later transaction. Revalidate at the write boundary and
-- hold row locks until that write commits. The task row is locked exclusively
-- so concurrent event inserts cannot deadlock while their AFTER trigger
-- updates last_activity_at. Remaining rows use shared locks. The order is:
-- task -> contact -> identity (portal only) -> grant (portal only) -> link.
-- This serializes the insert/update against reassignment, contact/email
-- deactivation, global identity disable, grant revoke and link revoke.
create or replace function public.guard_task_recipient_access_link_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  access_link_id_value uuid;
  provided_contact_id uuid;
  initial_link_contact_id uuid;
  initial_portal_grant_id uuid;
  task_row public.operational_tasks%rowtype;
  contact_row public.organization_contacts%rowtype;
  identity_row public.task_recipient_identities%rowtype;
  grant_row public.task_recipient_portal_grants%rowtype;
  link_row public.task_access_links%rowtype;
begin
  if tg_table_name = 'task_events' then
    access_link_id_value := new.actor_access_link_id;
    provided_contact_id := new.actor_contact_id;
  elsif tg_table_name = 'task_attachments' then
    access_link_id_value := new.uploaded_by_access_link_id;
    provided_contact_id := new.uploaded_by_contact_id;
  else
    raise exception using
      errcode = '0A000',
      message = 'TASK_ACCESS_LINK_WRITE_TABLE_UNSUPPORTED';
  end if;

  -- Profile/system writes and records without an external actor retain their
  -- established semantics. Any access-link-based write is checked below;
  -- task_access_link_covers preserves legacy task/branch behavior.
  if access_link_id_value is null then
    return new;
  end if;

  if provided_contact_id is null then
    raise exception using
      errcode = '23514',
      message = 'TASK_ACCESS_LINK_WRITE_CONTACT_REQUIRED';
  end if;

  -- Unlocked discovery only determines which canonical rows to lock. Every
  -- value is read and validated again after the locks have been acquired.
  select
    access_link.contact_id,
    access_link.portal_grant_id
  into initial_link_contact_id, initial_portal_grant_id
  from public.task_access_links access_link
  where access_link.id = access_link_id_value;

  if not found or initial_link_contact_id <> provided_contact_id then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_LINK_WRITE_FORBIDDEN';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = new.task_id
  for update;

  if not found or task_row.org_id <> new.org_id then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_LINK_WRITE_FORBIDDEN';
  end if;

  select contact.*
  into contact_row
  from public.organization_contacts contact
  where contact.id = initial_link_contact_id
  for share;

  if not found
    or contact_row.org_id <> new.org_id
    or contact_row.is_active = false
  then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_LINK_WRITE_FORBIDDEN';
  end if;

  if initial_portal_grant_id is not null then
    if contact_row.recipient_identity_id is null then
      raise exception using
        errcode = '42501',
        message = 'TASK_PORTAL_WRITE_FORBIDDEN';
    end if;

    select identity.*
    into identity_row
    from public.task_recipient_identities identity
    where identity.id = contact_row.recipient_identity_id
    for share;

    if not found or identity_row.status <> 'active' then
      raise exception using
        errcode = '42501',
        message = 'TASK_PORTAL_WRITE_FORBIDDEN';
    end if;

    select portal_grant.*
    into grant_row
    from public.task_recipient_portal_grants portal_grant
    where portal_grant.id = initial_portal_grant_id
    for share;

    if not found
      or grant_row.revoked_at is not null
      or grant_row.recipient_identity_id <> identity_row.id
      or grant_row.org_id <> new.org_id
      or grant_row.contact_id <> contact_row.id
      or grant_row.task_id <> task_row.id
      or grant_row.grant_role <> 'assignee'
    then
      raise exception using
        errcode = '42501',
        message = 'TASK_PORTAL_WRITE_FORBIDDEN';
    end if;
  end if;

  select access_link.*
  into link_row
  from public.task_access_links access_link
  where access_link.id = access_link_id_value
  for share;

  if not found
    or link_row.contact_id <> contact_row.id
    or link_row.org_id <> new.org_id
    or link_row.revoked_at is not null
    or link_row.expires_at <= now()
    or link_row.portal_grant_id is distinct from initial_portal_grant_id
    or not public.task_access_link_covers(
      link_row.id,
      task_row.id,
      contact_row.id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'TASK_ACCESS_LINK_WRITE_FORBIDDEN';
  end if;

  if initial_portal_grant_id is not null and (
    task_row.archived_at is not null
    or task_row.status in ('approved', 'cancelled')
    or task_row.assignee_contact_id is distinct from contact_row.id
    or link_row.task_id <> task_row.id
    or link_row.root_task_id <> task_row.root_task_id
    or link_row.role <> 'assignee'
    or link_row.scope <> 'task'
  ) then
    raise exception using
      errcode = '42501',
      message = 'TASK_PORTAL_WRITE_FORBIDDEN';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_task_event_access_link_write
  on public.task_events;
create trigger trg_guard_task_event_access_link_write
before insert or update on public.task_events
for each row execute function public.guard_task_recipient_access_link_write();

drop trigger if exists trg_guard_task_attachment_access_link_write
  on public.task_attachments;
create trigger trg_guard_task_attachment_access_link_write
before insert or update on public.task_attachments
for each row execute function public.guard_task_recipient_access_link_write();

-- ---------------------------------------------------------------------
-- Hash-only, single-use activation tokens
-- ---------------------------------------------------------------------

create table if not exists public.task_recipient_activation_tokens (
  id uuid primary key default gen_random_uuid(),
  recipient_identity_id uuid not null
    references public.task_recipient_identities (id) on delete cascade,
  contact_id uuid not null references public.organization_contacts (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint task_recipient_activation_tokens_hash_unique
    unique (token_hash),
  constraint task_recipient_activation_tokens_hash_check
    check (char_length(token_hash) = 64 and token_hash ~ '^[0-9a-f]{64}$'),
  constraint task_recipient_activation_tokens_expiry_check
    check (expires_at > created_at),
  constraint task_recipient_activation_tokens_terminal_check
    check (not (consumed_at is not null and revoked_at is not null))
);

create index if not exists task_recipient_activation_tokens_identity_idx
  on public.task_recipient_activation_tokens (
    recipient_identity_id,
    created_at desc
  );

create index if not exists task_recipient_activation_tokens_open_contact_task_idx
  on public.task_recipient_activation_tokens (contact_id, task_id, expires_at)
  where consumed_at is null and revoked_at is null;

comment on table public.task_recipient_activation_tokens is
  'Single-use account activation credentials. Several open delivery candidates may coexist until one is accepted, which revokes all others. Only lowercase SHA-256 hashes are persisted.';

create or replace function public.validate_task_recipient_activation_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' and not exists (
    select 1
    from public.task_recipient_identities identity
    join public.organization_contacts contact
      on contact.id = new.contact_id
     and contact.recipient_identity_id = identity.id
     and contact.is_active = true
    join public.operational_tasks task
      on task.id = new.task_id
     and task.org_id = contact.org_id
     and task.assignee_contact_id = contact.id
    join public.task_recipient_portal_grants portal_grant
      on portal_grant.task_id = task.id
     and portal_grant.contact_id = contact.id
     and portal_grant.recipient_identity_id = identity.id
     and portal_grant.revoked_at is null
    where identity.id = new.recipient_identity_id
      and identity.status <> 'disabled'
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_RECIPIENT_ACTIVATION_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_task_recipient_activation_token
  on public.task_recipient_activation_tokens;
create trigger trg_validate_task_recipient_activation_token
before insert on public.task_recipient_activation_tokens
for each row execute function public.validate_task_recipient_activation_token();

create or replace function public.revoke_task_recipient_tokens_for_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and (
    old.is_active is distinct from new.is_active
    or old.recipient_identity_id is distinct from new.recipient_identity_id
  ) then
    update public.task_recipient_activation_tokens activation_token
    set revoked_at = now()
    where activation_token.contact_id = new.id
      and activation_token.consumed_at is null
      and activation_token.revoked_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_revoke_task_recipient_tokens_for_contact
  on public.organization_contacts;
-- See the grant-sync trigger above: email must be an explicit UPDATE target.
create trigger trg_revoke_task_recipient_tokens_for_contact
after update of email, is_active, recipient_identity_id
on public.organization_contacts
for each row execute function public.revoke_task_recipient_tokens_for_contact();

create or replace function public.revoke_task_recipient_tokens_for_disabled_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'disabled' and old.status is distinct from new.status then
    update public.task_recipient_activation_tokens activation_token
    set revoked_at = now()
    where activation_token.recipient_identity_id = new.id
      and activation_token.consumed_at is null
      and activation_token.revoked_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_revoke_task_recipient_tokens_for_disabled_identity
  on public.task_recipient_identities;
create trigger trg_revoke_task_recipient_tokens_for_disabled_identity
after update of status on public.task_recipient_identities
for each row execute function public.revoke_task_recipient_tokens_for_disabled_identity();

create or replace function public.revoke_task_recipient_tokens_for_reassignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if old.assignee_contact_id is distinct from new.assignee_contact_id then
    update public.task_recipient_activation_tokens activation_token
    set revoked_at = now()
    where activation_token.task_id = new.id
      and activation_token.consumed_at is null
      and activation_token.revoked_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_revoke_task_recipient_tokens_for_reassignment
  on public.operational_tasks;
create trigger trg_revoke_task_recipient_tokens_for_reassignment
after update of assignee_contact_id on public.operational_tasks
for each row execute function public.revoke_task_recipient_tokens_for_reassignment();

-- The RPC name is retained for API compatibility. Issuing a new candidate does
-- not revoke earlier open tokens: an email/provider failure must not invalidate
-- the recipient's last working link. accept_task_recipient_activation consumes
-- one token atomically and revokes every other open token for the identity.
create or replace function public.rotate_task_recipient_activation(
  p_contact_id uuid,
  p_task_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.task_recipient_activation_tokens
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  identity_row public.task_recipient_identities%rowtype;
  contact_row public.organization_contacts%rowtype;
  token_row public.task_recipient_activation_tokens%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_ROTATE_FORBIDDEN';
  end if;

  if p_contact_id is null
    or p_task_id is null
    or p_token_hash is null
    or char_length(p_token_hash) <> 64
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_ACTIVATION_INPUT_INVALID';
  end if;

  -- Canonical lock order: task before the contact/identity locked by ensure.
  perform 1
  from public.operational_tasks task
  where task.id = p_task_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_TASK_FORBIDDEN';
  end if;

  identity_row := public.ensure_task_recipient_identity_for_contact(p_contact_id);

  select contact.*
  into contact_row
  from public.organization_contacts contact
  join public.operational_tasks task
    on task.id = p_task_id
   and task.org_id = contact.org_id
   and task.assignee_contact_id = contact.id
  where contact.id = p_contact_id
    and contact.is_active = true
    and contact.recipient_identity_id = identity_row.id
    and task.archived_at is null
    and task.status not in ('approved', 'cancelled')
  for update of contact, task;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_TASK_FORBIDDEN';
  end if;

  if identity_row.status = 'disabled' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_IDENTITY_DISABLED';
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
    p_task_id,
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

  insert into public.task_recipient_activation_tokens (
    recipient_identity_id,
    contact_id,
    task_id,
    token_hash,
    expires_at
  )
  values (
    identity_row.id,
    p_contact_id,
    p_task_id,
    p_token_hash,
    p_expires_at
  )
  returning * into token_row;

  update public.task_recipient_identities identity
  set
    status = case
      when identity.status = 'dormant' then 'invited'
      else identity.status
    end,
    invited_at = coalesce(identity.invited_at, now()),
    updated_at = now()
  where identity.id = identity_row.id
    and identity.status <> 'disabled';

  return token_row;
end;
$$;

create or replace function public.preview_task_recipient_activation(
  p_token_hash text
)
returns table (
  recipient_identity_id uuid,
  email text,
  display_name text,
  identity_status text,
  task_id uuid,
  has_account boolean,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_PREVIEW_FORBIDDEN';
  end if;

  if p_token_hash is null
    or char_length(p_token_hash) <> 64
    or p_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_ACTIVATION_INVALID';
  end if;

  return query
  select
    identity.id,
    identity.email,
    identity.display_name,
    identity.status,
    activation_token.task_id,
    identity.auth_user_id is not null,
    activation_token.expires_at
  from public.task_recipient_activation_tokens activation_token
  join public.task_recipient_identities identity
    on identity.id = activation_token.recipient_identity_id
   and identity.status <> 'disabled'
  join public.organization_contacts contact
    on contact.id = activation_token.contact_id
   and contact.recipient_identity_id = identity.id
   and contact.is_active = true
  join public.operational_tasks task
    on task.id = activation_token.task_id
   and task.org_id = contact.org_id
   and task.assignee_contact_id = contact.id
  join public.task_recipient_portal_grants portal_grant
    on portal_grant.task_id = task.id
   and portal_grant.contact_id = contact.id
   and portal_grant.recipient_identity_id = identity.id
   and portal_grant.revoked_at is null
  where activation_token.token_hash = p_token_hash
    and activation_token.consumed_at is null
    and activation_token.revoked_at is null
    and activation_token.expires_at > now()
    and task.archived_at is null;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_ACTIVATION_INVALID';
  end if;
end;
$$;

create or replace function public.accept_task_recipient_activation(
  p_token_hash text,
  p_auth_user_id uuid
)
returns table (
  recipient_identity_id uuid,
  task_id uuid,
  contact_id uuid,
  identity_status text,
  already_consumed boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  token_id_value uuid;
  token_identity_id_value uuid;
  token_row public.task_recipient_activation_tokens%rowtype;
  identity_row public.task_recipient_identities%rowtype;
  auth_email_normalized text;
  auth_email_confirmed boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_ACCEPT_FORBIDDEN';
  end if;

  if p_auth_user_id is null
    or p_token_hash is null
    or char_length(p_token_hash) <> 64
    or p_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_ACTIVATION_INVALID';
  end if;

  -- Read the immutable lookup keys first, then lock the shared identity before
  -- the individual token. With parallel open tokens this common lock order
  -- prevents two simultaneous accepts from deadlocking while revoking each
  -- other's token rows.
  select
    activation_token.id,
    activation_token.recipient_identity_id
  into token_id_value, token_identity_id_value
  from public.task_recipient_activation_tokens activation_token
  where activation_token.token_hash = p_token_hash;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_ACTIVATION_INVALID';
  end if;

  select identity.*
  into identity_row
  from public.task_recipient_identities identity
  where identity.id = token_identity_id_value
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_ACTIVATION_INVALID';
  end if;

  select activation_token.*
  into token_row
  from public.task_recipient_activation_tokens activation_token
  where activation_token.id = token_id_value
    and activation_token.token_hash = p_token_hash
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_ACTIVATION_INVALID';
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

  -- Idempotent recovery: a response/network failure may make the server retry
  -- the same consumed token. It is accepted only for the already-bound user.
  if token_row.consumed_at is not null then
    if token_row.revoked_at is not null
      or identity_row.auth_user_id is distinct from p_auth_user_id
    then
      raise exception using
        errcode = 'P0002',
        message = 'TASK_RECIPIENT_ACTIVATION_INVALID';
    end if;

    return query
    select
      identity_row.id,
      token_row.task_id,
      token_row.contact_id,
      identity_row.status,
      true;
    return;
  end if;

  if token_row.revoked_at is not null
    or token_row.expires_at <= now()
    or identity_row.status = 'disabled'
  then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_RECIPIENT_ACTIVATION_INVALID';
  end if;

  if identity_row.auth_user_id is not null
    and identity_row.auth_user_id <> p_auth_user_id
  then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_IDENTITY_ALREADY_BOUND';
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

  if not exists (
    select 1
    from public.organization_contacts contact
    join public.operational_tasks task
      on task.id = token_row.task_id
     and task.org_id = contact.org_id
     and task.assignee_contact_id = contact.id
    join public.task_recipient_portal_grants portal_grant
      on portal_grant.task_id = task.id
     and portal_grant.contact_id = contact.id
     and portal_grant.recipient_identity_id = identity_row.id
     and portal_grant.revoked_at is null
    where contact.id = token_row.contact_id
      and contact.recipient_identity_id = identity_row.id
      and contact.is_active = true
      and task.archived_at is null
  ) then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_ACTIVATION_TASK_FORBIDDEN';
  end if;

  update public.task_recipient_identities identity
  set
    auth_user_id = p_auth_user_id,
    status = 'active',
    activated_at = coalesce(identity.activated_at, now()),
    last_login_at = now(),
    updated_at = now()
  where identity.id = identity_row.id
  returning identity.* into identity_row;

  update public.task_recipient_activation_tokens activation_token
  set consumed_at = now()
  where activation_token.id = token_row.id
    and activation_token.consumed_at is null
    and activation_token.revoked_at is null;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'TASK_RECIPIENT_ACTIVATION_RACE';
  end if;

  update public.task_recipient_activation_tokens activation_token
  set revoked_at = now()
  where activation_token.recipient_identity_id = identity_row.id
    and activation_token.id <> token_row.id
    and activation_token.consumed_at is null
    and activation_token.revoked_at is null;

  return query
  select
    identity_row.id,
    token_row.task_id,
    token_row.contact_id,
    identity_row.status,
    false;
end;
$$;

-- ---------------------------------------------------------------------
-- Service-only portal authorization resolution
-- ---------------------------------------------------------------------

create or replace function public.resolve_task_recipient_portal_scope(
  p_auth_user_id uuid,
  p_task_id uuid default null
)
returns table (
  grant_id uuid,
  recipient_identity_id uuid,
  org_id uuid,
  contact_id uuid,
  task_id uuid,
  grant_role text,
  granted_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  identity_id_value uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_SCOPE_RESOLVE_FORBIDDEN';
  end if;

  if p_auth_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_RECIPIENT_AUTH_USER_REQUIRED';
  end if;

  select identity.id
  into identity_id_value
  from public.task_recipient_identities identity
  join auth.users auth_user
    on auth_user.id = identity.auth_user_id
   and public.task_recipient_normalize_email(auth_user.email)
     = identity.email_normalized
   and auth_user.email_confirmed_at is not null
  where identity.auth_user_id = p_auth_user_id
    and identity.status = 'active';

  if identity_id_value is null then
    return;
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
    portal_grant.id,
    portal_grant.recipient_identity_id,
    portal_grant.org_id,
    portal_grant.contact_id,
    portal_grant.task_id,
    portal_grant.grant_role,
    portal_grant.granted_at
  from public.task_recipient_portal_grants portal_grant
  join public.organization_contacts contact
    on contact.id = portal_grant.contact_id
   and contact.org_id = portal_grant.org_id
   and contact.recipient_identity_id = portal_grant.recipient_identity_id
   and contact.is_active = true
  join public.operational_tasks task
    on task.id = portal_grant.task_id
   and task.org_id = portal_grant.org_id
   and task.assignee_contact_id = portal_grant.contact_id
  where portal_grant.recipient_identity_id = identity_id_value
    and portal_grant.revoked_at is null
    and (p_task_id is null or portal_grant.task_id = p_task_id);
end;
$$;

create or replace function public.task_recipient_portal_grant_covers(
  p_auth_user_id uuid,
  p_task_id uuid,
  p_contact_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_RECIPIENT_GRANT_CHECK_FORBIDDEN';
  end if;

  return exists (
    select 1
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
      and (p_contact_id is null or contact.id = p_contact_id)
  );
end;
$$;

-- Existing external workflow RPCs and actor constraints expect an
-- actor_access_link_id. This resolver validates the durable portal grant and
-- returns a hash-only compatibility actor row. No plaintext credential is
-- generated or returned, and the grant remains the source of authorization.
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

  -- Canonical lock order: task before identity/grant/link. This matches the
  -- write-boundary guard used when the returned actor is persisted.
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
    -- The active unique index permits one link per task/contact. Revoke any
    -- ordinary bearer/Signe link before creating a distinct portal-only actor
    -- row. Never retrofit portal provenance onto a bearer link: doing so would
    -- make its historical and future token actions indistinguishable from an
    -- authenticated portal action.
    update public.task_access_links access_link
    set revoked_at = coalesce(access_link.revoked_at, now())
    where access_link.task_id = p_task_id
      and access_link.contact_id = contact_id_value
      and access_link.revoked_at is null;

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

-- ---------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------

alter table public.task_recipient_identities enable row level security;
alter table public.task_recipient_portal_grants enable row level security;
alter table public.task_recipient_activation_tokens enable row level security;

-- No authenticated/anon policies are intentional. Portal reads and writes
-- are resolved by a trusted server after verifying the Supabase session.
revoke all on table public.task_recipient_identities
  from public, anon, authenticated;
revoke all on table public.task_recipient_portal_grants
  from public, anon, authenticated;
revoke all on table public.task_recipient_activation_tokens
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.task_recipient_identities
  to service_role;
grant select, insert, update, delete
  on table public.task_recipient_portal_grants
  to service_role;
grant select, insert, update, delete
  on table public.task_recipient_activation_tokens
  to service_role;

revoke all on function public.task_recipient_normalize_email(text)
  from public, anon, authenticated;
revoke all on function public.task_recipient_email_is_valid(text)
  from public, anon, authenticated;
revoke all on function public.guard_task_recipient_identity()
  from public, anon, authenticated;
revoke all on function public.task_recipient_identity_upsert(text, text)
  from public, anon, authenticated;
revoke all on function public.assign_task_recipient_identity_to_contact()
  from public, anon, authenticated;
revoke all on function public.validate_task_recipient_portal_grant()
  from public, anon, authenticated;
revoke all on function public.sync_task_recipient_grant_for_task()
  from public, anon, authenticated;
revoke all on function public.sync_task_recipient_grants_for_contact()
  from public, anon, authenticated;
revoke all on function public.sync_disabled_task_recipient_identity()
  from public, anon, authenticated;
revoke all on function public.guard_task_recipient_access_link_write()
  from public, anon, authenticated;
revoke all on function public.validate_task_recipient_activation_token()
  from public, anon, authenticated;
revoke all on function public.revoke_task_recipient_tokens_for_contact()
  from public, anon, authenticated;
revoke all on function public.revoke_task_recipient_tokens_for_disabled_identity()
  from public, anon, authenticated;
revoke all on function public.revoke_task_recipient_tokens_for_reassignment()
  from public, anon, authenticated;

revoke all on function public.ensure_task_recipient_identity_for_contact(uuid)
  from public, anon, authenticated;
revoke all on function public.ensure_task_recipient_portal_grant(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.rotate_task_recipient_activation(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.preview_task_recipient_activation(text)
  from public, anon, authenticated;
revoke all on function public.accept_task_recipient_activation(text, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_task_recipient_portal_scope(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.task_recipient_portal_grant_covers(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_task_recipient_portal_actor(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.ensure_task_recipient_identity_for_contact(uuid)
  to service_role;
grant execute on function public.task_recipient_normalize_email(text)
  to service_role;
grant execute on function public.task_recipient_email_is_valid(text)
  to service_role;
grant execute on function public.guard_task_recipient_access_link_write()
  to service_role;
grant execute on function public.ensure_task_recipient_portal_grant(uuid, uuid)
  to service_role;
grant execute on function public.rotate_task_recipient_activation(uuid, uuid, text, timestamptz)
  to service_role;
grant execute on function public.preview_task_recipient_activation(text)
  to service_role;
grant execute on function public.accept_task_recipient_activation(text, uuid)
  to service_role;
grant execute on function public.resolve_task_recipient_portal_scope(uuid, uuid)
  to service_role;
grant execute on function public.task_recipient_portal_grant_covers(uuid, uuid, uuid)
  to service_role;
grant execute on function public.resolve_task_recipient_portal_actor(uuid, uuid)
  to service_role;
