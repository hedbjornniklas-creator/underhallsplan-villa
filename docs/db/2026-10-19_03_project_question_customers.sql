-- Read-only customer directory for project questions. Assignment never shares a project.
-- Sending reuses Uppdrag contacts/outbox; agreements and historical events are untouched.
begin;

create function public.project_question_customers(p_org_id uuid,p_case_id uuid)
returns table(id uuid,name text,email text,phone text)
language plpgsql stable security definer set search_path=public,pg_catalog as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  if not exists(select 1 from public.action_cases c where c.org_id=p_org_id and c.id=p_case_id) then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  return query
  with registered as (
    select p.name as customer_name,p.email as customer_email,p.phone as customer_phone,0 as priority
    from public.action_case_participants p where p.org_id=p_org_id and p.action_case_id=p_case_id and p.role='customer'
  ), parties as (
    select x->>'name' as customer_name,d.body#>>'{contractParties,email}' as customer_email,
      coalesce(nullif(d.body#>>'{contractParties,mobile}',''),d.body#>>'{contractParties,phone}') as customer_phone,1 as priority
    from public.action_case_customer_contract_drafts d
    cross join lateral jsonb_array_elements(case when jsonb_typeof(d.body#>'{contractParties,customers}')='array' then d.body#>'{contractParties,customers}' else '[]'::jsonb end) x
    where d.org_id=p_org_id and d.action_case_id=p_case_id
  ), fallback as (
    select c.customer_name,c.customer_email,c.customer_phone,2 as priority from public.action_cases c
    where c.org_id=p_org_id and c.id=p_case_id and not exists(select 1 from registered) and not exists(select 1 from parties where btrim(coalesce(customer_name,''))<>'')
  ), cleaned as (
    select btrim(customer_name) as n,nullif(lower(btrim(customer_email)),'') as e,nullif(btrim(customer_phone),'') as p,priority
    from (select * from registered union all select * from parties union all select * from fallback) candidates
    where btrim(coalesce(customer_name,''))<>''
  ), unique_people as (
    select distinct on(lower(n),coalesce(e,'')) n,e,p from cleaned order by lower(n),coalesce(e,''),priority,p nulls last
  )
  select md5('project-question-customer:'||p_org_id::text||':'||p_case_id::text||':'||lower(u.n)||':'||coalesce(u.e,''))::uuid,u.n,u.e,u.p
  from unique_people u order by lower(u.n),coalesce(u.e,'');
end $$;
revoke all on function public.project_question_customers(uuid,uuid) from public,anon,authenticated;
grant execute on function public.project_question_customers(uuid,uuid) to service_role;

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
  if op is null or op not in ('create','update','answer','note','conclusion','close','reopen','send') or qid is null or rid is null or expected is null then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  if coalesce(length(p_request->>'text'),0)>12000 or coalesce(length(p_request->>'reportedBy'),0)>250 then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  if op in ('answer','note','conclusion','close','reopen') and btrim(coalesce(p_request->>'text',''))='' then raise exception 'PROJECT_QUESTION_INVALID'; end if;
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
    b:=jsonb_set(b,'{conclusion}',coalesce(q.body->'conclusion','""'));
    if op='update' and (b#>'{assignee,id}',b#>'{assignee,kind}') is distinct from (q.body#>'{assignee,id}',q.body#>'{assignee,kind}')
      and exists(select 1 from public.action_case_question_events e join public.operational_tasks t on t.id=e.task_id where e.question_id=qid and t.status not in ('approved','cancelled') and t.archived_at is null) then raise exception 'PROJECT_QUESTION_TASK_OPEN'; end if;
  else b:=q.body; end if;
  if op='answer' then b:=jsonb_set(b,'{status}','"answered"'); end if;
  if op='conclusion' then b:=jsonb_set(b,'{conclusion}',to_jsonb(p_request->>'text')); end if;
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
