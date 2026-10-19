-- Remove the unused conclusion feature; replies no longer resolve a question.
-- Fail before changing anything if a conclusion has since been recorded.
begin;
lock table public.action_case_questions, public.action_case_question_events in access exclusive mode;
do $$
begin
  if exists(select 1 from public.action_case_question_events where operation='conclusion'
      or btrim(coalesce(body->>'conclusion',''))<>''
      or btrim(coalesce(request#>>'{body,conclusion}',''))<>'')
    or exists(select 1 from public.action_case_questions where btrim(coalesce(body->>'conclusion',''))<>'')
  then raise exception 'PROJECT_QUESTION_CONCLUSIONS_EXIST'; end if;
end $$;
update public.action_case_questions set body=body-'conclusion' where body ? 'conclusion';
alter table public.action_case_question_events disable trigger question_events_immutable;
update public.action_case_question_events
  set body=body-'conclusion',
      request=case when jsonb_typeof(request->'body')='object'
        then jsonb_set(request,'{body}',(request->'body')-'conclusion') else request end
  where body ? 'conclusion' or (request->'body') ? 'conclusion';
alter table public.action_case_question_events enable trigger question_events_immutable;
alter table public.action_case_question_events drop constraint action_case_question_events_operation_check;
alter table public.action_case_question_events add constraint action_case_question_events_operation_check
  check(operation in ('create','update','answer','note','close','reopen','send'));
alter table public.action_case_questions add constraint question_body_no_conclusion
  check(not (body ? 'conclusion'));
alter table public.action_case_question_events add constraint question_event_no_conclusion
  check(not (body ? 'conclusion') and not coalesce((request->'body') ? 'conclusion',false));

create or replace function public.mutate_project_question(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_request jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  q public.action_case_questions%rowtype; prior public.action_case_question_events%rowtype;
  op text:=p_request->>'operation'; qid uuid:=(p_request->>'questionId')::uuid;
  rid uuid:=(p_request->>'requestId')::uuid; b jsonb; actor text; assigned_name text; assigned_email text;
  a jsonb; f record; tid uuid; task public.operational_tasks%rowtype; expected integer:=(p_request->>'revision')::integer;
  file_ids uuid[]; file_count integer; n integer; due_at timestamptz; followup_at timestamptz;
  customer_phone text; recipient_contact_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare') into actor
    from public.org_members m join public.profiles p on p.id=m.profile_id
    where m.org_id=p_org_id and m.profile_id=p_actor_id and m.is_active;
  if not found then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  select * into prior from public.action_case_question_events where id=rid;
  if found then
    if prior.org_id<>p_org_id or prior.action_case_id<>p_case_id or prior.actor_id<>p_actor_id or prior.request<>p_request then raise exception 'PROJECT_QUESTION_STALE'; end if;
    return prior.question_id;
  end if;
  if op is null or op not in ('create','update','answer','note','close','reopen','send') or qid is null or rid is null or expected is null then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  if coalesce(length(p_request->>'text'),0)>12000 or coalesce(length(p_request->>'reportedBy'),0)>250 then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  if op in ('answer','note','close','reopen') and btrim(coalesce(p_request->>'text',''))='' then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  if jsonb_typeof(p_request->'fileIds') is distinct from 'array' or jsonb_array_length(p_request->'fileIds')>20 then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into file_ids from jsonb_array_elements_text(p_request->'fileIds');
  if cardinality(file_ids)<>(select count(distinct x) from unnest(file_ids) x) then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  perform 1 from public.action_case_attachments where org_id=p_org_id and action_case_id=p_case_id and id=any(file_ids) for share;
  select count(*) into file_count from public.action_case_attachments where org_id=p_org_id and action_case_id=p_case_id and id=any(file_ids);
  if file_count<>cardinality(file_ids) then raise exception 'PROJECT_QUESTION_FILES'; end if;
  if op='create' then
    if expected<>0 then raise exception 'PROJECT_QUESTION_STALE'; end if;
    select coalesce(max(number),0)+1 into n from public.action_case_questions where action_case_id=p_case_id;
  else
    select * into q from public.action_case_questions where id=qid and org_id=p_org_id and action_case_id=p_case_id for update;
    if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
    if q.revision<>expected then raise exception 'PROJECT_QUESTION_STALE'; end if;
    if q.body->>'status'='closed' and op<>'reopen' then raise exception 'PROJECT_QUESTION_CLOSED'; end if;
    if op='reopen' and q.body->>'status'<>'closed' then raise exception 'PROJECT_QUESTION_INVALID'; end if;
    if op='close' and exists(select 1 from public.action_case_question_events e join public.operational_tasks t on t.id=e.task_id where e.question_id=qid and t.status not in ('approved','cancelled') and t.archived_at is null) then raise exception 'PROJECT_QUESTION_TASK_OPEN'; end if;
  end if;
  if op in ('create','update') then
    b:=p_request->'body'; a:=b->'assignee';
    if jsonb_typeof(b) is distinct from 'object' or btrim(coalesce(b->>'title',''))='' or length(b->>'title')>250
      or btrim(coalesce(b->>'description',''))='' or length(b->>'description')>12000
      or length(coalesce(b->>'source',''))>500 or coalesce(b->>'status','') not in ('open','investigating','answered') then raise exception 'PROJECT_QUESTION_INVALID'; end if;
    if coalesce(b->>'meetingDate','')<>'' then
      begin
        if b->>'meetingDate' !~ '^\d{4}-\d{2}-\d{2}$' or to_char((b->>'meetingDate')::date,'YYYY-MM-DD')<>b->>'meetingDate' then raise exception 'invalid'; end if;
      exception when others then raise exception 'PROJECT_QUESTION_INVALID'; end;
    end if;
    if a is not null and a<>'null'::jsonb then
      if a->>'kind'='customer' then
        select c.name,c.email into assigned_name,assigned_email from public.project_question_customers(p_org_id,p_case_id) c where c.id=(a->>'id')::uuid;
      elsif a->>'kind'='profile' then
        select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email into assigned_name,assigned_email from public.org_members m join public.profiles p on p.id=m.profile_id where m.org_id=p_org_id and m.profile_id=(a->>'id')::uuid and m.is_active;
      elsif a->>'kind'='contact' then
        select name,email into assigned_name,assigned_email from public.organization_contacts where org_id=p_org_id and id=(a->>'id')::uuid and is_active;
      else raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
      if assigned_name is null then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
      b:=jsonb_set(b,'{assignee}',jsonb_build_object('id',a->>'id','kind',a->>'kind','name',assigned_name,'email',assigned_email));
    else b:=jsonb_set(b,'{assignee}','null'); end if;
    if op='update' and (b#>'{assignee,id}',b#>'{assignee,kind}') is distinct from (q.body#>'{assignee,id}',q.body#>'{assignee,kind}')
      and exists(select 1 from public.action_case_question_events e join public.operational_tasks t on t.id=e.task_id where e.question_id=qid and t.status not in ('approved','cancelled') and t.archived_at is null) then raise exception 'PROJECT_QUESTION_TASK_OPEN'; end if;
  else b:=q.body; end if;
  if op='close' then b:=jsonb_set(b,'{status}','"closed"'); end if;
  if op='reopen' then b:=jsonb_set(b,'{status}','"open"'); end if;
  if op='send' then
    if exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and action_case_id=p_case_id and document_id=any(file_ids))
      or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and action_case_id=p_case_id and response_document_id=any(file_ids)) then raise exception 'PROJECT_QUESTION_FILES'; end if;
    a:=b->'assignee';
    if a is null or a='null'::jsonb then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
    if a->>'kind'='customer' then
      perform 1 from public.action_case_customer_contract_drafts where org_id=p_org_id and action_case_id=p_case_id for share;
      perform 1 from public.action_case_participants where org_id=p_org_id and action_case_id=p_case_id and role='customer' for share;
      select c.name,c.email,c.phone into assigned_name,assigned_email,customer_phone from public.project_question_customers(p_org_id,p_case_id) c where c.id=(a->>'id')::uuid;
    elsif a->>'kind'='contact' then
      select name,email into assigned_name,assigned_email from public.organization_contacts where org_id=p_org_id and id=(a->>'id')::uuid and is_active for share;
      recipient_contact_id:=(a->>'id')::uuid;
    else
      select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email into assigned_name,assigned_email from public.org_members m join public.profiles p on p.id=m.profile_id where m.org_id=p_org_id and m.profile_id=(a->>'id')::uuid and m.is_active for share of m,p;
    end if;
    if assigned_name is null or assigned_email is distinct from a->>'email' or assigned_name is distinct from a->>'name' or (a->>'kind'<>'profile' and btrim(coalesce(assigned_email,''))='') then raise exception 'PROJECT_QUESTION_RECIPIENT_CHANGED'; end if;
    due_at:=(p_request->>'dueAt')::timestamptz; followup_at:=(p_request->>'followupAt')::timestamptz;
    if due_at is null or followup_at is null or followup_at>due_at then raise exception 'PROJECT_QUESTION_DATES'; end if;
    if exists(select 1 from public.action_case_question_events e join public.operational_tasks t on t.id=e.task_id where e.question_id=qid and t.status not in ('approved','cancelled') and t.archived_at is null) then raise exception 'PROJECT_QUESTION_TASK_OPEN'; end if;
    if a->>'kind'='customer' then
      -- Reuse a matching recipient; do not reactivate an explicitly disabled contact.
      perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||lower(assigned_name)||':'||lower(assigned_email),0));
      select c.id into recipient_contact_id from public.organization_contacts c
        where c.org_id=p_org_id and lower(btrim(c.name))=lower(assigned_name) and lower(btrim(c.email))=lower(assigned_email) and c.is_active order by c.id limit 1 for share;
      if recipient_contact_id is null then
        if exists(select 1 from public.organization_contacts c where c.org_id=p_org_id and lower(btrim(c.name))=lower(assigned_name) and lower(btrim(c.email))=lower(assigned_email) and not c.is_active) then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
        insert into public.organization_contacts(org_id,name,email,phone,preferred_channel,is_active,created_by,updated_by)
          values(p_org_id,assigned_name,assigned_email,customer_phone,'email',true,p_actor_id,p_actor_id) returning id into recipient_contact_id;
      end if;
    end if;
    task:=public.create_operational_task_with_recurrence(
      p_org_id=>p_org_id,p_title=>'F-'||lpad(q.number::text,3,'0')||': '||(b->>'title'),
      p_due_at=>due_at,p_next_followup_at=>followup_at,p_primary_channel=>'email',p_task_kind=>'general',
      p_evidence_requirement=>'optional',p_evidence_requirements=>'{}'::text[],p_defer_initial_dispatch=>true,
      p_assignee_profile_id=>case when a->>'kind'='profile' then (a->>'id')::uuid end,
      p_assignee_contact_id=>recipient_contact_id,
      p_description=>(b->>'description')||case when coalesce(b->>'source','')<>'' then E'\n\nBakgrund: '||(b->>'source') else '' end||case when coalesce(b->>'meetingDate','')<>'' then E'\nMötesdatum: '||(b->>'meetingDate') else '' end,
      p_context_label=>'Projektfråga',p_actor_profile_id=>p_actor_id);
    tid:=task.id;
    for f in select * from public.action_case_attachments where id=any(file_ids) and org_id=p_org_id and action_case_id=p_case_id loop
      insert into public.task_attachments(org_id,task_id,attachment_type,file_name,storage_bucket,file_path,content_type,file_size_bytes,is_completion_evidence,uploaded_by_profile_id)
        values(p_org_id,tid,case when f.attachment_type='image' then 'photo' else 'document' end,f.file_name,f.storage_bucket,f.file_path,f.content_type,f.file_size_bytes,false,p_actor_id);
    end loop;
    perform public.finalize_operational_task_initial_dispatch(p_org_id,tid,p_actor_id);
    b:=jsonb_set(b,'{status}','"investigating"');
  end if;
  if op='create' then
    insert into public.action_case_questions(id,org_id,action_case_id,number,body) values(qid,p_org_id,p_case_id,n,b);
  else update public.action_case_questions set body=b,revision=revision+1,updated_at=now() where id=qid; end if;
  insert into public.action_case_question_events(id,org_id,action_case_id,question_id,revision,operation,actor_id,actor_name,body,message,reported_by,request,task_id)
    values(rid,p_org_id,p_case_id,qid,expected+1,op,p_actor_id,actor,b,coalesce(p_request->>'text',''),coalesce(p_request->>'reportedBy',''),p_request,tid);
  insert into public.action_case_question_files(event_id,attachment_id,file_name)
    select rid,id,file_name from public.action_case_attachments where id=any(file_ids) and org_id=p_org_id and action_case_id=p_case_id;
  return qid;
end $$;
revoke all on function public.mutate_project_question(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_project_question(uuid,uuid,uuid,jsonb) to service_role;
commit;
