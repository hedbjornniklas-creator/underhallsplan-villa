-- EB structured report fields
-- Date: 2026-05-17
-- Scope:
-- 1) Add structured EB fields needed for SBR-style statement flow
-- 2) Separate invited, attended and report recipient participant flags
-- 3) Add report attachment metadata and note-level investigation/deduction support

alter table public.eb_inspection_details
  add column if not exists inspector_appointed_by text,
  add column if not exists invitation_method text,
  add column if not exists invitation_date date,
  add column if not exists approval_status text,
  add column if not exists approval_note text,
  add column if not exists requires_continued_final_inspection boolean,
  add column if not exists warranty_period_years integer,
  add column if not exists warranty_end_date date,
  add column if not exists default_remedy_deadline date,
  add column if not exists after_inspection_requested boolean,
  add column if not exists after_inspection_due_date date,
  add column if not exists after_inspection_notice_in_report boolean not null default false,
  add column if not exists report_distribution_date date;

alter table public.eb_inspection_details
  drop constraint if exists eb_inspection_details_inspector_appointed_by_check,
  drop constraint if exists eb_inspection_details_approval_status_check,
  drop constraint if exists eb_inspection_details_warranty_period_years_check;

alter table public.eb_inspection_details
  add constraint eb_inspection_details_inspector_appointed_by_check
    check (inspector_appointed_by is null or inspector_appointed_by in ('client', 'parties_jointly', 'contractor')),
  add constraint eb_inspection_details_approval_status_check
    check (approval_status is null or approval_status in ('approved', 'not_approved', 'partly_approved')),
  add constraint eb_inspection_details_warranty_period_years_check
    check (warranty_period_years is null or warranty_period_years between 1 and 10);

comment on column public.eb_inspection_details.inspector_appointed_by is
  'Who appointed the inspector: client, parties_jointly, or contractor. Controls whether conflict-of-interest text is relevant.';
comment on column public.eb_inspection_details.invitation_method is
  'Editable method for how summons/invitation was sent or performed.';
comment on column public.eb_inspection_details.invitation_date is
  'Editable summons/invitation date shown in the report, separate from technical sent timestamp.';
comment on column public.eb_inspection_details.approval_status is
  'Final inspection decision: approved, not_approved, or partly_approved.';
comment on column public.eb_inspection_details.after_inspection_notice_in_report is
  'Whether the statement should include the standard text that the report serves as summons to after-inspection.';

alter table public.eb_participants
  add column if not exists attended boolean not null default false,
  add column if not exists receives_report boolean not null default true,
  add column if not exists represents_party_key text,
  add column if not exists can_represent_party boolean not null default false;

alter table public.eb_participants
  drop constraint if exists eb_participants_represents_party_key_check;

alter table public.eb_participants
  add constraint eb_participants_represents_party_key_check
    check (represents_party_key is null or represents_party_key in ('client', 'contractor', 'other'));

comment on column public.eb_participants.attended is
  'Whether the participant was present at the inspection; separate from being invited.';
comment on column public.eb_participants.receives_report is
  'Whether the participant should be included in the report distribution list.';
comment on column public.eb_participants.represents_party_key is
  'Which party the participant represents when acting as representative.';
comment on column public.eb_participants.can_represent_party is
  'Whether the participant may speak/act for the represented party.';

alter table public.eb_project_attachments
  add column if not exists include_in_report boolean not null default true,
  add column if not exists littera text,
  add column if not exists document_date date,
  add column if not exists document_number text,
  add column if not exists document_note text;

comment on column public.eb_project_attachments.include_in_report is
  'Whether the document/image should be included in the formal EB report appendix/document list.';
comment on column public.eb_project_attachments.littera is
  'Formal appendix/document lettering used in the EB report.';
comment on column public.eb_project_attachments.document_date is
  'Document date shown in the EB report document list.';
comment on column public.eb_project_attachments.document_number is
  'Document number/revision/reference shown in the EB report document list.';

alter table public.eb_notes
  add column if not exists investigation_responsible_party text,
  add column if not exists investigation_responsible_note text,
  add column if not exists investigation_cost_party text,
  add column if not exists investigation_due_date date,
  add column if not exists deduction_amount text;

alter table public.eb_notes
  drop constraint if exists eb_notes_investigation_responsible_party_check,
  drop constraint if exists eb_notes_investigation_cost_party_check;

alter table public.eb_notes
  add constraint eb_notes_investigation_responsible_party_check
    check (investigation_responsible_party is null or investigation_responsible_party in ('contractor', 'client', 'other')),
  add constraint eb_notes_investigation_cost_party_check
    check (investigation_cost_party is null or investigation_cost_party in ('contractor', 'client'));

comment on column public.eb_notes.investigation_responsible_party is
  'Responsible party for special investigation when the note is marked as investigation.';
comment on column public.eb_notes.investigation_cost_party is
  'Party responsible for investigation cost.';
comment on column public.eb_notes.investigation_due_date is
  'Date when special investigation should be completed.';
comment on column public.eb_notes.deduction_amount is
  'Free-text amount or description for deduction when the note is marked for deduction.';
