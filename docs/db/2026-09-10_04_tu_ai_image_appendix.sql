-- TU AI-assisted image appendix
-- Date: 2026-09-10
-- Scope:
-- 1) Store a customer-facing appendix caption separately from source evidence
-- 2) Allow appendix editing without changing the image caption used by the technical analysis

alter table public.technical_investigation_images
  add column if not exists report_caption text;

comment on column public.technical_investigation_images.report_caption is
  'Customer-facing caption used in the TU report appendix. The source caption remains unchanged for analysis traceability.';
