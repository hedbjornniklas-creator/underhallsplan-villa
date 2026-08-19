-- TU holistic AI analysis progress
-- Date: 2026-08-19
-- Scope:
-- 1) Persist the current background-analysis stage and image progress
-- 2) Record a heartbeat so interrupted jobs can be distinguished from active jobs
-- 3) Keep progress state consistent when source changes cancel an analysis

alter table public.tu_ai_runs
  add column if not exists progress_stage text,
  add column if not exists progress_current integer not null default 0,
  add column if not exists progress_total integer not null default 0,
  add column if not exists progress_message text,
  add column if not exists heartbeat_at timestamptz;

alter table public.tu_ai_runs
  drop constraint if exists tu_ai_runs_progress_stage_check,
  drop constraint if exists tu_ai_runs_progress_current_check,
  drop constraint if exists tu_ai_runs_progress_total_check;

alter table public.tu_ai_runs
  add constraint tu_ai_runs_progress_stage_check
    check (
      progress_stage is null
      or progress_stage in (
        'queued',
        'preparing',
        'analyzing_images',
        'synthesizing',
        'saving',
        'completed',
        'failed',
        'cancelled'
      )
    ),
  add constraint tu_ai_runs_progress_current_check
    check (progress_current >= 0),
  add constraint tu_ai_runs_progress_total_check
    check (progress_total >= 0);

comment on column public.tu_ai_runs.progress_stage is
  'Current persisted stage for a background AI run.';
comment on column public.tu_ai_runs.progress_current is
  'Number of completed units in the current AI stage.';
comment on column public.tu_ai_runs.progress_total is
  'Total number of units in the current AI stage.';
comment on column public.tu_ai_runs.progress_message is
  'User-facing status message for the current AI stage.';
comment on column public.tu_ai_runs.heartbeat_at is
  'Last persisted activity timestamp for stale-run detection.';

update public.tu_ai_runs
set
  progress_stage = case status
    when 'queued' then 'queued'
    when 'processing' then 'preparing'
    when 'completed' then 'completed'
    when 'failed' then 'failed'
    when 'cancelled' then 'cancelled'
    else progress_stage
  end,
  progress_message = case status
    when 'queued' then 'Analysen väntar på att starta.'
    when 'processing' then 'Analysen bearbetar underlaget.'
    when 'completed' then 'Analysen är klar för granskning.'
    when 'failed' then 'Analysen kunde inte slutföras.'
    when 'cancelled' then 'Analysen avbröts eftersom underlaget ändrades.'
    else progress_message
  end,
  heartbeat_at = coalesce(heartbeat_at, completed_at, started_at, created_at)
where operation = 'inspection_analysis'
  and progress_stage is null;

create or replace function public.mark_tu_analysis_stale_after_source_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id uuid;
  v_inspection_id uuid;
  v_run_id uuid;
begin
  v_org_id := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  v_inspection_id := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;

  if tg_table_name = 'technical_investigation_images' and tg_op = 'UPDATE' then
    if new.file_path is not distinct from old.file_path
      and new.storage_bucket is not distinct from old.storage_bucket
      and new.caption is not distinct from old.caption
    then
      return new;
    end if;
  end if;

  if tg_table_name = 'technical_investigation_details' and tg_op = 'UPDATE' then
    if new.title is not distinct from old.title
      and new.project_type is not distinct from old.project_type
      and new.scope_description is not distinct from old.scope_description
      and new.background is not distinct from old.background
      and new.basis is not distinct from old.basis
      and new.accessibility is not distinct from old.accessibility
      and new.property_object_type is not distinct from old.property_object_type
      and new.brf_name is not distinct from old.brf_name
      and new.apartment_number is not distinct from old.apartment_number
      and new.apartment_holder_name is not distinct from old.apartment_holder_name
    then
      return new;
    end if;
  end if;

  select current_analysis_run_id
  into v_run_id
  from public.tu_analysis_workflows
  where org_id = v_org_id
    and inspection_id = v_inspection_id
    and status <> 'in_progress';

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if v_run_id is not null then
    update public.tu_ai_runs
    set
      status = 'cancelled',
      error_message = 'Källunderlaget ändrades efter att analysen startades.',
      progress_stage = 'cancelled',
      progress_message = 'Analysen avbröts eftersom underlaget ändrades.',
      heartbeat_at = now(),
      completed_at = now()
    where id = v_run_id
      and status in ('queued', 'processing');
  end if;

  update public.tu_analysis_workflows
  set
    status = 'in_progress',
    analysis_approved_at = null,
    analysis_approved_by = null,
    analysis_stale_at = now()
  where org_id = v_org_id
    and inspection_id = v_inspection_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
