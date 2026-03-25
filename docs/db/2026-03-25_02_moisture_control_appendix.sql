-- Moisture control appendix (mobile step in OB flow)
-- Date: 2026-03-25
-- Additive only / rollback-safe:
--  - Adds inspection-level moisture control header + dynamic rows

create extension if not exists pgcrypto;

create table if not exists public.inspection_moisture_controls (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  building_type text,
  building_year text,
  extension_note text,
  heating text,
  ventilation text,
  object_other text,
  measurement_instrument text,
  comment text,
  place_name text,
  signed_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_moisture_controls_unique_inspection unique (inspection_id)
);

create index if not exists inspection_moisture_controls_org_idx
  on public.inspection_moisture_controls (org_id);

create table if not exists public.inspection_moisture_control_rows (
  id uuid primary key default gen_random_uuid(),
  moisture_control_id uuid not null references public.inspection_moisture_controls (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  location_label text not null,
  building_part text,
  measurement_type text not null default 'rf',
  measurement_value numeric(10,2),
  temperature_c numeric(10,2),
  note text,
  critical_level text not null default 'under',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_moisture_control_rows_location_label_check
    check (btrim(location_label) <> ''),
  constraint inspection_moisture_control_rows_measurement_type_check
    check (measurement_type in ('rf', 'fk', 'other')),
  constraint inspection_moisture_control_rows_measurement_value_check
    check (measurement_value is null or measurement_value >= 0),
  constraint inspection_moisture_control_rows_critical_level_check
    check (critical_level in ('under', 'over')),
  constraint inspection_moisture_control_rows_sort_order_check
    check (sort_order > 0)
);

create index if not exists inspection_moisture_control_rows_org_idx
  on public.inspection_moisture_control_rows (org_id);

create index if not exists inspection_moisture_control_rows_inspection_idx
  on public.inspection_moisture_control_rows (inspection_id);

create index if not exists inspection_moisture_control_rows_header_idx
  on public.inspection_moisture_control_rows (moisture_control_id, sort_order);
