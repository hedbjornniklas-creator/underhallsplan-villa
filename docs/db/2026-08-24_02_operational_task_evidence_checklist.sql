-- Uppdrag: multiple required completion-evidence types
-- Date: 2026-08-24
-- Prerequisites:
--   2026-08-20_01_operational_tasks_foundation.sql
--   2026-08-20_02_operational_task_initial_attachments.sql

create table if not exists public.task_completion_evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.operational_tasks (id) on delete cascade,
  evidence_type text not null,
  created_at timestamptz not null default now(),
  constraint task_completion_evidence_requirements_type_check
    check (evidence_type in ('text', 'photo', 'document')),
  constraint task_completion_evidence_requirements_task_type_key
    unique (task_id, evidence_type)
);

create index if not exists idx_task_completion_evidence_requirements_org_task
  on public.task_completion_evidence_requirements (org_id, task_id);

alter table public.task_completion_evidence_requirements enable row level security;

revoke all on table public.task_completion_evidence_requirements from public, anon, authenticated;
grant select on table public.task_completion_evidence_requirements to authenticated, service_role;
grant insert, update, delete on table public.task_completion_evidence_requirements to service_role;

drop policy if exists task_completion_evidence_requirements_select
  on public.task_completion_evidence_requirements;
create policy task_completion_evidence_requirements_select
on public.task_completion_evidence_requirements
for select
to authenticated
using (public.can_view_operational_task(task_id));

drop trigger if exists trg_validate_task_scope
  on public.task_completion_evidence_requirements;
create trigger trg_validate_task_scope
before insert or update on public.task_completion_evidence_requirements
for each row execute function public.validate_task_scoped_record();

-- Preserve the exact requirements of existing single-choice tasks. Legacy
-- "any" remains governed by operational_tasks.evidence_requirement.
insert into public.task_completion_evidence_requirements (org_id, task_id, evidence_type)
select task.org_id, task.id, task.evidence_requirement
from public.operational_tasks task
where task.evidence_requirement in ('text', 'photo', 'document')
on conflict (task_id, evidence_type) do nothing;

create or replace function public.task_completion_evidence_type_present(
  p_task_id uuid,
  p_evidence_type text
)
returns boolean
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.task_attachments attachment
    where attachment.task_id = p_task_id
      and attachment.is_completion_evidence = true
      and (
        attachment.attachment_type = p_evidence_type
        or (
          p_evidence_type = 'text'
          and attachment.attachment_type = 'audio'
          and nullif(btrim(coalesce(attachment.transcript_text, '')), '') is not null
        )
      )
  );
$$;

revoke all on function public.task_completion_evidence_type_present(uuid, text)
  from public, anon, authenticated;
grant execute on function public.task_completion_evidence_type_present(uuid, text)
  to service_role;

create or replace function public.register_task_completion_evidence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  expected_type text;
  actual_type text;
  checklist_count integer;
  checklist_complete boolean;
begin
  if not new.is_completion_evidence then
    return new;
  end if;

  actual_type := case
    when new.attachment_type = 'audio'
      and nullif(btrim(coalesce(new.transcript_text, '')), '') is not null
      then 'text'
    when new.attachment_type in ('text', 'photo', 'document')
      then new.attachment_type
    else null
  end;

  select count(*)::integer
  into checklist_count
  from public.task_completion_evidence_requirements requirement
  where requirement.task_id = new.task_id;

  if checklist_count > 0 then
    if actual_type is null or not exists (
      select 1
      from public.task_completion_evidence_requirements requirement
      where requirement.task_id = new.task_id
        and requirement.evidence_type = actual_type
    ) then
      raise exception using
        errcode = '23514',
        message = 'TASK_COMPLETION_EVIDENCE_TYPE_INVALID';
    end if;

    select not exists (
      select 1
      from public.task_completion_evidence_requirements requirement
      where requirement.task_id = new.task_id
        and not public.task_completion_evidence_type_present(
          new.task_id,
          requirement.evidence_type
        )
    )
    into checklist_complete;

    if checklist_complete then
      update public.task_requirements requirement
      set
        status = 'evidence_detected',
        evidence_attachment_id = new.id,
        verified_by_profile_id = null,
        verified_at = null
      where requirement.task_id = new.task_id
        and requirement.requirement_key = 'completion_evidence'
        and requirement.status in ('pending', 'evidence_detected');
    end if;

    return new;
  end if;

  -- Backwards-compatible behavior for tasks created before the checklist.
  select case task.evidence_requirement
    when 'text' then 'text'
    when 'photo' then 'photo'
    when 'document' then 'document'
    else null
  end
  into expected_type
  from public.operational_tasks task
  where task.id = new.task_id;

  if expected_type is not null and actual_type is distinct from expected_type then
    raise exception using
      errcode = '23514',
      message = 'TASK_COMPLETION_EVIDENCE_TYPE_INVALID';
  end if;

  update public.task_requirements requirement
  set
    status = 'evidence_detected',
    evidence_attachment_id = new.id,
    verified_by_profile_id = null,
    verified_at = null
  where requirement.task_id = new.task_id
    and requirement.requirement_key = 'completion_evidence'
    and requirement.status in ('pending', 'evidence_detected');

  return new;
end;
$$;

create or replace function public.guard_task_completion_evidence_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.requirement_key <> 'completion_evidence'
    or new.status <> 'verified'
    or new.status is not distinct from old.status
  then
    return new;
  end if;

  if exists (
    select 1
    from public.task_completion_evidence_requirements requirement
    where requirement.task_id = new.task_id
      and not public.task_completion_evidence_type_present(
        new.task_id,
        requirement.evidence_type
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'TASK_COMPLETION_EVIDENCE_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_task_completion_evidence_verification()
  from public, anon, authenticated;
grant execute on function public.guard_task_completion_evidence_verification()
  to service_role;

drop trigger if exists trg_guard_task_completion_evidence_verification
  on public.task_requirements;
create trigger trg_guard_task_completion_evidence_verification
before update on public.task_requirements
for each row execute function public.guard_task_completion_evidence_verification();

-- Overload the existing atomic create wrapper. The original signature remains
-- available for rolling deployments, while new callers provide the checklist.
create or replace function public.create_operational_task_with_dispatch_control(
  p_org_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_next_followup_at timestamptz,
  p_primary_channel text,
  p_task_kind text,
  p_evidence_requirement text,
  p_evidence_requirements text[],
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
  normalized_types text[];
  normalized_legacy_requirement text;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'TASK_CREATE_WITH_DISPATCH_CONTROL_FORBIDDEN';
  end if;

  select coalesce(array_agg(distinct evidence.value order by evidence.value), '{}'::text[])
  into normalized_types
  from unnest(coalesce(p_evidence_requirements, '{}'::text[])) as evidence(value);

  if exists (
    select 1
    from unnest(normalized_types) as evidence(value)
    where evidence.value not in ('text', 'photo', 'document')
  ) or cardinality(normalized_types) <> cardinality(coalesce(p_evidence_requirements, '{}'::text[])) then
    raise exception using
      errcode = '22023',
      message = 'TASK_EVIDENCE_CHECKLIST_INVALID';
  end if;

  normalized_legacy_requirement := case
    when cardinality(normalized_types) = 0 then 'optional'
    when cardinality(normalized_types) = 1 then normalized_types[1]
    else 'any'
  end;

  if p_evidence_requirement <> normalized_legacy_requirement then
    raise exception using
      errcode = '22023',
      message = 'TASK_EVIDENCE_CHECKLIST_INVALID';
  end if;

  result := public.create_operational_task_with_dispatch_control(
    p_org_id => p_org_id,
    p_title => p_title,
    p_due_at => p_due_at,
    p_next_followup_at => p_next_followup_at,
    p_primary_channel => p_primary_channel,
    p_task_kind => p_task_kind,
    p_evidence_requirement => p_evidence_requirement,
    p_defer_initial_dispatch => p_defer_initial_dispatch,
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

  insert into public.task_completion_evidence_requirements (
    org_id,
    task_id,
    evidence_type
  )
  select result.org_id, result.id, evidence.value
  from unnest(normalized_types) as evidence(value);

  return result;
end;
$$;

revoke all on function public.create_operational_task_with_dispatch_control(
  uuid, text, timestamptz, timestamptz, text, text, text, text[], boolean,
  uuid, uuid, uuid, integer, text, text, text, jsonb, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_operational_task_with_dispatch_control(
  uuid, text, timestamptz, timestamptz, text, text, text, text[], boolean,
  uuid, uuid, uuid, integer, text, text, text, jsonb, uuid, uuid, uuid, uuid
) to service_role;
