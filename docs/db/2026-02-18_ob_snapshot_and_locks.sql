-- OB snapshot + locking foundation (additive, safe)
-- Date: 2026-02-18
-- Scope:
-- 1) Add lock fields on inspections
-- 2) Create self-contained OB property snapshot table
-- 3) Add indexes + RLS policies for owner-scoped access

-- ---------------------------------------------------------------------
-- 1) Inspection lock fields
-- ---------------------------------------------------------------------
alter table public.inspections
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid;

create index if not exists inspections_locked_at_idx
  on public.inspections (locked_at);

create index if not exists inspections_locked_by_idx
  on public.inspections (locked_by);

-- ---------------------------------------------------------------------
-- 2) OB snapshot table (1:1 with inspection)
-- ---------------------------------------------------------------------
create table if not exists public.ob_property_snapshot (
  inspection_id uuid primary key
    references public.inspections (id)
    on delete cascade,

  -- Traceability to source property (no live dependency)
  source_property_id uuid
    references public.properties (id)
    on delete set null,
  source_property_owner uuid,
  source_property_created_at timestamptz,

  imported_at timestamptz not null default now(),
  snapshot_version integer not null default 1,

  -- Property data snapshot
  name text,
  address text,
  postal_code text,
  city text,
  municipality text,
  cadastral_id text,

  owner_name text,
  client_name text,
  contact_person text,

  tenure_type text,
  dwelling_type text,
  property_type text,

  plot_area_m2 numeric,
  area_m2 numeric,
  area_sqm numeric,

  tax_value numeric,
  planning_status text,
  type_code text,

  heating text,
  ventilation text,
  roof_type text,
  year_built integer,

  cover_path text,
  status text,
  last_inspected text,
  last_inspection_at text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ob_property_snapshot_snapshot_version_check
    check (snapshot_version > 0)
);

create index if not exists ob_property_snapshot_source_property_id_idx
  on public.ob_property_snapshot (source_property_id);

create index if not exists ob_property_snapshot_imported_at_idx
  on public.ob_property_snapshot (imported_at desc);

create index if not exists ob_property_snapshot_updated_at_idx
  on public.ob_property_snapshot (updated_at desc);

-- Keep updated_at current on row updates
create or replace function public.ob_property_snapshot_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ob_property_snapshot_set_updated_at on public.ob_property_snapshot;

create trigger trg_ob_property_snapshot_set_updated_at
before update on public.ob_property_snapshot
for each row
execute function public.ob_property_snapshot_set_updated_at();

-- ---------------------------------------------------------------------
-- 3) Access control (owner-scoped via inspections -> properties.owner)
-- ---------------------------------------------------------------------
alter table public.ob_property_snapshot enable row level security;

grant select, insert, update, delete on table public.ob_property_snapshot to authenticated;

drop policy if exists ob_property_snapshot_select_own on public.ob_property_snapshot;
create policy ob_property_snapshot_select_own
  on public.ob_property_snapshot
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = ob_property_snapshot.inspection_id
        and p.owner::text = auth.uid()::text
    )
  );

drop policy if exists ob_property_snapshot_insert_own on public.ob_property_snapshot;
create policy ob_property_snapshot_insert_own
  on public.ob_property_snapshot
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = ob_property_snapshot.inspection_id
        and p.owner::text = auth.uid()::text
    )
  );

drop policy if exists ob_property_snapshot_update_own on public.ob_property_snapshot;
create policy ob_property_snapshot_update_own
  on public.ob_property_snapshot
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = ob_property_snapshot.inspection_id
        and p.owner::text = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = ob_property_snapshot.inspection_id
        and p.owner::text = auth.uid()::text
    )
  );

drop policy if exists ob_property_snapshot_delete_own on public.ob_property_snapshot;
create policy ob_property_snapshot_delete_own
  on public.ob_property_snapshot
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = ob_property_snapshot.inspection_id
        and p.owner::text = auth.uid()::text
    )
  );
