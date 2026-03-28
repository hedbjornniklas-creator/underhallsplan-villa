-- RenoApp BRF completion fields
-- Date: 2026-03-28
-- Additive only / rollback-safe:
--  - Adds BRF onboarding/completion fields used when a board invite is accepted
-- Prerequisite:
--  - 2026-03-26_01_renoapp_mvp_foundation.sql
--  - 2026-03-28_01_renoapp_brf_onboarding.sql

alter table public.brf_associations
  add column if not exists property_designation text,
  add column if not exists address_line_2 text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists invoice_address text,
  add column if not exists invoice_email text,
  add column if not exists invoice_reference text,
  add column if not exists primary_contact_name text,
  add column if not exists primary_contact_email text,
  add column if not exists primary_contact_phone text,
  add column if not exists unit_count integer,
  add column if not exists technical_contact text,
  add column if not exists onboarding_comment text,
  add column if not exists onboarding_completed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'brf_associations_unit_count_check'
  ) then
    alter table public.brf_associations
      add constraint brf_associations_unit_count_check
        check (unit_count is null or unit_count > 0);
  end if;
end
$$;
