-- Fortnox customer and invoice scopes
--
-- Expands the connection scope contract without invalidating the original
-- companyinformation-only rows. Existing connections are marked for
-- reauthorization so no customer or invoice operation can mistake an old grant
-- for the current full grant.

begin;
set local lock_timeout = '10s';

alter table public.fortnox_connections
  drop constraint if exists fortnox_connections_scopes_check;

update public.fortnox_connections
set status = 'needs_reauthorization',
    last_error_code = 'FORTNOX_REQUIRED_SCOPE_MISSING',
    last_error_at = clock_timestamp(),
    connection_version = connection_version + 1
where not (
  granted_scopes @> array['companyinformation', 'customer', 'invoice']::text[]
)
and (
  status <> 'needs_reauthorization'
  or last_error_code is distinct from 'FORTNOX_REQUIRED_SCOPE_MISSING'
  or last_error_at is null
);

alter table public.fortnox_connections
  add constraint fortnox_connections_scopes_check
  check (
    array_ndims(granted_scopes) = 1
    and array_position(granted_scopes, null) is null
    and (
      (
        cardinality(granted_scopes) = 1
        and granted_scopes @> array['companyinformation']::text[]
      )
      or (
        cardinality(granted_scopes) = 3
        and granted_scopes @> array['companyinformation', 'customer', 'invoice']::text[]
      )
    )
    and (
      status = 'needs_reauthorization'
      or (
        status = 'connected'
        and cardinality(granted_scopes) = 3
        and granted_scopes @> array['companyinformation', 'customer', 'invoice']::text[]
      )
    )
  );

alter table public.fortnox_oauth_states
  drop constraint if exists fortnox_oauth_states_scopes_check;

alter table public.fortnox_oauth_states
  add constraint fortnox_oauth_states_scopes_check
  check (
    array_ndims(requested_scopes) = 1
    and array_position(requested_scopes, null) is null
    and (
      (
        cardinality(requested_scopes) = 1
        and requested_scopes @> array['companyinformation']::text[]
      )
      or (
        cardinality(requested_scopes) = 3
        and requested_scopes @> array['companyinformation', 'customer', 'invoice']::text[]
      )
    )
  );

commit;
