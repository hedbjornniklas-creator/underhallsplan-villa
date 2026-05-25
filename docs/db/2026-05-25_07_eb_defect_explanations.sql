-- EB defect explanations
-- Date: 2026-05-25
-- Scope:
-- 1) Store editable "Övriga förklaringar" text for Fel och förhållanden
-- 2) Store how parts without defects should be described in the statement

alter table public.eb_inspection_details
  add column if not exists defect_numbering_explanation text,
  add column if not exists defect_no_error_parts_policy text;

alter table public.eb_inspection_details
  drop constraint if exists eb_inspection_details_defect_no_error_parts_policy_check;

alter table public.eb_inspection_details
  add constraint eb_inspection_details_defect_no_error_parts_policy_check
    check (
      defect_no_error_parts_policy is null
      or defect_no_error_parts_policy in ('not_listed', 'listed_with_dash')
    );

comment on column public.eb_inspection_details.defect_numbering_explanation is
  'Editable statement text under Fel och förhållanden / Övriga förklaringar, normally explaining numbering of windows, doors and walls.';
comment on column public.eb_inspection_details.defect_no_error_parts_policy is
  'How locations/building parts without defects are described in the statement: not_listed or listed_with_dash.';
