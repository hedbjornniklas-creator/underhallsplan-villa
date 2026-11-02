-- Internal effort estimates. No operational task, deadline, notification or contract is rewritten.
-- Prerequisites: task foundation, recurrence and 2026-10-30_02_undated_personal_tasks.sql.
begin;

create table if not exists public.task_time_estimates (
  task_id uuid primary key references public.operational_tasks(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  estimated_minutes integer check (estimated_minutes between 1 and 10080),
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists task_time_estimates_org_idx on public.task_time_estimates(org_id);
alter table public.task_time_estimates enable row level security;
revoke all on public.task_time_estimates from public,anon,authenticated;
grant select,insert,update,delete on public.task_time_estimates to service_role;
drop trigger if exists task_time_estimate_scope on public.task_time_estimates;
create trigger task_time_estimate_scope before insert or update on public.task_time_estimates
for each row execute function public.validate_task_scoped_record();

create or replace function public.set_task_time_estimate(
  p_org_id uuid,p_task_id uuid,p_actor_profile_id uuid,p_task_version integer,p_estimate_version integer,p_minutes integer
) returns public.task_time_estimates
language plpgsql security definer set search_path=public,pg_catalog as $$
declare t public.operational_tasks%rowtype; e public.task_time_estimates%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'TASK_ESTIMATE_FORBIDDEN'; end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 10080) then raise exception 'TASK_ESTIMATE_INVALID'; end if;
  select * into t from public.operational_tasks where id=p_task_id and org_id=p_org_id and archived_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if p_actor_profile_id is null or (p_actor_profile_id<>t.issuer_profile_id and p_actor_profile_id is distinct from t.assignee_profile_id)
    or not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_actor_profile_id and is_active) then
    raise exception 'TASK_ESTIMATE_FORBIDDEN';
  end if;
  if t.status in ('approved','cancelled') then raise exception 'TASK_TERMINAL'; end if;
  if p_task_version is distinct from t.version then raise exception 'TASK_VERSION_CONFLICT'; end if;
  select * into e from public.task_time_estimates where task_id=p_task_id for update;
  if p_estimate_version is distinct from coalesce(e.version,0) then raise exception 'TASK_ESTIMATE_CONFLICT'; end if;
  if e.task_id is not null and e.org_id<>p_org_id then raise exception 'TASK_ESTIMATE_FORBIDDEN'; end if;
  if e.estimated_minutes is not distinct from p_minutes then return e; end if;
  insert into public.task_time_estimates(task_id,org_id,estimated_minutes,updated_by)
    values(p_task_id,p_org_id,p_minutes,p_actor_profile_id)
    on conflict(task_id) do update set estimated_minutes=excluded.estimated_minutes,version=task_time_estimates.version+1,
      updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into e;
  return e;
end $$;

-- The original creators keep their signatures and behavior for clients without an estimate.
-- The optional estimate is saved in the same transaction, before any server dispatch.
create or replace function public.create_task_with_time_estimate(
  p_org_id uuid,p_actor_profile_id uuid,p_minutes integer,p_without_dates boolean,p_task jsonb
) returns public.operational_tasks
language plpgsql security definer set search_path=public,pg_catalog as $$
declare t public.operational_tasks%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'TASK_ESTIMATE_FORBIDDEN'; end if;
  if p_minutes is null or p_minutes<1 or p_minutes>10080 or jsonb_typeof(p_task) is distinct from 'object'
    or p_without_dates is null then raise exception 'TASK_ESTIMATE_INVALID'; end if;
  if p_without_dates then
    t:=public.create_undated_personal_task(p_org_id,p_actor_profile_id,p_task->>'p_title',p_task->>'p_description',p_task->>'p_context_label');
  else
    t:=public.create_operational_task_with_recurrence(
      p_org_id=>p_org_id,p_actor_profile_id=>p_actor_profile_id,p_title=>p_task->>'p_title',
      p_due_at=>(p_task->>'p_due_at')::timestamptz,p_next_followup_at=>(p_task->>'p_next_followup_at')::timestamptz,
      p_primary_channel=>p_task->>'p_primary_channel',p_task_kind=>p_task->>'p_task_kind',
      p_evidence_requirement=>p_task->>'p_evidence_requirement',
      p_evidence_requirements=>array(select jsonb_array_elements_text(p_task->'p_evidence_requirements')),
      p_assignee_profile_id=>(p_task->>'p_assignee_profile_id')::uuid,p_assignee_contact_id=>(p_task->>'p_assignee_contact_id')::uuid,
      p_parent_task_id=>(p_task->>'p_parent_task_id')::uuid,p_expected_parent_version=>(p_task->>'p_expected_parent_version')::integer,
      p_description=>p_task->>'p_description',p_context_label=>p_task->>'p_context_label',p_fallback_channel=>p_task->>'p_fallback_channel',
      p_requirements=>p_task->'p_requirements',p_actor_contact_id=>null,p_actor_access_link_id=>null,
      p_source_ai_suggestion_id=>(p_task->>'p_source_ai_suggestion_id')::uuid,
      p_defer_initial_dispatch=>coalesce((p_task->>'p_defer_initial_dispatch')::boolean,false),
      p_recurrence_interval=>p_task->>'p_recurrence_interval'
    );
  end if;
  perform public.set_task_time_estimate(p_org_id,t.id,p_actor_profile_id,t.version,0,p_minutes);
  return t;
end $$;
revoke all on function public.set_task_time_estimate(uuid,uuid,uuid,integer,integer,integer),
  public.create_task_with_time_estimate(uuid,uuid,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.set_task_time_estimate(uuid,uuid,uuid,integer,integer,integer),
  public.create_task_with_time_estimate(uuid,uuid,integer,boolean,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
