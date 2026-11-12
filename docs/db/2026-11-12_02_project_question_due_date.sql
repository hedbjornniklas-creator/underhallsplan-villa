-- Internal date editing through the owning question. No existing rows are rewritten.
-- Requires 2026-11-12_01_project_question_reassignment.sql.
begin;

create or replace function public.write_project_question_due_date(
  p_org_id uuid, p_case_id uuid, p_actor_id uuid, p_request jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  q public.action_case_questions%rowtype; t public.operational_tasks%rowtype;
  prior public.action_case_question_events%rowtype;
  qid uuid; rid uuid; tid uuid; manager uuid; actor text;
  new_due timestamptz; new_followup timestamptz; audit_message text;
begin
  if auth.role() is distinct from 'service_role' or not public.task_profile_has_module_access(p_org_id,p_actor_id) then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  if jsonb_typeof(p_request) is distinct from 'object'
    or not (p_request ?& array['questionId','requestId','taskId','revision','taskVersion','operation','dueAt'])
    or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('questionId','requestId','taskId','revision','taskVersion','operation','dueAt'))
    or p_request->>'operation' is distinct from 'reschedule' then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  qid:=(p_request->>'questionId')::uuid; rid:=(p_request->>'requestId')::uuid; tid:=(p_request->>'taskId')::uuid;
  if qid is null or rid is null or tid is null or coalesce((p_request->>'revision')::integer,0)<1
    or coalesce((p_request->>'taskVersion')::integer,0)<1 then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  new_due:=(p_request->>'dueAt')::timestamptz;
  if new_due is null or not isfinite(new_due) then raise exception 'PROJECT_QUESTION_DATES'; end if;
  select manager_profile_id into manager from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if manager is distinct from p_actor_id or not public.project_question_internal_participant(p_org_id,p_case_id,qid,p_actor_id) then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select * into prior from public.action_case_question_events where id=rid;
  if found then
    if prior.org_id<>p_org_id or prior.action_case_id<>p_case_id or prior.actor_id<>p_actor_id or prior.request is distinct from p_request then raise exception 'PROJECT_QUESTION_STALE'; end if;
    return prior.question_id;
  end if;
  select * into q from public.action_case_questions where id=qid and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if q.revision is distinct from (p_request->>'revision')::integer then raise exception 'PROJECT_QUESTION_STALE'; end if;
  if q.body->>'status'='closed' then raise exception 'PROJECT_QUESTION_CLOSED'; end if;
  if not exists(select 1 from public.action_case_question_events where org_id=p_org_id and question_id=qid and task_id=tid) then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  perform 1 from public.operational_tasks where id=(select root_task_id from public.operational_tasks where id=tid and org_id=p_org_id) for update;
  select * into t from public.operational_tasks where id=tid and org_id=p_org_id and archived_at is null for update;
  if not found or t.status in ('approved','cancelled') then raise exception 'PROJECT_QUESTION_TASK_OPEN'; end if;
  if t.version is distinct from (p_request->>'taskVersion')::integer then raise exception 'PROJECT_QUESTION_STALE'; end if;
  if exists(select 1 from public.action_case_question_events e join public.operational_tasks ot on ot.id=e.task_id where e.question_id=qid and ot.id<>tid and ot.archived_at is null and ot.status not in ('approved','cancelled')) then raise exception 'PROJECT_QUESTION_TASK_OPEN'; end if;
  if exists(select 1 from public.task_message_deliveries where task_id=tid and status in ('sending','ambiguous')) then raise exception 'PROJECT_QUESTION_DUE_DELIVERY_PENDING'; end if;
  if new_due is not distinct from t.due_at then raise exception 'PROJECT_QUESTION_DUE_UNCHANGED'; end if;
  -- Preserve an earlier checkpoint; a deadline-based or now-too-late checkpoint
  -- follows the new deadline. The task engine rebuilds its normal reminder job.
  new_followup:=case when t.next_followup_at is null or t.next_followup_at=t.due_at or t.next_followup_at>new_due then new_due else t.next_followup_at end;
  perform public.edit_operational_task_details_core(p_org_id,tid,p_actor_id,t.version,
    jsonb_build_object('title',t.title,'description',t.description,'contextLabel',t.context_label,
      'assigneeProfileId',t.assignee_profile_id,'assigneeContactId',t.assignee_contact_id,
      'dueAt',new_due,'nextFollowupAt',new_followup,'primaryChannel',t.primary_channel,'fallbackChannel',t.fallback_channel),false,qid);
  select coalesce(nullif(btrim(full_name),''),email,'Projektansvarig') into actor from public.profiles where id=p_actor_id;
  audit_message:='Färdigdatum ändrades från '||coalesce(to_char(t.due_at at time zone 'Europe/Stockholm','YYYY-MM-DD HH24:MI'),'ej angivet')
    ||' till '||to_char(new_due at time zone 'Europe/Stockholm','YYYY-MM-DD HH24:MI')||' (Stockholm). Ansvarig och status är oförändrade.';
  update public.action_case_questions set revision=revision+1,updated_at=now() where id=qid returning * into q;
  insert into public.action_case_question_events(id,org_id,action_case_id,question_id,revision,operation,actor_id,actor_name,body,message,reported_by,request)
    values(rid,p_org_id,p_case_id,qid,q.revision,'update',p_actor_id,actor,q.body,audit_message,'',p_request);
  return qid;
end;
$$;
revoke all on function public.write_project_question_due_date(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_project_question_due_date(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
