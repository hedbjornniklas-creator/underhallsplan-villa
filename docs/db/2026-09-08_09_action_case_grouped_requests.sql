-- Uppdrag: one subcontractor request covering multiple actions/work rows.
-- Requires action-case migrations 01 through 05. No outbound mail is sent here.
begin;
create table if not exists public.action_case_quote_requests (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  supplier_name text not null check(btrim(supplier_name)<>''), supplier_email text not null,
  subject text not null check(btrim(subject)<>''), message text not null default '',
  requirements jsonb not null default '[]' check(jsonb_typeof(requirements)='array'),
  other_requirements text not null default '',
  lines jsonb not null check(jsonb_typeof(lines)='array' and jsonb_array_length(lines) between 1 and 30),
  attachment_ids uuid[] not null default '{}', body text not null,
  supplements_id uuid references public.action_case_quote_requests(id) on delete restrict,
  response_mode text not null default 'pending' check(response_mode in ('pending','itemized','package')),
  package_amount numeric(14,2) check(package_amount>=0), response_notes text not null default '',
  response_document_id uuid references public.action_case_attachments(id) on delete set null,
  delivery_status text not null default 'draft' check(delivery_status in ('draft','sending','sent','unknown')),
  email_payload jsonb, first_attempt_at timestamptz, last_attempt_at timestamptz, lease_id uuid,
  sent_at timestamptz, provider_message_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists action_case_quote_requests_case_idx on public.action_case_quote_requests(org_id,action_case_id,created_at);
alter table public.action_case_quote_requests enable row level security;
revoke all on public.action_case_quote_requests from public,anon,authenticated;
grant all on public.action_case_quote_requests to service_role;
alter table public.action_case_work_quotes add column if not exists request_id uuid references public.action_case_quote_requests(id) on delete restrict;
create unique index if not exists action_case_work_quotes_request_line_idx on public.action_case_work_quotes(request_id,cost_line_id) where request_id is not null;

-- Requested inclusions never become confirmed inclusions automatically.
-- Linked quote rows retain the request identity while their response is edited.
create or replace function public.guard_action_case_grouped_quote()
returns trigger language plpgsql security definer set search_path=public as $$
declare r public.action_case_quote_requests%rowtype;
begin
  if tg_op='DELETE' then
    if old.request_id is not null and exists(select 1 from public.action_case_items where id=old.action_case_item_id) then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and new.request_id is distinct from old.request_id then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
  if new.request_id is null then return new; end if;
  select * into r from public.action_case_quote_requests where id=new.request_id and org_id=new.org_id and action_case_id=new.action_case_id;
  if not found or r.first_attempt_at is null or not exists(select 1 from jsonb_array_elements(r.lines) s where (s->>'costLineId')::uuid=new.cost_line_id and (s->>'itemId')::uuid=new.action_case_item_id
    and s->>'scope'=new.scope_snapshot and s->>'description'=new.description_snapshot) then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
  if (new.supplier_name,new.supplier_email,new.request_subject,new.request_body,new.request_attachment_ids) is distinct from
    (r.supplier_name,r.supplier_email,r.subject,r.body,r.attachment_ids) then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists trg_action_case_grouped_quote on public.action_case_work_quotes;
create trigger trg_action_case_grouped_quote before insert or update or delete on public.action_case_work_quotes for each row execute function public.guard_action_case_grouped_quote();

create or replace function public.guard_action_case_grouped_price_selection()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.selected_quote_id is not null and exists(
    select 1 from public.action_case_work_quotes q join public.action_case_quote_requests r on r.id=q.request_id
    where q.id=new.selected_quote_id and (r.response_mode<>'itemized' or r.sent_at is null)
  ) then raise exception 'ACTION_CASE_REQUEST_PACKAGE_PRICE'; end if;
  return new;
end $$;
drop trigger if exists trg_zz_action_case_grouped_price on public.action_case_cost_lines;
create trigger trg_zz_action_case_grouped_price before insert or update on public.action_case_cost_lines for each row execute function public.guard_action_case_grouped_price_selection();

create or replace function public.write_action_case_request(
  p_org_id uuid,p_case_id uuid,p_request_id uuid,p_user_id uuid,p_operation text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.action_case_quote_requests%rowtype; s jsonb; v_ids uuid[]; v_lease uuid;
begin
  if not exists(select 1 from public.action_cases where id=p_case_id and org_id=p_org_id) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  -- Use the same item-before-cost-row lock order as existing costing writes.
  perform id from public.action_case_items where action_case_id=p_case_id and org_id=p_org_id order by id for update;
  select * into r from public.action_case_quote_requests where id=p_request_id for update;
  if found and (r.org_id<>p_org_id or r.action_case_id<>p_case_id) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_operation='save' then
    if r.id is not null and p_data->>'expectedUpdatedAt' is null then return jsonb_build_object('id',r.id); end if;
    if r.id is not null and r.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    if r.first_attempt_at is not null then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
    if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 30 then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    if (select count(distinct entry->>'costLineId') from jsonb_array_elements(p_data->'lines') entry) <> jsonb_array_length(p_data->'lines') then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    for s in select * from jsonb_array_elements(p_data->'lines') loop
      if not exists(select 1 from public.action_case_cost_lines l join public.action_case_items i on i.id=l.action_case_item_id
        where l.id=(s->>'costLineId')::uuid and i.id=(s->>'itemId')::uuid and l.org_id=p_org_id and i.org_id=p_org_id and l.action_case_id=p_case_id and i.action_case_id=p_case_id
        and l.category in ('own_labor','subcontractor') and i.status not in ('cancelled','declined','completed')
        and l.description=s->>'description' and i.title=s->>'itemTitle' and coalesce(i.scope,'')=s->>'scope') then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    end loop;
    v_ids:=array(select distinct value::uuid from jsonb_array_elements_text(p_data->'attachmentIds') order by value::uuid);
    if exists(select 1 from unnest(v_ids) requested(file_id) where not exists(select 1 from public.action_case_attachments a where a.id=requested.file_id and a.org_id=p_org_id and a.action_case_id=p_case_id)) then raise exception 'ACTION_CASE_FILE_NOT_FOUND'; end if;
    if exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id=any(v_ids))
      or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id=any(v_ids)) then raise exception 'ACTION_CASE_QUOTE_PRIVATE_DOCUMENT'; end if;
    if p_data->>'supplementsId' is not null and not exists(select 1 from public.action_case_quote_requests where id=(p_data->>'supplementsId')::uuid and org_id=p_org_id and action_case_id=p_case_id and first_attempt_at is not null and supplier_email=p_data->>'supplierEmail') then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    insert into public.action_case_quote_requests(id,org_id,action_case_id,supplier_name,supplier_email,subject,message,requirements,other_requirements,lines,attachment_ids,body,supplements_id,created_by)
    values(p_request_id,p_org_id,p_case_id,p_data->>'supplierName',p_data->>'supplierEmail',p_data->>'subject',p_data->>'message',p_data->'requirements',p_data->>'otherRequirements',p_data->'lines',v_ids,p_data->>'body',(p_data->>'supplementsId')::uuid,p_user_id)
    on conflict(id) do update set supplier_name=excluded.supplier_name,supplier_email=excluded.supplier_email,subject=excluded.subject,message=excluded.message,
      requirements=excluded.requirements,other_requirements=excluded.other_requirements,lines=excluded.lines,attachment_ids=excluded.attachment_ids,body=excluded.body,supplements_id=excluded.supplements_id,updated_at=clock_timestamp();
  else
    if r.id is null then raise exception 'ACTION_CASE_REQUEST_NOT_FOUND'; end if;
    if p_operation not in ('claim_send','finish_send') and r.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    if p_operation='delete' then
      if r.first_attempt_at is not null then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
      delete from public.action_case_quote_requests where id=r.id;
    elsif p_operation='response' then
      if r.sent_at is null then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
      if p_data->>'responseMode' not in ('pending','itemized','package') then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
      if p_data->>'responseDocumentId' is not null and not exists(select 1 from public.action_case_attachments where id=(p_data->>'responseDocumentId')::uuid and org_id=p_org_id and action_case_id=p_case_id and attachment_type='document') then raise exception 'ACTION_CASE_FILE_NOT_FOUND'; end if;
      if p_data->>'responseMode'<>'itemized' then
        update public.action_case_cost_lines l set selected_quote_id=null,updated_by=p_user_id
        where selected_quote_id in (select id from public.action_case_work_quotes where request_id=r.id);
      end if;
      update public.action_case_quote_requests set response_mode=p_data->>'responseMode',package_amount=(p_data->>'packageAmount')::numeric,
        response_notes=p_data->>'responseNotes',response_document_id=(p_data->>'responseDocumentId')::uuid,updated_at=clock_timestamp() where id=r.id;
    elsif p_operation='claim_send' then
      if r.sent_at is not null then return jsonb_build_object('alreadySent',true); end if;
      if r.first_attempt_at<now()-interval '23 hours' then raise exception 'ACTION_CASE_QUOTE_SEND_UNKNOWN'; end if;
      if r.delivery_status='sending' and r.last_attempt_at>now()-interval '2 minutes' then raise exception 'ACTION_CASE_QUOTE_SEND_BUSY'; end if;
      if r.first_attempt_at is null then
      for s in select * from jsonb_array_elements(r.lines) loop
        if not exists(select 1 from public.action_case_cost_lines l join public.action_case_items i on i.id=l.action_case_item_id
          where l.id=(s->>'costLineId')::uuid and i.id=(s->>'itemId')::uuid and l.org_id=p_org_id and i.action_case_id=p_case_id
          and l.category in ('own_labor','subcontractor') and i.status not in ('cancelled','declined','completed')
          and l.description=s->>'description' and i.title=s->>'itemTitle' and coalesce(i.scope,'')=s->>'scope') then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
      end loop;
      end if;
      if r.email_payload is null and (coalesce(jsonb_typeof(p_data->'emailPayload'),'null')<>'object' or r.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz) then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
      v_lease:=gen_random_uuid();
      update public.action_case_quote_requests set email_payload=coalesce(email_payload,p_data->'emailPayload'),first_attempt_at=coalesce(first_attempt_at,now()),last_attempt_at=now(),
        lease_id=v_lease,delivery_status='sending',response_mode=case when jsonb_array_length(lines)=1 then 'itemized' else response_mode end,updated_at=clock_timestamp() where id=r.id returning * into r;
      for s in select * from jsonb_array_elements(r.lines) loop
        insert into public.action_case_work_quotes(id,org_id,action_case_id,action_case_item_id,cost_line_id,request_id,supplier_name,supplier_email,
          scope_snapshot,description_snapshot,request_subject,request_body,request_attachment_ids,first_attempt_at,delivery_status,created_by)
        values(gen_random_uuid(),p_org_id,p_case_id,(s->>'itemId')::uuid,(s->>'costLineId')::uuid,r.id,r.supplier_name,r.supplier_email,
          s->>'scope',s->>'description',r.subject,r.body,r.attachment_ids,r.first_attempt_at,'sending',p_user_id)
        on conflict(request_id,cost_line_id) where request_id is not null do nothing;
      end loop;
      return jsonb_build_object('leaseId',v_lease,'payload',r.email_payload);
    elsif p_operation='finish_send' then
      if r.lease_id is distinct from (p_data->>'leaseId')::uuid then return jsonb_build_object('ignored',true); end if;
      update public.action_case_quote_requests set delivery_status=case when (p_data->>'success')::boolean then 'sent' else 'unknown' end,
        sent_at=case when (p_data->>'success')::boolean then now() end,provider_message_id=p_data->>'providerMessageId',updated_at=clock_timestamp() where id=r.id returning * into r;
      update public.action_case_work_quotes set delivery_status=r.delivery_status,sent_at=r.sent_at,updated_at=clock_timestamp() where request_id=r.id;
    else raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
  end if;
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'request_'||p_operation,'Samlad offertförfrågan uppdaterad.',p_user_id);
  return jsonb_build_object('id',p_request_id);
end $$;
revoke all on function public.write_action_case_request(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_action_case_request(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
