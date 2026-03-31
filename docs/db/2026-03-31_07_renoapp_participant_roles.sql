-- RenoApp participant roles
-- Date: 2026-03-31
-- Additive only / rollback-safe:
--  - Adds reusable participant roles for entrepreneurs and consultants
--  - Lets action types and question answers require participant roles
-- Prerequisite:
--  - 2026-03-31_05_renoapp_question_option_triggers.sql

create table if not exists public.renoapp_participant_roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  role_kind text not null default 'contractor',
  requires_company_name boolean not null default true,
  requires_org_number boolean not null default false,
  requires_contact_name boolean not null default false,
  requires_email boolean not null default false,
  requires_phone boolean not null default false,
  requires_certification boolean not null default false,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_participant_roles_key_check
    check (key = lower(key) and key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint renoapp_participant_roles_label_check
    check (btrim(label) <> ''),
  constraint renoapp_participant_roles_kind_check
    check (role_kind in ('contractor', 'consultant')),
  constraint renoapp_participant_roles_sort_order_check
    check (sort_order > 0)
);

drop trigger if exists trg_renoapp_participant_roles_set_updated_at on public.renoapp_participant_roles;
create trigger trg_renoapp_participant_roles_set_updated_at
before update on public.renoapp_participant_roles
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renoapp_action_type_participant_roles (
  id uuid primary key default gen_random_uuid(),
  action_type_id uuid not null references public.renovation_action_types (id) on delete cascade,
  participant_role_id uuid not null references public.renoapp_participant_roles (id) on delete cascade,
  is_required boolean not null default true,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_action_type_participant_roles_unique
    unique (action_type_id, participant_role_id),
  constraint renoapp_action_type_participant_roles_sort_order_check
    check (sort_order > 0)
);

create index if not exists renoapp_action_type_participant_roles_action_idx
  on public.renoapp_action_type_participant_roles (action_type_id, sort_order);

create index if not exists renoapp_action_type_participant_roles_role_idx
  on public.renoapp_action_type_participant_roles (participant_role_id, sort_order);

drop trigger if exists trg_renoapp_action_type_participant_roles_set_updated_at on public.renoapp_action_type_participant_roles;
create trigger trg_renoapp_action_type_participant_roles_set_updated_at
before update on public.renoapp_action_type_participant_roles
for each row
execute function public.renoapp_set_updated_at();

alter table public.renoapp_apply_option_triggers
  add column if not exists participant_role_id uuid references public.renoapp_participant_roles (id) on delete cascade;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'renoapp_apply_option_triggers_type_check'
  ) then
    alter table public.renoapp_apply_option_triggers
      drop constraint renoapp_apply_option_triggers_type_check;
  end if;

  alter table public.renoapp_apply_option_triggers
    add constraint renoapp_apply_option_triggers_type_check
    check (trigger_type in ('question', 'document', 'participant_role'));
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'renoapp_apply_option_triggers_target_check'
  ) then
    alter table public.renoapp_apply_option_triggers
      drop constraint renoapp_apply_option_triggers_target_check;
  end if;

  alter table public.renoapp_apply_option_triggers
    add constraint renoapp_apply_option_triggers_target_check
    check (
      (
        trigger_type = 'question'
        and question_id is not null
        and document_type_id is null
        and participant_role_id is null
      )
      or
      (
        trigger_type = 'document'
        and document_type_id is not null
        and question_id is null
        and participant_role_id is null
      )
      or
      (
        trigger_type = 'participant_role'
        and participant_role_id is not null
        and question_id is null
        and document_type_id is null
      )
    );
end $$;

create index if not exists renoapp_apply_option_triggers_participant_role_idx
  on public.renoapp_apply_option_triggers (participant_role_id, sort_order);

create unique index if not exists renoapp_apply_option_triggers_option_participant_role_unique
  on public.renoapp_apply_option_triggers (option_id, participant_role_id)
  where participant_role_id is not null;

insert into public.renoapp_participant_roles (
  key,
  label,
  description,
  role_kind,
  requires_company_name,
  requires_org_number,
  requires_contact_name,
  requires_email,
  requires_phone,
  requires_certification,
  sort_order,
  is_active
)
values
  ('qualified_contractor', 'Kvalificerad entreprenör', 'Allmänt entreprenörskrav när särskild specialist inte behöver anges.', 'contractor', true, true, true, true, true, false, 10, true),
  ('authorized_electrician', 'Behörig elektriker', 'Entreprenör eller elfirma med rätt behörighet för fasta elinstallationer.', 'contractor', true, true, true, true, true, true, 20, true),
  ('safe_water_installer', 'Säker Vatten-auktoriserad VVS-entreprenör', 'VVS-entreprenör med relevant auktorisation för vatten och avlopp.', 'contractor', true, true, true, true, true, true, 30, true),
  ('wet_room_contractor', 'Behörig våtrumsentreprenör', 'Entreprenör med behörighet enligt BKR eller GVK.', 'contractor', true, true, true, true, true, true, 40, true),
  ('structural_engineer', 'Konstruktör', 'Sakkunnig för utlåtanden vid rivning eller påverkan på konstruktion.', 'consultant', true, true, true, true, true, true, 50, true),
  ('ventilation_consultant', 'Ventilationskonsult eller ventilationsentreprenör', 'Sakkunnig eller entreprenör för frågor som påverkar ventilation och frånluft.', 'consultant', true, true, true, true, true, false, 60, true)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  role_kind = excluded.role_kind,
  requires_company_name = excluded.requires_company_name,
  requires_org_number = excluded.requires_org_number,
  requires_contact_name = excluded.requires_contact_name,
  requires_email = excluded.requires_email,
  requires_phone = excluded.requires_phone,
  requires_certification = excluded.requires_certification,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
