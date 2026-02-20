-- Add certification number to inspector profile (additive, safe)
-- Date: 2026-02-19

alter table public.profiles
  add column if not exists certification_number text;

