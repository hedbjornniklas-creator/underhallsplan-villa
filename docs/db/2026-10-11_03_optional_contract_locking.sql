-- Run after 2026-10-11_02. Paper locking has no content-completeness requirements.
-- Existing drafts, archived PDFs and online-publication rules remain unchanged.
begin;
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
  -- Validate stored shapes and values, but never require filled-in fields.
  perform public.assert_customer_contract(d.body,false);
  perform public.assert_customer_offer_pricing(d.body,null,false);
  perform public.assert_customer_payment_plan(d.body,false);
  expected:=d.body||jsonb_build_object('projectTitle',c.title,'propertyAddress',c.property_address,
    'customerName',coalesce(d.body#>>'{contractParties,customers,0,name}',''),'customerEmail',coalesce(d.body#>>'{contractParties,email}',''),
    'issuerName',coalesce(d.body#>>'{contractParties,contractor,companyName}',''),'replyEmail',coalesce(d.body#>>'{contractParties,contractor,email}',''));
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
revoke all on function public.write_contract_signing_document(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_contract_signing_document(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
