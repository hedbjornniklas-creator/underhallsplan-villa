-- RenoApp case action type
-- Date: 2026-03-26
-- Additive only / rollback-safe:
--  - Adds selected action type reference on renovation cases
-- Prerequisite:
--  - 2026-03-26_01_renoapp_mvp_foundation.sql

alter table if exists public.renovation_cases
  add column if not exists action_type_id uuid references public.renovation_action_types (id) on delete set null;

create index if not exists renovation_cases_action_type_idx
  on public.renovation_cases (action_type_id);
