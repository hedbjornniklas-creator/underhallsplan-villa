-- EB continued final inspection schedule
-- Date: 2026-05-25
-- Scope:
-- 1) Store agreed date and time for a new/continued final inspection
-- 2) Show the section only when a new/continued final inspection is selected

alter table public.eb_inspection_details
  add column if not exists continued_final_inspection_date date,
  add column if not exists continued_final_inspection_time time;

comment on column public.eb_inspection_details.continued_final_inspection_date is
  'Optional agreed date for continued/new final inspection shown in the EB statement.';
comment on column public.eb_inspection_details.continued_final_inspection_time is
  'Optional agreed time for continued/new final inspection shown in the EB statement.';
