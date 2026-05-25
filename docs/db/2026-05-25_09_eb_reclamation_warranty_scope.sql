-- EB reclamation warranty scope
-- Date: 2026-05-25
-- Scope:
-- 1) Store what a special product/material warranty applies to
-- 2) Render special warranty details in the EB reclamation deadline section

alter table public.eb_inspection_details
  add column if not exists warranty_scope text;

comment on column public.eb_inspection_details.warranty_scope is
  'Free-text description of what a special warranty applies to, shown as "för ..." in the EB reclamation deadline section.';
