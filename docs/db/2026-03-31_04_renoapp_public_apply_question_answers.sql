-- RenoApp public apply question answers
-- Date: 2026-03-31
-- Additive only / rollback-safe:
--  - Stores answers to reusable apply questions per renovation case
-- Prerequisite:
--  - 2026-03-31_03_renoapp_question_bank.sql

create table if not exists public.renoapp_case_question_answers (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.renovation_cases (id) on delete cascade,
  question_id uuid not null references public.renoapp_apply_questions (id) on delete cascade,
  option_id uuid not null references public.renoapp_apply_question_options (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_case_question_answers_unique
    unique (case_id, question_id, option_id)
);

create index if not exists renoapp_case_question_answers_case_idx
  on public.renoapp_case_question_answers (case_id, question_id);

create index if not exists renoapp_case_question_answers_question_idx
  on public.renoapp_case_question_answers (question_id, option_id);

drop trigger if exists trg_renoapp_case_question_answers_set_updated_at on public.renoapp_case_question_answers;
create trigger trg_renoapp_case_question_answers_set_updated_at
before update on public.renoapp_case_question_answers
for each row
execute function public.renoapp_set_updated_at();
