-- Add-on services foundation (admin catalog + per-inspector offers + assignment snapshots)
-- Date: 2026-03-15
-- Prerequisites:
--  - 2026-02-20_01_assignments_org_foundation.sql
--  - 2026-02-20_02_assignments_core.sql

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) Global add-on catalog (managed from /admin, no pricing here)
-- ---------------------------------------------------------------------
create table if not exists public.settings_addon_services (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_addon_services_key_check
    check (btrim(key) <> '' and key ~ '^[a-z0-9_]+$'),
  constraint settings_addon_services_name_check
    check (btrim(name) <> '')
);

create unique index if not exists settings_addon_services_key_unique_idx
  on public.settings_addon_services (lower(key));

create index if not exists settings_addon_services_active_sort_idx
  on public.settings_addon_services (is_active, sort_order, name);

-- ---------------------------------------------------------------------
-- 2) Per inspector offer list + custom price (managed from /ob/settings)
-- ---------------------------------------------------------------------
create table if not exists public.profile_addon_services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  addon_service_id uuid not null references public.settings_addon_services (id) on delete cascade,
  is_enabled boolean not null default false,
  price_amount numeric(12, 2),
  currency text not null default 'SEK',
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_addon_services_price_check
    check (price_amount is null or price_amount >= 0),
  constraint profile_addon_services_currency_check
    check (char_length(currency) = 3),
  constraint profile_addon_services_unique
    unique (org_id, profile_id, addon_service_id)
);

create index if not exists profile_addon_services_org_profile_idx
  on public.profile_addon_services (org_id, profile_id);

create index if not exists profile_addon_services_enabled_idx
  on public.profile_addon_services (org_id, profile_id, is_enabled);

-- ---------------------------------------------------------------------
-- 3) Customer ordered add-ons on assignment (snapshot at order time)
-- ---------------------------------------------------------------------
create table if not exists public.assignment_addon_orders (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  addon_service_id uuid references public.settings_addon_services (id) on delete set null,
  addon_key text not null,
  addon_name_snapshot text not null,
  price_amount_snapshot numeric(12, 2) not null,
  currency_snapshot text not null default 'SEK',
  created_at timestamptz not null default now(),
  constraint assignment_addon_orders_key_check
    check (btrim(addon_key) <> ''),
  constraint assignment_addon_orders_name_check
    check (btrim(addon_name_snapshot) <> ''),
  constraint assignment_addon_orders_price_check
    check (price_amount_snapshot >= 0),
  constraint assignment_addon_orders_currency_check
    check (char_length(currency_snapshot) = 3),
  constraint assignment_addon_orders_unique_per_assignment
    unique (assignment_id, addon_key)
);

create index if not exists assignment_addon_orders_org_id_idx
  on public.assignment_addon_orders (org_id);

create index if not exists assignment_addon_orders_assignment_id_idx
  on public.assignment_addon_orders (assignment_id);

-- ---------------------------------------------------------------------
-- 4) updated_at trigger helper
-- ---------------------------------------------------------------------
create or replace function public.addon_services_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_settings_addon_services_set_updated_at on public.settings_addon_services;
create trigger trg_settings_addon_services_set_updated_at
before update on public.settings_addon_services
for each row
execute function public.addon_services_set_updated_at();

drop trigger if exists trg_profile_addon_services_set_updated_at on public.profile_addon_services;
create trigger trg_profile_addon_services_set_updated_at
before update on public.profile_addon_services
for each row
execute function public.addon_services_set_updated_at();

