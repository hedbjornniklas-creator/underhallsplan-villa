-- TU verification result simplification
-- Date: 2026-09-09
-- Scope:
-- 1) Add a general result for control points that could not be verified
-- 2) Retain earlier detailed result values for historical records

alter table public.tu_verification_items
  drop constraint if exists tu_verification_items_verification_status_check;

alter table public.tu_verification_items
  add constraint tu_verification_items_verification_status_check
    check (
      verification_status in (
        'not_checked',
        'verified',
        'consistent',
        'reported_not_verifiable',
        'not_verifiable',
        'partially_verified',
        'remaining_condition',
        'inaccessible',
        'not_applicable'
      )
    );
