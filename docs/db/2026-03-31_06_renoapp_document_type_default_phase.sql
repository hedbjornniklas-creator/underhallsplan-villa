-- RenoApp document type default phase
-- Date: 2026-03-31
-- Additive only / rollback-safe:
--  - Adds default phase to underlagstyper
--  - Allows underlag to be grouped before, during or after execution
-- Prerequisite:
--  - 2026-03-30_01_renoapp_universal_apply_model.sql

alter table public.renovation_document_types
  add column if not exists default_phase text not null default 'before_required';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'renovation_document_types_default_phase_check'
  ) then
    alter table public.renovation_document_types
      drop constraint renovation_document_types_default_phase_check;
  end if;

  alter table public.renovation_document_types
    add constraint renovation_document_types_default_phase_check
    check (default_phase in ('before_required', 'during_execution', 'after_completion'));
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'renovation_action_document_requirements_phase_check'
  ) then
    alter table public.renovation_action_document_requirements
      drop constraint renovation_action_document_requirements_phase_check;
  end if;

  alter table public.renovation_action_document_requirements
    add constraint renovation_action_document_requirements_phase_check
    check (phase in ('before_required', 'before_conditional', 'during_execution', 'after_completion'));
end $$;

update public.renovation_document_types
set default_phase = 'before_required'
where default_phase not in ('before_required', 'during_execution', 'after_completion');
