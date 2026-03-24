-- Inspection unlock events + completed-lock backfill
-- Date: 2026-03-24
-- Additive only / rollback-safe:
--  - Adds unlock event audit table
--  - Backfills lock fields for already completed inspections

create extension if not exists pgcrypto;

create table if not exists public.inspection_lock_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  action text not null,
  reason text not null,
  performed_by uuid not null references public.profiles (id) on delete restrict,
  performed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inspection_lock_events_action_check
    check (action in ('unlock')),
  constraint inspection_lock_events_reason_check
    check (char_length(btrim(reason)) >= 10)
);

create index if not exists inspection_lock_events_org_inspection_idx
  on public.inspection_lock_events (org_id, inspection_id, performed_at desc);

create index if not exists inspection_lock_events_performed_by_idx
  on public.inspection_lock_events (performed_by, performed_at desc);

-- Preserve previous semantics where "klar" inspections are locked by default.
update public.inspections
set locked_at = now()
where locked_at is null
  and lower(coalesce(status, '')) in ('completed', 'klar', 'done');
