-- TU analysis scope trigger fix
-- Date: 2026-08-19
-- Scope:
-- 1) Validate workflow and analysis-item run references with table-specific triggers
-- 2) Avoid accessing fields that do not exist on the trigger row type

drop trigger if exists trg_validate_tu_analysis_workflow_scope
  on public.tu_analysis_workflows;
drop trigger if exists trg_validate_tu_ai_analysis_items_scope
  on public.tu_ai_analysis_items;

drop function if exists public.validate_tu_analysis_scope();

create or replace function public.validate_tu_analysis_workflow_scope()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.current_analysis_run_id is not null and not exists (
    select 1
    from public.tu_ai_runs run
    where run.id = new.current_analysis_run_id
      and run.org_id = new.org_id
      and run.inspection_id = new.inspection_id
      and run.operation = 'inspection_analysis'
  ) then
    raise exception using errcode = '23514', message = 'TU_ANALYSIS_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

create or replace function public.validate_tu_analysis_item_scope()
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
      and run.operation = 'inspection_analysis'
  ) then
    raise exception using errcode = '23514', message = 'TU_ANALYSIS_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

create trigger trg_validate_tu_analysis_workflow_scope
before insert or update on public.tu_analysis_workflows
for each row execute function public.validate_tu_analysis_workflow_scope();

create trigger trg_validate_tu_ai_analysis_items_scope
before insert or update on public.tu_ai_analysis_items
for each row execute function public.validate_tu_analysis_item_scope();

update public.tu_ai_runs run
set
  status = 'failed',
  error_message = 'Analyskörningen saknade koppling till arbetsflödet och avslutades vid triggerkorrigering.',
  progress_stage = 'failed',
  progress_message = 'En tidigare analysstart kunde inte slutföras. Starta analysen igen.',
  heartbeat_at = now(),
  completed_at = now()
where run.operation = 'inspection_analysis'
  and run.status in ('queued', 'processing')
  and not exists (
    select 1
    from public.tu_analysis_workflows workflow
    where workflow.current_analysis_run_id = run.id
  );
