-- Organization-scoped HusHub customer register
-- Date: 2026-09-10
-- Scope:
-- 1) One reusable customer register per inspector organization
-- 2) Atomic, human-readable customer numbers starting at 1001 per organization
-- 3) Optional Fortnox link metadata without any provider credentials
-- 4) Server-only writes and soft deactivation
--
-- Requires 2026-09-09_05_fortnox_connection_foundation.sql for
-- public.is_valid_swedish_organization_number(text).

begin;
set local lock_timeout = '10s';

create extension if not exists pgcrypto;

create table if not exists public.organization_customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_number bigint not null,
  customer_type text not null,
  name text not null,
  organization_number text,
  personal_identity_number text,
  email text,
  phone text,
  address text,
  address_line_2 text,
  postal_code text,
  city text,
  country_code text not null default 'SE',
  invoice_same_as_customer boolean not null default true,
  invoice_name text,
  invoice_email text,
  invoice_address text,
  invoice_address_line_2 text,
  invoice_postal_code text,
  invoice_city text,
  invoice_country_code text,
  invoice_reference text,
  fortnox_tenant_id text,
  fortnox_customer_number text,
  fortnox_synced_at timestamptz,
  is_active boolean not null default true,
  version bigint not null default 1,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_customers_org_number_unique
    unique (org_id, customer_number),
  constraint organization_customers_org_id_id_unique
    unique (org_id, id),
  constraint organization_customers_number_check
    check (customer_number >= 1001),
  constraint organization_customers_type_check
    check (customer_type in ('business', 'private')),
  constraint organization_customers_name_check
    check (char_length(btrim(name)) between 1 and 200),
  constraint organization_customers_organization_number_check
    check (
      organization_number is null
      or public.is_valid_swedish_organization_number(organization_number)
    ),
  constraint organization_customers_personal_identity_number_check
    check (
      personal_identity_number is null
      or personal_identity_number ~ '^[0-9]{6}-[0-9]{4}$'
    ),
  constraint organization_customers_identity_type_check
    check (
      (customer_type = 'business' and organization_number is not null and personal_identity_number is null)
      or (customer_type = 'private' and organization_number is null)
    ),
  constraint organization_customers_email_check
    check (email is null or char_length(email) <= 254),
  constraint organization_customers_phone_check
    check (phone is null or char_length(phone) <= 50),
  constraint organization_customers_address_check
    check (address is null or char_length(address) <= 255),
  constraint organization_customers_address_line_2_check
    check (address_line_2 is null or char_length(address_line_2) <= 255),
  constraint organization_customers_postal_code_check
    check (postal_code is null or char_length(postal_code) <= 32),
  constraint organization_customers_city_check
    check (city is null or char_length(city) <= 120),
  constraint organization_customers_country_code_check
    check (country_code ~ '^[A-Z]{2}$'),
  constraint organization_customers_invoice_override_check
    check (
      (
        invoice_same_as_customer
        and invoice_name is null
        and invoice_email is null
        and invoice_address is null
        and invoice_address_line_2 is null
        and invoice_postal_code is null
        and invoice_city is null
        and invoice_country_code is null
      )
      or (
        not invoice_same_as_customer
        and invoice_name is not null
        and char_length(btrim(invoice_name)) between 1 and 200
        and invoice_country_code is not null
        and invoice_country_code ~ '^[A-Z]{2}$'
      )
    ),
  constraint organization_customers_invoice_email_check
    check (invoice_email is null or char_length(invoice_email) <= 254),
  constraint organization_customers_invoice_address_check
    check (invoice_address is null or char_length(invoice_address) <= 255),
  constraint organization_customers_invoice_address_line_2_check
    check (invoice_address_line_2 is null or char_length(invoice_address_line_2) <= 255),
  constraint organization_customers_invoice_postal_code_check
    check (invoice_postal_code is null or char_length(invoice_postal_code) <= 32),
  constraint organization_customers_invoice_city_check
    check (invoice_city is null or char_length(invoice_city) <= 120),
  constraint organization_customers_invoice_reference_check
    check (invoice_reference is null or char_length(invoice_reference) <= 120),
  constraint organization_customers_fortnox_pair_check
    check (
      (fortnox_tenant_id is null and fortnox_customer_number is null and fortnox_synced_at is null)
      or (
        fortnox_tenant_id is not null
        and fortnox_customer_number is not null
        and fortnox_synced_at is not null
        and fortnox_tenant_id ~ '^[0-9]{1,32}$'
        and char_length(btrim(fortnox_customer_number)) between 1 and 50
      )
    ),
  constraint organization_customers_version_check
    check (version > 0)
);

comment on table public.organization_customers is
  'Reusable HusHub customers owned by one inspector organization.';
comment on column public.organization_customers.customer_number is
  'Human-readable HusHub customer number, allocated independently from 1001 in every organization.';
comment on column public.organization_customers.organization_number is
  'Canonical Swedish organization number in XXXXXX-XXXX form.';
comment on column public.organization_customers.personal_identity_number is
  'Optional personal identity number in YYMMDD-XXXX form; server-only personal data.';
comment on column public.organization_customers.fortnox_customer_number is
  'Optional customer number in the Fortnox tenant recorded alongside fortnox_tenant_id.';

create unique index if not exists organization_customers_organization_number_uidx
  on public.organization_customers (org_id, organization_number)
  where organization_number is not null;

create unique index if not exists organization_customers_personal_identity_number_uidx
  on public.organization_customers (org_id, personal_identity_number)
  where personal_identity_number is not null;

create unique index if not exists organization_customers_fortnox_uidx
  on public.organization_customers (org_id, fortnox_tenant_id, fortnox_customer_number)
  where fortnox_tenant_id is not null and fortnox_customer_number is not null;

create index if not exists organization_customers_org_active_number_idx
  on public.organization_customers (org_id, is_active desc, customer_number);

create index if not exists organization_customers_org_name_idx
  on public.organization_customers (org_id, lower(name));

create table if not exists public.organization_customer_counters (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  next_customer_number bigint not null default 1001,
  updated_at timestamptz not null default now(),
  constraint organization_customer_counters_next_number_check
    check (next_customer_number >= 1001)
);

comment on table public.organization_customer_counters is
  'Private atomic counters for organization-local HusHub customer numbers.';

create or replace function public.organization_customers_prepare_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.organization_customer_counters as counter (
      org_id,
      next_customer_number,
      updated_at
    ) values (
      new.org_id,
      1002,
      now()
    )
    on conflict (org_id) do update
      set next_customer_number = counter.next_customer_number + 1,
          updated_at = now()
    returning next_customer_number - 1 into new.customer_number;

    new.version = 1;
    new.created_at = coalesce(new.created_at, now());
  else
    new.customer_number = old.customer_number;
    new.org_id = old.org_id;
    new.created_by_profile_id = old.created_by_profile_id;
    new.created_at = old.created_at;
    new.version = old.version + 1;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_organization_customers_prepare_write
  on public.organization_customers;

create trigger trg_organization_customers_prepare_write
before insert or update on public.organization_customers
for each row
execute function public.organization_customers_prepare_write();

alter table public.organization_customers enable row level security;
alter table public.organization_customer_counters enable row level security;

revoke all on table public.organization_customers from public, anon, authenticated;
revoke all on table public.organization_customer_counters from public, anon, authenticated, service_role;
grant select, insert, update on table public.organization_customers to service_role;

revoke all on function public.organization_customers_prepare_write() from public, anon, authenticated, service_role;

commit;
