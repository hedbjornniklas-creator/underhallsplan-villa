-- EB previous inspections
-- Date: 2026-05-25
-- Scope:
-- 1) Store structured previous inspection rows for EB statements
-- 2) Support report rendering of "Tidigare besiktningar"

alter table public.eb_inspection_details
  add column if not exists previous_inspections jsonb not null default '[]'::jsonb;

comment on column public.eb_inspection_details.previous_inspections is
  'Structured previous inspection rows shown in the EB statement. Example entries: syn, pre_inspection with status and date.';
