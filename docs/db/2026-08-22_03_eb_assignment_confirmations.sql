-- EB assignment confirmations per inspection
-- Date: 2026-08-22
--
-- Reuses the shared assignments, assignment_links and assignment_acceptances
-- workflow. This table only supplies the EB inspection/version relationship.

alter table public.assignments
  add column if not exists assignment_details jsonb not null default '{}'::jsonb;

comment on column public.assignments.assignment_details is
  'Versioned module-specific assignment facts. Values are frozen when the shared assignment leaves draft status.';

create table if not exists public.eb_assignment_confirmations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  version_no integer not null default 1,
  is_current boolean not null default true,
  replaced_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_assignment_confirmations_assignment_unique unique (assignment_id),
  constraint eb_assignment_confirmations_version_unique unique (inspection_id, version_no),
  constraint eb_assignment_confirmations_version_check check (version_no > 0),
  constraint eb_assignment_confirmations_current_pair_check check (
    (is_current = true and replaced_at is null)
    or (is_current = false and replaced_at is not null)
  )
);

create unique index if not exists eb_assignment_confirmations_current_idx
  on public.eb_assignment_confirmations (inspection_id)
  where is_current = true;

create index if not exists eb_assignment_confirmations_org_idx
  on public.eb_assignment_confirmations (org_id, inspection_id, version_no desc);

drop trigger if exists trg_eb_assignment_confirmations_set_updated_at
  on public.eb_assignment_confirmations;
create trigger trg_eb_assignment_confirmations_set_updated_at
before update on public.eb_assignment_confirmations
for each row
execute function public.eb_set_updated_at();

alter table public.eb_assignment_confirmations enable row level security;

grant select, insert, update, delete
  on table public.eb_assignment_confirmations
  to authenticated;

drop policy if exists eb_assignment_confirmations_member_all
  on public.eb_assignment_confirmations;
create policy eb_assignment_confirmations_member_all
  on public.eb_assignment_confirmations
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

