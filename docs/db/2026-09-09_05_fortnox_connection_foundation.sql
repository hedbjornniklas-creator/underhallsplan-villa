-- Fortnox connection foundation
-- Date: 2026-09-09
-- Scope:
-- 1) Canonical organization number on HusHub organizations
-- 2) One Fortnox service-account connection per organization and TenantId
-- 3) Short-lived, one-time OAuth state stored only as a SHA-256 hash
-- 4) Member-readable connection status and server-only mutations/state
--
-- No Fortnox access token, refresh token, authorization code or client secret
-- is persisted by this schema.

begin;
set local lock_timeout = '10s';

alter table public.organizations
  add column if not exists organization_number text;

create or replace function public.is_valid_swedish_organization_number(
  p_value text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  compact_value text;
  checksum integer := 0;
  digit integer;
  position integer;
begin
  if p_value !~ '^[0-9]{6}-[0-9]{4}$' then
    return false;
  end if;

  compact_value := replace(p_value, '-', '');
  for position in 1..10 loop
    digit := substring(compact_value from position for 1)::integer;
    if mod(position, 2) = 1 then
      digit := digit * 2;
      if digit > 9 then
        digit := digit - 9;
      end if;
    end if;
    checksum := checksum + digit;
  end loop;

  return mod(checksum, 10) = 0;
end;
$$;

alter table public.organizations
  drop constraint if exists organizations_organization_number_check;

alter table public.organizations
  add constraint organizations_organization_number_check
  check (
    organization_number is null
    or public.is_valid_swedish_organization_number(organization_number)
  );

comment on column public.organizations.organization_number is
  'Canonical Swedish organization number in the format XXXXXX-XXXX.';

-- The existing organizations policy permits legacy admins to update the table
-- directly. Keep this legal identifier server-managed so the stricter current
-- organization/module authorization cannot be bypassed through the browser.
create or replace function public.fortnox_protect_organization_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.organization_number is not null then
      raise exception 'organization_number is server-managed'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE'
      and new.organization_number is distinct from old.organization_number then
      raise exception 'organization_number is server-managed'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fortnox_protect_organization_number
  on public.organizations;

create trigger trg_fortnox_protect_organization_number
before insert or update of organization_number on public.organizations
for each row
execute function public.fortnox_protect_organization_number();

-- Redundant with the primary key for uniqueness, but required as the target
-- of the composite foreign key that locks a connection to the verified legal
-- entity. Organization numbers are deliberately not globally unique yet.
create unique index if not exists organizations_id_organization_number_uidx
  on public.organizations (id, organization_number);

create table if not exists public.fortnox_connections (
  org_id uuid primary key,
  tenant_id text not null,
  company_name text not null,
  company_organization_number text not null,
  granted_scopes text[] not null,
  status text not null default 'connected',
  connection_version bigint not null default 1,
  connected_by_profile_id uuid references public.profiles (id) on delete set null,
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fortnox_connections_tenant_id_key unique (tenant_id),
  constraint fortnox_connections_org_company_number_fkey
    foreign key (org_id, company_organization_number)
    references public.organizations (id, organization_number)
    on update restrict
    on delete cascade,
  constraint fortnox_connections_tenant_id_check
    check (tenant_id ~ '^[0-9]+$' and char_length(tenant_id) <= 32),
  constraint fortnox_connections_company_name_check
    check (char_length(btrim(company_name)) between 1 and 255),
  constraint fortnox_connections_company_org_number_check
    check (public.is_valid_swedish_organization_number(company_organization_number)),
  constraint fortnox_connections_scopes_check
    check (
      cardinality(granted_scopes) = 1
      and array_position(granted_scopes, null) is null
      and granted_scopes @> array['companyinformation']::text[]
    ),
  constraint fortnox_connections_status_check
    check (status in ('connected', 'needs_reauthorization')),
  constraint fortnox_connections_version_check
    check (connection_version > 0),
  constraint fortnox_connections_last_error_code_check
    check (
      last_error_code is null
      or (
        char_length(last_error_code) between 1 and 80
        and last_error_code ~ '^[A-Z0-9_]+$'
      )
    ),
  constraint fortnox_connections_last_error_pair_check
    check (
      (last_error_code is null and last_error_at is null)
      or (last_error_code is not null and last_error_at is not null)
    )
);

-- Keep the migration forward-safe if an earlier draft of this additive table
-- was installed before connection-version compare-and-swap was introduced.
alter table public.fortnox_connections
  add column if not exists connection_version bigint;

update public.fortnox_connections
set connection_version = 1
where connection_version is null;

alter table public.fortnox_connections
  alter column connection_version set default 1,
  alter column connection_version set not null;

alter table public.fortnox_connections
  drop constraint if exists fortnox_connections_version_check;

alter table public.fortnox_connections
  add constraint fortnox_connections_version_check
  check (connection_version > 0);

alter table public.fortnox_connections
  drop constraint if exists fortnox_connections_company_org_number_check;

alter table public.fortnox_connections
  add constraint fortnox_connections_company_org_number_check
  check (public.is_valid_swedish_organization_number(company_organization_number));

create index if not exists fortnox_connections_status_idx
  on public.fortnox_connections (status, updated_at desc);

create or replace function public.fortnox_connections_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fortnox_connections_set_updated_at
  on public.fortnox_connections;

create trigger trg_fortnox_connections_set_updated_at
before update on public.fortnox_connections
for each row
execute function public.fortnox_connections_set_updated_at();

create table if not exists public.fortnox_oauth_states (
  state_hash text primary key,
  attempt_sequence bigint generated always as identity unique,
  org_id uuid not null references public.organizations (id) on delete cascade,
  initiated_by_profile_id uuid not null references public.profiles (id) on delete cascade,
  requested_scopes text[] not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fortnox_oauth_states_hash_check
    check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint fortnox_oauth_states_scopes_check
    check (
      cardinality(requested_scopes) = 1
      and array_position(requested_scopes, null) is null
      and requested_scopes @> array['companyinformation']::text[]
    ),
  constraint fortnox_oauth_states_expiry_check
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '15 minutes'
    ),
  constraint fortnox_oauth_states_consumed_at_check
    check (consumed_at is null or consumed_at >= created_at)
);

create index if not exists fortnox_oauth_states_org_created_idx
  on public.fortnox_oauth_states (org_id, created_at desc);

create index if not exists fortnox_oauth_states_expiry_idx
  on public.fortnox_oauth_states (expires_at)
  where consumed_at is null;

create index if not exists fortnox_oauth_states_retention_idx
  on public.fortnox_oauth_states (expires_at);

create unique index if not exists fortnox_oauth_states_one_pending_per_org_uidx
  on public.fortnox_oauth_states (org_id)
  where consumed_at is null;

create or replace function public.create_fortnox_oauth_state(
  p_state_hash text,
  p_org_id uuid,
  p_profile_id uuid,
  p_requested_scopes text[],
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- These rows contain no raw state or token, but old profile-/organization-bound
  -- hashes are still minimized opportunistically whenever a new flow starts.
  delete from public.fortnox_oauth_states as expired_state
  where expired_state.expires_at < clock_timestamp() - interval '24 hours';

  -- Serializes starts for the same organization. A later start permanently
  -- supersedes every earlier pending attempt for that organization.
  perform 1
  from public.organizations as organization
  where organization.id = p_org_id
  for update;

  update public.fortnox_oauth_states as oauth_state
  set consumed_at = clock_timestamp()
  where oauth_state.org_id = p_org_id
    and oauth_state.consumed_at is null;

  insert into public.fortnox_oauth_states (
    state_hash,
    org_id,
    initiated_by_profile_id,
    requested_scopes,
    expires_at
  )
  values (
    p_state_hash,
    p_org_id,
    p_profile_id,
    p_requested_scopes,
    p_expires_at
  );
end;
$$;

create or replace function public.consume_fortnox_oauth_state(
  p_state_hash text,
  p_profile_id uuid
)
returns table (
  org_id uuid,
  requested_scopes text[]
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_state_hash is null
    or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_profile_id is null then
    return;
  end if;

  return query
  update public.fortnox_oauth_states as oauth_state
  set consumed_at = clock_timestamp()
  where oauth_state.state_hash = p_state_hash
    and oauth_state.initiated_by_profile_id = p_profile_id
    and oauth_state.consumed_at is null
    and oauth_state.expires_at > clock_timestamp()
  returning oauth_state.org_id, oauth_state.requested_scopes;
end;
$$;

create or replace function public.save_fortnox_connection_from_oauth_state(
  p_state_hash text,
  p_profile_id uuid,
  p_tenant_id text,
  p_company_name text,
  p_company_organization_number text,
  p_granted_scopes text[],
  p_verified_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  consumed_state public.fortnox_oauth_states%rowtype;
begin
  select oauth_state.*
  into consumed_state
  from public.fortnox_oauth_states as oauth_state
  where oauth_state.state_hash = p_state_hash
    and oauth_state.initiated_by_profile_id = p_profile_id
    and oauth_state.consumed_at is not null;

  if not found then
    return false;
  end if;

  -- Uses the same organization row lock as create_fortnox_oauth_state so a
  -- connection can only be committed by the newest attempt known at commit.
  perform 1
  from public.organizations as organization
  where organization.id = consumed_state.org_id
  for update;

  if not found then
    return false;
  end if;

  if exists (
    select 1
    from public.fortnox_oauth_states as newer_state
    where newer_state.org_id = consumed_state.org_id
      and newer_state.attempt_sequence > consumed_state.attempt_sequence
  ) then
    return false;
  end if;

  insert into public.fortnox_connections (
    org_id,
    tenant_id,
    company_name,
    company_organization_number,
    granted_scopes,
    status,
    connected_by_profile_id,
    connected_at,
    last_verified_at,
    last_error_code,
    last_error_at
  )
  values (
    consumed_state.org_id,
    p_tenant_id,
    p_company_name,
    p_company_organization_number,
    p_granted_scopes,
    'connected',
    p_profile_id,
    p_verified_at,
    p_verified_at,
    null,
    null
  )
  on conflict (org_id) do update
  set tenant_id = excluded.tenant_id,
      company_name = excluded.company_name,
      company_organization_number = excluded.company_organization_number,
      granted_scopes = excluded.granted_scopes,
      status = excluded.status,
      connected_by_profile_id = excluded.connected_by_profile_id,
      connected_at = excluded.connected_at,
      last_verified_at = excluded.last_verified_at,
      last_error_code = null,
      last_error_at = null,
      connection_version = fortnox_connections.connection_version + 1;

  return true;
end;
$$;

create or replace function public.apply_fortnox_connection_verification(
  p_org_id uuid,
  p_tenant_id text,
  p_expected_version bigint,
  p_company_name text,
  p_granted_scopes text[],
  p_error_code text
)
returns table (
  company_name text,
  company_organization_number text,
  granted_scopes text[],
  status text,
  connected_at timestamptz,
  last_verified_at timestamptz,
  connection_version bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_error_code is null then
    if p_company_name is null or p_granted_scopes is null then
      return;
    end if;

    return query
    update public.fortnox_connections as connection
    set company_name = p_company_name,
        granted_scopes = p_granted_scopes,
        status = 'connected',
        last_verified_at = clock_timestamp(),
        last_error_code = null,
        last_error_at = null,
        connection_version = connection.connection_version + 1
    where connection.org_id = p_org_id
      and connection.tenant_id = p_tenant_id
      and connection.connection_version = p_expected_version
    returning
      connection.company_name,
      connection.company_organization_number,
      connection.granted_scopes,
      connection.status,
      connection.connected_at,
      connection.last_verified_at,
      connection.connection_version;

    return;
  end if;

  if p_error_code <> all (array[
    'FORTNOX_ACCESS_TOKEN_REJECTED',
    'FORTNOX_CLIENT_CREDENTIALS_REJECTED',
    'FORTNOX_COMPANY_VERIFICATION_FAILED',
    'FORTNOX_INVALID_TENANT',
    'FORTNOX_ORGANIZATION_MISMATCH',
    'FORTNOX_PERMISSION_OR_LICENSE_MISSING',
    'FORTNOX_REQUIRED_SCOPE_MISSING'
  ]::text[]) then
    return;
  end if;

  return query
  update public.fortnox_connections as connection
  set status = 'needs_reauthorization',
      last_error_code = p_error_code,
      last_error_at = clock_timestamp(),
      connection_version = connection.connection_version + 1
  where connection.org_id = p_org_id
    and connection.tenant_id = p_tenant_id
    and connection.connection_version = p_expected_version
  returning
    connection.company_name,
    connection.company_organization_number,
    connection.granted_scopes,
    connection.status,
    connection.connected_at,
    connection.last_verified_at,
    connection.connection_version;
end;
$$;

alter table public.fortnox_connections enable row level security;
alter table public.fortnox_oauth_states enable row level security;

revoke all on table public.fortnox_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.fortnox_connections to service_role;

drop policy if exists fortnox_connections_select_member
  on public.fortnox_connections;

-- Deliberately no browser policy. The authenticated status endpoint projects
-- only safe fields after checking the current profile's active memberships;
-- direct table SELECT would otherwise expose TenantId and internal metadata.

revoke all on table public.fortnox_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on table public.fortnox_oauth_states to service_role;

-- OAuth state is server-private, while all connection mutations are also
-- performed by authorized server code.
revoke all on function public.consume_fortnox_oauth_state(text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_fortnox_oauth_state(text, uuid)
  to service_role;

revoke all on function public.create_fortnox_oauth_state(text, uuid, uuid, text[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_fortnox_oauth_state(text, uuid, uuid, text[], timestamptz)
  to service_role;

revoke all on function public.save_fortnox_connection_from_oauth_state(
  text,
  uuid,
  text,
  text,
  text,
  text[],
  timestamptz
) from public, anon, authenticated;
grant execute on function public.save_fortnox_connection_from_oauth_state(
  text,
  uuid,
  text,
  text,
  text,
  text[],
  timestamptz
) to service_role;

revoke all on function public.apply_fortnox_connection_verification(
  uuid,
  text,
  bigint,
  text,
  text[],
  text
) from public, anon, authenticated;
grant execute on function public.apply_fortnox_connection_verification(
  uuid,
  text,
  bigint,
  text,
  text[],
  text
) to service_role;

revoke all on function public.fortnox_connections_set_updated_at()
  from public, anon, authenticated;

revoke all on function public.fortnox_protect_organization_number()
  from public, anon, authenticated;

commit;
