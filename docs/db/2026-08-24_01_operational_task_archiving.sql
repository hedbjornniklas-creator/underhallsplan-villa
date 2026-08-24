-- Operational tasks: creator-owned, audited soft archive
--
-- Prerequisites:
--  - 2026-08-20_01_operational_tasks_foundation.sql
--  - 2026-08-20_02_operational_task_initial_attachments.sql
--  - 2026-08-22_01_task_recipient_portal_identity.sql
--
-- "Delete" is deliberately implemented as a soft archive. Task history,
-- evidence and already completed deliveries remain available for audit, while
-- the selected task disappears from normal workspaces and recipient portals.

create or replace function public.archive_operational_task(
  p_org_id uuid,
  p_task_id uuid,
  p_expected_version integer,
  p_actor_profile_id uuid
)
returns public.operational_tasks
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  task_row public.operational_tasks%rowtype;
  result public.operational_tasks%rowtype;
  actor_name_value text;
  archived_at_value timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_ARCHIVE_FORBIDDEN';
  end if;

  if p_org_id is null
    or p_task_id is null
    or p_actor_profile_id is null
  then
    raise exception using
      errcode = '22023',
      message = 'TASK_ARCHIVE_INPUT_INVALID';
  end if;

  if p_expected_version is null or p_expected_version <= 0 then
    raise exception using
      errcode = '22023',
      message = 'TASK_VERSION_REQUIRED';
  end if;

  -- The row lock serializes archive, transition and direct-child creation for
  -- this task. create_operational_task also locks its parent before inserting.
  select task.*
  into task_row
  from public.operational_tasks task
  where task.id = p_task_id
    and task.org_id = p_org_id
    and task.archived_at is null
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK_NOT_FOUND';
  end if;

  -- Ownership is intentionally narrower than ordinary task management:
  -- neither an organization admin nor the immutable issuer can substitute for
  -- the exact profile recorded as the task creator.
  if task_row.created_by_profile_id is distinct from p_actor_profile_id then
    raise exception using
      errcode = '42501',
      message = 'TASK_ARCHIVE_FORBIDDEN';
  end if;

  if task_row.version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'TASK_VERSION_CONFLICT';
  end if;

  -- A task tree must be archived from the leaves upwards. Any direct child,
  -- including an approved or cancelled child, blocks the parent until that
  -- child has itself been archived.
  if exists (
    select 1
    from public.operational_tasks child
    where child.parent_task_id = task_row.id
      and child.archived_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_ARCHIVE_CHILDREN_EXIST';
  end if;

  select coalesce(
    nullif(btrim(profile.full_name), ''),
    profile.email,
    'Intern anvandare'
  )
  into actor_name_value
  from public.profiles profile
  where profile.id = p_actor_profile_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TASK_ARCHIVE_FORBIDDEN';
  end if;

  update public.operational_tasks task
  set
    archived_at = archived_at_value,
    last_activity_at = archived_at_value
  where task.id = task_row.id
    and task.org_id = task_row.org_id
    and task.archived_at is null
  returning * into result;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'TASK_VERSION_CONFLICT';
  end if;

  -- Preserve the complete history while recording the visibility mutation as
  -- an append-only event. taskMutationApplied prevents the activity trigger
  -- from touching/incrementing the task a second time.
  insert into public.task_events (
    org_id,
    task_id,
    event_type,
    actor_type,
    actor_profile_id,
    actor_contact_id,
    actor_access_link_id,
    actor_name,
    message,
    from_status,
    to_status,
    metadata,
    created_at
  )
  values (
    task_row.org_id,
    task_row.id,
    'task_archived',
    'profile',
    p_actor_profile_id,
    null,
    null,
    actor_name_value,
    'Uppgiften arkiverades.',
    task_row.status,
    task_row.status,
    jsonb_build_object(
      'taskMutationApplied', true,
      'archivedByProfileId', p_actor_profile_id,
      'archivedAt', archived_at_value
    ),
    archived_at_value
  );

  -- Revoke every exact-task access credential. Branch links rooted in an
  -- ancestor are left intact because revoking one would also remove access to
  -- unrelated sibling tasks; all task resolvers reject archived targets.
  update public.task_access_links access_link
  set revoked_at = coalesce(access_link.revoked_at, archived_at_value)
  where access_link.task_id = task_row.id
    and access_link.revoked_at is null;

  update public.task_recipient_portal_grants portal_grant
  set
    revoked_at = coalesce(portal_grant.revoked_at, archived_at_value),
    revocation_reason = coalesce(
      portal_grant.revocation_reason,
      'task_archived'
    )
  where portal_grant.task_id = task_row.id
    and portal_grant.revoked_at is null;

  update public.task_recipient_activation_tokens activation_token
  set revoked_at = archived_at_value
  where activation_token.task_id = task_row.id
    and activation_token.consumed_at is null
    and activation_token.revoked_at is null;

  -- Close pending workflow work without deleting its audit rows.
  update public.task_deadline_change_requests deadline_request
  set status = 'cancelled'
  where deadline_request.task_id = task_row.id
    and deadline_request.status = 'pending';

  update public.task_followup_rules followup_rule
  set
    is_active = false,
    initial_dispatch_pending = false
  where followup_rule.task_id = task_row.id;

  update public.task_automation_jobs job
  set
    status = 'cancelled',
    completed_at = coalesce(job.completed_at, archived_at_value),
    locked_at = null,
    locked_by = null,
    heartbeat_at = null,
    error_message = 'TASK_ARCHIVED'
  where job.task_id = task_row.id
    and job.status in ('queued', 'processing', 'failed');

  -- A provider call that is already in flight cannot be recalled, but marking
  -- sending rows cancelled prevents any later retry from this database.
  update public.task_message_deliveries delivery
  set
    status = 'cancelled',
    next_attempt_at = null,
    error_message = 'TASK_ARCHIVED'
  where delivery.task_id = task_row.id
    and delivery.status in ('queued', 'sending', 'failed');

  update public.task_ai_runs ai_run
  set
    status = 'cancelled',
    heartbeat_at = null,
    completed_at = coalesce(ai_run.completed_at, archived_at_value),
    error_message = 'TASK_ARCHIVED'
  where ai_run.task_id = task_row.id
    and ai_run.status in ('queued', 'processing');

  update public.task_ai_suggestions suggestion
  set
    status = 'expired',
    expires_at = archived_at_value
  where suggestion.task_id = task_row.id
    and suggestion.status = 'pending';

  select task.*
  into result
  from public.operational_tasks task
  where task.id = task_row.id
    and task.org_id = task_row.org_id;

  return result;
end;
$$;

comment on function public.archive_operational_task(uuid, uuid, integer, uuid) is
  'Service-only audited soft archive. Only the exact created_by_profile_id may archive a leaf task.';

revoke all on function public.archive_operational_task(uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.archive_operational_task(uuid, uuid, integer, uuid)
  to service_role;

-- Archived tasks must not remain visible through the authenticated RLS helper
-- functions, even though their rows and audit data are deliberately retained.
create or replace function public.can_work_operational_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.operational_tasks task
    where task.id = p_task_id
      and task.archived_at is null
      and public.has_operational_task_module_access(task.org_id)
      and (
        public.is_org_admin(task.org_id)
        or task.issuer_profile_id = auth.uid()
        or task.assignee_profile_id = auth.uid()
      )
  );
$$;

create or replace function public.can_manage_operational_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.operational_tasks task
    where task.id = p_task_id
      and task.archived_at is null
      and public.has_operational_task_module_access(task.org_id)
      and (
        public.is_org_admin(task.org_id)
        or task.issuer_profile_id = auth.uid()
      )
  );
$$;

create or replace function public.can_view_operational_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with recursive
  target as (
    select task.id, task.org_id
    from public.operational_tasks task
    where task.id = p_task_id
      and task.archived_at is null
  ),
  directly_involved as (
    select task.id, task.parent_task_id, task.org_id
    from public.operational_tasks task
    join target on target.org_id = task.org_id
    where task.archived_at is null
      and (
        task.issuer_profile_id = auth.uid()
        or task.assignee_profile_id = auth.uid()
      )
  ),
  visible_ancestors as (
    select task.id, task.parent_task_id, task.org_id
    from directly_involved task
    union
    select parent.id, parent.parent_task_id, parent.org_id
    from public.operational_tasks parent
    join visible_ancestors child
      on parent.id = child.parent_task_id
    where parent.archived_at is null
  ),
  visible_descendants as (
    select task.id, task.org_id
    from directly_involved task
    union
    select child.id, child.org_id
    from public.operational_tasks child
    join visible_descendants parent
      on child.parent_task_id = parent.id
    where child.archived_at is null
  )
  select exists (
    select 1
    from target
    where public.has_operational_task_module_access(target.org_id)
      and (
        public.is_org_admin(target.org_id)
        or exists (
          select 1
          from visible_ancestors
          where visible_ancestors.id = target.id
        )
        or exists (
          select 1
          from visible_descendants
          where visible_descendants.id = target.id
        )
      )
  );
$$;

revoke all on function public.can_work_operational_task(uuid) from public, anon;
revoke all on function public.can_manage_operational_task(uuid) from public, anon;
revoke all on function public.can_view_operational_task(uuid) from public, anon;
grant execute on function public.can_work_operational_task(uuid) to authenticated;
grant execute on function public.can_manage_operational_task(uuid) to authenticated;
grant execute on function public.can_view_operational_task(uuid) to authenticated;
