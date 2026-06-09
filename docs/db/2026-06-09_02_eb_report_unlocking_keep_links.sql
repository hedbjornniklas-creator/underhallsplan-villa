-- EB report unlocking link retention
-- Date: 2026-06-09
-- Scope:
-- 1) Unlock EB reports consistently with the global inspection lock
-- 2) Keep active digital report links available until a new version is published
-- 3) Log unlock reasons in the shared inspection lock event table

create or replace function public.unlock_eb_inspection_report(
  p_org_id uuid,
  p_project_id uuid,
  p_inspection_id uuid,
  p_reason text,
  p_performed_by uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_was_locked_at timestamptz;
  v_report_locked_at timestamptz;
begin
  if char_length(v_reason) < 10 then
    raise exception using
      errcode = '22023',
      message = 'UNLOCK_REASON_REQUIRED';
  end if;

  select i.locked_at, d.report_locked_at
  into v_was_locked_at, v_report_locked_at
  from public.eb_inspection_details d
  join public.inspections i on i.id = d.inspection_id
  where d.org_id = p_org_id
    and d.eb_project_id = p_project_id
    and d.inspection_id = p_inspection_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'EB_INSPECTION_NOT_FOUND';
  end if;

  if v_was_locked_at is null and v_report_locked_at is null then
    raise exception using
      errcode = '55000',
      message = 'EB_INSPECTION_ALREADY_UNLOCKED';
  end if;

  update public.inspections
  set
    locked_at = null,
    locked_by = null
  where id = p_inspection_id;

  update public.eb_inspection_details
  set
    report_locked_at = null,
    report_locked_by = null
  where org_id = p_org_id
    and eb_project_id = p_project_id
    and inspection_id = p_inspection_id;

  insert into public.inspection_lock_events (
    org_id,
    inspection_id,
    action,
    reason,
    performed_by
  )
  values (
    p_org_id,
    p_inspection_id,
    'unlock',
    v_reason,
    p_performed_by
  );

  return coalesce(v_was_locked_at, v_report_locked_at);
end;
$$;

grant execute on function public.unlock_eb_inspection_report(uuid, uuid, uuid, text, uuid) to authenticated;
-- EB report unlocking link retention
-- Date: 2026-06-09
-- Scope:
-- 1) Unlock EB reports consistently with the global inspection lock
-- 2) Keep active digital report links available until a new version is published
-- 3) Log unlock reasons in the shared inspection lock event table

create or replace function public.unlock_eb_inspection_report(
  p_org_id uuid,
  p_project_id uuid,
  p_inspection_id uuid,
  p_reason text,
  p_performed_by uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_was_locked_at timestamptz;
  v_report_locked_at timestamptz;
begin
  if char_length(v_reason) < 10 then
    raise exception using
      errcode = '22023',
      message = 'UNLOCK_REASON_REQUIRED';
  end if;

  select i.locked_at, d.report_locked_at
  into v_was_locked_at, v_report_locked_at
  from public.eb_inspection_details d
  join public.inspections i on i.id = d.inspection_id
  where d.org_id = p_org_id
    and d.eb_project_id = p_project_id
    and d.inspection_id = p_inspection_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'EB_INSPECTION_NOT_FOUND';
  end if;

  if v_was_locked_at is null and v_report_locked_at is null then
    raise exception using
      errcode = '55000',
      message = 'EB_INSPECTION_ALREADY_UNLOCKED';
  end if;

  update public.inspections
  set
    locked_at = null,
    locked_by = null
  where id = p_inspection_id;

  update public.eb_inspection_details
  set
    report_locked_at = null,
    report_locked_by = null
  where org_id = p_org_id
    and eb_project_id = p_project_id
    and inspection_id = p_inspection_id;

  insert into public.inspection_lock_events (
    org_id,
    inspection_id,
    action,
    reason,
    performed_by
  )
  values (
    p_org_id,
    p_inspection_id,
    'unlock',
    v_reason,
    p_performed_by
  );

  return coalesce(v_was_locked_at, v_report_locked_at);
end;
$$;

grant execute on function public.unlock_eb_inspection_report(uuid, uuid, uuid, text, uuid) to authenticated;
