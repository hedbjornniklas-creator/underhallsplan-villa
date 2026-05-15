-- EB report draft
-- Date: 2026-05-15
-- Scope:
-- 1) Store editable report draft sections for SBR-style EB statements

alter table public.eb_inspection_details
  add column if not exists report_draft jsonb not null default '{}'::jsonb,
  add column if not exists report_draft_updated_at timestamptz;

create index if not exists eb_inspection_details_report_draft_gin_idx
  on public.eb_inspection_details using gin (report_draft);
