-- Area measurement appendix (mobile step in OB flow)
-- Date: 2026-03-23
-- Additive only / rollback-safe:
--  - Adds profile flag for SBR area measurement diploma
--  - Adds inspection-level area measurement header + dynamic rows

create extension if not exists pgcrypto;

alter table if exists public.profiles
  add column if not exists is_sbr_diplomerad_areamatning boolean not null default false;

create table if not exists public.inspection_area_measurements (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  building_type text,
  building_year integer,
  extension_note text,
  object_other text,
  measurement_instrument text,
  comment text,
  other_notes text,
  place_name text,
  signed_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_area_measurements_unique_inspection unique (inspection_id)
);

create index if not exists inspection_area_measurements_org_idx
  on public.inspection_area_measurements (org_id);

create table if not exists public.inspection_area_measurement_rows (
  id uuid primary key default gen_random_uuid(),
  area_measurement_id uuid not null references public.inspection_area_measurements (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  floor_or_part text not null,
  boarea_m2 numeric(10,2),
  biarea_m2 numeric(10,2),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_area_measurement_rows_floor_or_part_check
    check (btrim(floor_or_part) <> ''),
  constraint inspection_area_measurement_rows_boarea_check
    check (boarea_m2 is null or boarea_m2 >= 0),
  constraint inspection_area_measurement_rows_biarea_check
    check (biarea_m2 is null or biarea_m2 >= 0),
  constraint inspection_area_measurement_rows_sort_order_check
    check (sort_order > 0)
);

create index if not exists inspection_area_measurement_rows_org_idx
  on public.inspection_area_measurement_rows (org_id);

create index if not exists inspection_area_measurement_rows_inspection_idx
  on public.inspection_area_measurement_rows (inspection_id);

create index if not exists inspection_area_measurement_rows_header_idx
  on public.inspection_area_measurement_rows (area_measurement_id, sort_order);

