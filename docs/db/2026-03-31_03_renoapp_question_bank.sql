-- RenoApp question bank foundation
-- Date: 2026-03-31
-- Additive only / rollback-safe:
--  - Adds reusable apply questions and options
--  - Adds mapping between renovation types and questions
-- Prerequisite:
--  - 2026-03-30_01_renoapp_universal_apply_model.sql

create table if not exists public.renoapp_apply_questions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  help_text text,
  response_type text not null default 'single_select',
  sort_order integer not null default 100,
  is_locked boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_apply_questions_key_check
    check (key = lower(key) and key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint renoapp_apply_questions_label_check
    check (btrim(label) <> ''),
  constraint renoapp_apply_questions_response_type_check
    check (response_type in ('single_select', 'multi_select', 'boolean')),
  constraint renoapp_apply_questions_sort_order_check
    check (sort_order > 0)
);

drop trigger if exists trg_renoapp_apply_questions_set_updated_at on public.renoapp_apply_questions;
create trigger trg_renoapp_apply_questions_set_updated_at
before update on public.renoapp_apply_questions
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renoapp_apply_question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.renoapp_apply_questions (id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_apply_question_options_key_check
    check (key = lower(key) and key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint renoapp_apply_question_options_label_check
    check (btrim(label) <> ''),
  constraint renoapp_apply_question_options_sort_order_check
    check (sort_order > 0),
  constraint renoapp_apply_question_options_question_key_unique
    unique (question_id, key)
);

create index if not exists renoapp_apply_question_options_question_idx
  on public.renoapp_apply_question_options (question_id, sort_order);

drop trigger if exists trg_renoapp_apply_question_options_set_updated_at on public.renoapp_apply_question_options;
create trigger trg_renoapp_apply_question_options_set_updated_at
before update on public.renoapp_apply_question_options
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renoapp_action_type_questions (
  id uuid primary key default gen_random_uuid(),
  action_type_id uuid not null references public.renovation_action_types (id) on delete cascade,
  question_id uuid not null references public.renoapp_apply_questions (id) on delete cascade,
  sort_order integer not null default 100,
  is_required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_action_type_questions_sort_order_check
    check (sort_order > 0),
  constraint renoapp_action_type_questions_unique
    unique (action_type_id, question_id)
);

create index if not exists renoapp_action_type_questions_action_idx
  on public.renoapp_action_type_questions (action_type_id, sort_order);

create index if not exists renoapp_action_type_questions_question_idx
  on public.renoapp_action_type_questions (question_id, sort_order);

drop trigger if exists trg_renoapp_action_type_questions_set_updated_at on public.renoapp_action_type_questions;
create trigger trg_renoapp_action_type_questions_set_updated_at
before update on public.renoapp_action_type_questions
for each row
execute function public.renoapp_set_updated_at();

insert into public.renoapp_apply_questions (
  key,
  label,
  help_text,
  response_type,
  sort_order,
  is_locked,
  is_active,
  metadata
)
values
  (
    'wet_room_project_scope',
    'Vad gäller ditt våtrumsprojekt?',
    'Vi använder svaret för att avgöra vilket underlag som behöver bifogas.',
    'single_select',
    10,
    true,
    true,
    '{"scope":"wet_room"}'::jsonb
  ),
  (
    'wall_demolition_needed',
    'Behöver någon vägg rivas för att genomföra ändringen?',
    'Detta avgör om konstruktionsunderlag kan behöva bifogas.',
    'single_select',
    20,
    true,
    true,
    '{"scope":"layout"}'::jsonb
  ),
  (
    'ventilation_affected',
    'Påverkas ventilation eller frånluft?',
    'Detta hjälper oss att avgöra om ventilationsunderlag behöver bifogas.',
    'single_select',
    30,
    true,
    true,
    '{"scope":"ventilation"}'::jsonb
  ),
  (
    'contractor_selected',
    'Finns entreprenör vald redan?',
    'Vi använder svaret för att avgöra vilka entreprenörsuppgifter som kan samlas in redan nu.',
    'single_select',
    40,
    true,
    true,
    '{"scope":"contractor"}'::jsonb
  )
on conflict (key) do update
set
  label = excluded.label,
  help_text = excluded.help_text,
  response_type = excluded.response_type,
  sort_order = excluded.sort_order,
  is_locked = excluded.is_locked,
  is_active = excluded.is_active,
  metadata = excluded.metadata;

insert into public.renoapp_apply_question_options (
  question_id,
  key,
  label,
  description,
  sort_order,
  is_active,
  metadata
)
select
  question_row.id,
  seed.key,
  seed.label,
  seed.description,
  seed.sort_order,
  seed.is_active,
  seed.metadata
from (
  values
    (
      'wet_room_project_scope',
      'renovate_existing',
      'Renovera befintligt badrum',
      'Befintligt våtrum ska uppgraderas eller återställas.',
      10,
      true,
      '{"outcome":"existing"}'::jsonb
    ),
    (
      'wet_room_project_scope',
      'relocate_new_position',
      'Flytta badrummet till ny plats',
      'Våtrummet ska placeras i ett annat rum eller på en ny plats i bostaden.',
      20,
      true,
      '{"outcome":"relocate"}'::jsonb
    ),
    (
      'wet_room_project_scope',
      'build_additional',
      'Bygga ett extra badrum',
      'Ett nytt extra våtrum ska skapas utöver det som redan finns.',
      30,
      true,
      '{"outcome":"additional"}'::jsonb
    ),
    (
      'wall_demolition_needed',
      'yes',
      'Ja',
      'Vägg behöver rivas helt eller delvis.',
      10,
      true,
      '{}'::jsonb
    ),
    (
      'wall_demolition_needed',
      'no',
      'Nej',
      'Ingen vägg behöver rivas.',
      20,
      true,
      '{}'::jsonb
    ),
    (
      'wall_demolition_needed',
      'unknown',
      'Vet inte',
      'Osäkert om vägg behöver rivas.',
      30,
      true,
      '{}'::jsonb
    ),
    (
      'ventilation_affected',
      'yes',
      'Ja',
      'Ventilation eller frånluft påverkas.',
      10,
      true,
      '{}'::jsonb
    ),
    (
      'ventilation_affected',
      'no',
      'Nej',
      'Ventilation eller frånluft påverkas inte.',
      20,
      true,
      '{}'::jsonb
    ),
    (
      'ventilation_affected',
      'unknown',
      'Vet inte',
      'Osäkert om ventilation eller frånluft påverkas.',
      30,
      true,
      '{}'::jsonb
    ),
    (
      'contractor_selected',
      'yes',
      'Ja',
      'Entreprenör är redan vald.',
      10,
      true,
      '{}'::jsonb
    ),
    (
      'contractor_selected',
      'no',
      'Nej',
      'Entreprenör är inte vald ännu.',
      20,
      true,
      '{}'::jsonb
    )
) as seed (
  question_key,
  key,
  label,
  description,
  sort_order,
  is_active,
  metadata
)
join public.renoapp_apply_questions question_row
  on question_row.key = seed.question_key
on conflict (question_id, key) do update
set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  metadata = excluded.metadata;
