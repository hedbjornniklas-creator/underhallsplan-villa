-- RenoApp BRF terms acceptance
-- Date: 2026-04-04
-- Additive only / rollback-safe:
--  - Stores accepted BRF terms version and acceptance metadata at onboarding completion
-- Prerequisite:
--  - 2026-03-28_02_renoapp_brf_completion_fields.sql

alter table public.brf_associations
  add column if not exists onboarding_terms_version text,
  add column if not exists onboarding_terms_accepted_at timestamptz,
  add column if not exists onboarding_terms_accepted_by uuid references public.profiles (id) on delete set null;

create index if not exists brf_associations_onboarding_terms_accepted_by_idx
  on public.brf_associations (onboarding_terms_accepted_by);
