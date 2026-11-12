-- Explicit, audited reassignment through the owning question only.
-- Requires 2026-11-10_01_task_details_editing. No existing data is rewritten.
begin;

create or replace function public.edit_operational_task_details_core(
  p_org_id uuid, p_task_id uuid, p_actor_profile_id uuid, p_expected_version integer,
  p_changes jsonb, p_confirm_recipient_change boolean, p_question_id uuid
) returns public.operational_tasks
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  t public.operational_tasks%rowtype; result public.operational_tasks%rowtype;
  new_profile uuid; new_contact uuid; new_due timestamptz; new_followup timestamptz;
  new_title text; new_description text; new_context text; new_primary text; new_fallback text;
  recipient_changed boolean; schedule_changed boolean; before_value jsonb; after_value jsonb;
  actor_name_value text; old_name text; new_name text; question_managed boolean := false;
begin
  if auth.role() is distinct from 'service_role' or p_actor_profile_id is null then raise exception 'TASK_DETAILS_FORBIDDEN'; end if;
  if p_question_id is not null then
    question_managed := exists(select 1 from public.action_case_question_events e
      join public.action_case_questions q on q.id=e.question_id and q.org_id=e.org_id
      join public.action_cases c on c.id=q.action_case_id and c.org_id=q.org_id
      where e.task_id=p_task_id and q.id=p_question_id and q.org_id=p_org_id and c.manager_profile_id=p_actor_profile_id
        and public.project_question_internal_participant(p_org_id,c.id,q.id,p_actor_profile_id));
    if not question_managed then raise exception 'TASK_DETAILS_FORBIDDEN'; end if;
  end if;
  perform 1 from public.operational_tasks where id=(select root_task_id from public.operational_tasks where id=p_task_id and org_id=p_org_id) for update;
  select * into t from public.operational_tasks where id=p_task_id and org_id=p_org_id and archived_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_actor_profile_id and is_active
    and (t.issuer_profile_id=p_actor_profile_id or role='admin' or question_managed)) then raise exception 'TASK_DETAILS_FORBIDDEN'; end if;
  if not public.task_profile_has_module_access(p_org_id,p_actor_profile_id) then raise exception 'TASK_DETAILS_FORBIDDEN'; end if;
  if t.created_source<>'manual' then raise exception 'TASK_DETAILS_MANAGED'; end if;
  if not question_managed and exists(select 1 from public.action_case_question_events where org_id=p_org_id and task_id=t.id) then raise exception 'TASK_DETAILS_MANAGED'; end if;
  if t.status in ('approved','cancelled') then raise exception 'TASK_TERMINAL'; end if;
  if p_expected_version is null or p_expected_version<1 then raise exception 'TASK_VERSION_REQUIRED'; end if;
  if t.version<>p_expected_version then raise exception 'TASK_VERSION_CONFLICT'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or not (p_changes ?& array['title','description','contextLabel','assigneeProfileId','assigneeContactId','dueAt','nextFollowupAt','primaryChannel','fallbackChannel'])
    or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('title','description','contextLabel','assigneeProfileId','assigneeContactId','dueAt','nextFollowupAt','primaryChannel','fallbackChannel')) then raise exception 'TASK_DETAILS_INPUT_INVALID'; end if;
  new_title:=btrim(p_changes->>'title'); new_description:=nullif(btrim(p_changes->>'description'),''); new_context:=nullif(btrim(p_changes->>'contextLabel'),'');
  if nullif(new_title,'') is null or length(new_title)>500 or length(coalesce(new_description,''))>20000 or length(coalesce(new_context,''))>500 then raise exception 'TASK_DETAILS_INPUT_INVALID'; end if;
  new_profile:=nullif(p_changes->>'assigneeProfileId','')::uuid; new_contact:=nullif(p_changes->>'assigneeContactId','')::uuid;
  if (new_profile is null)=(new_contact is null) then raise exception 'TASK_ASSIGNEE_REQUIRED'; end if;
  new_due:=(p_changes->>'dueAt')::timestamptz; new_followup:=(p_changes->>'nextFollowupAt')::timestamptz;
  new_primary:=p_changes->>'primaryChannel'; new_fallback:=nullif(p_changes->>'fallbackChannel','');
  if new_primary is null or (new_primary not in ('email','whatsapp') and not (new_primary='in_app' and t.primary_channel='in_app'))
    or (new_fallback is not null and ((new_fallback not in ('email','whatsapp') and not (new_fallback='in_app' and t.fallback_channel='in_app')) or new_fallback=new_primary)) then raise exception 'TASK_DETAILS_INPUT_INVALID'; end if;
  if new_due is null then
    if new_followup is not null or new_profile is distinct from t.issuer_profile_id or new_contact is not null or t.parent_task_id is not null or t.task_kind<>'simple'
      or t.status in ('waiting','ready_for_review','returned') then raise exception 'TASK_DUE_REQUIRED'; end if;
    if exists(select 1 from public.operational_tasks where parent_task_id=t.id and archived_at is null) then raise exception 'TASK_DUE_EDIT_CHILDREN'; end if;
  elsif not isfinite(new_due) or new_followup is null or not isfinite(new_followup) or new_followup>new_due then raise exception 'TASK_FOLLOWUP_INVALID'; end if;
  recipient_changed:=new_profile is distinct from t.assignee_profile_id or new_contact is distinct from t.assignee_contact_id;
  schedule_changed:=new_due is distinct from t.due_at or new_followup is distinct from t.next_followup_at;
  if recipient_changed and p_confirm_recipient_change is distinct from true then raise exception 'TASK_DETAILS_CONFIRM_RECIPIENT'; end if;
  if recipient_changed and exists(select 1 from public.task_message_deliveries where task_id=t.id and status in ('sending','ambiguous')) then raise exception 'TASK_DETAILS_DELIVERY_PENDING'; end if;
  if (recipient_changed or schedule_changed) and exists(select 1 from public.task_deadline_change_requests where task_id=t.id and status='pending') then raise exception 'TASK_DETAILS_PENDING_REQUEST'; end if;
  if schedule_changed and exists(select 1 from public.task_recurrence_rules where task_id=t.id and is_active) then raise exception 'TASK_DUE_EDIT_RECURRENCE'; end if;
  if new_due is not null and exists(select 1 from public.operational_tasks where id=t.parent_task_id and due_at<new_due) then raise exception 'TASK_CHILD_AFTER_PARENT_DUE'; end if;
  if new_due is not null and exists(select 1 from public.operational_tasks where parent_task_id=t.id and archived_at is null and status not in ('approved','cancelled') and due_at>new_due) then raise exception 'TASK_PARENT_DUE_BEFORE_CHILD'; end if;
  if recipient_changed and new_profile is not null and not public.task_profile_has_module_access(p_org_id,new_profile) then raise exception 'TASK_ASSIGNEE_TASK_ACCESS_REQUIRED'; end if;
  if new_contact is not null and not exists(select 1 from public.organization_contacts where org_id=p_org_id and id=new_contact and is_active
    and nullif(btrim(email),'') is not null and ((new_primary<>'whatsapp' and new_fallback is distinct from 'whatsapp') or nullif(btrim(coalesce(whatsapp_number,phone)),'') is not null)) then raise exception 'TASK_CONTACT_METHOD_REQUIRED'; end if;
  before_value:=jsonb_build_object('title',t.title,'description',t.description,'contextLabel',t.context_label,'assigneeProfileId',t.assignee_profile_id,'assigneeContactId',t.assignee_contact_id,'dueAt',t.due_at,'nextFollowupAt',t.next_followup_at,'primaryChannel',t.primary_channel,'fallbackChannel',t.fallback_channel);
  after_value:=jsonb_build_object('title',new_title,'description',new_description,'contextLabel',new_context,'assigneeProfileId',new_profile,'assigneeContactId',new_contact,'dueAt',new_due,'nextFollowupAt',new_followup,'primaryChannel',new_primary,'fallbackChannel',new_fallback);
  if before_value=after_value then return t; end if;
  if recipient_changed then
    update public.task_followup_rules set is_active=false,initial_dispatch_pending=true where task_id=t.id and org_id=p_org_id;
    update public.operational_tasks set title=new_title,description=new_description,context_label=new_context,
      assignee_profile_id=new_profile,assignee_contact_id=new_contact,due_at=new_due,next_followup_at=new_followup,
      primary_channel=new_primary,fallback_channel=new_fallback,last_activity_at=now() where id=t.id returning * into result;
    update public.task_access_links set revoked_at=coalesce(revoked_at,now()) where task_id=t.id and revoked_at is null;
    update public.task_recipient_portal_grants set revoked_at=coalesce(revoked_at,now()),revocation_reason='task_reassigned_awaiting_dispatch' where task_id=t.id and revoked_at is null;
    update public.task_recipient_activation_tokens set revoked_at=now() where task_id=t.id and consumed_at is null and revoked_at is null;
    update public.task_automation_jobs set status='cancelled',completed_at=coalesce(completed_at,now()),locked_at=null,locked_by=null,heartbeat_at=null,error_message='TASK_RECIPIENT_CHANGED'
      where task_id=t.id and status in ('queued','processing','failed');
    update public.task_message_deliveries set status='cancelled',next_attempt_at=null,error_message='TASK_RECIPIENT_CHANGED'
      where task_id=t.id and status in ('queued','sending','failed');
  else
    update public.operational_tasks set title=new_title,description=new_description,context_label=new_context,due_at=new_due,next_followup_at=new_followup,
      primary_channel=new_primary,fallback_channel=new_fallback,last_activity_at=now() where id=t.id returning * into result;
    if new_due is null then update public.task_followup_rules set is_active=false,initial_dispatch_pending=false where task_id=t.id; end if;
  end if;
  select coalesce(nullif(btrim(full_name),''),email,'Uppdragsansvarig') into actor_name_value from public.profiles where id=p_actor_profile_id;
  old_name:=coalesce((select full_name from public.profiles where id=t.assignee_profile_id),(select name from public.organization_contacts where id=t.assignee_contact_id),'Tidigare mottagare');
  new_name:=coalesce((select full_name from public.profiles where id=new_profile),(select name from public.organization_contacts where id=new_contact),'Ny mottagare');
  insert into public.task_events(org_id,task_id,event_type,actor_type,actor_profile_id,actor_name,message,metadata)
    values(p_org_id,t.id,case when recipient_changed then 'task_recipient_changed' else 'task_details_changed' end,'profile',p_actor_profile_id,actor_name_value,
      case when recipient_changed then 'Mottagare ändrades från '||old_name||' till '||new_name||'. Den gamla länken spärrades. Inget nytt utskick har gjorts.' else 'Uppgiftens grunduppgifter ändrades.' end,
      jsonb_build_object('before',before_value,'after',after_value,'taskMutationApplied',true,'taskVersion',result.version,'questionId',p_question_id));
  return result;
end;
$$;
revoke all on function public.edit_operational_task_details_core(uuid,uuid,uuid,integer,jsonb,boolean,uuid) from public,anon,authenticated,service_role;

create or replace function public.edit_operational_task_details(
  p_org_id uuid,p_task_id uuid,p_actor_profile_id uuid,p_expected_version integer,p_changes jsonb,p_confirm_recipient_change boolean default false
) returns public.operational_tasks language sql security definer set search_path=public,pg_catalog as $$
  select public.edit_operational_task_details_core(p_org_id,p_task_id,p_actor_profile_id,p_expected_version,p_changes,p_confirm_recipient_change,null);
$$;
revoke all on function public.edit_operational_task_details(uuid,uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.edit_operational_task_details(uuid,uuid,uuid,integer,jsonb,boolean) to service_role;

-- Extend the existing release engine only for the manager of its owning question.
-- Fail closed if its audited authorization block has an unexpected definition.
do $$
declare definition text; needle text:=E'task_row.issuer_profile_id = p_actor_profile_id\n      or member.role = ''admin''';
begin
  select pg_get_functiondef('public.finalize_operational_task_initial_dispatch(uuid,uuid,uuid)'::regprocedure) into definition;
  definition:=replace(definition,E'\r\n',E'\n');
  if position('project_question_internal_participant' in definition)=0 then
    if position(needle in definition)=0 then raise exception 'PROJECT_QUESTION_DISPATCH_DEFINITION'; end if;
    definition:=replace(definition,needle,needle||E'\n      or exists(select 1 from public.action_case_question_events e join public.action_case_questions q on q.id=e.question_id and q.org_id=e.org_id join public.action_cases c on c.id=q.action_case_id and c.org_id=q.org_id where e.task_id=task_row.id and q.org_id=p_org_id and c.manager_profile_id=p_actor_profile_id and public.project_question_internal_participant(p_org_id,c.id,q.id,p_actor_profile_id))');
    execute definition;
  end if;
end $$;

create or replace function public.write_project_question_assignment(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_request jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  q public.action_case_questions%rowtype; prior public.action_case_question_events%rowtype;
  t public.operational_tasks%rowtype; manager uuid; actor text; b jsonb; a jsonb;
  qid uuid:=(p_request->>'questionId')::uuid; rid uuid:=(p_request->>'requestId')::uuid;
  tid uuid:=(p_request->>'taskId')::uuid; op text:=p_request->>'operation';
  person_name text; person_email text; previous_name text; contact_id uuid; profile_id uuid; pending boolean; f record;
begin
  if auth.role() is distinct from 'service_role' or not public.task_profile_has_module_access(p_org_id,p_actor_id) then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select manager_profile_id into manager from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if manager is distinct from p_actor_id or not public.project_question_internal_participant(p_org_id,p_case_id,qid,p_actor_id) then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select * into prior from public.action_case_question_events where id=rid;
  if found then
    if prior.org_id<>p_org_id or prior.action_case_id<>p_case_id or prior.actor_id<>p_actor_id or prior.request<>p_request then raise exception 'PROJECT_QUESTION_STALE'; end if;
    return prior.question_id;
  end if;
  select * into q from public.action_case_questions where id=qid and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if q.revision is distinct from (p_request->>'revision')::integer then raise exception 'PROJECT_QUESTION_STALE'; end if;
  if q.body->>'status'='closed' then raise exception 'PROJECT_QUESTION_CLOSED'; end if;
  if rid is null or tid is null or op is null or op not in ('reassign','dispatch_reassignment') or (p_request->>'confirmed')::boolean is distinct from true then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  if not exists(select 1 from public.action_case_question_events where org_id=p_org_id and question_id=qid and task_id=tid) then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  perform 1 from public.operational_tasks where id=(select root_task_id from public.operational_tasks where id=tid and org_id=p_org_id) for update;
  select * into t from public.operational_tasks where id=tid and org_id=p_org_id and archived_at is null for update;
  if not found or t.status in ('approved','cancelled') then raise exception 'PROJECT_QUESTION_TASK_OPEN'; end if;
  if t.version is distinct from (p_request->>'taskVersion')::integer then raise exception 'PROJECT_QUESTION_STALE'; end if;
  if exists(select 1 from public.action_case_question_events e join public.operational_tasks ot on ot.id=e.task_id where e.question_id=qid and ot.id<>tid and ot.archived_at is null and ot.status not in ('approved','cancelled')) then raise exception 'PROJECT_QUESTION_TASK_OPEN'; end if;
  select coalesce(nullif(btrim(full_name),''),email,'Projektansvarig') into actor from public.profiles where id=p_actor_id;
  b:=q.body;
  previous_name:=coalesce(b#>>'{assignee,name}','tidigare ansvarig');
  if op='reassign' then
    a:=p_request->'assignee';
    if a->>'kind'='profile' then
      select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email into person_name,person_email from public.profiles p join public.org_members m on m.profile_id=p.id and m.org_id=p_org_id and m.is_active where p.id=(a->>'id')::uuid for share of p,m;
      profile_id:=(a->>'id')::uuid;
    elsif a->>'kind'='contact' then
      select name,email into person_name,person_email from public.organization_contacts where org_id=p_org_id and id=(a->>'id')::uuid and is_active for share;
      contact_id:=(a->>'id')::uuid;
    elsif a->>'kind'='customer' then
      select c.name,c.email into person_name,person_email from public.project_question_customers(p_org_id,p_case_id) c where c.id=(a->>'id')::uuid;
      if person_name is not null and nullif(btrim(person_email),'') is not null then
        perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||lower(person_name)||':'||lower(person_email),0));
        select id into contact_id from public.organization_contacts where org_id=p_org_id and lower(btrim(name))=lower(person_name) and lower(btrim(email))=lower(person_email) and is_active order by id limit 1 for share;
        if contact_id is null then
          if exists(select 1 from public.organization_contacts where org_id=p_org_id and lower(btrim(name))=lower(person_name) and lower(btrim(email))=lower(person_email) and not is_active) then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
          insert into public.organization_contacts(org_id,name,email,preferred_channel,is_active,created_by,updated_by) values(p_org_id,person_name,person_email,'email',true,p_actor_id,p_actor_id) returning id into contact_id;
        end if;
      end if;
    else raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
    if person_name is null or (profile_id is null and nullif(btrim(person_email),'') is null) then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
    if (profile_id,contact_id) is not distinct from (t.assignee_profile_id,t.assignee_contact_id) then raise exception 'PROJECT_QUESTION_ASSIGNEE_UNCHANGED'; end if;
    perform public.edit_operational_task_details_core(p_org_id,tid,p_actor_id,t.version,
      jsonb_build_object('title',t.title,'description',t.description,'contextLabel',t.context_label,'assigneeProfileId',profile_id,'assigneeContactId',contact_id,'dueAt',t.due_at,'nextFollowupAt',t.next_followup_at,'primaryChannel',t.primary_channel,'fallbackChannel',t.fallback_channel),true,qid);
    a:=jsonb_build_object('id',a->>'id','kind',a->>'kind','name',person_name,'email',person_email);
    b:=jsonb_set(b,'{assignee}',a);
    insert into public.action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email)
      values(p_org_id,p_case_id,qid,a->>'kind',(a->>'id')::uuid,person_name,person_email)
      on conflict(question_id,person_kind,person_id) do update set active=true,removed_at=null;
    -- Group-dialog membership is separate: do not silently remove the former assignee.
  else
    a:=b->'assignee';
    if t.assignee_profile_id is not null then
      if a->>'kind'<>'profile' or (a->>'id')::uuid is distinct from t.assignee_profile_id then raise exception 'PROJECT_QUESTION_RECIPIENT_CHANGED'; end if;
      select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email into person_name,person_email from public.profiles p join public.org_members m on m.profile_id=p.id and m.org_id=p_org_id and m.is_active where p.id=t.assignee_profile_id for share of p,m;
    else
      select name,email into person_name,person_email from public.organization_contacts where org_id=p_org_id and id=t.assignee_contact_id and is_active for share;
      if a->>'kind'='contact' and (a->>'id')::uuid is distinct from t.assignee_contact_id then raise exception 'PROJECT_QUESTION_RECIPIENT_CHANGED'; end if;
      if a->>'kind'='customer' and not exists(select 1 from public.project_question_customers(p_org_id,p_case_id) c where c.id=(a->>'id')::uuid and c.name=person_name and c.email=person_email) then raise exception 'PROJECT_QUESTION_RECIPIENT_CHANGED'; end if;
      if a->>'kind' not in ('contact','customer') then raise exception 'PROJECT_QUESTION_RECIPIENT_CHANGED'; end if;
    end if;
    if person_name is null or person_name is distinct from a->>'name' or person_email is distinct from a->>'email' then raise exception 'PROJECT_QUESTION_RECIPIENT_CHANGED'; end if;
    select initial_dispatch_pending into pending from public.task_followup_rules where org_id=p_org_id and task_id=tid for update;
    if pending is distinct from true then raise exception 'PROJECT_QUESTION_ASSIGNMENT_DISPATCHED'; end if;
    if jsonb_typeof(p_request->'fileIds') is distinct from 'array' or jsonb_array_length(p_request->'fileIds')>20 then raise exception 'PROJECT_QUESTION_FILES'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_request->'fileIds') x where not exists(select 1 from public.action_case_attachments af where af.id=x::uuid and af.org_id=p_org_id and af.action_case_id=p_case_id and (af.question_id is null or af.question_id=qid)))
      or exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id in(select x::uuid from jsonb_array_elements_text(p_request->'fileIds') x))
      or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id in(select x::uuid from jsonb_array_elements_text(p_request->'fileIds') x)) then raise exception 'PROJECT_QUESTION_FILES'; end if;
    for f in select * from public.action_case_attachments where id in(select x::uuid from jsonb_array_elements_text(p_request->'fileIds') x) and org_id=p_org_id loop
      insert into public.task_attachments(org_id,task_id,attachment_type,file_name,storage_bucket,file_path,content_type,file_size_bytes,is_completion_evidence,uploaded_by_profile_id)
        select p_org_id,tid,case when f.attachment_type='image' then 'photo' else 'document' end,f.file_name,f.storage_bucket,f.file_path,f.content_type,f.file_size_bytes,false,p_actor_id
        where not exists(select 1 from public.task_attachments where task_id=tid and storage_bucket=f.storage_bucket and file_path=f.file_path);
    end loop;
    perform public.finalize_operational_task_initial_dispatch(p_org_id,tid,p_actor_id);
    if t.assignee_profile_id is not null then
      insert into public.task_events(org_id,task_id,event_type,actor_type,actor_profile_id,actor_name,message,metadata)
        values(p_org_id,tid,'comment','profile',p_actor_id,actor,'Du har tilldelats uppdraget ”'||t.title||'”. Befintlig status och historik är oförändrade.',jsonb_build_object('taskMutationApplied',true,'questionReassignmentRequestId',rid));
    end if;
  end if;
  update public.action_case_questions set body=b,revision=revision+1,updated_at=now() where id=qid returning * into q;
  insert into public.action_case_question_events(id,org_id,action_case_id,question_id,revision,operation,actor_id,actor_name,body,message,reported_by,request)
    values(rid,p_org_id,p_case_id,qid,q.revision,'update',p_actor_id,actor,b,
      case when op='reassign' then 'Ansvarig ändrades från '||previous_name||' till '||person_name||'. Inget nytt utskick har gjorts.' else 'Uppgiften har frigjorts för utskick till den nya ansvariga.' end,'',p_request);
  if op='dispatch_reassignment' then
    insert into public.action_case_question_files(event_id,attachment_id,file_name)
      select rid,af.id,af.file_name from public.action_case_attachments af where af.org_id=p_org_id and af.id in(select x::uuid from jsonb_array_elements_text(p_request->'fileIds') x);
  end if;
  return qid;
end;
$$;
revoke all on function public.write_project_question_assignment(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_project_question_assignment(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
