-- Profile signature image
-- Date: 2026-05-30
-- Scope:
-- 1) Store a reusable inspector signature image on the shared profile/settings record

alter table if exists public.profiles
  add column if not exists signature_path text;

comment on column public.profiles.signature_path is
  'Public media path or URL for the inspector signature image used in reports.';
