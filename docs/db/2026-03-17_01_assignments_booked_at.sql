-- Assignments: add booked_at timestamp for inspector acceptance step
-- Date: 2026-03-17
-- Prerequisites:
--  - 2026-03-16_03_assignments_ordered_status.sql

alter table public.assignments
  add column if not exists booked_at timestamptz;

-- Backfill existing booked/completed rows so history can be shown in UI.
update public.assignments
set booked_at = coalesce(accepted_at, updated_at, now())
where booked_at is null
  and status in ('booked', 'completed');

