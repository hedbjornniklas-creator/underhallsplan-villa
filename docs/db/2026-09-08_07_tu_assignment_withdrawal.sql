-- TU consumer withdrawal requests
-- Date: 2026-09-08
-- Scope:
-- 1) Store a durable request to withdraw from an accepted TU distance contract
-- 2) Preserve the assignment, acceptance and delivery evidence for manual handling
-- 3) Record where and when the mandatory electronic receipt was sent

create extension if not exists pgcrypto;

create table if not exists public.assignment_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  assignment_link_id uuid references public.assignment_links (id) on delete set null,
  customer_name text not null,
  receipt_email text not null,
  requested_at timestamptz not null default now(),
  requested_ip inet,
  user_agent text,
  receipt_sent_at timestamptz,
  status text not null default 'received',
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignment_withdrawal_requests_assignment_unique unique (assignment_id),
  constraint assignment_withdrawal_requests_customer_name_check
    check (btrim(customer_name) <> ''),
  constraint assignment_withdrawal_requests_receipt_email_check
    check (btrim(receipt_email) <> ''),
  constraint assignment_withdrawal_requests_status_check
    check (status in ('received', 'resolved', 'rejected'))
);

create index if not exists assignment_withdrawal_requests_org_requested_idx
  on public.assignment_withdrawal_requests (org_id, requested_at desc);

drop trigger if exists trg_assignment_withdrawal_requests_set_updated_at
  on public.assignment_withdrawal_requests;
create trigger trg_assignment_withdrawal_requests_set_updated_at
before update on public.assignment_withdrawal_requests
for each row
execute function public.assignments_set_updated_at();

alter table public.assignment_withdrawal_requests enable row level security;

grant select, update on table public.assignment_withdrawal_requests to authenticated;

drop policy if exists assignment_withdrawal_requests_select_member
  on public.assignment_withdrawal_requests;
create policy assignment_withdrawal_requests_select_member
  on public.assignment_withdrawal_requests
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists assignment_withdrawal_requests_update_member
  on public.assignment_withdrawal_requests;
create policy assignment_withdrawal_requests_update_member
  on public.assignment_withdrawal_requests
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

comment on table public.assignment_withdrawal_requests is
  'Durable customer requests to withdraw from accepted distance contracts. The request does not delete or automatically adjudicate the assignment.';
