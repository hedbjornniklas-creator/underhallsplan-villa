-- EB inspection lifecycle: reopening returns the inspection to ongoing work.
-- Prerequisites: EB locking/link retention and inspection_lock_events migrations.
-- Existing RPC privileges and published report links are preserved.
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid)') is null then
    raise exception 'EB_REPORT_UNLOCK_MIGRATION_REQUIRED';
  end if;
end $$;

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
    raise exception using errcode = '22023', message = 'UNLOCK_REASON_REQUIRED';
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
    raise exception using errcode = 'P0002', message = 'EB_INSPECTION_NOT_FOUND';
  end if;
  if v_was_locked_at is null and v_report_locked_at is null then
    raise exception using errcode = '55000', message = 'EB_INSPECTION_ALREADY_UNLOCKED';
  end if;

  -- The global write guard permits lock-field changes only while OLD is locked.
  -- Clear the lock first; both writes and the audit remain one transaction.
  update public.inspections set locked_at = null, locked_by = null
  where id = p_inspection_id;

  update public.eb_inspection_details
  set report_locked_at = null, report_locked_by = null
  where org_id = p_org_id
    and eb_project_id = p_project_id
    and inspection_id = p_inspection_id;

  update public.inspections set status = 'ongoing'
  where id = p_inspection_id;

  insert into public.inspection_lock_events (
    org_id, inspection_id, action, reason, performed_by
  ) values (
    p_org_id, p_inspection_id, 'unlock', v_reason, p_performed_by
  );

  return coalesce(v_was_locked_at, v_report_locked_at);
end;
$$;

-- Repair only proven, currently unlocked EB work. A missing lock alone is not
-- evidence that an old completed inspection should be reopened.
update public.inspections i
set status = 'ongoing'
from public.eb_inspection_details d
where d.inspection_id = i.id
  and i.locked_at is null
  and d.report_locked_at is null
  and lower(btrim(coalesce(i.status, ''))) in ('completed', 'done', 'klar')
  and exists (
    select 1 from public.inspection_lock_events e
    where e.org_id = d.org_id and e.inspection_id = i.id and e.action = 'unlock'
  );

notify pgrst, 'reload schema';
commit;
