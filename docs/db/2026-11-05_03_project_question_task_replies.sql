-- Reply to a question's existing individual task from the question UI.
-- No old messages are copied, no contract or calculation data is changed.
begin;
do $$begin
  if not exists(select 1 from pg_trigger where tgrelid='public.task_events'::regclass and tgname='trg_enqueue_task_event_notification' and tgenabled<>'D') then
    raise exception 'PROJECT_QUESTION_NOTIFICATION_SCHEMA';
  end if;
end $$;

create or replace function public.reply_project_question_task(
  p_org_id uuid,p_case_id uuid,p_question_id uuid,p_task_id uuid,p_actor_id uuid,
  p_request_id uuid,p_recipient jsonb,p_message text
) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare q public.action_case_questions%rowtype; t public.operational_tasks%rowtype;
  prior public.task_events%rowtype; target jsonb; target_email text; actor_name text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  if p_request_id is null or p_message is null or btrim(p_message)='' or length(p_message)>12000 then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  select * into q from public.action_case_questions where org_id=p_org_id and action_case_id=p_case_id and id=p_question_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  perform 1 from public.action_case_question_participants p join public.org_members m on m.org_id=p.org_id and m.profile_id=p.person_id and m.is_active
    where p.org_id=p_org_id and p.action_case_id=p_case_id and p.question_id=q.id and p.person_kind='profile' and p.person_id=p_actor_id and p.active for share of p,m;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if not exists(select 1 from public.action_case_question_events e where e.org_id=p_org_id and e.action_case_id=p_case_id and e.question_id=q.id and e.task_id=p_task_id and e.operation='send') then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  select * into t from public.operational_tasks where org_id=p_org_id and id=p_task_id for update;
  if not found or t.archived_at is not null then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if p_actor_id is distinct from t.issuer_profile_id and p_actor_id is distinct from t.assignee_profile_id then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select * into prior from public.task_events where id=p_request_id;
  if found then
    if prior.org_id<>p_org_id or prior.task_id<>t.id or prior.actor_profile_id is distinct from p_actor_id or prior.event_type<>'comment' or prior.message is distinct from btrim(p_message)
      or prior.metadata is distinct from jsonb_build_object('projectQuestionId',q.id,'recipient',p_recipient) then raise exception 'PROJECT_QUESTION_STALE'; end if;
    return prior.id;
  end if;
  if q.body->>'status'='closed' then raise exception 'PROJECT_QUESTION_CLOSED'; end if;
  if t.assignee_profile_id=p_actor_id then target:=jsonb_build_object('kind','profile','id',t.issuer_profile_id);
  elsif t.assignee_profile_id is not null then target:=jsonb_build_object('kind','profile','id',t.assignee_profile_id);
  elsif t.assignee_contact_id is not null then target:=jsonb_build_object('kind','contact','id',t.assignee_contact_id);
  else raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
  if target->>'kind'='contact' then
    select email into target_email from public.organization_contacts where org_id=p_org_id and id=(target->>'id')::uuid and is_active for share;
  else
    select p.email into target_email from public.org_members m join public.profiles p on p.id=m.profile_id where m.org_id=p_org_id and m.profile_id=(target->>'id')::uuid and m.is_active for share of m,p;
  end if;
  if not found then raise exception 'PROJECT_QUESTION_TASK_RECIPIENT_CHANGED'; end if;
  if nullif(btrim(target_email),'') is null then raise exception 'PROJECT_QUESTION_TASK_RECIPIENT_CHANGED'; end if;
  target:=target||jsonb_build_object('email',nullif(lower(btrim(target_email)),''));
  if target is distinct from p_recipient then raise exception 'PROJECT_QUESTION_TASK_RECIPIENT_CHANGED'; end if;
  select coalesce(nullif(btrim(full_name),''),email,'Internal user') into actor_name from public.profiles where id=p_actor_id;
  -- The existing notification trigger queues exactly one recipient-scoped job
  -- in this transaction. A failed queue insert rolls back the message too.
  insert into public.task_events(id,org_id,task_id,event_type,actor_type,actor_profile_id,actor_name,message,metadata)
    values(p_request_id,p_org_id,t.id,'comment','profile',p_actor_id,actor_name,btrim(p_message),jsonb_build_object('projectQuestionId',q.id,'recipient',target));
  update public.action_case_questions set updated_at=now() where id=q.id;
  return p_request_id;
end $$;
revoke all on function public.reply_project_question_task(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.reply_project_question_task(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text) to service_role;

commit;
