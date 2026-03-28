-- RenoApp BRF onboarding
-- Date: 2026-03-28
-- Additive only / rollback-safe:
--  - Adds admin-controlled BRF requests and board invites for RenoApp
-- Prerequisite:
--  - 2026-03-26_01_renoapp_mvp_foundation.sql

create extension if not exists pgcrypto;

create table if not exists public.brf_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_number text,
  address text,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  message text,
  status text not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  approved_brf_id uuid references public.brf_associations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brf_requests_name_check
    check (btrim(name) <> ''),
  constraint brf_requests_contact_name_check
    check (btrim(contact_name) <> ''),
  constraint brf_requests_contact_email_check
    check (btrim(contact_email) <> ''),
  constraint brf_requests_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists brf_requests_status_idx
  on public.brf_requests (status, created_at desc);

create index if not exists brf_requests_contact_email_idx
  on public.brf_requests (lower(contact_email));

drop trigger if exists trg_brf_requests_set_updated_at on public.brf_requests;
create trigger trg_brf_requests_set_updated_at
before update on public.brf_requests
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.brf_member_invites (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brf_associations (id) on delete cascade,
  email text not null,
  role text not null default 'board',
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brf_member_invites_email_check
    check (btrim(email) <> ''),
  constraint brf_member_invites_role_check
    check (role in ('board', 'admin'))
);

create index if not exists brf_member_invites_brf_idx
  on public.brf_member_invites (brf_id, created_at desc);

create index if not exists brf_member_invites_email_idx
  on public.brf_member_invites (lower(email));

create index if not exists brf_member_invites_active_idx
  on public.brf_member_invites (brf_id, expires_at)
  where accepted_at is null and revoked_at is null;

drop trigger if exists trg_brf_member_invites_set_updated_at on public.brf_member_invites;
create trigger trg_brf_member_invites_set_updated_at
before update on public.brf_member_invites
for each row
execute function public.renoapp_set_updated_at();
