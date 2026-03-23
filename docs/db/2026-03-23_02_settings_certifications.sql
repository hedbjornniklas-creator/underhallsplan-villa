-- Certifications catalog foundation (admin-managed)
-- Date: 2026-03-23
-- Scope:
-- 1) settings_certifications (global catalog)
-- 2) updated_at trigger for this table

create extension if not exists pgcrypto;

create table if not exists public.settings_certifications (
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
  constraint settings_certifications_key_check
    check (btrim(key) <> '' and key ~ '^[a-z0-9_]+$'),
  constraint settings_certifications_name_check
    check (btrim(name) <> '')
);

create unique index if not exists settings_certifications_key_unique_idx
  on public.settings_certifications (lower(key));

create index if not exists settings_certifications_active_sort_idx
  on public.settings_certifications (is_active, sort_order, name);

create or replace function public.settings_certifications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_settings_certifications_set_updated_at on public.settings_certifications;
create trigger trg_settings_certifications_set_updated_at
before update on public.settings_certifications
for each row
execute function public.settings_certifications_set_updated_at();

