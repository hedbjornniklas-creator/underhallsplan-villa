-- Uppdrag v1: completion-based recurring root tasks.
-- The next occurrence is generated atomically when the current occurrence is approved.

create table if not exists public.task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null unique references public.operational_tasks (id) on delete cascade,
  series_id uuid not null,
  sequence integer not null default 1 check (sequence > 0),
  recurrence_interval text not null check (recurrence_interval in ('weekly', 'monthly', 'quarterly', 'yearly')),
  anchor_due_at timestamptz not null,
  anchor_followup_at timestamptz not null,
  time_zone text not null default 'Europe/Stockholm',
  is_active boolean not null default true,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, sequence)
);

create index if not exists task_recurrence_rules_org_active_idx
  on public.task_recurrence_rules (org_id, is_active, updated_at desc);

alter table public.task_recurrence_rules enable row level security;
revoke all on table public.task_recurrence_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.task_recurrence_rules to service_role;

drop trigger if exists trg_task_recurrence_rules_updated_at
  on public.task_recurrence_rules;
create trigger trg_task_recurrence_rules_updated_at
before update on public.task_recurrence_rules
for each row execute function public.operational_tasks_set_updated_at();

create or replace function public.create_operational_task_with_recurrence(
  p_org_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_next_followup_at timestamptz,
  p_primary_channel text,
  p_task_kind text,
  p_evidence_requirement text,
  p_evidence_requirements text[],
  p_defer_initial_dispatch boolean,
  p_recurrence_interval text default null,
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
    raise exception using errcode = '42501', message = 'TASK_CREATE_WITH_RECURRENCE_FORBIDDEN';
  end if;
  if p_recurrence_interval is not null
     and p_recurrence_interval not in ('weekly', 'monthly', 'quarterly', 'yearly') then
    raise exception using errcode = '22023', message = 'TASK_RECURRENCE_INTERVAL_INVALID';
  end if;
  if p_recurrence_interval is not null and p_parent_task_id is not null then
    raise exception using errcode = '22023', message = 'TASK_RECURRENCE_ROOT_ONLY';
  end if;

  result := public.create_operational_task_with_dispatch_control(
    p_org_id => p_org_id,
    p_title => p_title,
    p_due_at => p_due_at,
    p_next_followup_at => p_next_followup_at,
    p_primary_channel => p_primary_channel,
    p_task_kind => p_task_kind,
    p_evidence_requirement => p_evidence_requirement,
    p_evidence_requirements => p_evidence_requirements,
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

  if p_recurrence_interval is not null then
    insert into public.task_recurrence_rules (
      org_id, task_id, series_id, sequence, recurrence_interval, anchor_due_at,
      anchor_followup_at, time_zone, created_by_profile_id
    ) values (
      result.org_id, result.id, result.id, 1, p_recurrence_interval, result.due_at,
      result.next_followup_at, result.due_timezone, result.issuer_profile_id
    );
  end if;
  return result;
end;
$$;

revoke all on function public.create_operational_task_with_recurrence(
  uuid, text, timestamptz, timestamptz, text, text, text, text[], boolean, text,
  uuid, uuid, uuid, integer, text, text, text, jsonb, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_operational_task_with_recurrence(
  uuid, text, timestamptz, timestamptz, text, text, text, text[], boolean, text,
  uuid, uuid, uuid, integer, text, text, text, jsonb, uuid, uuid, uuid, uuid
) to service_role;

create or replace function public.set_task_recurrence_rule(
  p_org_id uuid,
  p_task_id uuid,
  p_expected_version integer,
  p_interval text,
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
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'TASK_RECURRENCE_UPDATE_FORBIDDEN';
  end if;
  if p_interval is not null and p_interval not in ('weekly', 'monthly', 'quarterly', 'yearly') then
    raise exception using errcode = '22023', message = 'TASK_RECURRENCE_INTERVAL_INVALID';
  end if;

  select task.* into task_row
  from public.operational_tasks task
  where task.id = p_task_id and task.org_id = p_org_id and task.archived_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'TASK_NOT_FOUND'; end if;
  if task_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'TASK_VERSION_CONFLICT';
  end if;
  if task_row.parent_task_id is not null then
    raise exception using errcode = '22023', message = 'TASK_RECURRENCE_ROOT_ONLY';
  end if;
  if task_row.status in ('approved', 'cancelled') then
    raise exception using errcode = '22023', message = 'TASK_RECURRENCE_TERMINAL';
  end if;

  select coalesce(nullif(btrim(profile.full_name), ''), profile.email, 'Uppdragsansvarig')
  into actor_name_value
  from public.org_members member
  join public.profiles profile on profile.id = member.profile_id
  where member.org_id = p_org_id
    and member.profile_id = p_actor_profile_id
    and member.is_active = true
    and (member.role = 'admin' or task_row.issuer_profile_id = p_actor_profile_id);
  if not found then
    raise exception using errcode = '42501', message = 'TASK_RECURRENCE_UPDATE_FORBIDDEN';
  end if;

  if p_interval is null then
    update public.task_recurrence_rules
    set is_active = false
    where task_id = task_row.id;
  else
    insert into public.task_recurrence_rules (
      org_id, task_id, series_id, sequence, recurrence_interval, anchor_due_at,
      anchor_followup_at, time_zone, is_active, created_by_profile_id
    ) values (
      task_row.org_id, task_row.id, task_row.id, 1, p_interval, task_row.due_at,
      task_row.next_followup_at, task_row.due_timezone, true, p_actor_profile_id
    )
    on conflict (task_id) do update set
      series_id = excluded.series_id,
      sequence = excluded.sequence,
      recurrence_interval = excluded.recurrence_interval,
      anchor_due_at = excluded.anchor_due_at,
      anchor_followup_at = excluded.anchor_followup_at,
      time_zone = excluded.time_zone,
      is_active = true,
      created_by_profile_id = excluded.created_by_profile_id;
  end if;

  insert into public.task_events (
    org_id, task_id, event_type, actor_type, actor_profile_id, actor_name, message, metadata
  ) values (
    task_row.org_id, task_row.id, 'recurrence_updated', 'profile', p_actor_profile_id,
    actor_name_value,
    case when p_interval is null then 'Återkommande uppgift stängdes av.'
         else 'Återkommande uppgift uppdaterades.' end,
    jsonb_build_object('interval', p_interval, 'taskMutationApplied', true)
  );

  select task.* into task_row from public.operational_tasks task where task.id = p_task_id;
  return task_row;
end;
$$;

revoke all on function public.set_task_recurrence_rule(uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_task_recurrence_rule(uuid, uuid, integer, text, uuid)
  to service_role;

create or replace function public.generate_next_recurring_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  rule_row public.task_recurrence_rules%rowtype;
  next_task public.operational_tasks%rowtype;
  next_sequence integer;
  next_due_at timestamptz;
  next_followup_at timestamptz;
  local_offset interval;
  evidence_types text[];
  requirement_templates jsonb;
begin
  if old.status = new.status or new.status <> 'approved' or new.parent_task_id is not null then
    return new;
  end if;

  select rule.* into rule_row
  from public.task_recurrence_rules rule
  where rule.task_id = new.id and rule.is_active = true
  for update;
  if not found then return new; end if;

  next_sequence := rule_row.sequence + 1;
  loop
    local_offset := case rule_row.recurrence_interval
      when 'weekly' then make_interval(days => 7 * (next_sequence - 1))
      when 'monthly' then make_interval(months => next_sequence - 1)
      when 'quarterly' then make_interval(months => 3 * (next_sequence - 1))
      else make_interval(years => next_sequence - 1)
    end;
    next_due_at := ((rule_row.anchor_due_at at time zone rule_row.time_zone) + local_offset)
      at time zone rule_row.time_zone;
    next_followup_at := ((rule_row.anchor_followup_at at time zone rule_row.time_zone) + local_offset)
      at time zone rule_row.time_zone;
    exit when next_due_at > clock_timestamp() and next_followup_at > clock_timestamp();
    next_sequence := next_sequence + 1;
    if next_sequence > rule_row.sequence + 1200 then
      raise exception using errcode = '54000', message = 'TASK_RECURRENCE_GENERATION_LIMIT';
    end if;
  end loop;

  select coalesce(array_agg(item.evidence_type order by item.evidence_type), '{}'::text[])
  into evidence_types
  from public.task_completion_evidence_requirements item
  where item.task_id = new.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirement_key', requirement.requirement_key,
    'label', requirement.label,
    'is_required', requirement.is_required,
    'description', requirement.description,
    'sort_order', requirement.sort_order
  ) order by requirement.created_at), '[]'::jsonb)
  into requirement_templates
  from public.task_requirements requirement
  where requirement.task_id = new.id;

  next_task := public.create_operational_task_with_dispatch_control(
    p_org_id => new.org_id,
    p_title => new.title,
    p_due_at => next_due_at,
    p_next_followup_at => next_followup_at,
    p_primary_channel => new.primary_channel,
    p_task_kind => new.task_kind,
    p_evidence_requirement => new.evidence_requirement,
    p_evidence_requirements => evidence_types,
    p_defer_initial_dispatch => new.assignee_contact_id is not null,
    p_assignee_profile_id => new.assignee_profile_id,
    p_assignee_contact_id => new.assignee_contact_id,
    p_description => new.description,
    p_context_label => new.context_label,
    p_fallback_channel => new.fallback_channel,
    p_requirements => requirement_templates,
    p_actor_profile_id => new.issuer_profile_id
  );

  insert into public.task_recurrence_rules (
    org_id, task_id, series_id, sequence, recurrence_interval, anchor_due_at,
    anchor_followup_at, time_zone, created_by_profile_id
  ) values (
    new.org_id, next_task.id, rule_row.series_id, next_sequence, rule_row.recurrence_interval,
    rule_row.anchor_due_at, rule_row.anchor_followup_at, rule_row.time_zone,
    rule_row.created_by_profile_id
  );

  insert into public.task_events (
    org_id, task_id, event_type, actor_type, actor_name, message, metadata
  ) values (
    new.org_id, new.id, 'recurrence_generated', 'system', 'Gizmo',
    'Nästa återkommande uppgift skapades.',
    jsonb_build_object('nextTaskId', next_task.id, 'sequence', next_sequence)
  );
  return new;
end;
$$;

drop trigger if exists trg_generate_next_recurring_task on public.operational_tasks;
create trigger trg_generate_next_recurring_task
after update of status on public.operational_tasks
for each row execute function public.generate_next_recurring_task();

revoke all on function public.generate_next_recurring_task() from public, anon, authenticated;
grant execute on function public.generate_next_recurring_task() to service_role;
