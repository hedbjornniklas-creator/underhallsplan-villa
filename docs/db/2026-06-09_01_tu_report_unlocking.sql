-- Technical investigations report unlocking
-- Date: 2026-06-09
-- Scope:
-- 1) Unlock TU reports consistently with the global inspection lock
-- 2) Revoke active digital report links when a locked TU report is reopened
-- 3) Log unlock reasons in the shared inspection lock event table

create or replace function public.unlock_tu_investigation_report(
  p_org_id uuid,
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
  from public.technical_investigation_details d
  join public.inspections i on i.id = d.inspection_id
  where d.org_id = p_org_id
    and d.inspection_id = p_inspection_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TU_INSPECTION_NOT_FOUND';
  end if;

  if v_was_locked_at is null and v_report_locked_at is null then
    raise exception using
      errcode = '55000',
      message = 'TU_INSPECTION_ALREADY_UNLOCKED';
  end if;

  update public.inspections
  set
    locked_at = null,
    locked_by = null
  where id = p_inspection_id;

  update public.technical_investigation_details
  set
    report_locked_at = null,
    report_locked_by = null
  where org_id = p_org_id
    and inspection_id = p_inspection_id;

  update public.inspection_report_links
  set revoked_at = now()
  where inspection_id = p_inspection_id
    and revoked_at is null;

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

grant execute on function public.unlock_tu_investigation_report(uuid, uuid, text, uuid) to authenticated;
