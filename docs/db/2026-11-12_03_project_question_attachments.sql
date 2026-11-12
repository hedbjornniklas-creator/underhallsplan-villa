-- Current question attachments are separate from immutable history and recipient snapshots.
begin;
alter table public.action_case_questions add column if not exists attachment_ids uuid[];

create or replace function public.project_question_attachment_ids(p_org_id uuid,p_case_id uuid,p_question_id uuid)
returns uuid[] language sql stable security definer set search_path=public,pg_catalog as $$
  select coalesce(q.attachment_ids,array(select distinct f.attachment_id
    from public.action_case_question_events e join public.action_case_question_files f on f.event_id=e.id
    where e.org_id=p_org_id and e.action_case_id=p_case_id and e.question_id=q.id and e.operation in ('create','update','send') order by f.attachment_id))
  from public.action_case_questions q where q.org_id=p_org_id and q.action_case_id=p_case_id and q.id=p_question_id
$$;
revoke all on function public.project_question_attachment_ids(uuid,uuid,uuid) from public,anon,authenticated,service_role;

do $$begin
  if to_regprocedure('public.mutate_project_question_before_attachments(uuid,uuid,uuid,jsonb)') is null then
    alter function public.mutate_project_question(uuid,uuid,uuid,jsonb) rename to mutate_project_question_before_attachments;
  end if;
end $$;
revoke all on function public.mutate_project_question_before_attachments(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.mutate_project_question(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_request jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare result uuid; selected uuid[]; qid uuid:=(p_request->>'questionId')::uuid; op text:=p_request->>'operation'; prior public.action_case_question_events%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  -- Let the original exact-request audit handle lost-response retries, never replay an old selection.
  select * into prior from public.action_case_question_events where id=(p_request->>'requestId')::uuid;
  if found then return public.mutate_project_question_before_attachments(p_org_id,p_case_id,p_actor_id,p_request); end if;
  if p_request ? 'attachmentSelection' then
    if p_request->'attachmentSelection'<>'1'::jsonb or op not in ('create','update','send') then raise exception 'PROJECT_QUESTION_INVALID'; end if;
    if jsonb_typeof(p_request->'fileIds') is distinct from 'array' or jsonb_array_length(p_request->'fileIds')>20 then raise exception 'PROJECT_QUESTION_FILES'; end if;
    select coalesce(array_agg(x::uuid),'{}') into selected from jsonb_array_elements_text(p_request->'fileIds') x;
    if cardinality(selected)<>(select count(distinct x) from unnest(selected) x)
      or (select count(*) from public.action_case_attachments f where f.org_id=p_org_id and f.action_case_id=p_case_id and f.id=any(selected) and (f.question_id is null or f.question_id=qid))<>cardinality(selected)
      or exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id=any(selected))
      or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id=any(selected)) then raise exception 'PROJECT_QUESTION_FILES'; end if;
    if op='send' and (not selected @> public.project_question_attachment_ids(p_org_id,p_case_id,qid) or not selected <@ public.project_question_attachment_ids(p_org_id,p_case_id,qid)) then raise exception 'PROJECT_QUESTION_STALE'; end if;
  end if;
  result:=public.mutate_project_question_before_attachments(p_org_id,p_case_id,p_actor_id,p_request);
  if p_request->'attachmentSelection'='1'::jsonb and op in ('create','update') then
    update public.action_case_questions set attachment_ids=selected where id=result and org_id=p_org_id and action_case_id=p_case_id;
  end if;
  return result;
end $$;
revoke all on function public.mutate_project_question(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_project_question(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.share_project_question_files(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_request jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare q public.action_case_questions%rowtype; t public.operational_tasks%rowtype; prior public.action_case_question_events%rowtype;
  rid uuid:=(p_request->>'requestId')::uuid; qid uuid:=(p_request->>'questionId')::uuid; tid uuid:=(p_request->>'taskId')::uuid;
  manager uuid; actor text; selected uuid[]; new_ids uuid[]; f public.action_case_attachments%rowtype; audit_text text; resolution jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select manager_profile_id into manager from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found or manager is distinct from p_actor_id or not public.project_question_internal_participant(p_org_id,p_case_id,qid,p_actor_id) then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select * into prior from public.action_case_question_events where id=rid;
  if found then
    if prior.org_id<>p_org_id or prior.action_case_id<>p_case_id or prior.question_id<>qid or prior.actor_id<>p_actor_id or prior.request<>p_request then raise exception 'PROJECT_QUESTION_STALE'; end if;
    return qid;
  end if;
  if rid is null or p_request->>'operation'<>'share_files' or p_request->'confirmed' is distinct from 'true'::jsonb then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  select * into q from public.action_case_questions where id=qid and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if q.revision is distinct from (p_request->>'revision')::integer then raise exception 'PROJECT_QUESTION_STALE'; end if;
  if q.body->>'status'='closed' then raise exception 'PROJECT_QUESTION_CLOSED'; end if;
  if not exists(select 1 from public.action_case_question_events where org_id=p_org_id and question_id=qid and task_id=tid and operation='send') then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  select * into t from public.operational_tasks where id=tid and org_id=p_org_id for update;
  if not found or t.archived_at is not null or t.status in ('approved','cancelled') then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if t.version is distinct from (p_request->>'taskVersion')::integer then raise exception 'PROJECT_QUESTION_STALE'; end if;
  if exists(select 1 from public.task_followup_rules where task_id=tid and initial_dispatch_pending) then raise exception 'PROJECT_QUESTION_FILES_NOT_DISPATCHED'; end if;
  if jsonb_typeof(p_request->'fileIds') is distinct from 'array' or jsonb_array_length(p_request->'fileIds') not between 1 and 20 then raise exception 'PROJECT_QUESTION_FILES'; end if;
  select array_agg(x::uuid) into selected from jsonb_array_elements_text(p_request->'fileIds') x;
  if cardinality(selected)<>(select count(distinct x) from unnest(selected) x)
    or not selected @> public.project_question_attachment_ids(p_org_id,p_case_id,qid) or not selected <@ public.project_question_attachment_ids(p_org_id,p_case_id,qid)
    or (select count(*) from public.action_case_attachments where org_id=p_org_id and action_case_id=p_case_id and id=any(selected) and (question_id is null or question_id=qid))<>cardinality(selected)
    or exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id=any(selected))
    or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id=any(selected)) then raise exception 'PROJECT_QUESTION_FILES'; end if;
  perform 1 from public.action_case_attachments where org_id=p_org_id and id=any(selected) for share;
  select array_agg(af.id) into new_ids from public.action_case_attachments af where af.id=any(selected) and not exists(
    select 1 from public.task_attachments ta where ta.org_id=p_org_id and ta.task_id=tid and ta.storage_bucket=af.storage_bucket and ta.file_path=af.file_path and not ta.is_completion_evidence);
  if coalesce(cardinality(new_ids),0)=0 then raise exception 'PROJECT_QUESTION_FILES_UNCHANGED'; end if;
  select coalesce(nullif(btrim(full_name),''),email,'Intern användare') into actor from public.profiles where id=p_actor_id;
  audit_text:=cardinality(new_ids)::text||' nya bilagor har delats med '||coalesce(q.body#>>'{assignee,name}','ansvarig')||'. Samma fråga och uppgiftslänk behålls.';
  for f in select * from public.action_case_attachments where id=any(new_ids) and org_id=p_org_id loop
    insert into public.task_attachments(org_id,task_id,attachment_type,file_name,storage_bucket,file_path,content_type,file_size_bytes,is_completion_evidence,uploaded_by_profile_id)
      values(p_org_id,tid,case when f.attachment_type='image' then 'photo' else 'document' end,f.file_name,f.storage_bucket,f.file_path,f.content_type,f.file_size_bytes,false,p_actor_id);
  end loop;
  update public.action_case_questions set revision=revision+1,updated_at=now() where id=qid returning * into q;
  insert into public.action_case_question_events(id,org_id,action_case_id,question_id,revision,operation,actor_id,actor_name,body,message,reported_by,request)
    values(rid,p_org_id,p_case_id,qid,q.revision,'update',p_actor_id,actor,q.body,audit_text,'',p_request);
  insert into public.action_case_question_files(event_id,attachment_id,file_name) select rid,id,file_name from public.action_case_attachments where id=any(new_ids) and org_id=p_org_id;
  -- The existing trigger atomically queues the normal recipient notification. It must not restart reminders.
  insert into public.task_events(id,org_id,task_id,event_type,actor_type,actor_profile_id,actor_name,message,metadata)
    values(rid,p_org_id,tid,'comment','profile',p_actor_id,actor,audit_text,jsonb_build_object('taskMutationApplied',true,'projectQuestionAttachmentUpdate',qid,'attachmentIds',to_jsonb(new_ids)));
  resolution:=public.resolve_task_event_notification_target(rid);
  if resolution->>'skipped'='true' and resolution->>'reason'<>'self_recipient' then raise exception 'PROJECT_QUESTION_RECIPIENT_CHANGED'; end if;
  return qid;
end $$;
revoke all on function public.share_project_question_files(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.share_project_question_files(uuid,uuid,uuid,jsonb) to service_role;

-- A project manager may differ from the task's original issuer. Only this audited
-- attachment operation may notify on their behalf; ordinary comment permissions stay unchanged.
do $$declare definition text; needle text; addition text; begin
  definition:=pg_get_functiondef('public.resolve_task_event_notification_target(uuid)'::regprocedure);
  needle:='  if event_row.event_type = ''comment'' then';
  addition:=E'  if event_row.event_type = ''comment'' and event_row.metadata ? ''projectQuestionAttachmentUpdate'' and exists(\n    select 1 from public.action_case_question_events e join public.action_cases c on c.id=e.action_case_id and c.org_id=e.org_id\n    where e.id=event_row.id and e.org_id=task_row.org_id and e.actor_id=event_row.actor_profile_id and c.manager_profile_id=e.actor_id\n      and e.request->>''operation''=''share_files'' and e.request->>''taskId''=task_row.id::text\n      and e.question_id::text=event_row.metadata->>''projectQuestionAttachmentUpdate''\n      and public.project_question_internal_participant(e.org_id,e.action_case_id,e.question_id,e.actor_id)) then\n    actor_is_issuer:=true; actor_is_assignee:=false;\n  end if;\n';
  if position('projectQuestionAttachmentUpdate' in definition)=0 then
    if position(needle in definition)=0 then raise exception 'PROJECT_QUESTION_NOTIFICATION_SCHEMA'; end if;
    execute replace(definition,needle,addition||needle);
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.task_events'::regclass and tgname='trg_enqueue_task_event_notification' and tgenabled<>'D') then raise exception 'PROJECT_QUESTION_NOTIFICATION_SCHEMA'; end if;
end $$;
notify pgrst,'reload schema';
commit;
