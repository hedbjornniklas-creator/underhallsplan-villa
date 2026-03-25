-- Moisture control images per control row
-- Date: 2026-03-25
-- Additive only / rollback-safe:
--  - Adds image attachments for each moisture control row

create extension if not exists pgcrypto;

create table if not exists public.inspection_moisture_control_images (
  id uuid primary key default gen_random_uuid(),
  moisture_control_row_id uuid not null references public.inspection_moisture_control_rows (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  file_path text not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_moisture_control_images_file_path_check
    check (btrim(file_path) <> ''),
  constraint inspection_moisture_control_images_sort_order_check
    check (sort_order > 0)
);

create index if not exists inspection_moisture_control_images_org_idx
  on public.inspection_moisture_control_images (org_id);

create index if not exists inspection_moisture_control_images_inspection_idx
  on public.inspection_moisture_control_images (inspection_id);

create index if not exists inspection_moisture_control_images_row_idx
  on public.inspection_moisture_control_images (moisture_control_row_id, sort_order);

create or replace function public.inspection_moisture_control_images_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inspection_moisture_control_images_set_updated_at on public.inspection_moisture_control_images;
create trigger trg_inspection_moisture_control_images_set_updated_at
before update on public.inspection_moisture_control_images
for each row
execute function public.inspection_moisture_control_images_set_updated_at();
