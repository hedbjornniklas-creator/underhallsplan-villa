-- Document type applicable modules
-- Date: 2026-05-25
-- Scope:
-- 1) Let the existing document type admin mark document types for OB, EB or both
-- 2) Keep existing applies_to semantics for OB buyer/seller/apartment filtering

alter table public.document_types
  add column if not exists applicable_modules text not null default 'ob';

update public.document_types
set applicable_modules = 'ob'
where applicable_modules is null
   or btrim(applicable_modules) = '';

comment on column public.document_types.applicable_modules is
  'Comma-separated module keys where the document type is used. Examples: ob, eb, ob,eb. Existing applies_to remains reserved for OB buyer/seller/apartment filtering.';
