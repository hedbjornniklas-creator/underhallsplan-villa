-- Inspection cover picture (cover image owned by inspection)
-- Date: 2026-02-25
-- Prerequisites:
--  - 2026-02-18_ob_snapshot_and_locks.sql

alter table public.inspections
  add column if not exists cover_path text;

