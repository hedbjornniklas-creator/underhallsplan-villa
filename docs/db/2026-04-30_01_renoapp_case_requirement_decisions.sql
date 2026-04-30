-- RenoApp case requirement decisions
-- Date: 2026-04-30
-- Stores board decisions for which suggested documents and participant roles should be requested per case.

create table if not exists public.renoapp_case_requirement_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.renovation_cases (id) on delete cascade,
  document_type_id uuid references public.renovation_document_types (id) on delete cascade,
  participant_role_id uuid references public.renoapp_participant_roles (id) on delete cascade,
  decision text not null,
  note text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_case_requirement_decisions_decision_check check (
    decision in ('requested', 'not_requested')
  ),
  constraint renoapp_case_requirement_decisions_target_check check (
    (
      document_type_id is not null
      and participant_role_id is null
    )
    or
    (
      document_type_id is null
      and participant_role_id is not null
    )
  )
);

drop trigger if exists trg_renoapp_case_requirement_decisions_set_updated_at on public.renoapp_case_requirement_decisions;
create trigger trg_renoapp_case_requirement_decisions_set_updated_at
before update on public.renoapp_case_requirement_decisions
for each row
execute function public.renoapp_set_updated_at();

create index if not exists renoapp_case_requirement_decisions_case_idx
  on public.renoapp_case_requirement_decisions (case_id, decided_at desc);

create unique index if not exists renoapp_case_requirement_decisions_document_unique
  on public.renoapp_case_requirement_decisions (case_id, document_type_id)
  where document_type_id is not null;

create unique index if not exists renoapp_case_requirement_decisions_participant_unique
  on public.renoapp_case_requirement_decisions (case_id, participant_role_id)
  where participant_role_id is not null;
