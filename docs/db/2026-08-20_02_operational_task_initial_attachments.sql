-- Uppdrag v1: atomic initial-dispatch hold while creator attachments upload
-- Date: 2026-08-20
-- Prerequisite: 2026-08-20_01_operational_tasks_foundation.sql
--
-- A task is still created as assigned, but its first follow-up/assignment job
-- can be held in the same transaction until all initial attachments are saved.

alter table public.task_followup_rules
  add column if not exists initial_dispatch_pending boolean not null default false;

comment on column public.task_followup_rules.initial_dispatch_pending is
  'True only while the creator is uploading initial task attachments. Finalization atomically releases the first assignment evaluation.';

create or replace function public.create_operational_task_with_dispatch_control(
  p_org_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_next_followup_at timestamptz,
  p_primary_channel text,
  p_task_kind text,
  p_evidence_requirement text,
  p_defer_initial_dispatch boolean,
  p_assignee_profile_id uuid default null,
  p_assignee_contact_id uuid default null,
  p_parent_task_id uuid default null,
  p_expected_parent_version integer default null,
  p_description text default null,
  p_context_label text default null,
  p_fallback_channel text default null,
  p_requirements jsonb default '[]'::jsonb,
  p_actor_profile_id uuid default null,
  p_actor_contact_id uuid default null,
  p_actor_access_link_id uuid default null,
  p_source_ai_suggestion_id uuid default null
)
returns public.operational_tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result public.operational_tasks%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_CREATE_WITH_DISPATCH_CONTROL_FORBIDDEN';
  end if;

  if p_defer_initial_dispatch is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_INITIAL_DISPATCH_CONTROL_REQUIRED';
  end if;

  result := public.create_operational_task(
    p_org_id => p_org_id,
    p_title => p_title,
    p_due_at => p_due_at,
    p_next_followup_at => p_next_followup_at,
    p_primary_channel => p_primary_channel,
    p_task_kind => p_task_kind,
    p_evidence_requirement => p_evidence_requirement,
    p_assignee_profile_id => p_assignee_profile_id,
    p_assignee_contact_id => p_assignee_contact_id,
    p_parent_task_id => p_parent_task_id,
    p_expected_parent_version => p_expected_parent_version,
    p_description => p_description,
    p_context_label => p_context_label,
    p_fallback_channel => p_fallback_channel,
    p_requirements => p_requirements,
    p_actor_profile_id => p_actor_profile_id,
    p_actor_contact_id => p_actor_contact_id,
    p_actor_access_link_id => p_actor_access_link_id,
    p_source_ai_suggestion_id => p_source_ai_suggestion_id
  );

  if p_defer_initial_dispatch then
    update public.task_followup_rules followup_rule
    set
      is_active = false,
      initial_dispatch_pending = true
    where followup_rule.org_id = result.org_id
      and followup_rule.task_id = result.id;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'TASK_FOLLOWUP_RULE_NOT_FOUND';
    end if;

    update public.task_automation_jobs job
    set
      status = 'cancelled',
      completed_at = now(),
      locked_at = null,
      locked_by = null,
      heartbeat_at = null,
      error_message = 'Initial dispatch is waiting for creator attachments.'
    where job.org_id = result.org_id
      and job.task_id = result.id
      and job.job_type = 'evaluate_followup'
      and job.status in ('queued', 'failed');
  end if;

  return result;
end;
$$;

comment on function public.create_operational_task_with_dispatch_control(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  boolean,
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  jsonb,
  uuid,
  uuid,
  uuid,
  uuid
) is
  'Service-only atomic wrapper around create_operational_task. It can hold the initial assignment evaluation until creator attachments are ready.';

create or replace function public.finalize_operational_task_initial_dispatch(
  p_org_id uuid,
  p_task_id uuid,
  p_actor_profile_id uuid
)
returns public.operational_tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  actor_name_value text;
  dispatch_is_pending boolean;
  current_job_id uuid;
  current_job_key text;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_INITIAL_DISPATCH_FINALIZE_FORBIDDEN';
  end if;

  if p_org_id is null or p_task_id is null or p_actor_profile_id is null then
    raise exception using
      errcode = '22023',
      message = 'TASK_INITIAL_DISPATCH_FINALIZE_INPUT_INVALID';
  end if;

  select task.*
  into task_row
  from public.operational_tasks task
  where task.org_id = p_org_id
    and task.id = p_task_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOT_FOUND';
  end if;

  select coalesce(
    nullif(btrim(profile.full_name), ''),
    profile.email,
    'Uppdragsansvarig'
  )
  into actor_name_value
  from public.org_members member
  join public.profiles profile
    on profile.id = member.profile_id
  where member.org_id = task_row.org_id
    and member.profile_id = p_actor_profile_id
    and member.is_active = true
    and (
      task_row.issuer_profile_id = p_actor_profile_id
      or member.role = 'admin'
    );

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_INITIAL_DISPATCH_FINALIZE_FORBIDDEN';
  end if;

  if task_row.archived_at is not null
    or task_row.status in ('approved', 'cancelled')
  then
    raise exception using
      errcode = '23514',
      message = 'TASK_INITIAL_DISPATCH_TERMINAL';
  end if;

  select followup_rule.initial_dispatch_pending
  into dispatch_is_pending
  from public.task_followup_rules followup_rule
  where followup_rule.org_id = task_row.org_id
    and followup_rule.task_id = task_row.id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_FOLLOWUP_RULE_NOT_FOUND';
  end if;

  -- A completed retry is deliberately a no-op: it cannot send the assignment
  -- twice or add duplicate audit events.
  if not dispatch_is_pending then
    return task_row;
  end if;

  update public.task_followup_rules followup_rule
  set
    initial_dispatch_pending = false,
    is_active = true
  where followup_rule.org_id = task_row.org_id
    and followup_rule.task_id = task_row.id;

  -- No obsolete queued evaluation may become runnable when the rule is
  -- reactivated. Historical completed/cancelled jobs remain as audit records.
  update public.task_automation_jobs job
  set
    status = 'cancelled',
    completed_at = now(),
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    error_message = 'Superseded by initial dispatch for task version ' || task_row.version::text
  where job.org_id = task_row.org_id
    and job.task_id = task_row.id
    and job.job_type = 'evaluate_followup'
    and job.status in ('queued', 'failed');

  current_job_key :=
    'task-followup-initial-ready:' || task_row.id::text || ':v' || task_row.version::text;

  -- Use a separate ready-job key instead of reviving the trigger-created job.
  -- If a worker already claimed that older job while the rule was inactive,
  -- this queued evaluation still guarantees a pass after the release. Message
  -- idempotency prevents two concurrent evaluations from sending twice.
  insert into public.task_automation_jobs (
    org_id,
    task_id,
    job_type,
    status,
    available_at,
    idempotency_key,
    payload
  )
  values (
    task_row.org_id,
    task_row.id,
    'evaluate_followup',
    'queued',
    now(),
    current_job_key,
    jsonb_build_object(
      'taskVersion', task_row.version,
      'scheduledFrom', 'initial-attachments-finalized'
    )
  )
  on conflict (org_id, idempotency_key) do nothing
  returning id into current_job_id;

  if current_job_id is null then
    select job.id
    into current_job_id
    from public.task_automation_jobs job
    where job.org_id = task_row.org_id
      and job.idempotency_key = current_job_key;
  end if;

  insert into public.task_events (
    org_id,
    task_id,
    event_type,
    actor_type,
    actor_profile_id,
    actor_name,
    message,
    metadata
  )
  values (
    task_row.org_id,
    task_row.id,
    'initial_dispatch_released',
    'profile',
    p_actor_profile_id,
    actor_name_value,
    'Uppdragets första utskick frigjordes efter att underlaget sparats.',
    jsonb_build_object(
      'taskMutationApplied', true,
      'taskVersion', task_row.version,
      'automationJobId', current_job_id,
      'initialDispatchPending', false
    )
  );

  return task_row;
end;
$$;

comment on function public.finalize_operational_task_initial_dispatch(uuid, uuid, uuid) is
  'Service-only idempotent release of an initial task assignment after creator attachments have been saved.';

revoke all on function public.create_operational_task_with_dispatch_control(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  boolean,
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  jsonb,
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

revoke all on function public.finalize_operational_task_initial_dispatch(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_operational_task_with_dispatch_control(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  boolean,
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  jsonb,
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

grant execute on function public.finalize_operational_task_initial_dispatch(uuid, uuid, uuid)
  to service_role;
