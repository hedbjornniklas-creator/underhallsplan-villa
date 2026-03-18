-- Assignments: add customer postal code and city fields
-- Date: 2026-03-18
-- Prerequisites:
--  - 2026-02-20_01_assignments_org_foundation.sql

alter table public.assignments
  add column if not exists customer_postal_code text,
  add column if not exists customer_city text;
