-- Requires 2026-10-19_04_project_question_dialogue.sql. Project manager is explicit,
-- never inferred from created_by. Administrators appoint the project manager.
-- Question-scoped participants and a separately shared conversation.
-- Private question history is never copied into the shared message stream.
begin;
alter table public.action_cases add column manager_profile_id uuid references public.profiles(id);
create function public.guard_project_manager() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if (tg_op='INSERT' and new.manager_profile_id is not null) or (tg_op='UPDATE' and new.manager_profile_id is distinct from old.manager_profile_id) then
    if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_MANAGER_FORBIDDEN'; end if;
    if new.manager_profile_id is not null and not exists(select 1 from public.org_members m where m.org_id=new.org_id and m.profile_id=new.manager_profile_id and m.is_active) then raise exception 'PROJECT_MANAGER_INVALID'; end if;
  end if;
  return new;
end $$;
create trigger action_case_project_manager_guard before insert or update of manager_profile_id on public.action_cases for each row execute function public.guard_project_manager();
create table public.action_case_question_participants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  action_case_id uuid not null,
  question_id uuid not null,
  person_kind text not null check(person_kind in ('profile','contact','customer')),
  person_id uuid not null,
  name text not null,
  email text,
  contact_id uuid references public.organization_contacts(id),
  active boolean not null default true,
  shared boolean not null default false,
  added_as_manager boolean not null default false,
  link_nonce uuid not null default gen_random_uuid(),
  link_expires_at timestamptz,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  unique(question_id,person_kind,person_id),
  foreign key(org_id,action_case_id,question_id) references public.action_case_questions(org_id,action_case_id,id)
);
create table public.action_case_question_conversations (
  question_id uuid primary key references public.action_case_questions(id),
  owner_id uuid not null references public.profiles(id),
  shared_body jsonb,
  shared_at timestamptz,
  version integer not null default 0
);
create table public.action_case_question_messages (
  id uuid primary key,
  question_id uuid not null references public.action_case_questions(id),
  participant_id uuid not null references public.action_case_question_participants(id),
  operation text not null check(operation in ('participants','share','reply')),
  actor_name text not null,
  actor_method text not null check(actor_method in ('internal_login','personal_link')),
  message text not null default '',
  snapshot jsonb,
  request jsonb not null,
  created_at timestamptz not null default now()
);
create table public.action_case_question_message_files (
  message_id uuid not null references public.action_case_question_messages(id),
  attachment_id uuid not null references public.action_case_attachments(id),
  file_name text not null,
  primary key(message_id,attachment_id)
);
create table public.action_case_question_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.action_case_question_messages(id),
  participant_id uuid not null references public.action_case_question_participants(id),
  link_nonce uuid not null,
  recipient_name text not null,
  recipient_email text not null,
  question_title text not null,
  body_text text not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  claimed_until timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  unique(message_id,participant_id)
);
create index on public.action_case_question_participants(org_id,person_id,question_id) where active;
create index on public.action_case_question_messages(question_id,created_at,id);
create index on public.action_case_question_deliveries(status,claimed_until);
alter table public.action_case_attachments add column question_id uuid;
alter table public.action_case_attachments add constraint question_file_scope foreign key(org_id,action_case_id,question_id) references public.action_case_questions(org_id,action_case_id,id);
create policy private_question_files_server_only on public.action_case_attachments as restrictive for all to anon,authenticated using(question_id is null) with check(question_id is null);
-- A separate private bucket has no organization-wide storage policy.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  select 'project-question-files','project-question-files',false,file_size_limit,allowed_mime_types from storage.buckets where id='action-case-files'
  on conflict(id) do nothing;
alter table public.action_case_attachments add constraint private_question_bucket check((question_id is null and storage_bucket<>'project-question-files') or (question_id is not null and storage_bucket='project-question-files'));
alter table public.action_case_question_participants enable row level security;
alter table public.action_case_question_conversations enable row level security;
alter table public.action_case_question_messages enable row level security;
alter table public.action_case_question_message_files enable row level security;
alter table public.action_case_question_deliveries enable row level security;
revoke all on public.action_case_question_participants,public.action_case_question_conversations,public.action_case_question_messages,public.action_case_question_message_files,public.action_case_question_deliveries from public,anon,authenticated,service_role;
grant select on public.action_case_question_participants,public.action_case_question_conversations,public.action_case_question_messages,public.action_case_question_message_files,public.action_case_question_deliveries to service_role;
create trigger question_messages_immutable before update or delete on public.action_case_question_messages for each row execute function public.protect_project_question_history();
create trigger question_message_files_immutable before update or delete on public.action_case_question_message_files for each row execute function public.protect_project_question_history();

insert into public.action_case_question_conversations(question_id,owner_id)
  select q.id,e.actor_id from public.action_case_questions q
  join public.action_case_question_events e on e.question_id=q.id and e.operation='create' and e.revision=1;
do $$begin
  if exists(select 1 from public.action_case_questions q where not exists(select 1 from public.action_case_question_conversations c where c.question_id=q.id)) then raise exception 'PROJECT_QUESTION_HISTORY_MISSING'; end if;
end $$;
insert into public.action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email)
  select q.org_id,q.action_case_id,q.id,'profile',c.owner_id,coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email
  from public.action_case_questions q join public.action_case_question_conversations c on c.question_id=q.id join public.profiles p on p.id=c.owner_id;
insert into public.action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email)
  select q.org_id,q.action_case_id,q.id,'profile',p.id,coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email
  from public.action_case_questions q join public.profiles p on q.body#>>'{assignee,kind}'='profile' and p.id::text=q.body#>>'{assignee,id}'
  join public.org_members m on m.org_id=q.org_id and m.profile_id=p.id and m.is_active
  on conflict(question_id,person_kind,person_id) do nothing;

create function public.project_question_internal_participant(p_org_id uuid,p_case_id uuid,p_question_id uuid,p_profile_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_catalog as $$
  select auth.role()='service_role' and exists(
    select 1 from public.action_case_question_participants p join public.org_members m on m.org_id=p.org_id and m.profile_id=p.person_id and m.is_active
    where p.org_id=p_org_id and p.action_case_id=p_case_id and p.question_id=p_question_id and p.person_kind='profile' and p.person_id=p_profile_id and p.active
  );
$$;

-- Existing question mutations retain their atomic task pipeline, behind a participant gate.
alter function public.mutate_project_question(uuid,uuid,uuid,jsonb) rename to mutate_project_question_core;
revoke all on function public.mutate_project_question_core(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.mutate_project_question(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_request jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare qid uuid:=(p_request->>'questionId')::uuid; result uuid; q public.action_case_questions%rowtype; manager uuid; a jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select manager_profile_id into manager from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if p_request->>'operation'<>'create' and not public.project_question_internal_participant(p_org_id,p_case_id,qid,p_actor_id) then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if p_request->>'operation'='send' and p_actor_id is distinct from manager then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  if exists(select 1 from public.action_case_attachments f where f.id in(select value::uuid from jsonb_array_elements_text(p_request->'fileIds')) and f.question_id is not null and f.question_id<>qid) then raise exception 'PROJECT_QUESTION_FILES'; end if;
  a:=p_request#>'{body,assignee}';
  if p_actor_id is distinct from manager and a is not null and a<>'null'::jsonb
    and not (a->>'kind'='profile' and (a->>'id'=p_actor_id::text or a->>'id'=manager::text))
    and not exists(select 1 from public.action_case_question_participants p where p.question_id=qid and p.person_kind=a->>'kind' and p.person_id::text=a->>'id' and p.active)
  then raise exception 'PROJECT_QUESTION_PARTICIPANT_REQUIRED'; end if;
  result:=public.mutate_project_question_core(p_org_id,p_case_id,p_actor_id,p_request);
  select * into q from public.action_case_questions where id=result;
  if p_request->>'operation'='create' then
    insert into public.action_case_question_conversations(question_id,owner_id) values(result,p_actor_id) on conflict do nothing;
    insert into public.action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email)
      select p_org_id,p_case_id,result,'profile',p.id,coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email from public.profiles p where p.id=p_actor_id
      on conflict(question_id,person_kind,person_id) do nothing;
    if manager is not null then
      insert into public.action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email,added_as_manager)
        select p_org_id,p_case_id,result,'profile',p.id,coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email,true from public.profiles p where p.id=manager
        on conflict(question_id,person_kind,person_id) do update set active=true,removed_at=null;
    end if;
  end if;
  if q.body->'assignee'<>'null'::jsonb and p_actor_id=manager then
    insert into public.action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email)
      values(p_org_id,p_case_id,result,q.body#>>'{assignee,kind}',(q.body#>>'{assignee,id}')::uuid,q.body#>>'{assignee,name}',q.body#>>'{assignee,email}')
      on conflict(question_id,person_kind,person_id) do update set active=true,removed_at=null;
  end if;
  return result;
end $$;

create function public.set_project_manager(p_org_id uuid,p_case_id uuid,p_actor_id uuid,p_manager_id uuid,p_expected_manager_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare previous uuid; manager_name text;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_actor_id and is_active and role='admin') then raise exception 'PROJECT_MANAGER_FORBIDDEN'; end if;
  select manager_profile_id into previous from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'PROJECT_MANAGER_NOT_FOUND'; end if;
  if previous is distinct from p_expected_manager_id then raise exception 'PROJECT_MANAGER_STALE'; end if;
  if p_manager_id is not null then
    select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare') into manager_name from public.profiles p join public.org_members m on m.profile_id=p.id and m.org_id=p_org_id and m.is_active where p.id=p_manager_id for share of p,m;
    if not found then raise exception 'PROJECT_MANAGER_INVALID'; end if;
  end if;
  if previous is not distinct from p_manager_id then return p_case_id; end if;
  update public.action_cases set manager_profile_id=p_manager_id where id=p_case_id and org_id=p_org_id;
  update public.action_case_question_participants set active=false,shared=false,removed_at=now(),link_nonce=gen_random_uuid()
    where org_id=p_org_id and action_case_id=p_case_id and person_kind='profile' and person_id=previous and added_as_manager;
  if p_manager_id is not null then
    insert into public.action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email,added_as_manager)
      select q.org_id,q.action_case_id,q.id,'profile',p.id,manager_name,p.email,true
      from public.action_case_questions q cross join public.profiles p where q.org_id=p_org_id and q.action_case_id=p_case_id and p.id=p_manager_id
      on conflict(question_id,person_kind,person_id) do update set active=true,removed_at=null;
  end if;
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'project_manager_changed',coalesce(manager_name,'Projektansvarig borttagen'),p_actor_id);
  return p_case_id;
end $$;

create function public.mutate_project_question_dialogue(p_org_id uuid,p_case_id uuid,p_question_id uuid,p_profile_id uuid,p_participant_id uuid,p_nonce uuid,p_request jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  q public.action_case_questions%rowtype; c public.action_case_question_conversations%rowtype;
  actor public.action_case_question_participants%rowtype; prior public.action_case_question_messages%rowtype;
  op text:=p_request->>'operation'; rid uuid:=(p_request->>'requestId')::uuid; refs jsonb; ref jsonb; ids uuid[]:='{}';
  person_name text; person_email text; pid uuid; member_id uuid; contact uuid; files uuid[]; expected integer:=(p_request->>'version')::integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  perform 1 from public.action_cases where org_id=p_org_id and id=p_case_id for update;
  select * into q from public.action_case_questions where org_id=p_org_id and action_case_id=p_case_id and id=p_question_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  select * into c from public.action_case_question_conversations where question_id=q.id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  if p_profile_id is not null then
    if not public.project_question_internal_participant(p_org_id,p_case_id,q.id,p_profile_id) then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
    select * into actor from public.action_case_question_participants where question_id=q.id and person_kind='profile' and person_id=p_profile_id and active;
  else
    select p.* into actor from public.action_case_question_participants p join public.organization_contacts oc on oc.id=p.contact_id and oc.org_id=p.org_id and oc.is_active and lower(btrim(oc.email))=lower(p.email)
      where p.id=p_participant_id and p.question_id=q.id and p.active and p.shared and p.link_nonce=p_nonce and p.link_expires_at>now() for share of p,oc;
    if not found or op<>'reply' then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  end if;
  select * into prior from public.action_case_question_messages where id=rid;
  if found then
    if prior.question_id<>q.id or prior.participant_id<>actor.id or prior.request<>p_request then raise exception 'PROJECT_QUESTION_STALE'; end if;
    return prior.id;
  end if;
  if op not in ('participants','share','reply') or rid is null or expected is null or (op<>'reply' and expected<>c.version) then raise exception 'PROJECT_QUESTION_STALE'; end if;
  if q.body->>'status'='closed' and op<>'participants' then raise exception 'PROJECT_QUESTION_CLOSED'; end if;
  if op='participants' then
    refs:=p_request->'participants';
    if p_profile_id is null or p_profile_id is distinct from (select manager_profile_id from public.action_cases where id=q.action_case_id and org_id=p_org_id) then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
    if jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs)>30 then raise exception 'PROJECT_QUESTION_INVALID'; end if;
    refs:=refs||jsonb_build_array(jsonb_build_object('kind','profile','id',p_profile_id));
    if q.body->'assignee'<>'null'::jsonb then refs:=refs||jsonb_build_array(q.body->'assignee'); end if;
    for ref in select value from jsonb_array_elements(refs) loop
      pid:=(ref->>'id')::uuid;person_name:=null;person_email:=null;
      if ref->>'kind'='profile' then
        select coalesce(nullif(btrim(p.full_name),''),p.email,'Intern användare'),p.email into person_name,person_email from public.profiles p join public.org_members m on m.profile_id=p.id and m.org_id=p_org_id and m.is_active where p.id=pid;
      elsif ref->>'kind'='contact' then
        select name,email into person_name,person_email from public.organization_contacts where id=pid and org_id=p_org_id and is_active;
      elsif ref->>'kind'='customer' then
        select name,email into person_name,person_email from public.project_question_customers(p_org_id,p_case_id) where id=pid;
      else raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
      if person_name is null then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
      if exists(select 1 from public.action_case_question_participants p where p.id=any(ids) and lower(btrim(p.name))=lower(btrim(person_name)) and lower(btrim(coalesce(p.email,'')))=lower(btrim(coalesce(person_email,'')))) then continue; end if;
      insert into public.action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email)
        values(p_org_id,p_case_id,q.id,ref->>'kind',pid,person_name,person_email)
        on conflict(question_id,person_kind,person_id) do update set active=true,removed_at=null,
          name=excluded.name,email=excluded.email,
          shared=case when action_case_question_participants.active and action_case_question_participants.email is not distinct from excluded.email then action_case_question_participants.shared else false end,
          link_nonce=case when action_case_question_participants.active and action_case_question_participants.email is not distinct from excluded.email then action_case_question_participants.link_nonce else gen_random_uuid() end
        returning id into member_id;
      ids:=array_append(ids,member_id);
    end loop;
    update public.action_case_question_participants set active=false,shared=false,removed_at=now(),link_nonce=gen_random_uuid() where question_id=q.id and active and not(id=any(ids));
  elsif op='share' then
    if p_profile_id is null or p_profile_id is distinct from (select manager_profile_id from public.action_cases where id=q.action_case_id and org_id=p_org_id) then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
    if p_request->>'confirmed'<>'true' then raise exception 'PROJECT_QUESTION_INVALID'; end if;
    -- New members receive only the explicitly shared snapshot and shared replies.
    for ref in select to_jsonb(p) from public.action_case_question_participants p where p.question_id=q.id and p.active and p.person_kind<>'profile' loop
      if btrim(coalesce(ref->>'email',''))='' then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
      person_name:=null;person_email:=null;
      if ref->>'person_kind'='customer' then
        select name,email into person_name,person_email from public.project_question_customers(p_org_id,p_case_id) where id=(ref->>'person_id')::uuid;
      else
        select name,email into person_name,person_email from public.organization_contacts where org_id=p_org_id and id=(ref->>'person_id')::uuid and is_active;
      end if;
      if person_name is distinct from ref->>'name' or person_email is distinct from ref->>'email' then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
      perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||lower(ref->>'name')||':'||lower(ref->>'email'),0));
      select oc.id into contact from public.organization_contacts oc where oc.org_id=p_org_id and lower(btrim(oc.name))=lower(ref->>'name') and lower(btrim(oc.email))=lower(ref->>'email') and oc.is_active order by oc.id limit 1 for share;
      if contact is null then
        if exists(select 1 from public.organization_contacts oc where oc.org_id=p_org_id and lower(btrim(oc.name))=lower(ref->>'name') and lower(btrim(oc.email))=lower(ref->>'email') and not oc.is_active) then raise exception 'PROJECT_QUESTION_ASSIGNEE'; end if;
        insert into public.organization_contacts(org_id,name,email,preferred_channel,is_active,created_by,updated_by) values(p_org_id,ref->>'name',ref->>'email','email',true,p_profile_id,p_profile_id) returning id into contact;
      end if;
      update public.action_case_question_participants set contact_id=contact where id=(ref->>'id')::uuid;
    end loop;
    update public.action_case_question_participants set shared=true,link_expires_at=now()+interval '90 days' where question_id=q.id and active;
    update public.action_case_question_conversations set shared_body=jsonb_build_object('title',q.body->>'title','description',q.body->>'description'),shared_at=now() where question_id=q.id;
  else
    if c.shared_at is null or btrim(coalesce(p_request->>'text',''))='' or length(p_request->>'text')>12000 then raise exception 'PROJECT_QUESTION_INVALID'; end if;
    if (select count(*) from public.action_case_question_messages where participant_id=actor.id and created_at>now()-interval '1 minute')>=30 then raise exception 'PROJECT_QUESTION_RATE_LIMITED'; end if;
  end if;
  if op='participants' then files:='{}'; else
    if jsonb_typeof(p_request->'fileIds') is distinct from 'array' or jsonb_array_length(p_request->'fileIds')>20 then raise exception 'PROJECT_QUESTION_FILES'; end if;
    select coalesce(array_agg(value::uuid),'{}') into files from jsonb_array_elements_text(p_request->'fileIds');
    if p_profile_id is null and cardinality(files)>0 then raise exception 'PROJECT_QUESTION_FILES'; end if;
    if (select count(*) from public.action_case_attachments where org_id=p_org_id and action_case_id=p_case_id and id=any(files) and (question_id is null or question_id=q.id))<>cardinality(files)
      or exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and action_case_id=p_case_id and document_id=any(files))
      or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and action_case_id=p_case_id and response_document_id=any(files)) then raise exception 'PROJECT_QUESTION_FILES'; end if;
  end if;
  insert into public.action_case_question_messages(id,question_id,participant_id,operation,actor_name,actor_method,message,snapshot,request)
    values(rid,q.id,actor.id,op,actor.name,case when p_profile_id is null then 'personal_link' else 'internal_login' end,case when op='reply' then btrim(p_request->>'text') else '' end,case when op='share' then jsonb_build_object('title',q.body->>'title','description',q.body->>'description') end,p_request);
  insert into public.action_case_question_message_files(message_id,attachment_id,file_name)
    select rid,id,file_name from public.action_case_attachments where org_id=p_org_id and action_case_id=p_case_id and id=any(files);
  if op in ('share','reply') then
    insert into public.action_case_question_deliveries(message_id,participant_id,link_nonce,recipient_name,recipient_email,question_title,body_text)
      select rid,p.id,p.link_nonce,p.name,p.email,case when op='share' then q.body->>'title' else c.shared_body->>'title' end,
        case when op='share' then 'Du har bjudits in till en projektfråga.' else 'Nytt svar från '||actor.name||'. Öppna frågan för att läsa och svara.' end
      from public.action_case_question_participants p where p.question_id=q.id and p.active and p.shared and p.id<>actor.id and btrim(coalesce(p.email,''))<>'';
  end if;
  update public.action_case_question_conversations set version=version+1 where question_id=q.id;
  update public.action_case_questions set updated_at=now() where id=q.id;
  return rid;
end $$;

create function public.claim_project_question_delivery(p_question_id uuid default null)
returns setof public.action_case_question_deliveries language plpgsql security definer set search_path=public,pg_catalog as $$
declare selected_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  update public.action_case_question_deliveries d set status='cancelled',claimed_until=null
    where d.status in ('pending','failed','sending') and not exists(
      select 1 from public.action_case_question_participants p where p.id=d.participant_id and p.active and p.shared and p.link_nonce=d.link_nonce and p.email=d.recipient_email
      and (p.person_kind='profile' or p.link_expires_at>now())
      and ((p.person_kind='profile' and exists(select 1 from public.profiles pr join public.org_members om on om.profile_id=pr.id and om.org_id=p.org_id and om.is_active where pr.id=p.person_id and lower(btrim(pr.email))=lower(btrim(p.email))))
        or (p.person_kind<>'profile' and exists(select 1 from public.organization_contacts oc where oc.id=p.contact_id and oc.org_id=p.org_id and oc.is_active and lower(btrim(oc.email))=lower(p.email))))
    );
  select d.id into selected_id from public.action_case_question_deliveries d
    join public.action_case_question_messages m on m.id=d.message_id
    where (p_question_id is null or m.question_id=p_question_id) and d.attempts<5 and
      (d.status='pending' or (d.status='failed' and d.claimed_until<now()) or (d.status='sending' and d.claimed_until<now()))
    order by m.created_at,d.id for update of d skip locked limit 1;
  if selected_id is null then return; end if;
  return query update public.action_case_question_deliveries set status='sending',attempts=attempts+1,claimed_until=now()+interval '5 minutes' where id=selected_id returning *;
end $$;
create function public.finish_project_question_delivery(p_id uuid,p_attempt integer,p_provider_id text)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  update public.action_case_question_deliveries set status=case when p_provider_id is null then 'failed' else 'sent' end,
    provider_message_id=p_provider_id,sent_at=case when p_provider_id is not null then now() end,
    claimed_until=case when p_provider_id is null then now()+interval '1 minute' end
    where id=p_id and attempts=p_attempt and status='sending';
end $$;

create or replace function public.protect_question_original_file() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if exists(select 1 from public.action_case_question_files where attachment_id=old.id)
    or exists(select 1 from public.action_case_question_message_files where attachment_id=old.id) then
    if row(new.org_id,new.action_case_id,new.question_id,new.file_path,new.storage_bucket,new.file_name,new.content_type,new.file_size_bytes)
      is distinct from row(old.org_id,old.action_case_id,old.question_id,old.file_path,old.storage_bucket,old.file_name,old.content_type,old.file_size_bytes)
      then raise exception 'PROJECT_QUESTION_IMMUTABLE'; end if;
  end if;
  return new;
end $$;
revoke all on function public.project_question_internal_participant(uuid,uuid,uuid,uuid), public.mutate_project_question(uuid,uuid,uuid,jsonb), public.mutate_project_question_dialogue(uuid,uuid,uuid,uuid,uuid,uuid,jsonb), public.claim_project_question_delivery(uuid), public.finish_project_question_delivery(uuid,integer,text), public.set_project_manager(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.project_question_internal_participant(uuid,uuid,uuid,uuid), public.mutate_project_question(uuid,uuid,uuid,jsonb), public.mutate_project_question_dialogue(uuid,uuid,uuid,uuid,uuid,uuid,jsonb), public.claim_project_question_delivery(uuid), public.finish_project_question_delivery(uuid,integer,text), public.set_project_manager(uuid,uuid,uuid,uuid,uuid) to service_role;
commit;
