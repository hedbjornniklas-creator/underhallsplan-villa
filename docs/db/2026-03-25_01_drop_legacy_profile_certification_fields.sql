-- Remove legacy certification fields from profiles (hard switch)
-- Date: 2026-03-25
-- Preconditions:
--  - App uses settings_certifications + profile_certifications only
--  - Legacy fallback reads removed from runtime code paths

alter table if exists public.profiles
  drop column if exists sbr_group,
  drop column if exists sbr_status,
  drop column if exists membership_number,
  drop column if exists certification_number,
  drop column if exists is_sbr_diplomerad_areamatning;

