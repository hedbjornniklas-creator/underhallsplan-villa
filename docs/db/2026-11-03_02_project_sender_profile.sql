-- One project sender, shared by editable offer and contract drafts.
-- Requires 2026-10-12_03. Installation rewrites no project or historical documents.
begin;
set local lock_timeout='10s';

create or replace function public.project_sender_body(p_body jsonb,p_sender jsonb,p_title text,p_name text,p_email text,p_phone text)
returns jsonb language plpgsql set search_path='' as $$
declare body jsonb; parties jsonb; contractor jsonb; buyers text;
begin
  body:=coalesce(p_body,jsonb_build_object('title',coalesce(p_title,''),'introduction','','baseAmountOre',null,'validUntil','',
    'contractForm','abs18','terms','','paymentTerms','','schedule','','attachmentIds','[]'::jsonb,'termsAttachmentId',null,'items','[]'::jsonb));
  contractor:=jsonb_build_object('companyName','','organizationNumber','','contactName','','mobile','','street','','postalCode','','city','','phone','','fax','','email','','fTax','unreviewed')
    ||coalesce(body#>'{contractParties,contractor}','{}'::jsonb)||public.contract_sender_protected_fields(p_sender);
  parties:=jsonb_build_object('version',1,'customers',jsonb_build_array(jsonb_build_object('name',coalesce(p_name,''),'personalNumber','')),
    'street','','postalCode','','city','','phone','','mobile',coalesce(p_phone,''),'email',coalesce(p_email,''))
    ||coalesce(body->'contractParties','{}'::jsonb)||jsonb_build_object('contractor',contractor);
  body:=body||jsonb_build_object('senderProfile',p_sender,'contractParties',parties);
  if jsonb_typeof(body->'contractDetails')='object' then
    select coalesce(string_agg(btrim(buyer->>'name'),', ' order by ordinal) filter(where coalesce(btrim(buyer->>'name'),'')<>''),'') into buyers
      from jsonb_array_elements(parties->'customers') with ordinality as customer(buyer,ordinal);
    body:=jsonb_set(body,'{contractDetails,fields,parties}',jsonb_build_object('status','specified','text','Beställare: '||buyers||'. Entreprenör: '||(p_sender->>'name')||'.'));
  end if;
  return body;
end $$;

create or replace function public.select_action_case_project_sender(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_data jsonb,p_logo_data_url text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='10s' as $$
declare c public.action_cases%rowtype; d public.action_case_customer_contract_drafts%rowtype;
  o public.action_case_customer_offer_drafts%rowtype; sender public.organization_sender_profiles%rowtype;
  org public.organizations%rowtype; previous public.action_case_contract_sender_requests%rowtype;
  v_request uuid; profile_id uuid; requested_revision integer; profile_version bigint; legal_version bigint; frozen jsonb;
begin
  perform public.assert_contract_sender_actor(p_org_id,p_user_id);
  if jsonb_typeof(p_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_data))<>7
    or not p_data ?& array['requestId','revision','profileId','profileVersion','legalNameVersion','organizationNumber','confirmed']
    or p_data->'confirmed' is distinct from 'true'::jsonb
    or jsonb_typeof(p_data->'requestId') is distinct from 'string' or jsonb_typeof(p_data->'profileId') is distinct from 'string'
    or jsonb_typeof(p_data->'revision') is distinct from 'number' or p_data->>'revision' !~ '^(0|[1-9][0-9]*)$'
    or jsonb_typeof(p_data->'profileVersion') is distinct from 'number' or p_data->>'profileVersion' !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_data->'legalNameVersion') is distinct from 'number' or p_data->>'legalNameVersion' !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_data->'organizationNumber') is distinct from 'string' or p_data->>'organizationNumber' !~ '^[0-9]{6}-?[0-9]{4}$' then raise exception 'CUSTOMER_SENDER_INVALID'; end if;
  begin
    v_request:=(p_data->>'requestId')::uuid; profile_id:=(p_data->>'profileId')::uuid;
    requested_revision:=(p_data->>'revision')::integer; profile_version:=(p_data->>'profileVersion')::bigint; legal_version:=(p_data->>'legalNameVersion')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'CUSTOMER_SENDER_INVALID'; end;
  select * into c from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into previous from public.action_case_contract_sender_requests where request_id=v_request;
  if found then
    if previous.action_case_id<>p_case_id or previous.org_id<>p_org_id or previous.actor_profile_id<>p_user_id or previous.request_values is distinct from p_data then raise exception 'CUSTOMER_SENDER_STALE'; end if;
    return jsonb_build_object('saved',true,'revision',previous.draft_revision);
  end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='accepted') then raise exception 'CUSTOMER_OFFER_ACCEPTED'; end if;
  if exists(select 1 from public.action_case_contract_signing_documents where action_case_id=p_case_id and released_at is null)
    or exists(select 1 from public.action_case_contract_signing_delivery where action_case_id=p_case_id and signed_copy is not null and signed_copy<>'null'::jsonb)
    then raise exception 'CUSTOMER_OFFER_LOCKED'; end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='published') then raise exception 'CUSTOMER_SENDER_WITHDRAW_FIRST'; end if;
  select * into d from public.action_case_customer_contract_drafts where action_case_id=p_case_id and org_id=p_org_id for update;
  if coalesce(d.revision,0)<>requested_revision then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  select * into o from public.action_case_customer_offer_drafts where action_case_id=p_case_id and org_id=p_org_id for update;
  select * into org from public.organizations where id=p_org_id for share;
  if org.legal_name is null or org.organization_number is null or not public.is_valid_swedish_organization_number(org.organization_number) then raise exception 'CUSTOMER_SENDER_IDENTITY_REQUIRED'; end if;
  select * into sender from public.organization_sender_profiles where id=profile_id and org_id=p_org_id for share;
  if not found or not sender.is_active then raise exception 'CUSTOMER_SENDER_PROFILE'; end if;
  if sender.version<>profile_version or org.legal_name_version<>legal_version or org.organization_number is distinct from p_data->>'organizationNumber' then raise exception 'CUSTOMER_SENDER_STALE'; end if;
  if sender.logo_path is null and p_logo_data_url is not null then raise exception 'CUSTOMER_SENDER_MEDIA'; end if;
  if sender.logo_path is not null and (p_logo_data_url is null or length(p_logo_data_url)>200000
    or p_logo_data_url !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$') then raise exception 'CUSTOMER_SENDER_MEDIA'; end if;
  frozen:=jsonb_build_object('version',1,'organizationId',p_org_id,'profileId',sender.id,'profileVersion',sender.version,
    'legalNameVersion',org.legal_name_version,'legalName',org.legal_name,'organizationNumber',org.organization_number,
    'name',sender.name,'address',sender.address,'postalCode',sender.postal_code,'city',sender.city,'email',sender.email,'phone',sender.phone,
    'website',sender.website,'logoPath',sender.logo_path,'logoDataUrl',p_logo_data_url,'reportFooterText',sender.report_footer_text);
  insert into public.action_case_contract_senders(action_case_id,org_id,sender_profile_id,snapshot,selected_by)
    values(p_case_id,p_org_id,sender.id,frozen,p_user_id)
    on conflict(action_case_id) do update set sender_profile_id=excluded.sender_profile_id,snapshot=excluded.snapshot,selected_by=excluded.selected_by,selected_at=now();
  insert into public.action_case_customer_contract_drafts(action_case_id,org_id,revision,body,updated_by)
    values(p_case_id,p_org_id,1,public.project_sender_body(d.body,frozen,c.title,c.customer_name,c.customer_email,c.customer_phone),p_user_id)
    on conflict(action_case_id) do update set body=excluded.body,revision=action_case_customer_contract_drafts.revision+1,updated_by=p_user_id,updated_at=clock_timestamp();
  insert into public.action_case_customer_offer_drafts(action_case_id,org_id,revision,body,updated_by)
    values(p_case_id,p_org_id,1,public.project_sender_body(o.body,frozen,c.title,c.customer_name,c.customer_email,c.customer_phone),p_user_id)
    on conflict(action_case_id) do update set body=excluded.body,revision=action_case_customer_offer_drafts.revision+1,updated_by=p_user_id,updated_at=clock_timestamp();
  insert into public.action_case_contract_sender_requests(request_id,action_case_id,org_id,actor_profile_id,request_values,draft_revision)
    values(v_request,p_case_id,p_org_id,p_user_id,p_data,coalesce(d.revision,0)+1);
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'project_sender_selected','Avsändarprofil vald för projektets offert- och avtalsutkast',p_user_id);
  return jsonb_build_object('saved',true,'revision',coalesce(d.revision,0)+1);
end $$;

create or replace function public.assert_action_case_offer_sender_body(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_body jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare frozen jsonb; field_name text;
begin
  perform public.assert_contract_sender_actor(p_org_id,p_user_id);
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select snapshot into frozen from public.action_case_contract_senders where action_case_id=p_case_id and org_id=p_org_id;
  if p_body->'senderProfile' is distinct from frozen then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
  if frozen is not null and p_body ? 'contractParties' then
    for field_name in select jsonb_object_keys(public.contract_sender_protected_fields(frozen)) loop
      if p_body#>array['contractParties','contractor',field_name] is distinct from public.contract_sender_protected_fields(frozen)->field_name then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
    end loop;
  end if;
end $$;

create or replace function public.guard_project_sender_lock()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.action_cases where id=new.action_case_id and org_id=new.org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=new.action_case_id and status='accepted')
    or exists(select 1 from public.action_case_contract_signing_documents where action_case_id=new.action_case_id and released_at is null)
    or exists(select 1 from public.action_case_contract_signing_delivery where action_case_id=new.action_case_id and signed_copy is not null and signed_copy<>'null'::jsonb)
    then raise exception 'CUSTOMER_OFFER_LOCKED'; end if;
  return new;
end $$;
drop trigger if exists project_sender_lock on public.action_case_contract_senders;
create trigger project_sender_lock before insert or update on public.action_case_contract_senders for each row execute function public.guard_project_sender_lock();

create or replace function public.guard_offer_sender_draft()
returns trigger language plpgsql security definer set search_path='' as $$
declare frozen jsonb; field_name text;
begin
  perform 1 from public.action_cases where id=new.action_case_id and org_id=new.org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select snapshot into frozen from public.action_case_contract_senders where action_case_id=new.action_case_id and org_id=new.org_id;
  -- Legacy drafts without a selected profile remain writable until a project selection is made.
  if frozen is not null and new.body->'senderProfile' is distinct from frozen then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
  if frozen is null and new.body ? 'senderProfile' then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
  if frozen is not null and new.body ? 'contractParties' then
    for field_name in select jsonb_object_keys(public.contract_sender_protected_fields(frozen)) loop
      if new.body#>array['contractParties','contractor',field_name] is distinct from public.contract_sender_protected_fields(frozen)->field_name then raise exception 'CUSTOMER_SENDER_IMMUTABLE'; end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists offer_sender_draft_guard on public.action_case_customer_offer_drafts;
create trigger offer_sender_draft_guard before insert or update of body on public.action_case_customer_offer_drafts for each row execute function public.guard_offer_sender_draft();
revoke all on function public.project_sender_body(jsonb,jsonb,text,text,text,text),public.select_action_case_project_sender(uuid,uuid,uuid,jsonb,text),public.guard_offer_sender_draft(),public.guard_project_sender_lock(),public.assert_action_case_offer_sender_body(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.select_action_case_project_sender(uuid,uuid,uuid,jsonb,text),public.assert_action_case_offer_sender_body(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
