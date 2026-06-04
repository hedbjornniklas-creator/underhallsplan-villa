-- Technical investigations report section type settings
-- Date: 2026-06-04
-- Scope:
-- 1) Add an admin-managed catalog for TU report section headings/types
-- 2) Seed current TU section types so the editor dropdown can be controlled from admin

create extension if not exists pgcrypto;

create table if not exists public.settings_tu_report_section_types (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  title text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_tu_report_section_types_key_check
    check (btrim(key) <> '' and key ~ '^[a-z0-9_]+$'),
  constraint settings_tu_report_section_types_title_check
    check (btrim(title) <> '')
);

create unique index if not exists settings_tu_report_section_types_key_unique_idx
  on public.settings_tu_report_section_types (lower(key));

create unique index if not exists settings_tu_report_section_types_key_plain_unique_idx
  on public.settings_tu_report_section_types (key);

create index if not exists settings_tu_report_section_types_active_sort_idx
  on public.settings_tu_report_section_types (is_active, sort_order, title);

create or replace function public.settings_tu_report_section_types_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_settings_tu_report_section_types_set_updated_at
  on public.settings_tu_report_section_types;
create trigger trg_settings_tu_report_section_types_set_updated_at
before update on public.settings_tu_report_section_types
for each row
execute function public.settings_tu_report_section_types_set_updated_at();

grant select, insert, update, delete on table public.settings_tu_report_section_types
to authenticated;

create or replace function public.is_hushub_besiktapp_admin()
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id::text = auth.uid()::text
      and coalesce(p.is_admin, false) = true
  )
  or exists (
    select 1
    from public.platform_access_assignments paa
    join public.platform_products pp
      on pp.id = paa.product_id
     and pp.key = 'hushub_admin'
    join public.platform_modules pm
      on pm.id = paa.module_id
     and pm.key = 'besiktapp_admin'
    join public.platform_roles pr
      on pr.id = paa.role_id
     and pr.key in ('hushub_superadmin', 'product_admin')
    where paa.profile_id::text = auth.uid()::text
      and paa.is_active = true
      and (paa.expires_at is null or paa.expires_at > now())
      and paa.scope_type = 'global'
      and paa.scope_id is null
  );
$$;

grant execute on function public.is_hushub_besiktapp_admin() to authenticated;

alter table public.settings_tu_report_section_types enable row level security;

drop policy if exists settings_tu_report_section_types_admin_all
  on public.settings_tu_report_section_types;
create policy settings_tu_report_section_types_admin_all
  on public.settings_tu_report_section_types
  for all
  to authenticated
  using (public.is_hushub_besiktapp_admin())
  with check (public.is_hushub_besiktapp_admin());

insert into public.settings_tu_report_section_types (
  key,
  title,
  description,
  sort_order,
  is_active,
  is_system
)
values
  ('background_scope', 'Bakgrund', 'Bakgrund och anledning till utredningen.', 100, true, true),
  ('assignment_scope', 'Uppdragets omfattning', 'Vad uppdraget omfattar och avgränsar.', 200, true, true),
  ('construction_description', 'Beskrivning av konstruktionen', 'Beskrivning av berörd konstruktion.', 300, true, true),
  ('basis_conditions', 'Underlag och besiktningsförutsättningar', 'Underlag, handlingar och förutsättningar.', 400, true, true),
  ('observed_execution', 'Iakttagelser vid platsbesök', 'Observationer från platsbesöket.', 500, true, true),
  ('technical_assessment', 'Teknisk bedömning', 'Teknisk analys och bedömning.', 600, true, true),
  ('time_assessment', 'Tidsmässig bedömning', 'Tidsmässig bedömning av förhållanden eller skada.', 700, true, true),
  ('continued_risk', 'Bedömning av fortsatt risk', 'Bedömning av fortsatt risk eller skadeutveckling.', 800, true, true),
  ('recommended_actions', 'Rekommenderad fortsatt hantering', 'Rekommenderad fortsatt hantering eller åtgärdsinriktning.', 900, true, true),
  ('closing_comments', 'Avslutande kommentarer', 'Avslutande kommentarer och juridiskt skydd.', 1000, true, true)
on conflict (key) do update
set
  title = excluded.title,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_system = true,
  updated_at = now();
