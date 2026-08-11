-- Direct TU investigation invoice email
-- Date: 2026-08-11
-- Scope:
-- 1) Store an optional billing email for TU investigations created without an assignment confirmation

alter table public.technical_investigation_details
  add column if not exists invoice_email text;

comment on column public.technical_investigation_details.invoice_email is
  'Optional billing recipient email for directly created TU investigations. Contact delivery uses inspections.customer_email.';

alter table public.technical_investigation_details
  drop constraint if exists technical_investigation_details_invoice_email_check;

alter table public.technical_investigation_details
  add constraint technical_investigation_details_invoice_email_check
    check (
      invoice_email is null
      or btrim(invoice_email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    );
