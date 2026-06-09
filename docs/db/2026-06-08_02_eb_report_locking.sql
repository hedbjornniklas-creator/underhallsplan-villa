-- EB report locking and stored PDF delivery support
-- Date: 2026-06-08
-- Scope:
-- 1) Track who locked an EB report
-- 2) Lock/unlock EB reports consistently with the global inspection lock while keeping published links active until a new version is published
-- 3) Protect EB inspection data with the shared locked-inspection write guard

alter table public.eb_inspection_details
  add column if not exists report_locked_by uuid references public.profiles (id) on delete set null;

comment on column public.eb_inspection_details.report_locked_at is
  'When the EB report was locked for delivery.';

comment on column public.eb_inspection_details.report_locked_by is
  'Profile that locked the EB report for delivery.';

create or replace function public.lock_eb_inspection_report(
  p_org_id uuid,
  p_project_id uuid,
  p_inspection_id uuid,
  p_performed_by uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_at timestamptz;
  v_existing_inspection_locked_at timestamptz;
  v_existing_report_locked_at timestamptz;
begin
  select i.locked_at, d.report_locked_at
  into v_existing_inspection_locked_at, v_existing_report_locked_at
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

  if v_existing_report_locked_at is not null then
    return v_existing_report_locked_at;
  end if;

  if v_existing_inspection_locked_at is not null then
    return v_existing_inspection_locked_at;
  end if;

  v_locked_at := now();

  update public.eb_inspection_details
  set
    report_locked_at = v_locked_at,
    report_locked_by = p_performed_by
  where org_id = p_org_id
    and eb_project_id = p_project_id
    and inspection_id = p_inspection_id;

  update public.inspections
  set
    status = 'completed',
    locked_at = v_locked_at,
    locked_by = p_performed_by
  where id = p_inspection_id;

  return v_locked_at;
end;
$$;

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

grant execute on function public.lock_eb_inspection_report(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.unlock_eb_inspection_report(uuid, uuid, uuid, text, uuid) to authenticated;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'eb_inspection_details',
    'eb_participants',
    'eb_disciplines',
    'eb_notes'
  ];
begin
  if to_regprocedure('public.guard_locked_inspection_child_write()') is null then
    raise notice 'guard_locked_inspection_child_write() is missing; apply inspection lock migration first.';
    return;
  end if;

  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format(
        'drop trigger if exists trg_guard_locked_inspection_write on public.%I',
        v_table
      );
      execute format(
        'create trigger trg_guard_locked_inspection_write
          before insert or update or delete on public.%I
          for each row
          execute function public.guard_locked_inspection_child_write()',
        v_table
      );
    end if;
  end loop;
end
$$;
