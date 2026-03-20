-- Inspections: store rendered report PDFs in Supabase Storage (metadata in DB)
-- Date: 2026-03-20
-- Prerequisites:
--  - 2026-03-18_02_inspection_report_links_snapshot_payload.sql

alter table public.inspection_report_links
  add column if not exists pdf_storage_bucket text,
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_size_bytes integer;

alter table public.inspection_report_links
  drop constraint if exists inspection_report_links_pdf_storage_pair_check;

alter table public.inspection_report_links
  add constraint inspection_report_links_pdf_storage_pair_check
    check (
      (
        btrim(coalesce(pdf_storage_bucket, '')) = ''
        and btrim(coalesce(pdf_storage_path, '')) = ''
      )
      or (
        btrim(coalesce(pdf_storage_bucket, '')) <> ''
        and btrim(coalesce(pdf_storage_path, '')) <> ''
      )
    );

create index if not exists inspection_report_links_pdf_storage_path_idx
  on public.inspection_report_links (pdf_storage_bucket, pdf_storage_path)
  where revoked_at is null;

comment on column public.inspection_report_links.pdf_storage_bucket is
  'Supabase Storage bucket for immutable report PDF.';

comment on column public.inspection_report_links.pdf_storage_path is
  'Supabase Storage object path for immutable report PDF.';

comment on column public.inspection_report_links.pdf_size_bytes is
  'Stored PDF size in bytes.';

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, allowed_mime_types)
    values (
      'inspection-reports',
      'inspection-reports',
      false,
      array['application/pdf']::text[]
    )
    on conflict (id) do nothing;
  end if;
end $$;
