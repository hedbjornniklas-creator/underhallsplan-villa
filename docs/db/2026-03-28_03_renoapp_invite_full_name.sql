-- RenoApp invite full name
-- Date: 2026-03-28
-- Additive only / rollback-safe:
--  - Adds optional full_name to BRF member invites for onboarding and invite emails
-- Prerequisite:
--  - 2026-03-28_01_renoapp_brf_onboarding.sql

alter table public.brf_member_invites
  add column if not exists full_name text;
