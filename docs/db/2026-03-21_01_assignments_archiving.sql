-- Assignments: add explicit archiving fields (separate from business status)
-- Date: 2026-03-21
-- Prerequisites:
--  - 2026-03-16_03_assignments_ordered_status.sql

alter table public.assignments
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

create index if not exists assignments_org_archived_idx
  on public.assignments (org_id, archived_at, created_at desc);

comment on column public.assignments.archived_at is
  'Soft-archive timestamp for list visibility. Null = active in default list.';

comment on column public.assignments.archived_by is
  'Profile id that archived the assignment (null when not archived or restored).';

