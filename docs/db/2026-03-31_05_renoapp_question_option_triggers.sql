-- RenoApp question option triggers
-- Date: 2026-03-31
-- Additive only / rollback-safe:
--  - Lets an answer option trigger follow-up questions and document requirements
-- Prerequisite:
--  - 2026-03-31_03_renoapp_question_bank.sql

create table if not exists public.renoapp_apply_option_triggers (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.renoapp_apply_question_options (id) on delete cascade,
  trigger_type text not null,
  question_id uuid references public.renoapp_apply_questions (id) on delete cascade,
  document_type_id uuid references public.renovation_document_types (id) on delete cascade,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_apply_option_triggers_type_check
    check (trigger_type in ('question', 'document')),
  constraint renoapp_apply_option_triggers_sort_order_check
    check (sort_order > 0),
  constraint renoapp_apply_option_triggers_target_check
    check (
      (trigger_type = 'question' and question_id is not null and document_type_id is null)
      or
      (trigger_type = 'document' and document_type_id is not null and question_id is null)
    )
);

create index if not exists renoapp_apply_option_triggers_option_idx
  on public.renoapp_apply_option_triggers (option_id, sort_order);

create index if not exists renoapp_apply_option_triggers_question_idx
  on public.renoapp_apply_option_triggers (question_id, sort_order);

create index if not exists renoapp_apply_option_triggers_document_idx
  on public.renoapp_apply_option_triggers (document_type_id, sort_order);

create unique index if not exists renoapp_apply_option_triggers_option_question_unique
  on public.renoapp_apply_option_triggers (option_id, question_id)
  where question_id is not null;

create unique index if not exists renoapp_apply_option_triggers_option_document_unique
  on public.renoapp_apply_option_triggers (option_id, document_type_id)
  where document_type_id is not null;

drop trigger if exists trg_renoapp_apply_option_triggers_set_updated_at on public.renoapp_apply_option_triggers;
create trigger trg_renoapp_apply_option_triggers_set_updated_at
before update on public.renoapp_apply_option_triggers
for each row
execute function public.renoapp_set_updated_at();

insert into public.renoapp_apply_option_triggers (
  option_id,
  trigger_type,
  question_id,
  document_type_id,
  sort_order,
  is_active
)
select
  option_row.id,
  seed.trigger_type,
  question_target.id,
  document_target.id,
  seed.sort_order,
  true
from (
  values
    ('wet_room_project_scope', 'relocate_new_position', 'question', 'wall_demolition_needed', null, 10),
    ('wet_room_project_scope', 'relocate_new_position', 'question', 'ventilation_affected', null, 20),
    ('wet_room_project_scope', 'relocate_new_position', 'question', 'contractor_selected', null, 30),
    ('wet_room_project_scope', 'relocate_new_position', 'document', null, 'certificate', 40),
    ('wet_room_project_scope', 'build_additional', 'question', 'wall_demolition_needed', null, 10),
    ('wet_room_project_scope', 'build_additional', 'question', 'ventilation_affected', null, 20),
    ('wet_room_project_scope', 'build_additional', 'question', 'contractor_selected', null, 30),
    ('wet_room_project_scope', 'build_additional', 'document', null, 'certificate', 40),
    ('wall_demolition_needed', 'yes', 'document', null, 'certificate', 10),
    ('wall_demolition_needed', 'unknown', 'document', null, 'certificate', 20),
    ('ventilation_affected', 'yes', 'document', null, 'certificate', 10),
    ('ventilation_affected', 'unknown', 'document', null, 'certificate', 20)
) as seed (question_key, option_key, trigger_type, target_question_key, target_document_key, sort_order)
join public.renoapp_apply_questions question_row
  on question_row.key = seed.question_key
join public.renoapp_apply_question_options option_row
  on option_row.question_id = question_row.id
 and option_row.key = seed.option_key
left join public.renoapp_apply_questions question_target
  on seed.trigger_type = 'question'
 and question_target.key = seed.target_question_key
left join public.renovation_document_types document_target
  on seed.trigger_type = 'document'
 and document_target.key = seed.target_document_key
where
  (seed.trigger_type = 'question' and question_target.id is not null)
  or
  (seed.trigger_type = 'document' and document_target.id is not null)
on conflict do nothing;
