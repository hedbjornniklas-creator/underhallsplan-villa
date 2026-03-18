-- OB snapshot: add apartment-specific fields used in Grunddata
-- Date: 2026-03-18
-- Prerequisites:
--  - 2026-02-18_ob_snapshot_and_locks.sql
--  - 2026-03-18_03_assignments_apartment_fields.sql

alter table public.ob_property_snapshot
  add column if not exists brf_name text,
  add column if not exists apartment_number text,
  add column if not exists apartment_holder_name text;

-- Backfill from linked assignments where snapshot values are still empty.
update public.ob_property_snapshot s
set
  brf_name = coalesce(nullif(btrim(s.brf_name), ''), nullif(btrim(a.brf_name), '')),
  apartment_number = coalesce(
    nullif(btrim(s.apartment_number), ''),
    nullif(btrim(a.apartment_number), '')
  ),
  apartment_holder_name = coalesce(
    nullif(btrim(s.apartment_holder_name), ''),
    nullif(btrim(a.apartment_holder_name), '')
  )
from public.assignments a
where a.inspection_id = s.inspection_id
  and (
    (coalesce(nullif(btrim(s.brf_name), ''), '') = '' and coalesce(nullif(btrim(a.brf_name), ''), '') <> '')
    or (
      coalesce(nullif(btrim(s.apartment_number), ''), '') = ''
      and coalesce(nullif(btrim(a.apartment_number), ''), '') <> ''
    )
    or (
      coalesce(nullif(btrim(s.apartment_holder_name), ''), '') = ''
      and coalesce(nullif(btrim(a.apartment_holder_name), ''), '') <> ''
    )
  );
