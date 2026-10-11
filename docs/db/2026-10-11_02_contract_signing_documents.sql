-- Independent paper-signing versions. Run after 2026-10-11_01.
-- No existing draft, publication, acceptance or document is rewritten.
begin;
create table if not exists public.action_case_contract_signing_documents (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id) on delete restrict,
  version integer not null check(version>0),
  draft_revision integer not null check(draft_revision>0),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  files jsonb not null check(jsonb_typeof(files)='array'),
  pdf_path text not null,
  pdf_sha256 text not null check(pdf_sha256 ~ '^[a-f0-9]{64}$'),
  pdf_size bigint not null check(pdf_size between 100 and 50000000),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  released_at timestamptz,
  unique(action_case_id,version), unique(action_case_id,draft_revision)
);
create unique index if not exists contract_signing_active_version
  on public.action_case_contract_signing_documents(action_case_id) where released_at is null;
alter table public.action_case_contract_signing_documents enable row level security;
revoke all on public.action_case_contract_signing_documents from public,anon,authenticated;
grant all on public.action_case_contract_signing_documents to service_role;

create or replace function public.guard_contract_signing_document() returns trigger
language plpgsql set search_path=public,pg_catalog as $$
begin
  if tg_op='DELETE' or (new.id,new.org_id,new.action_case_id,new.version,new.draft_revision,new.snapshot,new.files,
    new.pdf_path,new.pdf_sha256,new.pdf_size,new.created_at,new.created_by)
    is distinct from (old.id,old.org_id,old.action_case_id,old.version,old.draft_revision,old.snapshot,old.files,
    old.pdf_path,old.pdf_sha256,old.pdf_size,old.created_at,old.created_by)
    or old.released_at is not null or new.released_at is null
    then raise exception 'CUSTOMER_OFFER_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists contract_signing_document_immutable on public.action_case_contract_signing_documents;
create trigger contract_signing_document_immutable before update or delete on public.action_case_contract_signing_documents
  for each row execute function public.guard_contract_signing_document();

create or replace function public.guard_contract_signing_lock() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare c uuid; o uuid;
begin
  c:=case when tg_op='DELETE' then old.action_case_id else new.action_case_id end;
  o:=case when tg_op='DELETE' then old.org_id else new.org_id end;
  perform 1 from public.action_cases where id=c and org_id=o for update;
  if exists(select 1 from public.action_case_contract_signing_documents where action_case_id=c and released_at is null)
    then raise exception 'CUSTOMER_OFFER_LOCKED'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists contract_signing_draft_lock on public.action_case_customer_contract_drafts;
create trigger contract_signing_draft_lock before insert or update or delete on public.action_case_customer_contract_drafts
  for each row execute function public.guard_contract_signing_lock();
drop trigger if exists contract_signing_online_lock on public.action_case_customer_offers;
create trigger contract_signing_online_lock before insert or update of status on public.action_case_customer_offers
  for each row execute function public.guard_contract_signing_lock();

create or replace function public.write_contract_signing_document(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare c public.action_cases%rowtype; d public.action_case_customer_contract_drafts%rowtype;
  s public.action_case_contract_signing_documents%rowtype; f jsonb; n integer; expected jsonb; v_id uuid;
begin
  perform 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active=true for share;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into c from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into d from public.action_case_customer_contract_drafts where action_case_id=p_case_id and org_id=p_org_id for update;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='accepted')
    then raise exception 'CUSTOMER_OFFER_ACCEPTED'; end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='published')
    then raise exception 'CUSTOMER_OFFER_WITHDRAW_FIRST'; end if;
  if p_data->>'confirmed' is distinct from 'true' then raise exception 'CUSTOMER_OFFER_CONFIRM'; end if;
  select * into s from public.action_case_contract_signing_documents where action_case_id=p_case_id and draft_revision=(p_data->>'revision')::integer;
  if p_operation='freeze' and found then
    if s.released_at is not null then raise exception 'CUSTOMER_OFFER_STALE'; end if;
    return jsonb_build_object('id',s.id);
  end if;
  if d.revision is null or d.revision is distinct from (p_data->>'revision')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if p_operation='new_draft' then
    select * into s from public.action_case_contract_signing_documents where id=(p_data->>'id')::uuid and org_id=p_org_id and action_case_id=p_case_id and released_at is null for update;
    if not found then raise exception 'CUSTOMER_OFFER_STALE'; end if;
    update public.action_case_contract_signing_documents set released_at=clock_timestamp() where id=s.id;
    update public.action_case_customer_contract_drafts set revision=revision+1,updated_by=p_user_id,updated_at=clock_timestamp() where action_case_id=p_case_id;
    return jsonb_build_object('id',s.id);
  end if;
  if p_operation is distinct from 'freeze' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if exists(select 1 from public.action_case_contract_signing_documents where action_case_id=p_case_id and released_at is null)
    then raise exception 'CUSTOMER_OFFER_LOCKED'; end if;
  perform public.assert_customer_contract(d.body,true);
  perform public.assert_customer_offer_pricing(d.body,null,true);
  perform public.assert_customer_payment_plan(d.body,true);
  if jsonb_typeof(d.body#>'{contractParties,customers}') is distinct from 'array'
    or jsonb_array_length(d.body#>'{contractParties,customers}') not between 1 and 2
    or exists(select 1 from jsonb_array_elements(d.body#>'{contractParties,customers}') buyer where coalesce(trim(buyer->>'name'),'')='')
    or coalesce(trim(d.body#>>'{contractParties,contractor,companyName}'),'')=''
    or coalesce(trim(d.body#>>'{contractParties,contractor,organizationNumber}'),'')=''
    then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  if exists(select 1 from jsonb_array_elements(d.body->'items') i where i->>'kind'='option') then raise exception 'CUSTOMER_OFFER_SEPARATE_CHOICES'; end if;
  expected:=d.body||jsonb_build_object('projectTitle',c.title,'propertyAddress',c.property_address,
    'customerName',d.body#>>'{contractParties,customers,0,name}','customerEmail',d.body#>>'{contractParties,email}',
    'issuerName',d.body#>>'{contractParties,contractor,companyName}','replyEmail',d.body#>>'{contractParties,contractor,email}');
  if p_data->'snapshot' is distinct from expected then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if jsonb_typeof(p_data->'files') is distinct from 'array' or jsonb_array_length(p_data->'files')<>jsonb_array_length(d.body->'attachmentIds') then raise exception 'CUSTOMER_OFFER_FILES'; end if;
  v_id:=(p_data->>'id')::uuid;
  if p_data->>'pdfPath' is distinct from p_org_id::text||'/'||p_case_id::text||'/signing/'||v_id::text||'/contract.pdf' then raise exception 'CUSTOMER_OFFER_FILES'; end if;
  for f in select value from jsonb_array_elements(p_data->'files') loop
    if coalesce(f->>'sha256','') !~ '^[a-f0-9]{64}$' or not d.body->'attachmentIds' ? (f->>'id') or f->>'path' is distinct from p_org_id::text||'/'||p_case_id::text||'/signing/'||v_id::text||'/'||(f->>'id')
      or not exists(select 1 from public.action_case_attachments a where a.id=(f->>'id')::uuid and a.org_id=p_org_id and a.action_case_id=p_case_id
        and a.storage_bucket='action-case-files' and a.file_path=f->>'sourcePath' and a.file_size_bytes=(f->>'fileSizeBytes')::bigint and a.file_name=f->>'fileName' and a.content_type=f->>'contentType')
      or exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id=(f->>'id')::uuid)
      or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id=(f->>'id')::uuid)
      then raise exception 'CUSTOMER_OFFER_FILES'; end if;
  end loop;
  if (select count(distinct entry.value->>'id') from jsonb_array_elements(p_data->'files') entry)<>jsonb_array_length(d.body->'attachmentIds') then raise exception 'CUSTOMER_OFFER_FILES'; end if;
  select coalesce(max(version),0)+1 into n from public.action_case_contract_signing_documents where action_case_id=p_case_id;
  if n is distinct from (p_data->>'version')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  insert into public.action_case_contract_signing_documents(id,org_id,action_case_id,version,draft_revision,snapshot,files,pdf_path,pdf_sha256,pdf_size,created_by,created_at)
    values(v_id,p_org_id,p_case_id,n,d.revision,expected,p_data->'files',p_data->>'pdfPath',p_data->>'pdfSha256',(p_data->>'pdfSize')::bigint,p_user_id,(p_data->>'createdAt')::timestamptz);
  return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.write_contract_signing_document(uuid,uuid,uuid,text,jsonb),public.guard_contract_signing_document(),public.guard_contract_signing_lock() from public,anon,authenticated;
grant execute on function public.write_contract_signing_document(uuid,uuid,uuid,text,jsonb),public.guard_contract_signing_document(),public.guard_contract_signing_lock() to service_role;
notify pgrst,'reload schema';
commit;
