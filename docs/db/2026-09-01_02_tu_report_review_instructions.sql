-- TU report review instructions
-- Date: 2026-09-01
-- Scope:
-- 1) Store inspector instructions separately from field evidence
-- 2) Preserve before/after text for auditable AI-assisted report revisions
-- 3) Support background processing, application and revert without changing OB or EB

create extension if not exists pgcrypto;

alter table public.tu_ai_runs
  drop constraint if exists tu_ai_runs_operation_check;

alter table public.tu_ai_runs
  add constraint tu_ai_runs_operation_check
    check (operation in ('section_draft', 'inspection_analysis', 'report_draft', 'report_review'));

create unique index if not exists tu_ai_runs_active_report_review_idx
  on public.tu_ai_runs (inspection_id)
  where operation = 'report_review'
    and status in ('queued', 'processing');

create table if not exists public.tu_report_review_instructions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  base_run_id uuid references public.tu_ai_runs (id) on delete set null,
  result_run_id uuid unique references public.tu_ai_runs (id) on delete set null,
  scope text not null default 'section',
  target_section_id text,
  target_section_title text,
  instruction text not null,
  status text not null default 'queued',
  impact_summary text,
  affected_section_ids jsonb not null default '[]'::jsonb,
  before_sections jsonb not null default '[]'::jsonb,
  after_sections jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  created_by uuid references public.profiles (id) on delete set null,
  applied_by uuid references public.profiles (id) on delete set null,
  applied_at timestamptz,
  reverted_by uuid references public.profiles (id) on delete set null,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tu_report_review_instructions_scope_check
    check (scope in ('section', 'report')),
  constraint tu_report_review_instructions_target_check
    check (
      (scope = 'section' and btrim(coalesce(target_section_id, '')) <> '')
      or (scope = 'report' and target_section_id is null)
    ),
  constraint tu_report_review_instructions_instruction_check
    check (char_length(btrim(instruction)) >= 3),
  constraint tu_report_review_instructions_status_check
    check (status in ('queued', 'processing', 'completed', 'applied', 'rejected', 'failed', 'reverted')),
  constraint tu_report_review_instructions_affected_check
    check (jsonb_typeof(affected_section_ids) = 'array'),
  constraint tu_report_review_instructions_before_check
    check (jsonb_typeof(before_sections) = 'array'),
  constraint tu_report_review_instructions_after_check
    check (jsonb_typeof(after_sections) = 'array'),
  constraint tu_report_review_instructions_warnings_check
    check (jsonb_typeof(warnings) = 'array')
);

create unique index if not exists tu_report_review_instructions_active_idx
  on public.tu_report_review_instructions (inspection_id)
  where status in ('queued', 'processing');

create index if not exists tu_report_review_instructions_history_idx
  on public.tu_report_review_instructions (inspection_id, created_at desc);

drop trigger if exists trg_tu_report_review_instructions_set_updated_at
  on public.tu_report_review_instructions;
create trigger trg_tu_report_review_instructions_set_updated_at
before update on public.tu_report_review_instructions
for each row execute function public.technical_investigations_set_updated_at();

alter table public.tu_report_review_instructions enable row level security;

grant select, insert, update, delete on table
  public.tu_report_review_instructions
to authenticated;

drop policy if exists tu_report_review_instructions_member_all
  on public.tu_report_review_instructions;
create policy tu_report_review_instructions_member_all
  on public.tu_report_review_instructions
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

do $$
begin
  if to_regprocedure('public.guard_locked_inspection_child_write()') is null then
    raise notice 'guard_locked_inspection_child_write() is missing; apply inspection lock migration first.';
    return;
  end if;

  execute 'drop trigger if exists trg_guard_locked_inspection_write
    on public.tu_report_review_instructions';
  execute 'create trigger trg_guard_locked_inspection_write
    before insert or update or delete on public.tu_report_review_instructions
    for each row execute function public.guard_locked_inspection_child_write()';
end
$$;

create or replace function public.validate_tu_ai_suggestion_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.tu_ai_runs run
    where run.id = new.run_id
      and run.org_id = new.org_id
      and run.inspection_id = new.inspection_id
      and run.operation in ('section_draft', 'report_draft', 'report_review')
  ) then
    raise exception using errcode = '23514', message = 'TU_EVIDENCE_LINK_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

comment on table public.tu_report_review_instructions is
  'Inspector-authored review decisions and their AI-assisted report revisions.';
comment on column public.tu_report_review_instructions.instruction is
  'Authoritative inspector instruction. It is review evidence, not original field evidence.';
comment on column public.tu_report_review_instructions.before_sections is
  'Report section texts before the instruction was applied, retained for audit and revert.';
comment on column public.tu_report_review_instructions.after_sections is
  'AI-proposed affected report section texts after holistic consistency review.';
