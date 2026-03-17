-- Inspections: persistent report links with PDF V2 snapshot
-- Date: 2026-03-18
-- Prerequisites:
--  - 2026-02-20_01_assignments_org_foundation.sql
--  - 2026-02-20_03_assignments_rls.sql

create extension if not exists pgcrypto;

create table if not exists public.inspection_report_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,

  token_hash text not null,
  pdf_base64 text not null,
  pdf_sha256 text not null,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,

  constraint inspection_report_links_token_hash_unique unique (token_hash),
  constraint inspection_report_links_token_hash_len_check check (char_length(token_hash) >= 32),
  constraint inspection_report_links_pdf_base64_check check (btrim(pdf_base64) <> ''),
  constraint inspection_report_links_pdf_sha256_check check (pdf_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists inspection_report_links_org_id_idx
  on public.inspection_report_links (org_id);

create index if not exists inspection_report_links_inspection_id_idx
  on public.inspection_report_links (inspection_id);

create index if not exists inspection_report_links_assignment_id_idx
  on public.inspection_report_links (assignment_id);

create index if not exists inspection_report_links_created_at_idx
  on public.inspection_report_links (created_at desc);

create index if not exists inspection_report_links_active_token_idx
  on public.inspection_report_links (token_hash)
  where revoked_at is null;

alter table public.inspection_report_links enable row level security;

grant select, insert, update, delete on table public.inspection_report_links to authenticated;

drop policy if exists inspection_report_links_select_member on public.inspection_report_links;
create policy inspection_report_links_select_member
  on public.inspection_report_links
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists inspection_report_links_insert_member on public.inspection_report_links;
create policy inspection_report_links_insert_member
  on public.inspection_report_links
  for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists inspection_report_links_update_member on public.inspection_report_links;
create policy inspection_report_links_update_member
  on public.inspection_report_links
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists inspection_report_links_delete_admin on public.inspection_report_links;
create policy inspection_report_links_delete_admin
  on public.inspection_report_links
  for delete
  to authenticated
  using (public.is_org_admin(org_id));
