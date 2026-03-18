-- Inspections: support link-only report delivery with immutable snapshot payload
-- Date: 2026-03-18
-- Prerequisites:
--  - 2026-03-18_01_inspection_report_links.sql

alter table public.inspection_report_links
  add column if not exists delivery_mode text,
  add column if not exists snapshot_schema_version text,
  add column if not exists snapshot_payload jsonb;

update public.inspection_report_links
set delivery_mode = coalesce(nullif(btrim(delivery_mode), ''), 'link_pdf')
where delivery_mode is null
   or btrim(delivery_mode) = '';

alter table public.inspection_report_links
  alter column delivery_mode set default 'link_pdf',
  alter column delivery_mode set not null,
  alter column pdf_base64 drop not null,
  alter column pdf_sha256 drop not null;

alter table public.inspection_report_links
  drop constraint if exists inspection_report_links_pdf_base64_check,
  drop constraint if exists inspection_report_links_pdf_sha256_check,
  drop constraint if exists inspection_report_links_delivery_mode_check,
  drop constraint if exists inspection_report_links_snapshot_schema_version_check,
  drop constraint if exists inspection_report_links_payload_check;

alter table public.inspection_report_links
  add constraint inspection_report_links_pdf_base64_check
    check (pdf_base64 is null or btrim(pdf_base64) <> ''),
  add constraint inspection_report_links_pdf_sha256_check
    check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint inspection_report_links_delivery_mode_check
    check (delivery_mode in ('link_pdf', 'link_only')),
  add constraint inspection_report_links_snapshot_schema_version_check
    check (snapshot_payload is null or btrim(coalesce(snapshot_schema_version, '')) <> ''),
  add constraint inspection_report_links_payload_check
    check (
      (
        btrim(coalesce(pdf_base64, '')) <> ''
        and coalesce(pdf_sha256, '') ~ '^[0-9a-f]{64}$'
      )
      or snapshot_payload is not null
    );

