-- RenoApp public apply listing
-- Date: 2026-03-28
-- Additive only / rollback-safe:
--  - Adds BRF-level setting for whether public apply should be listed openly
-- Prerequisite:
--  - 2026-03-26_01_renoapp_mvp_foundation.sql

alter table public.brf_associations
  add column if not exists is_public_apply_listed boolean not null default false;

create index if not exists brf_associations_public_apply_listing_idx
  on public.brf_associations (is_public_apply_enabled, is_public_apply_listed);
