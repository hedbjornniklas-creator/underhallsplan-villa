-- EB project party relations, contact details and billing
-- Date: 2026-08-22
-- Scope:
-- 1) Preserve "same as" choices when an EB project is reopened
-- 2) Store the actual property owner instead of always assuming the client
-- 3) Add party phone numbers and optional billing details

alter table public.eb_projects
  add column if not exists client_address_matches_object boolean not null default false,
  add column if not exists client_is_property_owner boolean not null default true,
  add column if not exists property_owner_name text,
  add column if not exists client_phone text,
  add column if not exists contractor_phone text,
  add column if not exists invoice_recipient_matches_client boolean not null default true,
  add column if not exists invoice_name text,
  add column if not exists invoice_org_no text,
  add column if not exists invoice_reference text,
  add column if not exists invoice_email_matches_client boolean not null default true,
  add column if not exists invoice_email text,
  add column if not exists invoice_address_matches_client boolean not null default true,
  add column if not exists invoice_address text,
  add column if not exists invoice_postal_code text,
  add column if not exists invoice_city text;

comment on column public.eb_projects.client_address_matches_object is
  'When true, the EB client address follows the project object address.';
comment on column public.eb_projects.client_is_property_owner is
  'When true, the EB client is also the property owner.';
comment on column public.eb_projects.property_owner_name is
  'Resolved property owner name for the EB project.';
comment on column public.eb_projects.invoice_recipient_matches_client is
  'When true, the billing recipient follows the EB client name.';
comment on column public.eb_projects.invoice_email_matches_client is
  'When true, the billing email follows the EB client email.';
comment on column public.eb_projects.invoice_address_matches_client is
  'When true, the billing address follows the resolved EB client address.';
