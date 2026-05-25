-- EB project party addresses
-- Date: 2026-05-25
-- Scope:
-- 1) Store address lines for EB client/beställare and primary contractor/hantverkare
-- 2) Support HF 17 and ABS/entreprenad vocabulary in EB reports

alter table public.eb_projects
  add column if not exists client_address text,
  add column if not exists client_postal_code text,
  add column if not exists client_city text,
  add column if not exists contractor_address text,
  add column if not exists contractor_postal_code text,
  add column if not exists contractor_city text;

comment on column public.eb_projects.client_address is
  'Address line for the EB client/beställare/konsument shown in the statement.';
comment on column public.eb_projects.client_postal_code is
  'Postal code for the EB client/beställare/konsument shown in the statement.';
comment on column public.eb_projects.client_city is
  'City for the EB client/beställare/konsument shown in the statement.';
comment on column public.eb_projects.contractor_address is
  'Address line for the primary EB contractor/hantverkare/näringsidkare shown in the statement.';
comment on column public.eb_projects.contractor_postal_code is
  'Postal code for the primary EB contractor/hantverkare/näringsidkare shown in the statement.';
comment on column public.eb_projects.contractor_city is
  'City for the primary EB contractor/hantverkare/näringsidkare shown in the statement.';
