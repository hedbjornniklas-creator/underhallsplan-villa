-- OB risk/FTU overrides per inspection row
-- Date: 2026-03-11
-- Prerequisites:
--  - 2026-02-18_ob_snapshot_and_locks.sql

-- Control points (insida + utsida): editable risk/FTU text per row.
alter table public.inspection_control_items
  add column if not exists risk_text text,
  add column if not exists ftu_text text;

-- Free notes in utsida: editable risk/FTU text per observation row.
alter table public.inspection_exterior_observations
  add column if not exists risk_text text,
  add column if not exists ftu_text text;

