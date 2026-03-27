-- RenoApp MVP foundation
-- Date: 2026-03-26
-- Additive only / rollback-safe:
--  - Adds isolated RenoApp tables for BRF, units, contacts, cases and access links
--  - Adds configuration tables for action types, document types and requirements

create extension if not exists pgcrypto;

create or replace function public.renoapp_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.brf_associations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  org_number text,
  address text,
  email text,
  phone text,
  is_public_apply_enabled boolean not null default true,
  apply_intro_text text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brf_associations_name_check
    check (btrim(name) <> ''),
  constraint brf_associations_slug_check
    check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists brf_associations_created_by_idx
  on public.brf_associations (created_by);

drop trigger if exists trg_brf_associations_set_updated_at on public.brf_associations;
create trigger trg_brf_associations_set_updated_at
before update on public.brf_associations
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.brf_members (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brf_associations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'board',
  is_active boolean not null default true,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brf_members_role_check
    check (role in ('board', 'admin')),
  constraint brf_members_unique
    unique (brf_id, profile_id)
);

create index if not exists brf_members_profile_idx
  on public.brf_members (profile_id);

create index if not exists brf_members_active_idx
  on public.brf_members (brf_id, is_active);

drop trigger if exists trg_brf_members_set_updated_at on public.brf_members;
create trigger trg_brf_members_set_updated_at
before update on public.brf_members
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renovation_action_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renovation_action_types_key_check
    check (btrim(key) <> ''),
  constraint renovation_action_types_label_check
    check (btrim(label) <> ''),
  constraint renovation_action_types_sort_order_check
    check (sort_order > 0)
);

drop trigger if exists trg_renovation_action_types_set_updated_at on public.renovation_action_types;
create trigger trg_renovation_action_types_set_updated_at
before update on public.renovation_action_types
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renovation_document_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renovation_document_types_key_check
    check (btrim(key) <> ''),
  constraint renovation_document_types_label_check
    check (btrim(label) <> ''),
  constraint renovation_document_types_sort_order_check
    check (sort_order > 0)
);

drop trigger if exists trg_renovation_document_types_set_updated_at on public.renovation_document_types;
create trigger trg_renovation_document_types_set_updated_at
before update on public.renovation_document_types
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renovation_action_document_requirements (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid references public.brf_associations (id) on delete cascade,
  action_type_id uuid not null references public.renovation_action_types (id) on delete cascade,
  document_type_id uuid not null references public.renovation_document_types (id) on delete cascade,
  is_required boolean not null default true,
  note text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renovation_action_document_requirements_sort_order_check
    check (sort_order > 0)
);

create unique index if not exists renovation_action_document_requirements_unique_idx
  on public.renovation_action_document_requirements (
    coalesce(brf_id, '00000000-0000-0000-0000-000000000000'::uuid),
    action_type_id,
    document_type_id
  );

create index if not exists renovation_action_document_requirements_lookup_idx
  on public.renovation_action_document_requirements (brf_id, action_type_id, sort_order);

drop trigger if exists trg_renovation_action_document_requirements_set_updated_at on public.renovation_action_document_requirements;
create trigger trg_renovation_action_document_requirements_set_updated_at
before update on public.renovation_action_document_requirements
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_name_check
    check (btrim(name) <> ''),
  constraint contacts_email_or_phone_check
    check (
      nullif(btrim(coalesce(email, '')), '') is not null
      or nullif(btrim(coalesce(phone, '')), '') is not null
    )
);

create index if not exists contacts_email_idx
  on public.contacts (lower(email))
  where email is not null;

create index if not exists contacts_phone_idx
  on public.contacts (phone)
  where phone is not null;

drop trigger if exists trg_contacts_set_updated_at on public.contacts;
create trigger trg_contacts_set_updated_at
before update on public.contacts
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.brf_units (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brf_associations (id) on delete cascade,
  unit_number_internal text,
  unit_number_skatteverket text,
  address_line text,
  floor text,
  status text not null default 'preliminary',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brf_units_status_check
    check (status in ('preliminary', 'verified')),
  constraint brf_units_number_check
    check (
      nullif(btrim(coalesce(unit_number_internal, '')), '') is not null
      or nullif(btrim(coalesce(unit_number_skatteverket, '')), '') is not null
    )
);

create index if not exists brf_units_brf_status_idx
  on public.brf_units (brf_id, status);

create index if not exists brf_units_internal_number_idx
  on public.brf_units (brf_id, unit_number_internal)
  where unit_number_internal is not null;

create index if not exists brf_units_skatteverket_number_idx
  on public.brf_units (brf_id, unit_number_skatteverket)
  where unit_number_skatteverket is not null;

drop trigger if exists trg_brf_units_set_updated_at on public.brf_units;
create trigger trg_brf_units_set_updated_at
before update on public.brf_units
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.unit_contacts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.brf_units (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  relationship_type text not null default 'unknown',
  verification_status text not null default 'unverified',
  from_date date,
  to_date date,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_contacts_relationship_type_check
    check (relationship_type in ('owner', 'resident', 'representative', 'unknown')),
  constraint unit_contacts_verification_status_check
    check (verification_status in ('unverified', 'verified_by_board', 'verified_by_system'))
);

create index if not exists unit_contacts_unit_idx
  on public.unit_contacts (unit_id, is_current);

create index if not exists unit_contacts_contact_idx
  on public.unit_contacts (contact_id, is_current);

drop trigger if exists trg_unit_contacts_set_updated_at on public.unit_contacts;
create trigger trg_unit_contacts_set_updated_at
before update on public.unit_contacts
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renovation_cases (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brf_associations (id) on delete cascade,
  unit_id uuid references public.brf_units (id) on delete set null,
  applicant_contact_id uuid references public.contacts (id) on delete set null,
  case_number text not null unique,
  title text not null,
  description text,
  status text not null default 'submitted',
  risk_level text,
  blocked_at timestamptz,
  blocked_reason text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renovation_cases_title_check
    check (btrim(title) <> ''),
  constraint renovation_cases_status_check
    check (status in ('draft', 'submitted', 'review', 'need_info', 'approved', 'conditional', 'rejected', 'completed')),
  constraint renovation_cases_risk_level_check
    check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical'))
);

create index if not exists renovation_cases_brf_status_idx
  on public.renovation_cases (brf_id, status, submitted_at desc);

create index if not exists renovation_cases_unit_idx
  on public.renovation_cases (unit_id);

create index if not exists renovation_cases_contact_idx
  on public.renovation_cases (applicant_contact_id);

drop trigger if exists trg_renovation_cases_set_updated_at on public.renovation_cases;
create trigger trg_renovation_cases_set_updated_at
before update on public.renovation_cases
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renovation_case_checks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.renovation_cases (id) on delete cascade,
  affects_structure boolean not null default false,
  affects_plumbing boolean not null default false,
  affects_ventilation boolean not null default false,
  affects_electrical boolean not null default false,
  affects_wet_room boolean not null default false,
  affects_surface_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_renovation_case_checks_set_updated_at on public.renovation_case_checks;
create trigger trg_renovation_case_checks_set_updated_at
before update on public.renovation_case_checks
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renovation_case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.renovation_cases (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  document_type_id uuid references public.renovation_document_types (id) on delete set null,
  storage_bucket text not null default 'renoapp-case-documents',
  file_path text not null,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  status text not null default 'uploaded',
  note text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renovation_case_documents_file_path_check
    check (btrim(file_path) <> ''),
  constraint renovation_case_documents_status_check
    check (status in ('uploaded', 'missing', 'approved', 'rejected'))
);

create index if not exists renovation_case_documents_case_idx
  on public.renovation_case_documents (case_id, uploaded_at desc);

create index if not exists renovation_case_documents_contact_idx
  on public.renovation_case_documents (contact_id);

drop trigger if exists trg_renovation_case_documents_set_updated_at on public.renovation_case_documents;
create trigger trg_renovation_case_documents_set_updated_at
before update on public.renovation_case_documents
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renovation_case_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.renovation_cases (id) on delete cascade,
  decision text not null,
  conditions text,
  reason text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renovation_case_decisions_decision_check
    check (decision in ('approved', 'conditional', 'rejected'))
);

create index if not exists renovation_case_decisions_case_idx
  on public.renovation_case_decisions (case_id, decided_at desc);

drop trigger if exists trg_renovation_case_decisions_set_updated_at on public.renovation_case_decisions;
create trigger trg_renovation_case_decisions_set_updated_at
before update on public.renovation_case_decisions
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.case_access_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.renovation_cases (id) on delete cascade,
  token_hash text not null unique,
  email text not null,
  scope text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint case_access_links_email_check
    check (btrim(email) <> ''),
  constraint case_access_links_scope_check
    check (scope in ('read', 'upload_documents', 'answer_questions'))
);

create index if not exists case_access_links_case_idx
  on public.case_access_links (case_id, created_at desc);

create index if not exists case_access_links_active_idx
  on public.case_access_links (case_id, expires_at)
  where revoked_at is null;

insert into public.renovation_action_types (key, label, sort_order)
values
  ('bathroom', 'Badrum', 10),
  ('kitchen', 'Kök', 20),
  ('wall', 'Vägg', 30),
  ('plumbing', 'VVS', 40),
  ('electrical', 'El', 50),
  ('ventilation', 'Ventilation', 60),
  ('surface', 'Ytskikt', 70),
  ('other', 'Annat', 80)
on conflict (key) do update
set
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_active = true;

insert into public.renovation_document_types (key, label, description, sort_order)
values
  ('drawing', 'Ritning', 'Plan, skiss eller annan teknisk ritning som beskriver åtgärden.', 10),
  ('certificate', 'Intyg', 'Tekniska eller fackmässiga intyg från entreprenör eller sakkunnig.', 20),
  ('insurance', 'Försäkring', 'Försäkringsbevis eller motsvarande underlag för entreprenör.', 30),
  ('other', 'Övrigt', 'Kompletterande underlag som inte passar i annan dokumenttyp.', 40)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true;
