-- Inspections: add async PDF job status for report links
-- Date: 2026-03-20
-- Prerequisites:
--  - 2026-03-20_01_inspection_report_links_storage_pdf.sql

alter table public.inspection_report_links
  add column if not exists pdf_status text,
  add column if not exists pdf_error text,
  add column if not exists pdf_attempts integer,
  add column if not exists pdf_started_at timestamptz,
  add column if not exists pdf_generated_at timestamptz;

update public.inspection_report_links
set
  pdf_status = case
    when (
      btrim(coalesce(pdf_base64, '')) <> ''
      or (
        btrim(coalesce(pdf_storage_bucket, '')) <> ''
        and btrim(coalesce(pdf_storage_path, '')) <> ''
      )
    ) then 'ready'
    when btrim(coalesce(pdf_status, '')) in ('pending', 'processing', 'ready', 'failed') then btrim(pdf_status)
    else 'pending'
  end,
  pdf_attempts = greatest(coalesce(pdf_attempts, 0), 0),
  pdf_generated_at = case
    when (
      btrim(coalesce(pdf_base64, '')) <> ''
      or (
        btrim(coalesce(pdf_storage_bucket, '')) <> ''
        and btrim(coalesce(pdf_storage_path, '')) <> ''
      )
    ) then coalesce(pdf_generated_at, created_at)
    else pdf_generated_at
  end;

alter table public.inspection_report_links
  alter column pdf_status set default 'pending',
  alter column pdf_status set not null,
  alter column pdf_attempts set default 0,
  alter column pdf_attempts set not null;

alter table public.inspection_report_links
  drop constraint if exists inspection_report_links_pdf_status_check,
  drop constraint if exists inspection_report_links_pdf_attempts_check,
  drop constraint if exists inspection_report_links_pdf_ready_has_file_check;

alter table public.inspection_report_links
  add constraint inspection_report_links_pdf_status_check
    check (pdf_status in ('pending', 'processing', 'ready', 'failed')),
  add constraint inspection_report_links_pdf_attempts_check
    check (pdf_attempts >= 0),
  add constraint inspection_report_links_pdf_ready_has_file_check
    check (
      pdf_status <> 'ready'
      or btrim(coalesce(pdf_base64, '')) <> ''
      or (
        btrim(coalesce(pdf_storage_bucket, '')) <> ''
        and btrim(coalesce(pdf_storage_path, '')) <> ''
      )
    );

create index if not exists inspection_report_links_pdf_status_idx
  on public.inspection_report_links (pdf_status, created_at desc)
  where revoked_at is null;

comment on column public.inspection_report_links.pdf_status is
  'Async PDF job status: pending, processing, ready, failed.';

comment on column public.inspection_report_links.pdf_error is
  'Last PDF generation error message (if failed).';

comment on column public.inspection_report_links.pdf_attempts is
  'Number of PDF generation attempts.';

comment on column public.inspection_report_links.pdf_started_at is
  'Timestamp when PDF generation last started.';

comment on column public.inspection_report_links.pdf_generated_at is
  'Timestamp when PDF was successfully generated and stored.';
