-- Project-wide customer kind and VAT PRESENTATION. No data backfill, price or
-- calculation conversion. Only an explicit, version-checked selection writes drafts.
begin;
set local lock_timeout='10s';

alter table public.organization_customers drop constraint if exists organization_customers_type_check;
alter table public.organization_customers add constraint organization_customers_type_check check(customer_type in ('private','business','association'));
alter table public.organization_customers drop constraint if exists organization_customers_identity_type_check;
alter table public.organization_customers add constraint organization_customers_identity_type_check check(
  (customer_type in ('business','association') and organization_number is not null and personal_identity_number is null)
  or (customer_type='private' and organization_number is null));

create table if not exists public.action_case_customer_presentations (
  action_case_id uuid primary key references public.action_cases(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  revision integer not null check(revision>0), value jsonb not null,
  updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table if not exists public.action_case_customer_presentation_requests (
  org_id uuid not null references public.organizations(id), request_id uuid not null,
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  actor_id uuid not null references public.profiles(id), request jsonb not null,
  primary key(org_id,request_id)
);
alter table public.action_case_customer_presentations enable row level security;
alter table public.action_case_customer_presentation_requests enable row level security;
revoke all on public.action_case_customer_presentations,public.action_case_customer_presentation_requests from public,anon,authenticated;
grant all on public.action_case_customer_presentations,public.action_case_customer_presentation_requests to service_role;

create or replace function public.assert_customer_presentation(v jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>3
    or v->'version' is distinct from '1'::jsonb or coalesce(v->>'customerType','') not in ('private','business','association')
    or coalesce(v->>'vatBasis','') not in ('incl','excl') or (v->>'customerType'='private' and v->>'vatBasis'<>'incl')
    then raise exception 'CUSTOMER_PRESENTATION_INVALID'; end if;
end $$;

create or replace function public.project_customer_presentation_body(b jsonb,v jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare p jsonb:=b->'contractParties';
begin
  perform public.assert_customer_presentation(v);
  if jsonb_typeof(p)='object' then
    if v->>'customerType'='private' then p:=p||jsonb_build_object('business',null);
    else
      -- Never silently discard another buyer or an entered personal identity.
      if jsonb_array_length(p->'customers')<>1 or coalesce(p#>>'{customers,0,personalNumber}','')<>'' then
        raise exception 'CUSTOMER_PRESENTATION_IDENTITY'; end if;
      p:=p||jsonb_build_object('business',case when jsonb_typeof(p->'business')='object' then p->'business'
        else jsonb_build_object('organizationNumber','','contactName','','signatoryName','') end);
    end if;
    b:=b||jsonb_build_object('contractParties',p);
  end if;
  return b||jsonb_build_object('customerPresentation',v);
end $$;

create or replace function public.guard_project_customer_presentation()
returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
  perform 1 from public.action_cases where id=new.action_case_id and org_id=new.org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select value into v from public.action_case_customer_presentations where action_case_id=new.action_case_id and org_id=new.org_id;
  if new.body->'customerPresentation' is distinct from v then raise exception 'CUSTOMER_PRESENTATION_STALE'; end if;
  if v is not null then
    perform public.assert_customer_presentation(v);
    if new.body ? 'contractParties' and ((v->>'customerType'='private') is distinct from
      (coalesce(new.body#>'{contractParties,business}','null'::jsonb)='null'::jsonb)) then raise exception 'CUSTOMER_PRESENTATION_STALE'; end if;
  end if;
  return new;
end $$;
drop trigger if exists customer_presentation_guard on public.action_case_customer_contract_drafts;
create trigger customer_presentation_guard before insert or update of body on public.action_case_customer_contract_drafts for each row execute function public.guard_project_customer_presentation();
drop trigger if exists customer_presentation_guard on public.action_case_customer_offer_drafts;
create trigger customer_presentation_guard before insert or update of body on public.action_case_customer_offer_drafts for each row execute function public.guard_project_customer_presentation();

create or replace function public.select_project_customer_presentation(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path='' set lock_timeout='10s' as $$
declare c public.action_cases%rowtype; d public.action_case_customer_contract_drafts%rowtype; o public.action_case_customer_offer_drafts%rowtype;
  s public.action_case_customer_presentations%rowtype; r public.action_case_customer_presentation_requests%rowtype;
  customer public.organization_customers%rowtype; v jsonb:=p_data->'value'; b jsonb; ob jsonb; p jsonb; sender jsonb; v_request uuid; selected_id uuid; k text;
begin
  perform public.assert_contract_sender_actor(p_org_id,p_user_id);
  perform public.assert_customer_presentation(v);
  if jsonb_typeof(p_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_data))<>7
    or not p_data ?& array['requestId','revision','contractRevision','offerRevision','value','customerId','customerVersion'] then raise exception 'CUSTOMER_PRESENTATION_INVALID'; end if;
  foreach k in array array['revision','contractRevision','offerRevision'] loop
    if jsonb_typeof(p_data->k) is distinct from 'number' or p_data->>k !~ '^(0|[1-9][0-9]*)$' then raise exception 'CUSTOMER_PRESENTATION_INVALID'; end if;
  end loop;
  begin v_request:=(p_data->>'requestId')::uuid; selected_id:=(p_data->>'customerId')::uuid;
  exception when invalid_text_representation then raise exception 'CUSTOMER_PRESENTATION_INVALID'; end;
  if v_request is null then raise exception 'CUSTOMER_PRESENTATION_INVALID'; end if;
  select * into c from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into r from public.action_case_customer_presentation_requests req where req.org_id=p_org_id and req.request_id=v_request;
  if found then
    if r.action_case_id<>p_case_id or r.actor_id<>p_user_id or r.request is distinct from p_data then raise exception 'CUSTOMER_PRESENTATION_STALE'; end if;
    return;
  end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='accepted')
    or exists(select 1 from public.action_case_contract_signing_documents where action_case_id=p_case_id and released_at is null)
    or exists(select 1 from public.action_case_contract_signing_delivery where action_case_id=p_case_id and signed_copy is not null and signed_copy<>'null'::jsonb)
    then raise exception 'CUSTOMER_OFFER_LOCKED'; end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='published') then raise exception 'CUSTOMER_OFFER_WITHDRAW_FIRST'; end if;
  select * into d from public.action_case_customer_contract_drafts where action_case_id=p_case_id and org_id=p_org_id for update;
  select * into o from public.action_case_customer_offer_drafts where action_case_id=p_case_id and org_id=p_org_id for update;
  select * into s from public.action_case_customer_presentations where action_case_id=p_case_id and org_id=p_org_id for update;
  if coalesce(d.revision,0)::bigint<>(p_data->>'contractRevision')::bigint or coalesce(o.revision,0)::bigint<>(p_data->>'offerRevision')::bigint
    or coalesce(s.revision,0)::bigint<>(p_data->>'revision')::bigint then raise exception 'CUSTOMER_PRESENTATION_STALE'; end if;
  b:=coalesce(d.body,jsonb_build_object('title',c.title,'introduction','','baseAmountOre',null,'validUntil','','contractForm','custom','terms','','paymentTerms','','schedule','','attachmentIds','[]'::jsonb,'termsAttachmentId',null,'items','[]'::jsonb));
  ob:=coalesce(o.body,b);
  if not b ? 'contractParties' or not ob ? 'contractParties' then
    p:=jsonb_build_object('version',1,'customers',jsonb_build_array(jsonb_build_object('name',coalesce(c.customer_name,''),'personalNumber','')),
      'street','','postalCode','','city','','phone','','mobile',coalesce(c.customer_phone,''),'email',coalesce(c.customer_email,''),
      'contractor',jsonb_build_object('companyName','','organizationNumber','','contactName','','mobile','','street','','postalCode','','city','','phone','','fax','','email','','fTax','unreviewed'));
    select snapshot into sender from public.action_case_contract_senders where action_case_id=p_case_id and org_id=p_org_id;
    if not b ? 'contractParties' then
      b:=case when sender is not null then public.project_sender_body(b,sender,c.title,c.customer_name,c.customer_email,c.customer_phone) else b||jsonb_build_object('contractParties',p) end;
    end if;
    if not ob ? 'contractParties' then
      ob:=case when sender is not null then public.project_sender_body(ob,sender,c.title,c.customer_name,c.customer_email,c.customer_phone) else ob||jsonb_build_object('contractParties',p) end;
    end if;
  end if;
  if selected_id is not null then
    select * into customer from public.organization_customers where id=selected_id and org_id=p_org_id and is_active for share;
    if not found or customer.customer_type is distinct from v->>'customerType' then raise exception 'CUSTOMER_PRESENTATION_CUSTOMER'; end if;
    if customer.version::text is distinct from p_data->>'customerVersion' then raise exception 'CUSTOMER_PRESENTATION_STALE'; end if;
    -- Changing the actual buyer retains the established no-history / access rules.
    if c.organization_customer_id is distinct from selected_id and exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id) then raise exception 'CUSTOMER_REGISTRY_HISTORY_LOCKED'; end if;
    select snapshot into sender from public.action_case_contract_senders where action_case_id=p_case_id and org_id=p_org_id;
    if sender is not null then b:=public.project_sender_body(b,sender,c.title,c.customer_name,c.customer_email,c.customer_phone); end if;
    p:=coalesce(b->'contractParties',jsonb_build_object('version',1,'customers','[]'::jsonb,'phone','','mobile','','email','','street','','postalCode','','city','',
      'contractor',jsonb_build_object('companyName','','organizationNumber','','contactName','','mobile','','street','','postalCode','','city','','phone','','fax','','email','','fTax','unreviewed')));
    p:=p||jsonb_build_object('customers',jsonb_build_array(jsonb_build_object('name',customer.name,'personalNumber','')),
      'business',case when customer.customer_type='private' then 'null'::jsonb else jsonb_build_object('organizationNumber',customer.organization_number,'contactName',coalesce(p#>>'{business,contactName}',''),'signatoryName',coalesce(p#>>'{business,signatoryName}','')) end,
      'street',concat_ws(', ',customer.address,customer.address_line_2),'postalCode',coalesce(customer.postal_code,''),'city',coalesce(customer.city,''),'mobile',coalesce(customer.phone,''),'email',coalesce(customer.email,''));
    b:=b||jsonb_build_object('contractParties',p); ob:=ob||jsonb_build_object('contractParties',p);
  elsif c.organization_customer_id is not null then
    select * into customer from public.organization_customers where id=c.organization_customer_id and org_id=p_org_id;
    if customer.customer_type is distinct from v->>'customerType' then raise exception 'CUSTOMER_PRESENTATION_CUSTOMER'; end if;
  end if;
  b:=public.project_customer_presentation_body(b,v); ob:=public.project_customer_presentation_body(ob,v);
  insert into public.action_case_customer_presentations(action_case_id,org_id,revision,value,updated_by) values(p_case_id,p_org_id,1,v,p_user_id)
    on conflict(action_case_id) do update set revision=action_case_customer_presentations.revision+1,value=excluded.value,updated_by=p_user_id,updated_at=clock_timestamp();
  if selected_id is not null then
    perform public.write_action_case_contract_parties(p_org_id,p_case_id,p_user_id,'save',jsonb_build_object('revision',coalesce(d.revision,0),'body',b));
    if c.organization_customer_id is distinct from selected_id then
      update public.action_case_access_links set revoked_at=clock_timestamp() where org_id=p_org_id and action_case_id=p_case_id and revoked_at is null;
      delete from public.action_case_attachment_grants where participant_id in(select id from public.action_case_participants where action_case_id=p_case_id and role='customer');
      update public.action_case_customer_planning set shared_items='[]'::jsonb,participant_id=null,revision=revision+1 where action_case_id=p_case_id and org_id=p_org_id;
      update public.action_case_schedules set shared_rows='[]'::jsonb,revision=revision+1 where action_case_id=p_case_id and org_id=p_org_id;
    end if;
    update public.action_cases set organization_customer_id=selected_id,customer_link_request_id=v_request where id=p_case_id and org_id=p_org_id;
  else
    insert into public.action_case_customer_contract_drafts(action_case_id,org_id,revision,body,updated_by) values(p_case_id,p_org_id,1,b,p_user_id)
      on conflict(action_case_id) do update set revision=action_case_customer_contract_drafts.revision+1,body=excluded.body,updated_by=p_user_id,updated_at=clock_timestamp();
  end if;
  insert into public.action_case_customer_offer_drafts(action_case_id,org_id,revision,body,updated_by) values(p_case_id,p_org_id,1,ob,p_user_id)
    on conflict(action_case_id) do update set revision=action_case_customer_offer_drafts.revision+1,body=excluded.body,updated_by=p_user_id,updated_at=clock_timestamp();
  insert into public.action_case_customer_presentation_requests values(p_org_id,v_request,p_case_id,p_user_id,p_data);
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by) values(p_org_id,p_case_id,'customer_presentation_selected','Beställartyp och momsvisning uppdaterade; prisbelopp oförändrade',p_user_id);
end $$;

-- Freeze presentation with newly shared choices, never rewrite existing shares.
alter table public.action_case_customer_planning add column if not exists shared_customer_presentation jsonb;
create or replace function public.freeze_choice_customer_presentation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or new.shared_revision is distinct from old.shared_revision then
    select value into new.shared_customer_presentation from public.action_case_customer_presentations where action_case_id=new.action_case_id and org_id=new.org_id;
  end if;
  return new;
end $$;
drop trigger if exists z_freeze_choice_customer_presentation on public.action_case_customer_planning;
create trigger z_freeze_choice_customer_presentation before insert or update on public.action_case_customer_planning for each row execute function public.freeze_choice_customer_presentation();
do $$ begin
  if to_regprocedure('public.customer_choices_snapshot_before_presentation(uuid,uuid,uuid)') is null then
    alter function public.customer_choices_snapshot(uuid,uuid,uuid) rename to customer_choices_snapshot_before_presentation;
  end if;
end $$;
create or replace function public.customer_choices_snapshot(p_org_id uuid,p_case_id uuid,p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v jsonb;
begin
  result:=public.customer_choices_snapshot_before_presentation(p_org_id,p_case_id,p_participant_id);
  if result is null then return null; end if;
  select shared_customer_presentation into v from public.action_case_customer_planning where action_case_id=p_case_id and org_id=p_org_id;
  return case when v is null then result else result||jsonb_build_object('customerPresentation',v) end;
end $$;
revoke all on function public.assert_customer_presentation(jsonb),public.project_customer_presentation_body(jsonb,jsonb),public.guard_project_customer_presentation(),public.select_project_customer_presentation(uuid,uuid,uuid,jsonb),public.freeze_choice_customer_presentation(),public.customer_choices_snapshot_before_presentation(uuid,uuid,uuid),public.customer_choices_snapshot(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.select_project_customer_presentation(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.customer_choices_snapshot(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
