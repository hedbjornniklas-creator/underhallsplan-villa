alter table public.case_access_links
  add column if not exists plain_token text;

alter table public.case_access_links
  alter column email drop not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'case_access_links_email_check'
  ) then
    alter table public.case_access_links
      drop constraint case_access_links_email_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'case_access_links_email_optional_check'
  ) then
    alter table public.case_access_links
      add constraint case_access_links_email_optional_check
        check (email is null or btrim(email) <> '');
  end if;
end $$;

create unique index if not exists case_access_links_plain_token_unique_idx
  on public.case_access_links (plain_token)
  where plain_token is not null;

create table if not exists public.renovation_case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.renovation_cases (id) on delete cascade,
  type text not null,
  author_role text not null,
  author_profile_id uuid references public.profiles (id) on delete set null,
  author_contact_id uuid references public.contacts (id) on delete set null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint renovation_case_messages_type_check
    check (type in ('request_for_info', 'applicant_reply', 'document_uploaded', 'decision', 'status_change')),
  constraint renovation_case_messages_author_role_check
    check (author_role in ('board', 'applicant', 'system'))
);

create index if not exists renovation_case_messages_case_idx
  on public.renovation_case_messages (case_id, created_at desc);
