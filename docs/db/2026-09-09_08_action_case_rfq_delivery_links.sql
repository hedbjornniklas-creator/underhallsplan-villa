-- Uppdrag: immutable, private request-specific file deliveries.
-- Apply after 2026-09-09_04_action_case_package_pricing.sql.
-- No existing messages, access grants or files are rewritten.
begin;

insert into storage.buckets(id,name,public,file_size_limit)
values('action-case-rfq-files','action-case-rfq-files',false,26214400)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;
-- No browser policies: only the server may copy/read these immutable objects.

create table if not exists public.action_case_rfq_deliveries (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  request_id uuid unique references public.action_case_quote_requests(id) on delete cascade,
  quote_id uuid unique references public.action_case_work_quotes(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  files jsonb not null check(jsonb_typeof(files)='array' and jsonb_array_length(files)<=30),
  expires_at timestamptz not null default (now()+interval '90 days'),
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check(num_nonnulls(request_id,quote_id)=1)
);
create index if not exists action_case_rfq_deliveries_case_idx on public.action_case_rfq_deliveries(org_id,action_case_id);
alter table public.action_case_rfq_deliveries enable row level security;
revoke all on public.action_case_rfq_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.action_case_rfq_deliveries to service_role;

create or replace function public.guard_action_case_rfq_delivery()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if (new.id,new.org_id,new.action_case_id,new.request_id,new.quote_id,new.token_hash,new.snapshot,new.files,new.expires_at,new.created_at)
    is distinct from (old.id,old.org_id,old.action_case_id,old.request_id,old.quote_id,old.token_hash,old.snapshot,old.files,old.expires_at,old.created_at)
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
    then raise exception 'ACTION_CASE_RFQ_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists trg_action_case_rfq_delivery on public.action_case_rfq_deliveries;
create trigger trg_action_case_rfq_delivery before update on public.action_case_rfq_deliveries
for each row execute function public.guard_action_case_rfq_delivery();

-- The link and existing idempotent send claim commit together. Copies are prepared
-- privately by the server first; no recipient can access them before this commits.
create or replace function public.claim_action_case_rfq_delivery(
  p_org_id uuid,p_case_id uuid,p_source_id uuid,p_user_id uuid,p_kind text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  r public.action_case_quote_requests%rowtype;
  q public.action_case_work_quotes%rowtype;
  c public.action_cases%rowtype;
  d public.action_case_rfq_deliveries%rowtype;
  a public.action_case_attachments%rowtype;
  ids uuid[]; file jsonb; source_version timestamptz; previous_payload jsonb;
  snapshot jsonb; result jsonb; link_id uuid; mapped_files jsonb:='[]';
begin
  if coalesce(p_kind,'') not in ('request','quote') then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
  perform id from public.action_case_items where action_case_id=p_case_id and org_id=p_org_id order by id for update;
  select * into c from public.action_cases where id=p_case_id and org_id=p_org_id;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_kind='request' then
    select * into r from public.action_case_quote_requests where id=p_source_id and action_case_id=p_case_id and org_id=p_org_id for update;
    if not found then raise exception 'ACTION_CASE_REQUEST_NOT_FOUND'; end if;
    if r.sent_at is not null then return jsonb_build_object('alreadySent',true); end if;
    ids:=r.attachment_ids; previous_payload:=r.email_payload; source_version:=r.updated_at;
    snapshot:=jsonb_build_object('subject',r.subject,'body',r.body,'supplierName',r.supplier_name,'supplierEmail',r.supplier_email,
      'caseTitle',c.title,'propertyAddress',c.property_address);
  else
    select * into q from public.action_case_work_quotes where id=p_source_id and action_case_id=p_case_id and org_id=p_org_id;
    if not found then raise exception 'ACTION_CASE_QUOTE_NOT_FOUND'; end if;
    if q.request_id is not null or q.package_request_id is not null then raise exception 'ACTION_CASE_REQUEST_USE_GROUP'; end if;
    perform id from public.action_case_cost_lines where id=q.cost_line_id for update;
    select * into q from public.action_case_work_quotes where id=p_source_id for update;
    if q.sent_at is not null then return jsonb_build_object('alreadySent',true); end if;
    ids:=q.request_attachment_ids; previous_payload:=q.email_payload; source_version:=q.updated_at;
    snapshot:=jsonb_build_object('subject',q.request_subject,'body',q.request_body,'supplierName',q.supplier_name,'supplierEmail',q.supplier_email,
      'caseTitle',c.title,'propertyAddress',c.property_address);
  end if;
  select * into d from public.action_case_rfq_deliveries where org_id=p_org_id and action_case_id=p_case_id
    and (case when p_kind='request' then request_id=p_source_id else quote_id=p_source_id end) for update;
  if found and (d.revoked_at is not null or d.expires_at<=now()) then raise exception 'ACTION_CASE_RFQ_ACCESS_CLOSED'; end if;
  if previous_payload is null then
    if source_version is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    link_id:=(p_data->>'deliveryId')::uuid;
    if link_id is null or coalesce(p_data->>'tokenHash','') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(p_data->'files') is distinct from 'array' or cardinality(ids)>30
      or jsonb_array_length(p_data->'files')<>cardinality(ids)
      or (select count(distinct f->>'id') from jsonb_array_elements(p_data->'files') f)<>cardinality(ids)
      then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    perform id from public.action_case_attachments where id=any(ids) order by id for share;
    for file in select * from jsonb_array_elements(p_data->'files') loop
      select * into a from public.action_case_attachments where id=(file->>'id')::uuid and id=any(ids) and org_id=p_org_id and action_case_id=p_case_id;
      if not found then raise exception 'ACTION_CASE_FILE_NOT_FOUND'; end if;
      if (a.storage_bucket,a.file_path,a.file_name,a.content_type,a.file_size_bytes) is distinct from
        (file->>'sourceBucket',file->>'sourcePath',file->>'fileName',file->>'contentType',(file->>'fileSizeBytes')::bigint)
        then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
      if file->>'path' is distinct from (p_org_id::text||'/'||p_case_id::text||'/'||link_id::text||'/'||a.id::text)
        then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
      if exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id=a.id)
        or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id=a.id)
        then raise exception 'ACTION_CASE_QUOTE_PRIVATE_DOCUMENT'; end if;
      mapped_files:=mapped_files||jsonb_build_array(jsonb_build_object('id',a.id,'fileName',a.file_name,'contentType',a.content_type,
        'fileSizeBytes',a.file_size_bytes,'type',a.attachment_type,'path',file->>'path'));
    end loop;
    if jsonb_typeof(p_data->'emailPayload') is distinct from 'object'
      or p_data->'emailPayload'->>'to' is distinct from snapshot->>'supplierEmail'
      or p_data->'emailPayload'->>'subject' is distinct from snapshot->>'subject'
      then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
  end if;
  if p_kind='request' then
    result:=public.write_action_case_request(p_org_id,p_case_id,p_source_id,p_user_id,'claim_send',
      jsonb_build_object('expectedUpdatedAt',source_version,'emailPayload',p_data->'emailPayload'));
  else
    result:=public.write_action_case_quote(p_org_id,p_case_id,q.action_case_item_id,q.cost_line_id,p_user_id,'claim_send',
      jsonb_build_object('id',q.id,'expectedUpdatedAt',source_version,'emailPayload',p_data->'emailPayload'));
  end if;
  if previous_payload is null then
    insert into public.action_case_rfq_deliveries(id,org_id,action_case_id,request_id,quote_id,token_hash,snapshot,files,created_by)
    values(link_id,p_org_id,p_case_id,case when p_kind='request' then p_source_id end,case when p_kind='quote' then p_source_id end,
      p_data->>'tokenHash',snapshot,mapped_files,p_user_id);
  end if;
  return result;
end $$;
revoke all on function public.claim_action_case_rfq_delivery(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_action_case_rfq_delivery(uuid,uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function public.revoke_action_case_rfq_delivery(p_org_id uuid,p_case_id uuid,p_delivery_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.action_case_rfq_deliveries set revoked_at=coalesce(revoked_at,now())
    where id=p_delivery_id and org_id=p_org_id and action_case_id=p_case_id;
  if not found then raise exception 'ACTION_CASE_RFQ_NOT_FOUND'; end if;
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'rfq_link_revoked','Länken till offertunderlaget återkallades.',p_user_id);
end $$;
revoke all on function public.revoke_action_case_rfq_delivery(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_action_case_rfq_delivery(uuid,uuid,uuid,uuid) to service_role;
commit;
