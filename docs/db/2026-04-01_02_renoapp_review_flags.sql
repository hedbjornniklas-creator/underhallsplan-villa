-- RenoApp review flags
-- Date: 2026-04-01
-- Additive only / rollback-safe:
--  - Adds reusable review flags for board attention
--  - Lets question answers trigger board-facing risk and missing-part flags
-- Prerequisite:
--  - 2026-04-01_01_renoapp_participant_application_flow.sql

create table if not exists public.renoapp_review_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  severity text not null default 'warning',
  category text not null default 'general',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_review_flags_key_check
    check (key = lower(key) and key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint renoapp_review_flags_label_check
    check (btrim(label) <> ''),
  constraint renoapp_review_flags_severity_check
    check (severity in ('info', 'warning', 'high')),
  constraint renoapp_review_flags_category_check
    check (btrim(category) <> ''),
  constraint renoapp_review_flags_sort_order_check
    check (sort_order > 0)
);

drop trigger if exists trg_renoapp_review_flags_set_updated_at on public.renoapp_review_flags;
create trigger trg_renoapp_review_flags_set_updated_at
before update on public.renoapp_review_flags
for each row
execute function public.renoapp_set_updated_at();

alter table public.renoapp_apply_option_triggers
  add column if not exists review_flag_id uuid references public.renoapp_review_flags (id) on delete cascade;

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
    check (trigger_type in ('question', 'document', 'participant_role', 'review_flag'));
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
        and review_flag_id is null
      )
      or
      (
        trigger_type = 'document'
        and document_type_id is not null
        and question_id is null
        and participant_role_id is null
        and review_flag_id is null
      )
      or
      (
        trigger_type = 'participant_role'
        and participant_role_id is not null
        and question_id is null
        and document_type_id is null
        and review_flag_id is null
      )
      or
      (
        trigger_type = 'review_flag'
        and review_flag_id is not null
        and question_id is null
        and document_type_id is null
        and participant_role_id is null
      )
    );
end $$;

create index if not exists renoapp_apply_option_triggers_review_flag_idx
  on public.renoapp_apply_option_triggers (review_flag_id, sort_order);

create unique index if not exists renoapp_apply_option_triggers_option_review_flag_unique
  on public.renoapp_apply_option_triggers (option_id, review_flag_id)
  where review_flag_id is not null;

insert into public.renoapp_review_flags (
  key,
  label,
  description,
  severity,
  category,
  sort_order,
  is_active
)
values
  ('electrical_design_missing', 'Elprojektering saknas', 'Ansökan berör el men sökanden uppger att elprojektering inte finns med.', 'high', 'dokument', 10, true),
  ('structural_impact_unclear', 'Konstruktionspåverkan oklar', 'Det finns osäkerhet kring påverkan på bärande delar eller konstruktion.', 'high', 'teknik', 20, true),
  ('ventilation_impact_unclear', 'Ventilationspåverkan oklar', 'Ansökan indikerar påverkan på ventilation eller frånluft som bör granskas särskilt.', 'warning', 'teknik', 30, true),
  ('contractor_not_selected', 'Entreprenör ej vald', 'Sökanden har ännu inte angett vem som ska utföra arbetet.', 'info', 'entreprenör', 40, true)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  severity = excluded.severity,
  category = excluded.category,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
