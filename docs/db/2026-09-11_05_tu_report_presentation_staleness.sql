-- TU report presentation changes must not invalidate the technical analysis
-- Date: 2026-09-11
-- Scope:
-- 1) Treat report title and project type as presentation metadata
-- 2) Keep technical source changes invalidating an approved analysis
-- 3) Preserve the existing cover-image exception

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
    -- title, project_type and report_draft belong to the reviewed report. They
    -- may be edited without making the technical field analysis obsolete.
    if new.scope_description is not distinct from old.scope_description
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
    if tg_op = 'DELETE' then return old; end if;
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

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
