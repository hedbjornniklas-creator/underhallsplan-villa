-- Atomic binding of one organization customer to one verified Fortnox customer
-- Date: 2026-09-10
--
-- The provider call happens before this RPC. This function makes the local
-- binding atomic relative to organization connection changes and customer
-- edits, while keeping retries idempotent.
--
-- Requires:
-- - 2026-09-09_05_fortnox_connection_foundation.sql
-- - 2026-09-10_03_fortnox_customer_invoice_scopes.sql
-- - 2026-09-10_05_organization_customers.sql

begin;
set local lock_timeout = '10s';

create or replace function public.bind_organization_customer_to_fortnox(
  p_org_id uuid,
  p_customer_id uuid,
  p_expected_version bigint,
  p_profile_id uuid,
  p_tenant_id text,
  p_fortnox_customer_number text
)
returns table (
  result_code text,
  customer_id uuid,
  bound_org_id uuid,
  bound_tenant_id text,
  bound_fortnox_customer_number text,
  bound_at timestamptz,
  customer_version bigint,
  customer_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_connection public.fortnox_connections%rowtype;
  current_customer public.organization_customers%rowtype;
begin
  if p_org_id is null
    or p_customer_id is null
    or p_profile_id is null
    or p_expected_version is null
    or p_expected_version <= 0
    or p_tenant_id is null
    or p_tenant_id !~ '^[0-9]{1,32}$'
    or p_fortnox_customer_number is null
    or p_fortnox_customer_number <> btrim(p_fortnox_customer_number)
    or char_length(p_fortnox_customer_number) not between 1 and 50 then
    result_code := 'INVALID_REQUEST';
    return next;
    return;
  end if;

  -- Connection creation/replacement uses the same organization-row lock.
  -- This serializes the final binding against a concurrent reconnect.
  perform 1
  from public.organizations as organization
  where organization.id = p_org_id
  for update;

  if not found then
    -- Do not distinguish a missing organization from missing authorization.
    result_code := 'ADMIN_REQUIRED';
    return next;
    return;
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = p_profile_id
  for key share;

  if not found then
    result_code := 'ADMIN_REQUIRED';
    return next;
    return;
  end if;

  perform 1
  from public.org_members as member
  where member.org_id = p_org_id
    and member.profile_id = p_profile_id
    and member.role = 'admin'
    and member.is_active = true
  for key share;

  if not found then
    result_code := 'ADMIN_REQUIRED';
    return next;
    return;
  end if;

  select connection.*
  into current_connection
  from public.fortnox_connections as connection
  where connection.org_id = p_org_id
  for update;

  if not found
    or current_connection.tenant_id <> p_tenant_id
    or current_connection.status <> 'connected'
    or not (
      current_connection.granted_scopes @> array['customer']::text[]
    ) then
    result_code := 'CONNECTION_NOT_CURRENT';
    return next;
    return;
  end if;

  select customer.*
  into current_customer
  from public.organization_customers as customer
  where customer.org_id = p_org_id
    and customer.id = p_customer_id
  for update;

  if not found then
    result_code := 'CUSTOMER_NOT_FOUND';
    return next;
    return;
  end if;

  if not current_customer.is_active then
    result_code := 'CUSTOMER_INACTIVE';
    return next;
    return;
  end if;

  if current_customer.fortnox_tenant_id is not null
    or current_customer.fortnox_customer_number is not null
    or current_customer.fortnox_synced_at is not null then
    if current_customer.fortnox_tenant_id = p_tenant_id
      and current_customer.fortnox_customer_number = p_fortnox_customer_number
      and current_customer.fortnox_synced_at is not null then
      result_code := 'ALREADY_BOUND';
      customer_id := current_customer.id;
      bound_org_id := current_customer.org_id;
      bound_tenant_id := current_customer.fortnox_tenant_id;
      bound_fortnox_customer_number := current_customer.fortnox_customer_number;
      bound_at := current_customer.fortnox_synced_at;
      customer_version := current_customer.version;
      customer_updated_at := current_customer.updated_at;
      return next;
      return;
    end if;

    result_code := 'LINK_CONFLICT';
    return next;
    return;
  end if;

  if current_customer.version <> p_expected_version then
    result_code := 'VERSION_CONFLICT';
    return next;
    return;
  end if;

  -- Fail closed before the unique index can raise a provider-number detail.
  -- The organization lock serializes all normal calls to this RPC in one org.
  perform 1
  from public.organization_customers as other_customer
  where other_customer.org_id = p_org_id
    and other_customer.id <> p_customer_id
    and other_customer.fortnox_tenant_id = p_tenant_id
    and other_customer.fortnox_customer_number = p_fortnox_customer_number
  for update;

  if found then
    result_code := 'LINK_CONFLICT';
    return next;
    return;
  end if;

  update public.organization_customers as customer
  set fortnox_tenant_id = p_tenant_id,
      fortnox_customer_number = p_fortnox_customer_number,
      fortnox_synced_at = clock_timestamp(),
      updated_by_profile_id = p_profile_id
  where customer.org_id = p_org_id
    and customer.id = p_customer_id
    and customer.is_active = true
    and customer.version = p_expected_version
    and customer.fortnox_tenant_id is null
    and customer.fortnox_customer_number is null
    and customer.fortnox_synced_at is null
  returning customer.* into current_customer;

  if not found then
    -- The target row is locked, so this is a defensive fail-closed result.
    result_code := 'VERSION_CONFLICT';
    return next;
    return;
  end if;

  result_code := 'BOUND';
  customer_id := current_customer.id;
  bound_org_id := current_customer.org_id;
  bound_tenant_id := current_customer.fortnox_tenant_id;
  bound_fortnox_customer_number := current_customer.fortnox_customer_number;
  bound_at := current_customer.fortnox_synced_at;
  customer_version := current_customer.version;
  customer_updated_at := current_customer.updated_at;
  return next;
end;
$$;

comment on function public.bind_organization_customer_to_fortnox(
  uuid,
  uuid,
  bigint,
  uuid,
  text,
  text
) is
  'Atomically binds an active organization customer to the current connected Fortnox tenant after an authorized server-side provider operation.';

revoke all on function public.bind_organization_customer_to_fortnox(
  uuid,
  uuid,
  bigint,
  uuid,
  text,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.bind_organization_customer_to_fortnox(
  uuid,
  uuid,
  bigint,
  uuid,
  text,
  text
) to service_role;

commit;
