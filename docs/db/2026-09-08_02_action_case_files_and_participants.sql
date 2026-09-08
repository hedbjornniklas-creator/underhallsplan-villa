-- Uppdrag: action case participants and private files
-- Date: 2026-09-08
-- Prerequisite: 2026-09-08_01_action_cases_foundation.sql
-- Scope:
-- 1) Add customer and subcontractor participants to action cases
-- 2) Store images and documents in a private bucket
-- 3) Grant each external participant access per attachment
-- 4) Use hash-only, revocable portal links

create extension if not exists pgcrypto;

create table if not exists public.action_case_participants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  action_case_id uuid not null references public.action_cases (id) on delete cascade,
  role text not null check (role in ('customer', 'subcontractor')),
  name text not null,
  company_name text,
  email text,
  phone text,
  organization_contact_id uuid references public.organization_contacts (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint action_case_participants_name_check check (btrim(name) <> ''),
  constraint action_case_participants_contact_check
    check (nullif(btrim(coalesce(email, '')), '') is not null or nullif(btrim(coalesce(phone, '')), '') is not null)
);

create unique index if not exists action_case_participants_one_customer_idx
  on public.action_case_participants (action_case_id) where role = 'customer';
create index if not exists action_case_participants_case_role_idx
  on public.action_case_participants (action_case_id, role, name);

create table if not exists public.action_case_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  action_case_id uuid not null references public.action_cases (id) on delete cascade,
  action_case_item_id uuid references public.action_case_items (id) on delete set null,
  attachment_type text not null check (attachment_type in ('image', 'document')),
  title text,
  file_name text not null,
  storage_bucket text not null default 'action-case-files',
  file_path text not null,
  content_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 26214400),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint action_case_attachments_file_name_check check (btrim(file_name) <> ''),
  constraint action_case_attachments_path_check check (btrim(file_path) <> ''),
  constraint action_case_attachments_path_unique unique (storage_bucket, file_path)
);

create table if not exists public.action_case_attachment_grants (
  attachment_id uuid not null references public.action_case_attachments (id) on delete cascade,
  participant_id uuid not null references public.action_case_participants (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (attachment_id, participant_id)
);

create table if not exists public.action_case_access_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  action_case_id uuid not null references public.action_cases (id) on delete cascade,
  participant_id uuid not null references public.action_case_participants (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_opened_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists action_case_attachments_case_created_idx
  on public.action_case_attachments (action_case_id, created_at desc);
create index if not exists action_case_attachment_grants_participant_idx
  on public.action_case_attachment_grants (participant_id, attachment_id);
create index if not exists action_case_access_links_participant_idx
  on public.action_case_access_links (participant_id, created_at desc);

insert into public.action_case_participants (
  org_id, action_case_id, role, name, email, phone, created_by
)
select
  action_case.org_id,
  action_case.id,
  'customer',
  action_case.customer_name,
  action_case.customer_email,
  action_case.customer_phone,
  action_case.created_by
from public.action_cases action_case
where (action_case.customer_email is not null or action_case.customer_phone is not null)
on conflict (action_case_id) where role = 'customer' do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'action-case-files',
  'action-case-files',
  false,
  26214400,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.action_case_participants enable row level security;
alter table public.action_case_attachments enable row level security;
alter table public.action_case_attachment_grants enable row level security;
alter table public.action_case_access_links enable row level security;

grant select, insert, update, delete on public.action_case_participants to authenticated;
grant select, insert, update, delete on public.action_case_attachments to authenticated;
grant select, insert, delete on public.action_case_attachment_grants to authenticated;
revoke all on public.action_case_access_links from public, anon, authenticated;

drop policy if exists action_case_participants_org_member_all on public.action_case_participants;
create policy action_case_participants_org_member_all on public.action_case_participants
for all to authenticated
using (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.action_cases action_case
    where action_case.id = action_case_participants.action_case_id
      and action_case.org_id = action_case_participants.org_id
  )
)
with check (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.action_cases action_case
    where action_case.id = action_case_participants.action_case_id
      and action_case.org_id = action_case_participants.org_id
  )
);

drop policy if exists action_case_attachments_org_member_all on public.action_case_attachments;
create policy action_case_attachments_org_member_all on public.action_case_attachments
for all to authenticated
using (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.action_cases action_case
    where action_case.id = action_case_attachments.action_case_id
      and action_case.org_id = action_case_attachments.org_id
  )
)
with check (
  public.is_org_member(org_id)
  and exists (
    select 1 from public.action_cases action_case
    where action_case.id = action_case_attachments.action_case_id
      and action_case.org_id = action_case_attachments.org_id
  )
  and (
    action_case_item_id is null
    or exists (
      select 1 from public.action_case_items item
      where item.id = action_case_attachments.action_case_item_id
        and item.action_case_id = action_case_attachments.action_case_id
        and item.org_id = action_case_attachments.org_id
    )
  )
);

drop policy if exists action_case_attachment_grants_org_member_all on public.action_case_attachment_grants;
create policy action_case_attachment_grants_org_member_all on public.action_case_attachment_grants
for all to authenticated
using (
  exists (
    select 1 from public.action_case_attachments attachment
    where attachment.id = action_case_attachment_grants.attachment_id
      and public.is_org_member(attachment.org_id)
  )
)
with check (
  exists (
    select 1
    from public.action_case_attachments attachment
    join public.action_case_participants participant
      on participant.id = action_case_attachment_grants.participant_id
     and participant.action_case_id = attachment.action_case_id
     and participant.org_id = attachment.org_id
    where attachment.id = action_case_attachment_grants.attachment_id
      and public.is_org_member(attachment.org_id)
  )
);

-- Browser clients receive signed one-use upload tokens and short-lived read URLs
-- from server routes. No storage.objects policy is intentionally added.
