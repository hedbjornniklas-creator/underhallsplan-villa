-- TU coherent whole-report drafts
-- Date: 2026-08-19
-- Scope:
-- 1) Add auditable background runs for coherent whole-report generation
-- 2) Link generated section drafts to approved holistic analysis items
-- 3) Permit the shared suggestion table to store both section and report drafts

alter table public.tu_ai_runs
  drop constraint if exists tu_ai_runs_operation_check;

alter table public.tu_ai_runs
  add constraint tu_ai_runs_operation_check
    check (operation in ('section_draft', 'inspection_analysis', 'report_draft'));

alter table public.tu_ai_suggestions
  add column if not exists source_analysis_item_ids jsonb not null default '[]'::jsonb;

alter table public.tu_ai_suggestions
  drop constraint if exists tu_ai_suggestions_analysis_sources_check;

alter table public.tu_ai_suggestions
  add constraint tu_ai_suggestions_analysis_sources_check
    check (jsonb_typeof(source_analysis_item_ids) = 'array');

comment on column public.tu_ai_suggestions.source_analysis_item_ids is
  'Approved holistic-analysis items used to produce this report section draft.';

create unique index if not exists tu_ai_runs_active_report_draft_idx
  on public.tu_ai_runs (inspection_id)
  where operation = 'report_draft'
    and status in ('queued', 'processing');

create index if not exists tu_ai_suggestions_report_run_idx
  on public.tu_ai_suggestions (run_id, created_at);

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
      and run.operation in ('section_draft', 'report_draft')
  ) then
    raise exception using errcode = '23514', message = 'TU_EVIDENCE_LINK_SCOPE_INVALID';
  end if;

  return new;
end;
$$;
