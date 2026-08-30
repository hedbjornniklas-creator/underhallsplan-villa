-- TU immutable report revisions
-- Date: 2026-08-30
-- Scope:
-- 1) Separate finalization from delivery for TU reports
-- 2) Keep the previously published recipient link active until a new revision is sent
-- 3) Preserve an auditable revision history without changing OB or EB behavior

create extension if not exists pgcrypto;

create table if not exists public.tu_report_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  revision_number integer not null,
  snapshot_link_id uuid not null references public.inspection_report_links (id) on delete restrict,
  published_link_id uuid references public.inspection_report_links (id) on delete restrict,
  status text not null default 'finalized',
  finalized_at timestamptz not null default now(),
  finalized_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_report_revisions_revision_number_check check (revision_number > 0),
  constraint tu_report_revisions_status_check
    check (status in ('finalized', 'published', 'superseded', 'withdrawn')),
  constraint tu_report_revisions_published_fields_check
    check (
      (status in ('finalized', 'withdrawn') and published_at is null and published_link_id is null)
      or (status in ('published', 'superseded') and published_at is not null and published_link_id is not null)
    ),
  constraint tu_report_revisions_inspection_revision_unique
    unique (inspection_id, revision_number),
  constraint tu_report_revisions_snapshot_link_unique unique (snapshot_link_id),
  constraint tu_report_revisions_published_link_unique unique (published_link_id)
);

create unique index if not exists tu_report_revisions_finalized_idx
  on public.tu_report_revisions (inspection_id)
  where status = 'finalized';

create unique index if not exists tu_report_revisions_published_idx
  on public.tu_report_revisions (inspection_id)
  where status = 'published';

create index if not exists tu_report_revisions_org_created_idx
  on public.tu_report_revisions (org_id, created_at desc);

create or replace function public.tu_report_revisions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tu_report_revisions_set_updated_at
  on public.tu_report_revisions;
create trigger trg_tu_report_revisions_set_updated_at
before update on public.tu_report_revisions
for each row
execute function public.tu_report_revisions_set_updated_at();

create or replace function public.withdraw_unpublished_tu_revision_after_unlock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.report_locked_at is not null and new.report_locked_at is null then
    update public.inspection_report_links links
    set revoked_at = coalesce(links.revoked_at, now())
    from public.tu_report_revisions revisions
    where revisions.inspection_id = new.inspection_id
      and revisions.org_id = new.org_id
      and revisions.status = 'finalized'
      and links.id = revisions.snapshot_link_id;

    update public.tu_report_revisions
    set status = 'withdrawn'
    where inspection_id = new.inspection_id
      and org_id = new.org_id
      and status = 'finalized';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_withdraw_unpublished_tu_revision_after_unlock
  on public.technical_investigation_details;
create trigger trg_withdraw_unpublished_tu_revision_after_unlock
after update of report_locked_at on public.technical_investigation_details
for each row
execute function public.withdraw_unpublished_tu_revision_after_unlock();

alter table public.tu_report_revisions enable row level security;

grant select, insert, update on table public.tu_report_revisions to authenticated;

drop policy if exists tu_report_revisions_member_select on public.tu_report_revisions;
create policy tu_report_revisions_member_select
  on public.tu_report_revisions
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists tu_report_revisions_member_insert on public.tu_report_revisions;
create policy tu_report_revisions_member_insert
  on public.tu_report_revisions
  for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists tu_report_revisions_member_update on public.tu_report_revisions;
create policy tu_report_revisions_member_update
  on public.tu_report_revisions
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

comment on table public.tu_report_revisions is
  'Immutable TU report revisions. A revision is finalized before it can be delivered.';
comment on column public.tu_report_revisions.snapshot_link_id is
  'Frozen internal snapshot created when the report is finalized.';
comment on column public.tu_report_revisions.published_link_id is
  'Recipient link created from the frozen snapshot when the revision is delivered.';
