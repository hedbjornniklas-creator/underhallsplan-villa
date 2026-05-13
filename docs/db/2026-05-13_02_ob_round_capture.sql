-- OB round image capture foundation
-- Date: 2026-05-13
-- Scope:
-- 1) Add round-capture metadata to inspection_images
-- 2) Add internal quick notes per room/exterior component
-- 3) Keep this online-first; offline queue/storage is intentionally deferred

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Image metadata
-- ---------------------------------------------------------------------
alter table public.inspection_images
  add column if not exists capture_source text not null default 'legacy_upload',
  add column if not exists source_area text,
  add column if not exists origin_interior_room_id uuid,
  add column if not exists origin_exterior_observation_id uuid,
  add column if not exists origin_exterior_item_id uuid,
  add column if not exists origin_floor_label text,
  add column if not exists origin_room_label text,
  add column if not exists origin_room_type_key text,
  add column if not exists origin_exterior_item_key text,
  add column if not exists captured_at timestamptz not null default now(),
  add column if not exists processing_status text not null default 'unprocessed',
  add column if not exists local_capture_id text,
  add column if not exists ignored_at timestamptz,
  add column if not exists ignored_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inspection_images_capture_source_check'
  ) then
    alter table public.inspection_images
      add constraint inspection_images_capture_source_check
      check (capture_source in ('legacy_upload', 'ob_round'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inspection_images_source_area_check'
  ) then
    alter table public.inspection_images
      add constraint inspection_images_source_area_check
      check (source_area is null or source_area in ('interior', 'exterior'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inspection_images_processing_status_check'
  ) then
    alter table public.inspection_images
      add constraint inspection_images_processing_status_check
      check (processing_status in ('unprocessed', 'linked', 'ignored'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inspection_images_origin_interior_room_id_fkey'
  ) then
    alter table public.inspection_images
      add constraint inspection_images_origin_interior_room_id_fkey
      foreign key (origin_interior_room_id)
      references public.inspection_interior_rooms (id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inspection_images_origin_exterior_observation_id_fkey'
  ) then
    alter table public.inspection_images
      add constraint inspection_images_origin_exterior_observation_id_fkey
      foreign key (origin_exterior_observation_id)
      references public.inspection_exterior_observations (id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inspection_images_origin_exterior_item_id_fkey'
  ) then
    alter table public.inspection_images
      add constraint inspection_images_origin_exterior_item_id_fkey
      foreign key (origin_exterior_item_id)
      references public.settings_exterior_items (id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inspection_images_ignored_by_fkey'
  ) then
    alter table public.inspection_images
      add constraint inspection_images_ignored_by_fkey
      foreign key (ignored_by)
      references public.profiles (id)
      on delete set null;
  end if;
end;
$$;

-- Backfill only unlocked inspections. Locked inspections are protected by
-- trg_guard_locked_inspection_write and must not be mutated by migrations.
update public.inspection_images img
set processing_status = 'linked'
from public.inspections i
where i.id = img.inspection_id
  and i.locked_at is null
  and img.control_item_id is not null
  and img.processing_status = 'unprocessed';

create index if not exists inspection_images_round_capture_idx
  on public.inspection_images (inspection_id, capture_source, captured_at desc);

create index if not exists inspection_images_round_processing_idx
  on public.inspection_images (inspection_id, processing_status, captured_at desc)
  where capture_source = 'ob_round';

create unique index if not exists inspection_images_local_capture_unique_idx
  on public.inspection_images (inspection_id, local_capture_id)
  where local_capture_id is not null;

-- ---------------------------------------------------------------------
-- Internal quick notes
-- ---------------------------------------------------------------------
create or replace function public.inspection_round_quick_notes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.inspection_round_quick_notes (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  source_area text not null,
  interior_room_id uuid references public.inspection_interior_rooms (id) on delete cascade,
  exterior_observation_id uuid references public.inspection_exterior_observations (id) on delete cascade,
  exterior_item_id uuid references public.settings_exterior_items (id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_round_quick_notes_source_area_check
    check (source_area in ('interior', 'exterior')),
  constraint inspection_round_quick_notes_target_check
    check (
      (source_area = 'interior' and interior_room_id is not null and exterior_item_id is null)
      or
      (source_area = 'exterior' and exterior_item_id is not null and interior_room_id is null)
    )
);

create unique index if not exists inspection_round_quick_notes_room_unique_idx
  on public.inspection_round_quick_notes (inspection_id, interior_room_id)
  where interior_room_id is not null;

create unique index if not exists inspection_round_quick_notes_exterior_item_unique_idx
  on public.inspection_round_quick_notes (inspection_id, exterior_item_id)
  where exterior_item_id is not null;

create index if not exists inspection_round_quick_notes_inspection_idx
  on public.inspection_round_quick_notes (inspection_id, updated_at desc);

drop trigger if exists trg_inspection_round_quick_notes_set_updated_at
  on public.inspection_round_quick_notes;
create trigger trg_inspection_round_quick_notes_set_updated_at
before update on public.inspection_round_quick_notes
for each row
execute function public.inspection_round_quick_notes_set_updated_at();

drop trigger if exists trg_guard_locked_inspection_write
  on public.inspection_round_quick_notes;
create trigger trg_guard_locked_inspection_write
before insert or update or delete on public.inspection_round_quick_notes
for each row
execute function public.guard_locked_inspection_child_write();

alter table public.inspection_round_quick_notes enable row level security;

grant select, insert, update, delete on table public.inspection_round_quick_notes to authenticated;

drop policy if exists inspection_round_quick_notes_select_own
  on public.inspection_round_quick_notes;
create policy inspection_round_quick_notes_select_own
  on public.inspection_round_quick_notes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = inspection_round_quick_notes.inspection_id
        and p.owner::text = auth.uid()::text
    )
  );

drop policy if exists inspection_round_quick_notes_insert_own
  on public.inspection_round_quick_notes;
create policy inspection_round_quick_notes_insert_own
  on public.inspection_round_quick_notes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = inspection_round_quick_notes.inspection_id
        and p.owner::text = auth.uid()::text
    )
  );

drop policy if exists inspection_round_quick_notes_update_own
  on public.inspection_round_quick_notes;
create policy inspection_round_quick_notes_update_own
  on public.inspection_round_quick_notes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = inspection_round_quick_notes.inspection_id
        and p.owner::text = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = inspection_round_quick_notes.inspection_id
        and p.owner::text = auth.uid()::text
    )
  );

drop policy if exists inspection_round_quick_notes_delete_own
  on public.inspection_round_quick_notes;
create policy inspection_round_quick_notes_delete_own
  on public.inspection_round_quick_notes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.inspections i
      join public.properties p on p.id = i.property_id
      where i.id = inspection_round_quick_notes.inspection_id
        and p.owner::text = auth.uid()::text
    )
  );
