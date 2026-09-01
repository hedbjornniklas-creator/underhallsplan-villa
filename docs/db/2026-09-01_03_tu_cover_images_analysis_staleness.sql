-- TU cover images and analysis staleness
-- Date: 2026-09-01
-- Scope:
-- 1) Treat cover images as report presentation, not technical source material
-- 2) Keep source-image changes invalidating an approved analysis
-- 3) Restore workflows that were invalidated only by adding a cover image

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

  if tg_table_name = 'technical_investigation_images' then
    if tg_op = 'INSERT' and new.section_key = 'cover' then
      return new;
    end if;

    if tg_op = 'DELETE' and old.section_key = 'cover' then
      return old;
    end if;

    if tg_op = 'UPDATE' then
      if old.section_key = 'cover' and new.section_key = 'cover' then
        return new;
      end if;

      if old.section_key <> 'cover'
        and new.section_key <> 'cover'
        and new.file_path is not distinct from old.file_path
        and new.storage_bucket is not distinct from old.storage_bucket
        and new.caption is not distinct from old.caption
      then
        return new;
      end if;
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

with repair_candidates as (
  select
    workflow.inspection_id,
    workflow.org_id,
    report_run.approved_at,
    report_run.created_by
  from public.tu_analysis_workflows workflow
  join lateral (
    select
      nullif(run.input_snapshot #>> '{approvedAnalysis,approvedAt}', '')::timestamptz as approved_at,
      run.created_by
    from public.tu_ai_runs run
    where run.org_id = workflow.org_id
      and run.inspection_id = workflow.inspection_id
      and run.operation = 'report_draft'
      and run.status = 'completed'
      and run.input_snapshot #>> '{approvedAnalysis,runId}' = workflow.current_analysis_run_id::text
    order by run.created_at desc
    limit 1
  ) report_run on report_run.approved_at is not null
  where workflow.status = 'in_progress'
    and workflow.analysis_stale_at is not null
    and exists (
      select 1
      from public.technical_investigation_images image
      where image.org_id = workflow.org_id
        and image.inspection_id = workflow.inspection_id
        and image.section_key = 'cover'
        and (
          image.created_at = workflow.analysis_stale_at
          or image.updated_at = workflow.analysis_stale_at
        )
    )
    and not exists (
      select 1
      from public.technical_investigation_images image
      where image.org_id = workflow.org_id
        and image.inspection_id = workflow.inspection_id
        and image.section_key <> 'cover'
        and (
          image.created_at = workflow.analysis_stale_at
          or image.updated_at = workflow.analysis_stale_at
        )
    )
    and not exists (
      select 1
      from public.tu_observations observation
      where observation.org_id = workflow.org_id
        and observation.inspection_id = workflow.inspection_id
        and (
          observation.created_at = workflow.analysis_stale_at
          or observation.updated_at = workflow.analysis_stale_at
        )
    )
    and not exists (
      select 1
      from public.tu_measurements measurement
      where measurement.org_id = workflow.org_id
        and measurement.inspection_id = workflow.inspection_id
        and (
          measurement.created_at = workflow.analysis_stale_at
          or measurement.updated_at = workflow.analysis_stale_at
        )
    )
    and not exists (
      select 1
      from public.tu_observation_images observation_image
      where observation_image.org_id = workflow.org_id
        and observation_image.inspection_id = workflow.inspection_id
        and observation_image.created_at = workflow.analysis_stale_at
    )
)
update public.tu_analysis_workflows workflow
set
  status = 'analysis_approved',
  analysis_approved_at = repair.approved_at,
  analysis_approved_by = coalesce(workflow.analysis_approved_by, repair.created_by),
  analysis_stale_at = null
from repair_candidates repair
where workflow.org_id = repair.org_id
  and workflow.inspection_id = repair.inspection_id;
