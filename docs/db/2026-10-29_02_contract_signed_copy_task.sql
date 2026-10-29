-- Run after 2026-10-29_01. Creates internal to-dos, never rewrites contracts.
begin;
create table if not exists public.action_case_contract_upload_tasks (
  document_id uuid primary key references public.action_case_contract_signing_documents(id) on delete restrict,
  org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id) on delete restrict,
  task_id uuid not null unique references public.operational_tasks(id) on delete restrict
);
alter table public.action_case_contract_upload_tasks enable row level security;
revoke all on public.action_case_contract_upload_tasks from public,anon,authenticated;
grant select,insert on public.action_case_contract_upload_tasks to service_role;

create or replace function public.ensure_contract_upload_task(p_document_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare s public.action_case_contract_signing_documents%rowtype; project public.action_cases%rowtype; actor uuid; tid uuid; deadline timestamptz;
begin
  select * into s from public.action_case_contract_signing_documents where id=p_document_id;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into project from public.action_cases where id=s.action_case_id and org_id=s.org_id for update;
  select * into s from public.action_case_contract_signing_documents where id=p_document_id for update;
  select task_id into tid from public.action_case_contract_upload_tasks where document_id=s.id;
  if found then return tid; end if;
  if s.released_at is not null or exists(select 1 from public.action_case_contract_signing_delivery where document_id=s.id and signed_copy is not null) then return null; end if;
  select profile_id into actor from public.org_members where org_id=s.org_id and is_active
    order by (profile_id=project.manager_profile_id) desc nulls last,(profile_id=s.created_by) desc,(role='admin') desc,profile_id limit 1;
  -- Closed organizations without active people cannot receive assignments.
  if actor is null then return null; end if;
  tid:=gen_random_uuid(); deadline:=clock_timestamp()+interval '7 days';
  insert into public.operational_tasks(id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,title,description,task_kind,status,due_at,next_followup_at,
    primary_channel,context_label,evidence_requirement,created_source,created_by_profile_id)
    values(tid,s.org_id,tid,actor,actor,left('Ladda upp signerat avtal - '||project.title,250),
      'Registrera den underskrivna PDF-kopian av avtalsversion '||s.version||' under Avtal i projektet. Kontrollera att alla parter har skrivit under samma version. '||
      'Projekt: /uppdrag/'||s.action_case_id::text||'?view=contract','general','assigned',deadline,deadline,
      'in_app','Signerat avtal','optional','system',actor);
  insert into public.action_case_contract_upload_tasks(document_id,org_id,action_case_id,task_id) values(s.id,s.org_id,s.action_case_id,tid);
  insert into public.task_events(org_id,task_id,event_type,actor_type,actor_name,message,to_status,metadata)
    values(s.org_id,tid,'task_created','system','HusHub','Avtalet har låsts. Den underskrivna PDF-kopian återstår att registrera.','assigned',jsonb_build_object('contractDocumentId',s.id,'contractVersion',s.version));
  return tid;
end $$;

create or replace function public.contract_upload_task_changed() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare tid uuid; prior text; target text; actor uuid;
begin
  if tg_table_name='action_case_contract_signing_documents' and tg_op='INSERT' then
    perform public.ensure_contract_upload_task(new.id); return new;
  end if;
  if tg_table_name='action_case_contract_signing_delivery' then
    if new.signed_copy is null or (tg_op='UPDATE' and old.signed_copy is not null) then return new; end if;
    select task_id into tid from public.action_case_contract_upload_tasks where document_id=new.document_id;
    target:='approved'; actor:=new.signed_by;
  else
    if new.released_at is null or old.released_at is not null then return new; end if;
    select task_id into tid from public.action_case_contract_upload_tasks where document_id=new.id;
    target:='cancelled';
  end if;
  if tid is null then return new; end if;
  select status into prior from public.operational_tasks where id=tid for update;
  if prior=target then return new; end if;
  update public.operational_tasks set status=target,approved_at=case when target='approved' then clock_timestamp() end,
    submitted_for_review_at=case when target='approved' then coalesce(submitted_for_review_at,clock_timestamp()) else submitted_for_review_at end,
    approved_by_profile_id=actor,last_activity_at=clock_timestamp() where id=tid;
  insert into public.task_events(org_id,task_id,event_type,actor_type,actor_name,message,from_status,to_status,metadata)
    values(new.org_id,tid,case when target='approved' then 'task_approved' else 'status_changed' end,'system','HusHub',
      case when target='approved' then 'Underskriven PDF-kopia har registrerats på avtalsversionen.' else 'Den osignerade versionen har ersatts av ett nytt utkast.' end,
      prior,target,jsonb_build_object('contractDocumentId',case when tg_table_name='action_case_contract_signing_delivery' then to_jsonb(new)->>'document_id' else to_jsonb(new)->>'id' end));
  return new;
end $$;
drop trigger if exists contract_upload_task_created on public.action_case_contract_signing_documents;
create trigger contract_upload_task_created after insert or update of released_at on public.action_case_contract_signing_documents
  for each row execute function public.contract_upload_task_changed();
drop trigger if exists contract_upload_task_completed on public.action_case_contract_signing_delivery;
create trigger contract_upload_task_completed after insert or update of signed_copy on public.action_case_contract_signing_delivery
  for each row execute function public.contract_upload_task_changed();

-- Explicit confirmation is required when leaving an unsigned frozen version.
do $wrapper$
begin
  if to_regprocedure('public.write_contract_signing_document_before_work_link(uuid,uuid,uuid,text,jsonb)') is null then
    alter function public.write_contract_signing_document(uuid,uuid,uuid,text,jsonb) rename to write_contract_signing_document_before_work_link;
  end if;
end $wrapper$;
create or replace function public.write_contract_signing_document(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_operation text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if p_operation='new_draft' and p_data->>'unsignedConfirmed' is distinct from 'true' then raise exception 'CUSTOMER_OFFER_UNSIGNED_CONFIRM'; end if;
  return public.write_contract_signing_document_before_work_link(p_org_id,p_case_id,p_user_id,p_operation,p_data);
end $$;
revoke all on function public.write_contract_signing_document_before_work_link(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.ensure_contract_upload_task(uuid),public.contract_upload_task_changed(),public.write_contract_signing_document(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ensure_contract_upload_task(uuid),public.contract_upload_task_changed(),public.write_contract_signing_document(uuid,uuid,uuid,text,jsonb) to service_role;

-- Existing active versions (including Lokevagen) get one pending internal task.
-- Their snapshot, PDF, attachments and current work rows are not modified.
select public.ensure_contract_upload_task(id) from public.action_case_contract_signing_documents where released_at is null;
notify pgrst,'reload schema';
commit;
