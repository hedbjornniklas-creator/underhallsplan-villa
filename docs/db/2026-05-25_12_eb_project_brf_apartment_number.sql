-- EB project BRF and apartment number
-- Date: 2026-05-25
-- Scope:
-- 1) Store BRF/lgh information separately from property designation
-- 2) Allow EB statements to render only the object identifiers that are filled in

alter table public.eb_projects
  add column if not exists brf_apartment_number text;

comment on column public.eb_projects.brf_apartment_number is
  'Optional BRF and apartment number/object identifier shown in the EB statement header when filled in.';
