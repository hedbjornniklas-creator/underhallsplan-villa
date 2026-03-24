-- Certification profile model (category + required fields + per-inspector selections)
-- Date: 2026-03-24
-- Prerequisites:
--  - 2026-03-23_02_settings_certifications.sql
--  - 2026-02-20_01_assignments_org_foundation.sql

create extension if not exists pgcrypto;

alter table if exists public.settings_certifications
  add column if not exists category text not null default 'certification',
  add column if not exists requires_number boolean not null default false,
  add column if not exists requires_valid_to boolean not null default false,
  add column if not exists number_label text,
  add column if not exists valid_to_label text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'settings_certifications_category_check'
  ) then
    alter table public.settings_certifications
      add constraint settings_certifications_category_check
      check (category in ('certification', 'membership'));
  end if;
end
$$;

create table if not exists public.profile_certifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  certification_id uuid not null references public.settings_certifications (id) on delete cascade,
  is_enabled boolean not null default false,
  number_value text,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_certifications_unique
    unique (org_id, profile_id, certification_id)
);

create index if not exists profile_certifications_org_profile_idx
  on public.profile_certifications (org_id, profile_id);

create index if not exists profile_certifications_enabled_idx
  on public.profile_certifications (org_id, profile_id, is_enabled);

create or replace function public.profile_certifications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profile_certifications_set_updated_at on public.profile_certifications;
create trigger trg_profile_certifications_set_updated_at
before update on public.profile_certifications
for each row
execute function public.profile_certifications_set_updated_at();

