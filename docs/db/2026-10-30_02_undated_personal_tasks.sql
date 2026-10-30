-- Undated personal root tasks. Existing dated and delegated flows are unchanged.
begin;

alter table public.operational_tasks alter column due_at drop not null;
alter table public.operational_tasks alter column next_followup_at drop not null;
alter table public.operational_tasks drop constraint if exists operational_tasks_schedule_check;
alter table public.operational_tasks add constraint operational_tasks_schedule_check check (
  (due_at is not null and next_followup_at is not null)
  or (
    due_at is null and next_followup_at is null
    and assignee_profile_id is not null and assignee_profile_id=issuer_profile_id
    and assignee_contact_id is null and parent_task_id is null
    and task_kind='simple' and created_source='manual'
  )
);

create or replace function public.sync_operational_task_followup_job()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare schedule_at timestamptz;
begin
  insert into public.task_followup_rules(org_id,task_id) values(new.org_id,new.id)
    on conflict(task_id) do nothing;
  update public.task_automation_jobs set status='cancelled',completed_at=now(),locked_at=null,
    locked_by=null,heartbeat_at=null,error_message='Superseded by task version '||new.version::text
    where task_id=new.id and job_type='evaluate_followup' and status in ('queued','failed');
  if new.status in ('approved','cancelled') then
    update public.task_access_links set revoked_at=coalesce(revoked_at,now())
      where task_id=new.id and revoked_at is null;
  end if;
  if new.archived_at is not null or new.status in ('draft','approved','cancelled')
    or (new.due_at is null and new.next_followup_at is null) then return new; end if;
  if tg_op='INSERT' and new.status='assigned' then schedule_at:=now();
  else schedule_at:=greatest(now(),least(new.next_followup_at,new.due_at-interval '3 days')); end if;
  insert into public.task_automation_jobs(org_id,task_id,job_type,status,available_at,idempotency_key,payload)
    values(new.org_id,new.id,'evaluate_followup','queued',schedule_at,
      'task-followup:'||new.id::text||':v'||new.version::text,
      jsonb_build_object('taskVersion',new.version,'scheduledFrom','operational_tasks'))
    on conflict(org_id,idempotency_key) do nothing;
  return new;
end;
$$;

create or replace function public.create_undated_personal_task(
  p_org_id uuid,p_actor_profile_id uuid,p_title text,p_description text default null,p_context_label text default null
) returns public.operational_tasks
language plpgsql security definer set search_path=public,pg_catalog as $$
declare result public.operational_tasks%rowtype; actor_name_value text; v_task_id uuid:=gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'TASK_PERSONAL_CREATE_FORBIDDEN'; end if;
  if p_actor_profile_id is null or nullif(btrim(p_title),'') is null or length(p_title)>500 then
    raise exception 'TASK_PERSONAL_CREATE_INPUT_INVALID';
  end if;
  select coalesce(nullif(btrim(p.full_name),''),p.email,'Uppdragsansvarig') into actor_name_value
    from public.org_members m join public.profiles p on p.id=m.profile_id
    where m.org_id=p_org_id and m.profile_id=p_actor_profile_id and m.is_active;
  if not found then raise exception 'TASK_PERSONAL_CREATE_FORBIDDEN'; end if;
  insert into public.operational_tasks(id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,
    title,description,context_label,task_kind,status,due_at,next_followup_at,primary_channel,created_source,created_by_profile_id)
    values(v_task_id,p_org_id,v_task_id,p_actor_profile_id,p_actor_profile_id,btrim(p_title),
      nullif(btrim(p_description),''),nullif(btrim(p_context_label),''),'simple','assigned',null,null,'email','manual',p_actor_profile_id)
    returning * into result;
  update public.task_followup_rules set is_active=false,initial_dispatch_pending=false
    where org_id=p_org_id and task_id=result.id;
  insert into public.task_events(org_id,task_id,event_type,actor_type,actor_profile_id,actor_name,message,to_status,metadata)
    values(p_org_id,result.id,'task_created','profile',p_actor_profile_id,actor_name_value,
      'Egen uppgift utan datum skapades.','assigned',jsonb_build_object('undatedPersonalTask',true));
  return result;
end;
$$;
revoke all on function public.create_undated_personal_task(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_undated_personal_task(uuid,uuid,text,text,text) to service_role;
create or replace function public.enqueue_task_event_notification_from_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from public.operational_tasks where id=new.task_id and due_at is null) then return new; end if;
  perform public.enqueue_task_event_notification(new.id);
  return new;
end;
$$;
revoke all on function public.enqueue_task_event_notification_from_trigger() from public,anon,authenticated;
comment on column public.operational_tasks.next_followup_at is
  'Next follow-up instant. Null only together with due_at on an undated manual personal root task.';
notify pgrst,'reload schema';
commit;
