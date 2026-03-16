-- Inspection add-on snapshot (copy from assignment add-ons at conversion)
-- Date: 2026-03-16
-- Prerequisites:
--  - 2026-03-15_01_addon_services_foundation.sql

create extension if not exists pgcrypto;

create table if not exists public.inspection_addon_orders (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  assignment_addon_order_id uuid references public.assignment_addon_orders (id) on delete set null,
  addon_service_id uuid references public.settings_addon_services (id) on delete set null,
  addon_key text not null,
  addon_name_snapshot text not null,
  sort_order integer not null default 100,
  price_amount_snapshot numeric(12, 2) not null,
  currency_snapshot text not null default 'SEK',
  is_selected boolean not null default false,
  selected_source text not null default 'inspection',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_addon_orders_key_check
    check (btrim(addon_key) <> ''),
  constraint inspection_addon_orders_name_check
    check (btrim(addon_name_snapshot) <> ''),
  constraint inspection_addon_orders_price_check
    check (price_amount_snapshot >= 0),
  constraint inspection_addon_orders_currency_check
    check (char_length(currency_snapshot) = 3),
  constraint inspection_addon_orders_selected_source_check
    check (selected_source in ('assignment', 'inspection')),
  constraint inspection_addon_orders_unique_per_inspection
    unique (inspection_id, addon_key)
);

create index if not exists inspection_addon_orders_org_id_idx
  on public.inspection_addon_orders (org_id);

create index if not exists inspection_addon_orders_inspection_id_idx
  on public.inspection_addon_orders (inspection_id);

create index if not exists inspection_addon_orders_selected_idx
  on public.inspection_addon_orders (inspection_id, is_selected);

drop trigger if exists trg_inspection_addon_orders_set_updated_at on public.inspection_addon_orders;
create trigger trg_inspection_addon_orders_set_updated_at
before update on public.inspection_addon_orders
for each row
execute function public.addon_services_set_updated_at();
