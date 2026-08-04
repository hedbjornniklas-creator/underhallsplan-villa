-- TU assignment invoice email
-- Date: 2026-08-04
-- Scope:
-- 1) Store an optional billing email separately from the confirmation recipient
-- 2) Preserve all existing assignments and use customer_email as fallback in invoicing flows

alter table public.assignments
  add column if not exists invoice_email text;

comment on column public.assignments.invoice_email is
  'Optional billing recipient email. Assignment confirmations are always sent to customer_email.';

alter table public.assignments
  drop constraint if exists assignments_invoice_email_check;

alter table public.assignments
  add constraint assignments_invoice_email_check
    check (
      invoice_email is null
      or btrim(invoice_email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    );
