-- EB unique report working copy
-- Date: 2026-08-13
-- Scope:
-- 1) Record when project/profile data was copied into an inspection report draft
-- 2) Keep immutable template metadata for the copied working version
-- 3) Leave existing report section structure and locked report drafts unchanged

alter table public.eb_inspection_details
  add column if not exists report_draft_initialized_at timestamptz,
  add column if not exists report_template_key text,
  add column if not exists report_template_title text,
  add column if not exists report_template_version integer;

comment on column public.eb_inspection_details.report_draft_initialized_at is
  'Timestamp when project, template and inspector data were first copied into this EB report working version.';

comment on column public.eb_inspection_details.report_template_key is
  'Template key copied when the EB working version was initialized. Informational after initialization.';

comment on column public.eb_inspection_details.report_template_title is
  'Template title copied when the EB working version was initialized. Informational after initialization.';

comment on column public.eb_inspection_details.report_template_version is
  'Template version copied when the EB working version was initialized. Informational after initialization.';

alter table public.eb_inspection_details
  drop constraint if exists eb_inspection_details_report_template_version_check;

alter table public.eb_inspection_details
  add constraint eb_inspection_details_report_template_version_check
  check (report_template_version is null or report_template_version > 0);
