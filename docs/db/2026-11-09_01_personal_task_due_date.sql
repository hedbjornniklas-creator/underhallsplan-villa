-- Explicit date editing for personal to-dos only. No existing rows are rewritten.
begin;

create or replace function public.set_personal_task_due_date(
  p_org_id uuid, p_task_id uuid, p_actor_profile_id uuid,
  p_expected_version integer, p_due_at timestamptz
) returns public.operational_tasks
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  task_row public.operational_tasks%rowtype;
  result public.operational_tasks%rowtype;
  actor_name_value text;
  next_followup_value timestamptz;
begin
  if auth.role() is distinct from 'service_role' or p_actor_profile_id is null then
    raise exception 'TASK_DUE_EDIT_FORBIDDEN';
  end if;
  select task.* into task_row from public.operational_tasks task
    where task.org_id = p_org_id and task.id = p_task_id and task.archived_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not exists(select 1 from public.org_members m where m.org_id = p_org_id
    and m.profile_id = p_actor_profile_id and m.is_active) then
    raise exception 'TASK_DUE_EDIT_FORBIDDEN';
  end if;
  if task_row.status in ('approved', 'cancelled') then raise exception 'TASK_TERMINAL'; end if;
  if task_row.issuer_profile_id <> p_actor_profile_id
    or task_row.assignee_profile_id is distinct from p_actor_profile_id
    or task_row.assignee_contact_id is not null or task_row.parent_task_id is not null
    or task_row.task_kind <> 'simple' or task_row.created_source <> 'manual' then
    raise exception 'TASK_DUE_EDIT_FORBIDDEN';
  end if;
  if p_expected_version is null or p_expected_version <= 0 then raise exception 'TASK_VERSION_REQUIRED'; end if;
  if task_row.version <> p_expected_version then raise exception 'TASK_VERSION_CONFLICT'; end if;
  if p_due_at is not null and not isfinite(p_due_at) then raise exception 'TASK_DUE_REQUIRED'; end if;
  if exists(select 1 from public.task_recurrence_rules where task_id = task_row.id and is_active) then
    raise exception 'TASK_DUE_EDIT_RECURRENCE';
  end if;
  if exists(select 1 from public.task_deadline_change_requests where task_id = task_row.id and status = 'pending') then
    raise exception 'TASK_DUE_EDIT_PENDING_REQUEST';
  end if;
  if p_due_at is null and exists(select 1 from public.operational_tasks
    where parent_task_id = task_row.id and archived_at is null) then
    raise exception 'TASK_DUE_EDIT_CHILDREN';
  end if;
  if p_due_at is null and task_row.status in ('waiting', 'ready_for_review', 'returned') then
    raise exception 'TASK_DUE_EDIT_STATUS';
  end if;
  if p_due_at is not null and exists(select 1 from public.operational_tasks
    where parent_task_id = task_row.id and archived_at is null
      and status not in ('approved', 'cancelled') and due_at > p_due_at) then
    raise exception 'TASK_PARENT_DUE_BEFORE_CHILD';
  end if;
  if task_row.due_at is not distinct from p_due_at then return task_row; end if;

  -- Preserve reminder preferences. An undated to-do must not start dispatching mail.
  next_followup_value := case when p_due_at is null then null
    else least(coalesce(task_row.next_followup_at, p_due_at), p_due_at) end;
  if p_due_at is null then
    update public.task_followup_rules set is_active = false, initial_dispatch_pending = false
      where task_id = task_row.id and org_id = p_org_id;
  end if;
  update public.operational_tasks set due_at = p_due_at, next_followup_at = next_followup_value,
    last_activity_at = now() where id = task_row.id returning * into result;
  select coalesce(nullif(btrim(full_name), ''), email, 'Uppdragsansvarig') into actor_name_value
    from public.profiles where id = p_actor_profile_id;
  insert into public.task_events(org_id, task_id, event_type, actor_type, actor_profile_id, actor_name, message, metadata)
    values(p_org_id, task_row.id, 'due_date_changed', 'profile', p_actor_profile_id, actor_name_value,
      'Sluttiden ändrades från ' || coalesce(to_char(task_row.due_at at time zone task_row.due_timezone, 'YYYY-MM-DD HH24:MI'), 'utan datum')
      || ' till ' || coalesce(to_char(p_due_at at time zone task_row.due_timezone, 'YYYY-MM-DD HH24:MI'), 'utan datum')
      || ' (' || task_row.due_timezone || ').',
      jsonb_build_object('previousDueAt', task_row.due_at, 'dueAt', p_due_at,
        'previousFollowupAt', task_row.next_followup_at, 'nextFollowupAt', next_followup_value,
        'taskMutationApplied', true));
  return result;
end;
$$;
revoke all on function public.set_personal_task_due_date(uuid,uuid,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.set_personal_task_due_date(uuid,uuid,uuid,integer,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
