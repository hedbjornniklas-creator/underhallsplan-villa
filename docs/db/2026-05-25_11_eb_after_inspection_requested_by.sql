-- EB after-inspection requested by
-- Date: 2026-05-25
-- Scope:
-- 1) Store which party requested after-inspection
-- 2) Support SBR-style wording in the remedy/after-inspection agreement section

alter table public.eb_inspection_details
  add column if not exists after_inspection_requested_by text;

alter table public.eb_inspection_details
  drop constraint if exists eb_inspection_details_after_inspection_requested_by_check;

alter table public.eb_inspection_details
  add constraint eb_inspection_details_after_inspection_requested_by_check
    check (
      after_inspection_requested_by is null
      or after_inspection_requested_by in ('client', 'contractor')
    );

comment on column public.eb_inspection_details.after_inspection_requested_by is
  'Party that requested after-inspection: client/beställare or contractor/hantverkare.';
