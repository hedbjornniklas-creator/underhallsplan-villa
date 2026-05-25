-- EB note source tracking
-- Date: 2026-05-25
-- Scope:
-- 1) Track system-created EB notes so derived notes can be updated without duplicates
-- 2) Support automatic notes for missing EB quality/documentation records

alter table public.eb_notes
  add column if not exists source_system text,
  add column if not exists source_record_id text;

comment on column public.eb_notes.source_system is
  'Internal source for system-created or imported EB notes. Example: eb_missing_document.';
comment on column public.eb_notes.source_record_id is
  'Source record identifier within source_system, such as a document_type id for missing document notes.';

create index if not exists eb_notes_source_system_idx
  on public.eb_notes (inspection_id, source_system, source_record_id)
  where source_system is not null;

create unique index if not exists eb_notes_source_unique_idx
  on public.eb_notes (inspection_id, source_system, source_record_id)
  where source_system is not null
    and source_record_id is not null;
