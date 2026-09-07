begin;

create table if not exists public.renoapp_completion_requests (
  id uuid primary key,
  case_id uuid not null references public.renovation_cases(id) on delete cascade,
  items jsonb not null default '[]',
  message text not null,
  created_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  revision integer not null default 0,
  draft jsonb not null default '{}',
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  delivery_error text,
  provider_message_id text
);
create index if not exists renoapp_completion_requests_case_idx
  on public.renoapp_completion_requests(case_id, created_at desc);
alter table public.renoapp_completion_requests enable row level security;
revoke all on public.renoapp_completion_requests from public, anon, authenticated;
grant all on public.renoapp_completion_requests to service_role;

-- Preserve the latest legacy request at rollout. Earlier edits were not versioned.
insert into public.renoapp_completion_requests(id,case_id,message,created_at,submitted_at,items,delivery_status,delivery_error)
select m.id,c.id,coalesce(m.message,''),m.created_at,
  case when c.status <> 'need_info' then c.updated_at end,
  coalesce((select jsonb_agg(jsonb_build_object(
    'id',case when d.document_type_id is not null then 'document:'||d.document_type_id else 'participant:'||d.participant_role_id end,
    'category',case when d.document_type_id is not null then 'document' else 'participant' end,
    'label',coalesce(dt.label,pr.label,'Underlag'),'correction',false))
    from public.renoapp_case_requirement_decisions d
    left join public.renovation_document_types dt on dt.id=d.document_type_id
    left join public.renoapp_participant_roles pr on pr.id=d.participant_role_id
    where d.case_id=c.id and d.decision='requested'),'[]'::jsonb),
  'pending','Leveransen för denna äldre begäran är inte registrerad.'
from public.renovation_cases c
join lateral (select * from public.renovation_case_messages where case_id=c.id and type='request_for_info'
  order by created_at desc,id desc limit 1) m on true
where not exists(select 1 from public.renoapp_completion_requests r where r.case_id=c.id)
on conflict(id) do nothing;

create or replace function public.renoapp_publish_completion(
  p_case_id uuid,p_id uuid,p_previous_id uuid,p_status text,p_actor uuid,
  p_items jsonb,p_selected jsonb,p_message text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.renovation_cases; latest_id uuid; selected jsonb;
begin
  select * into strict c from public.renovation_cases where id=p_case_id for update;
  if exists(select 1 from public.renoapp_completion_requests where id=p_id and case_id=p_case_id) then
    return jsonb_build_object('id',p_id);
  end if;
  select id into latest_id from public.renoapp_completion_requests where case_id=p_case_id order by created_at desc limit 1;
  if c.status='draft' or c.status<>p_status or latest_id is distinct from p_previous_id then
    raise exception 'COMPLETION_CHANGED';
  end if;
  select coalesce(jsonb_agg(k order by k),'[]') into selected from (
    select case when document_type_id is not null then 'document:'||document_type_id else 'participant:'||participant_role_id end k
    from public.renoapp_case_requirement_decisions where case_id=p_case_id and decision='requested'
  ) s;
  if selected <> (select coalesce(jsonb_agg(v order by v),'[]') from jsonb_array_elements_text(p_selected) v) then
    raise exception 'COMPLETION_REQUIREMENTS_CHANGED';
  end if;
  if nullif(btrim(p_message),'') is null then raise exception 'NEED_INFO_MESSAGE_REQUIRED'; end if;
  insert into public.renoapp_completion_requests(id,case_id,items,message,draft)
    values(p_id,p_case_id,p_items,p_message,
      coalesce((select jsonb_build_object('replyMessage',draft->>'replyMessage','participantEntries',
        coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(draft->'participantEntries','[]')) e
          where exists(select 1 from jsonb_array_elements(p_items) i where i->>'id'='participant:'||(e->>'participantRoleId'))),'[]'))
        from public.renoapp_completion_requests where id=latest_id and submitted_at is null),'{}'));
  update public.renovation_cases set status='need_info' where id=p_case_id;
  insert into public.renovation_case_messages(id,case_id,type,author_role,author_profile_id,message,metadata)
    values(p_id,p_case_id,'request_for_info','board',p_actor,p_message,
      jsonb_build_object('previousStatus',c.status,'nextStatus','need_info','completionRequestId',p_id));
  return jsonb_build_object('id',p_id);
end $$;

create or replace function public.renoapp_save_completion(
  p_case_id uuid,p_request_id uuid,p_token_hash text,p_revision integer,
  p_participants jsonb,p_reply text,p_submit boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.renovation_cases; r public.renoapp_completion_requests; entry jsonb; role_id uuid;
begin
  select * into strict c from public.renovation_cases where id=p_case_id for update;
  if not exists(select 1 from public.case_access_links where case_id=p_case_id and token_hash=p_token_hash
    and scope='answer_questions' and revoked_at is null and expires_at>now()) then raise exception 'DRAFT_LINK_INVALID'; end if;
  select * into r from public.renoapp_completion_requests where case_id=p_case_id order by created_at desc limit 1 for update;
  if c.status<>'need_info' or r.id is distinct from p_request_id or r.submitted_at is not null then
    raise exception 'COMPLETION_CHANGED';
  end if;
  if r.revision<>p_revision then raise exception 'COMPLETION_DRAFT_CHANGED'; end if;
  -- Only roles explicitly included in this sent request can be saved or changed.
  if exists(select 1 from jsonb_array_elements(p_participants) e where not exists(
    select 1 from jsonb_array_elements(r.items) i where i->>'id'='participant:'||(e->>'participantRoleId')
  )) then raise exception 'COMPLETION_BASE_FIELDS_LOCKED'; end if;
  if p_submit then
    for role_id in select split_part(i->>'id',':',2)::uuid from jsonb_array_elements(r.items) i where i->>'category'='participant' loop
      select e into entry from jsonb_array_elements(p_participants) e where (e->>'participantRoleId')::uuid=role_id;
      if entry is null or coalesce((entry->>'hasVerifiedAuthorization')::boolean,false)=false
        or coalesce((entry->>'acceptsResponsibility')::boolean,false)=false then
        raise exception 'PARTICIPANT_CONFIRMATION_REQUIRED';
      end if;
      delete from public.renoapp_case_participants where case_id=p_case_id and participant_role_id=role_id;
      insert into public.renoapp_case_participants(case_id,participant_role_id,company_name,org_number,contact_name,email,phone,
        certification_reference,has_verified_authorization,accepts_responsibility)
      values(p_case_id,role_id,nullif(entry->>'companyName',''),nullif(entry->>'orgNumber',''),nullif(entry->>'contactName',''),
        nullif(entry->>'email',''),nullif(entry->>'phone',''),nullif(entry->>'certificationReference',''),true,true);
    end loop;
    update public.renovation_cases set status='review' where id=p_case_id;
    insert into public.renovation_case_messages(case_id,type,author_role,author_contact_id,message,metadata)
      values(p_case_id,'applicant_reply','applicant',c.applicant_contact_id,
        coalesce(nullif(btrim(p_reply),''),'Komplettering inskickad.'),jsonb_build_object('completionRequestId',r.id,'nextStatus','review'));
  end if;
  update public.renoapp_completion_requests set revision=revision+1,
    draft=jsonb_build_object('participantEntries',p_participants,'replyMessage',coalesce(p_reply,'')),
    submitted_at=case when p_submit then now() else null end where id=r.id;
  return jsonb_build_object('revision',r.revision+1,'submitted',p_submit);
end $$;

revoke all on function public.renoapp_publish_completion(uuid,uuid,uuid,text,uuid,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.renoapp_save_completion(uuid,uuid,text,integer,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.renoapp_publish_completion(uuid,uuid,uuid,text,uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.renoapp_save_completion(uuid,uuid,text,integer,jsonb,text,boolean) to service_role;
alter table public.renovation_case_documents add column if not exists completion_request_id uuid
  references public.renoapp_completion_requests(id);

create or replace function public.renoapp_guard_completion_document()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.renovation_cases; r public.renoapp_completion_requests; d public.renovation_case_documents;
begin
  if tg_op='DELETE' then d:=old; else d:=new; end if;
  select * into c from public.renovation_cases where id=d.case_id for update;
  -- A case deletion cascades to its documents after the parent is gone.
  if not found and tg_op='DELETE' then return old; end if;
  if c.status not in ('draft','need_info') then raise exception 'COMPLETION_CHANGED'; end if;
  if c.status='need_info' or d.completion_request_id is not null then
    select * into r from public.renoapp_completion_requests where case_id=c.id order by created_at desc limit 1;
    if c.status<>'need_info' or r.submitted_at is not null or d.completion_request_id is distinct from r.id then
      raise exception 'COMPLETION_PREVIOUS_DOCUMENT';
    end if;
    if not exists(select 1 from jsonb_array_elements(r.items) i
      where i->>'id'=case when d.document_type_id is not null then 'document:'||d.document_type_id
        else 'participant:'||d.participant_role_id end) then raise exception 'COMPLETION_CHANGED'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists renoapp_guard_completion_document on public.renovation_case_documents;
create trigger renoapp_guard_completion_document before insert or delete on public.renovation_case_documents
  for each row execute function public.renoapp_guard_completion_document();
revoke all on function public.renoapp_guard_completion_document() from public,anon,authenticated;
commit;
