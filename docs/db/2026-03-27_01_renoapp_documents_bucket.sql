-- RenoApp documents bucket
-- Date: 2026-03-27
-- Additive only / rollback-safe:
--  - Ensures storage bucket exists for RenoApp case documents
-- Prerequisite:
--  - 2026-03-26_01_renoapp_mvp_foundation.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'renoapp-case-documents',
  'renoapp-case-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]::text[]
where not exists (
  select 1
  from storage.buckets
  where id = 'renoapp-case-documents'
);
