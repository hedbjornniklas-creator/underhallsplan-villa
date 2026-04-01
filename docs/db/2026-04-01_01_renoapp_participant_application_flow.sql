-- RenoApp participant application flow
-- Date: 2026-04-01
-- Additive only / rollback-safe:
--  - Adds verification metadata to participant roles
--  - Stores per-role entrepreneur/consultant details per case
--  - Lets uploaded case documents be linked to a participant role
-- Prerequisite:
--  - 2026-03-31_07_renoapp_participant_roles.sql

alter table public.renoapp_participant_roles
  add column if not exists verification_instructions text,
  add column if not exists verification_url text,
  add column if not exists insurance_required boolean not null default false;

create table if not exists public.renoapp_case_participants (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.renovation_cases (id) on delete cascade,
  participant_role_id uuid not null references public.renoapp_participant_roles (id) on delete cascade,
  company_name text,
  org_number text,
  contact_name text,
  email text,
  phone text,
  certification_reference text,
  has_verified_authorization boolean not null default false,
  accepts_responsibility boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_case_participants_unique
    unique (case_id, participant_role_id)
);

create index if not exists renoapp_case_participants_case_idx
  on public.renoapp_case_participants (case_id, participant_role_id);

create index if not exists renoapp_case_participants_role_idx
  on public.renoapp_case_participants (participant_role_id, case_id);

drop trigger if exists trg_renoapp_case_participants_set_updated_at on public.renoapp_case_participants;
create trigger trg_renoapp_case_participants_set_updated_at
before update on public.renoapp_case_participants
for each row
execute function public.renoapp_set_updated_at();

alter table public.renovation_case_documents
  add column if not exists participant_role_id uuid references public.renoapp_participant_roles (id) on delete set null,
  add column if not exists document_scope text not null default 'general';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'renovation_case_documents_scope_check'
  ) then
    alter table public.renovation_case_documents
      drop constraint renovation_case_documents_scope_check;
  end if;

  alter table public.renovation_case_documents
    add constraint renovation_case_documents_scope_check
    check (document_scope in ('general', 'participant_insurance'));
end $$;

create index if not exists renovation_case_documents_participant_role_idx
  on public.renovation_case_documents (participant_role_id, uploaded_at desc);

update public.renovation_case_documents
set document_scope = 'general'
where document_scope not in ('general', 'participant_insurance');
