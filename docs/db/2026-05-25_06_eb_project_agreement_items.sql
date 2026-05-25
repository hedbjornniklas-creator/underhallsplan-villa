-- EB project agreement items
-- Date: 2026-05-25
-- Scope:
-- 1) Store structured contract, ÄTA and other agreement rows for EB projects
-- 2) Support report rendering of "Avtal, handlingar och andra överenskommelser"

alter table public.eb_projects
  add column if not exists agreement_items jsonb not null default '[]'::jsonb;

comment on column public.eb_projects.agreement_items is
  'Structured EB project agreement rows shown in the statement. Each row has kind change_order/other, title, documentDate, note and includeInReport.';
