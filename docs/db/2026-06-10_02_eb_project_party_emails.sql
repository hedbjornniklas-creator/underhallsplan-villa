-- EB project party email addresses
-- Date: 2026-06-10
-- Scope:
-- 1) Store email addresses for client and contractor on EB projects
-- 2) Use these addresses as defaults for report distribution lists

alter table public.eb_projects
  add column if not exists client_email text,
  add column if not exists contractor_email text;

comment on column public.eb_projects.client_email is
  'Optional client email address used as a default report recipient for EB inspections.';

comment on column public.eb_projects.contractor_email is
  'Optional contractor email address used as a default report recipient for EB inspections.';
