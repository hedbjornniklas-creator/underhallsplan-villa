-- Separate published participation from the current assignee and mail delivery.
-- Existing question bodies, private notes and attachment selections are not changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

create or replace function public.recipient_session_identity(p_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare result uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'TASK_RECIPIENT_SCOPE_RESOLVE_FORBIDDEN'; end if;
  select i.id into result from public.task_recipient_identities i join auth.users u on u.id=i.auth_user_id
    and u.email_confirmed_at is not null and lower(btrim(u.email))=i.email_normalized
    where i.auth_user_id=p_auth_user_id and i.status='active';
  return result;
end $$;

create or replace function public.project_question_published_snapshot(p_question_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_catalog as $$
  select snapshot from (
    select jsonb_build_object('title',c.shared_body->>'title','description',c.shared_body->>'description','sharedAt',c.shared_at) snapshot,c.shared_at published_at,0 priority
      from public.action_case_question_conversations c where c.question_id=p_question_id and c.shared_at is not null and nullif(c.shared_body->>'title','') is not null
    union all
    select jsonb_build_object('title',e.body->>'title','description',e.body->>'description','sharedAt',e.created_at),e.created_at,1
      from public.action_case_question_events e where e.question_id=p_question_id and e.operation='send' and e.task_id is not null
        and nullif(e.body->>'title','') is not null
  ) published order by published_at desc,priority limit 1
$$;

create or replace function public.prepare_published_question_participant()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare contact_value uuid; recipient public.task_recipient_identities;
begin
  if not new.active or public.project_question_published_snapshot(new.question_id) is null then return new; end if;
  if new.person_kind='profile' then new.shared:=true; return new; end if;
  if nullif(btrim(new.email),'') is null then return new; end if;
  if new.person_kind='contact' then
    select id into contact_value from public.organization_contacts where id=new.person_id and org_id=new.org_id
      and is_active and lower(btrim(email))=lower(btrim(new.email));
    if contact_value is null then return new; end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(new.org_id::text||':'||lower(btrim(new.email)),0));
    select id into contact_value from public.organization_contacts where org_id=new.org_id and is_active
      and lower(btrim(email))=lower(btrim(new.email)) and (id=new.contact_id or name=new.name)
      order by (id=new.contact_id) desc nulls last,id limit 1;
    if contact_value is null then
      insert into public.organization_contacts(org_id,name,email,preferred_channel,is_active)
        values(new.org_id,new.name,new.email,'email',true) returning id into contact_value;
    end if;
  end if;
  recipient:=public.ensure_task_recipient_identity_for_contact(contact_value);
  if recipient.status='disabled' then return new; end if;
  new.contact_id:=contact_value;
  if not new.shared or new.link_expires_at is null or new.link_expires_at<=now() then
    new.link_nonce:=gen_random_uuid(); new.link_expires_at:=now()+interval '90 days';
  end if;
  new.shared:=true;
  return new;
end $$;
drop trigger if exists trg_prepare_published_question_participant on public.action_case_question_participants;
create trigger trg_prepare_published_question_participant before insert or update of active,shared,contact_id,email
  on public.action_case_question_participants for each row execute function public.prepare_published_question_participant();

create or replace function public.publish_question_participant_access()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if new.operation='send' and new.task_id is not null then
    update public.action_case_question_conversations set shared_body=jsonb_build_object('title',new.body->>'title','description',new.body->>'description'),
      shared_at=new.created_at,version=version+1 where question_id=new.question_id and (shared_at is null or shared_at<new.created_at);
    update public.action_case_question_participants set shared=true where question_id=new.question_id and active;
  end if;
  return new;
end $$;
drop trigger if exists trg_publish_question_participant_access on public.action_case_question_events;
create trigger trg_publish_question_participant_access after insert on public.action_case_question_events
  for each row execute function public.publish_question_participant_access();

-- A prior explicit send is a publication, even when the mail was not received.
-- Only its title/description are copied, never the current private draft body.
with published as (
  select distinct on(question_id) question_id,body,created_at from public.action_case_question_events
    where operation='send' and task_id is not null and nullif(body->>'title','') is not null
    order by question_id,created_at desc,id desc
)
update public.action_case_question_conversations c set shared_body=jsonb_build_object('title',p.body->>'title','description',p.body->>'description'),
  shared_at=p.created_at,version=c.version+1 from published p where c.question_id=p.question_id and c.shared_at is null;
update public.action_case_question_participants p set shared=true
  where p.active and public.project_question_published_snapshot(p.question_id) is not null;

create or replace function public.resolve_recipient_question_scope(p_auth_user_id uuid,p_question_id uuid default null)
returns setof public.action_case_question_participants language plpgsql security definer set search_path=public,pg_catalog as $$
declare identity_value uuid:=public.recipient_session_identity(p_auth_user_id);
begin
  if identity_value is null then return; end if;
  return query select p.* from public.action_case_question_participants p
    join public.organization_contacts c on c.id=p.contact_id and c.org_id=p.org_id and c.is_active
      and c.recipient_identity_id=identity_value and lower(btrim(c.email))=lower(btrim(p.email))
    where p.active and p.shared and p.person_kind<>'profile' and (p_question_id is null or p.question_id=p_question_id)
      and public.project_question_published_snapshot(p.question_id) is not null;
end $$;

alter table public.action_case_question_messages drop constraint if exists action_case_question_messages_actor_method_check;
alter table public.action_case_question_messages add constraint action_case_question_messages_actor_method_check
  check(actor_method in ('internal_login','personal_link','recipient_login'));

create or replace function public.reply_recipient_project_question(p_auth_user_id uuid,p_question_id uuid,p_request jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare q public.action_case_questions; c public.action_case_question_conversations; actor public.action_case_question_participants;
  prior public.action_case_question_messages; rid uuid:=(p_request->>'requestId')::uuid; text_value text:=btrim(p_request->>'text'); files uuid[]; snapshot jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select * into q from public.action_case_questions where id=p_question_id for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  select * into c from public.action_case_question_conversations where question_id=q.id for update;
  select p.* into actor from public.action_case_question_participants p where p.id in
    (select s.id from public.resolve_recipient_question_scope(p_auth_user_id,q.id) s) order by p.id limit 1 for update;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  perform 1 from public.organization_contacts oc join public.task_recipient_identities i on i.id=oc.recipient_identity_id
    where oc.id=actor.contact_id and oc.is_active and i.status='active' and i.auth_user_id=p_auth_user_id for share of oc,i;
  if not found then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  select * into prior from public.action_case_question_messages where id=rid;
  if found then
    if prior.question_id<>q.id or prior.participant_id<>actor.id or prior.request<>p_request then raise exception 'PROJECT_QUESTION_STALE'; end if;
    return prior.id;
  end if;
  if rid is null or p_request->>'operation' is distinct from 'reply' or text_value is null or length(text_value) not between 1 and 12000
    or jsonb_typeof(p_request->'fileIds') is distinct from 'array' or jsonb_array_length(p_request->'fileIds')>20 then raise exception 'PROJECT_QUESTION_INVALID'; end if;
  if q.body->>'status'='closed' then raise exception 'PROJECT_QUESTION_CLOSED'; end if;
  if (select count(*) from public.action_case_question_messages where participant_id=actor.id and created_at>now()-interval '1 minute')>=30 then raise exception 'PROJECT_QUESTION_RATE_LIMITED'; end if;
  select coalesce(array_agg(value::uuid),'{}') into files from jsonb_array_elements_text(p_request->'fileIds');
  if exists(select 1 from unnest(files) f where not exists(select 1 from public.action_case_question_message_files mf
      join public.action_case_question_messages m on m.id=mf.message_id where m.question_id=q.id and m.operation in ('share','reply') and mf.attachment_id=f)) then raise exception 'PROJECT_QUESTION_FILES'; end if;
  snapshot:=public.project_question_published_snapshot(q.id);
  if snapshot is null then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  insert into public.action_case_question_messages(id,question_id,participant_id,operation,actor_name,actor_method,message,request)
    values(rid,q.id,actor.id,'reply',actor.name,'recipient_login',text_value,p_request);
  insert into public.action_case_question_message_files(message_id,attachment_id,file_name)
    select rid,a.id,a.file_name from public.action_case_attachments a where a.org_id=q.org_id and a.id=any(files);
  insert into public.action_case_question_deliveries(message_id,participant_id,link_nonce,recipient_name,recipient_email,question_title,body_text)
    select rid,p.id,p.link_nonce,p.name,p.email,snapshot->>'title','Nytt svar fran '||actor.name||'. Oppna fragan for att lasa och svara.'
      from public.action_case_question_participants p where p.question_id=q.id and p.active and p.shared and p.id<>actor.id and nullif(btrim(p.email),'') is not null;
  update public.action_case_question_conversations set version=version+1 where question_id=q.id;
  update public.action_case_questions set updated_at=now() where id=q.id;
  return rid;
end $$;

create or replace function public.resend_project_question_link(p_org_id uuid,p_case_id uuid,p_question_id uuid,p_actor_id uuid,p_participant_id uuid,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare q public.action_case_questions; actor public.action_case_question_participants; target public.action_case_question_participants;
  prior public.action_case_question_messages; snapshot jsonb; request_value jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select * into q from public.action_case_questions where id=p_question_id and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found or not public.project_question_internal_participant(p_org_id,p_case_id,p_question_id,p_actor_id)
    or p_actor_id is distinct from (select manager_profile_id from public.action_cases where id=p_case_id and org_id=p_org_id) then raise exception 'PROJECT_QUESTION_FORBIDDEN'; end if;
  select * into actor from public.action_case_question_participants where question_id=q.id and person_kind='profile' and person_id=p_actor_id and active;
  select * into target from public.action_case_question_participants where id=p_participant_id and question_id=q.id and active and shared for update;
  snapshot:=public.project_question_published_snapshot(q.id);
  if target.id is null or actor.id is null or snapshot is null or nullif(btrim(target.email),'') is null or p_request_id is null then raise exception 'PROJECT_QUESTION_NOT_FOUND'; end if;
  request_value:=jsonb_build_object('operation','resend_link','participantId',p_participant_id,'actorId',p_actor_id);
  select * into prior from public.action_case_question_messages where id=p_request_id;
  if found then
    if prior.question_id<>q.id or prior.participant_id<>actor.id or prior.request<>request_value then raise exception 'PROJECT_QUESTION_STALE'; end if;
    return prior.id;
  end if;
  if exists(select 1 from public.action_case_question_deliveries where participant_id=target.id and created_at>now()-interval '30 seconds') then raise exception 'PROJECT_QUESTION_RATE_LIMITED'; end if;
  if target.link_expires_at is null or target.link_expires_at<=now() then
    update public.action_case_question_participants set link_nonce=gen_random_uuid(),link_expires_at=now()+interval '90 days' where id=target.id returning * into target;
  end if;
  insert into public.action_case_question_messages(id,question_id,participant_id,operation,actor_name,actor_method,message,snapshot,request)
    values(p_request_id,q.id,actor.id,'share',actor.name,'internal_login','Fragelanken skickades pa nytt.',jsonb_build_object('title',snapshot->>'title','description',snapshot->>'description'),request_value);
  insert into public.action_case_question_deliveries(message_id,participant_id,link_nonce,recipient_name,recipient_email,question_title,body_text)
    values(p_request_id,target.id,target.link_nonce,target.name,target.email,snapshot->>'title','Har kommer lanken till fragan igen. Tidigare delad historik finns kvar.');
  update public.action_case_question_conversations set version=version+1 where question_id=q.id;
  return p_request_id;
end $$;

-- Former recipients retain a read-only publication, not an assignee actor or
-- a reactivated anonymous link. An explicit removal/deactivation still wins.
create or replace function public.resolve_recipient_task_participation(p_auth_user_id uuid,p_task_id uuid default null)
returns table(grant_id uuid,org_id uuid,contact_id uuid,task_id uuid,question_id uuid,shared_from timestamptz,shared_until timestamptz,snapshot jsonb)
language plpgsql security definer set search_path=public,pg_catalog as $$
declare identity_value uuid:=public.recipient_session_identity(p_auth_user_id);
begin
  if identity_value is null then return; end if;
  return query select g.id,g.org_id,g.contact_id,g.task_id,question.id,publication_start.sent_at,publication.revoked_at,
      coalesce(changes.metadata->'before',jsonb_build_object('title','Delat uppdrag','description',null,'contextLabel',null,'dueAt',null))
        ||jsonb_build_object('closed',t.status in ('approved','cancelled'))
    from public.task_recipient_portal_grants g join public.organization_contacts oc on oc.id=g.contact_id and oc.org_id=g.org_id and oc.is_active
      and oc.recipient_identity_id=identity_value
    join public.operational_tasks t on t.id=g.task_id and t.org_id=g.org_id and t.archived_at is null
    join lateral(select l.sent_at,l.revoked_at from public.task_access_links l
      where l.task_id=g.task_id and l.org_id=g.org_id and l.contact_id=g.contact_id
        and l.sent_at is not null and l.revoked_at is not null and l.revoked_at>=l.sent_at
      order by l.sent_at desc,l.id desc limit 1) publication on true
    left join lateral(select max(e.created_at) started_at from public.task_events e
      where e.task_id=g.task_id and e.org_id=g.org_id and e.event_type='task_recipient_changed'
        and e.metadata->'after'->>'assigneeContactId'=g.contact_id::text and e.created_at<=publication.sent_at) tenure on true
    join lateral(select min(l.sent_at) sent_at from public.task_access_links l
      where l.task_id=g.task_id and l.org_id=g.org_id and l.contact_id=g.contact_id
        and l.sent_at<=publication.sent_at and l.sent_at>=coalesce(tenure.started_at,'-infinity'::timestamptz)) publication_start on true
    left join lateral(select q.id from public.action_case_question_events e join public.action_case_questions q on q.id=e.question_id and q.org_id=e.org_id
      where e.task_id=g.task_id and e.org_id=g.org_id order by e.created_at limit 1) question on true
    left join lateral(select e.metadata from public.task_events e where e.task_id=g.task_id and e.org_id=g.org_id and e.event_type='task_recipient_changed'
      and e.metadata->'before'->>'assigneeContactId'=g.contact_id::text and e.created_at>=publication.sent_at
      and e.created_at<=publication.revoked_at order by e.created_at,e.id limit 1) changes on true
    where g.recipient_identity_id=identity_value and g.revoked_at is not null
      and g.revocation_reason in ('task_reassigned','task_reassigned_awaiting_dispatch') and (p_task_id is null or g.task_id=p_task_id)
      and (question.id is null or exists(select 1 from public.action_case_question_participants p where p.question_id=question.id and p.org_id=g.org_id and p.active
        and (p.contact_id=g.contact_id or (p.person_kind='contact' and p.person_id=g.contact_id))));
end $$;

create or replace function public.remove_question_participant_task_access()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare contact_value uuid:=coalesce(old.contact_id,case when old.person_kind='contact' then old.person_id end);
begin
  if old.active and not new.active and contact_value is not null then
    update public.task_recipient_portal_grants set revoked_at=coalesce(revoked_at,now()),revocation_reason='question_participant_removed'
      where org_id=old.org_id and contact_id=contact_value and task_id in(select task_id from public.action_case_question_events where question_id=old.question_id and org_id=old.org_id and task_id is not null);
    update public.task_access_links set revoked_at=coalesce(revoked_at,now()) where org_id=old.org_id and contact_id=contact_value
      and task_id in(select task_id from public.action_case_question_events where question_id=old.question_id and org_id=old.org_id and task_id is not null);
  end if;
  return new;
end $$;
drop trigger if exists trg_remove_question_participant_task_access on public.action_case_question_participants;
create trigger trg_remove_question_participant_task_access after update of active on public.action_case_question_participants
  for each row execute function public.remove_question_participant_task_access();

revoke all on function public.recipient_session_identity(uuid) from public,anon,authenticated;
revoke all on function public.project_question_published_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.prepare_published_question_participant() from public,anon,authenticated;
revoke all on function public.publish_question_participant_access() from public,anon,authenticated;
revoke all on function public.resolve_recipient_question_scope(uuid,uuid) from public,anon,authenticated;
revoke all on function public.reply_recipient_project_question(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.resend_project_question_link(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.resolve_recipient_task_participation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.remove_question_participant_task_access() from public,anon,authenticated;
grant execute on function public.recipient_session_identity(uuid),public.project_question_published_snapshot(uuid),
  public.resolve_recipient_question_scope(uuid,uuid),public.reply_recipient_project_question(uuid,uuid,jsonb),
  public.resend_project_question_link(uuid,uuid,uuid,uuid,uuid,uuid),public.resolve_recipient_task_participation(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
