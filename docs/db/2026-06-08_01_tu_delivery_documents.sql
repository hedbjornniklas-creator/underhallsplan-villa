-- Technical investigations delivery documents
-- Date: 2026-06-08
-- Scope:
-- 1) Let uploaded TU documents be selected for report delivery
-- 2) Keep selected documents available from the locked digital report link

alter table public.technical_investigation_documents
  add column if not exists include_in_delivery boolean not null default false;

create index if not exists technical_investigation_documents_delivery_idx
  on public.technical_investigation_documents (inspection_id, include_in_delivery, created_at desc);

comment on column public.technical_investigation_documents.include_in_delivery is
  'Whether this uploaded TU document should be included as downloadable supporting material in the report delivery snapshot.';
