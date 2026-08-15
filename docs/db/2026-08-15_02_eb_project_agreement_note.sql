-- EB project agreement note
-- Date: 2026-08-15
-- Scope: Store a general agreement comment for the EB statement.

alter table public.eb_projects
  add column if not exists agreement_note text;

comment on column public.eb_projects.agreement_note is
  'General agreement comment shown in the statement section Avtal, handlingar och andra överenskommelser.';
