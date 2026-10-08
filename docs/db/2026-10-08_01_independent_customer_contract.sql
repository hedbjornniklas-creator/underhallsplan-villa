-- Gizmo: independent contract draft, explicit imports and immutable signed versions.
-- Prerequisites: customer offers, costing, planning, payment plan, parties, property
-- and contract assignment migrations through 2026-10-07_03.
-- Run BEFORE publishing the application. Existing offer and signed snapshots are retained.
begin;

create table if not exists public.action_case_customer_contract_drafts (
  action_case_id uuid primary key references public.action_cases(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete restrict,
  revision integer not null check (revision > 0),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  internal_costing jsonb not null default '{}' check (jsonb_typeof(internal_costing) = 'object'),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.action_case_customer_contract_drafts enable row level security;
revoke all on public.action_case_customer_contract_drafts from public, anon, authenticated;
grant all on public.action_case_customer_contract_drafts to service_role;

-- One-time independent copy. Re-running never overwrites a contract or merges rows.
insert into public.action_case_customer_contract_drafts
  (action_case_id,org_id,revision,body,internal_costing,updated_by,updated_at)
select action_case_id,org_id,revision,body,internal_costing,updated_by,updated_at
from public.action_case_customer_offer_drafts d
where not exists(select 1 from public.action_case_customer_contract_drafts c where c.action_case_id=d.action_case_id)
on conflict(action_case_id) do nothing;

alter table public.action_case_customer_offers add column if not exists contract_revision integer;
update public.action_case_customer_offers set contract_revision=draft_revision where contract_revision is null;
create unique index if not exists customer_contract_publication_revision
  on public.action_case_customer_offers(action_case_id,contract_revision);

create or replace function public.guard_customer_contract_revision() returns trigger
language plpgsql set search_path=public,pg_catalog as $$
begin
  if new.contract_revision is distinct from old.contract_revision then raise exception 'CUSTOMER_OFFER_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists customer_contract_revision_immutable on public.action_case_customer_offers;
create trigger customer_contract_revision_immutable before update on public.action_case_customer_offers
  for each row execute function public.guard_customer_contract_revision();

create or replace function public.guard_independent_contract_draft() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare case_id uuid; organization_id uuid;
begin
  case_id := case when tg_op='DELETE' then old.action_case_id else new.action_case_id end;
  organization_id := case when tg_op='DELETE' then old.org_id else new.org_id end;
  -- Same lock as publication and acceptance, including direct service-role writes.
  perform 1 from public.action_cases where id=case_id and org_id=organization_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id=case_id and status='accepted')
    then raise exception 'CUSTOMER_OFFER_ACCEPTED'; end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and (new.action_case_id,new.org_id) is distinct from (old.action_case_id,old.org_id)
    then raise exception 'CUSTOMER_OFFER_IMMUTABLE'; end if;
  perform public.assert_customer_offer_pricing(new.body);
  perform public.assert_customer_contract(new.body);
  perform public.assert_customer_payment_plan(new.body);
  perform public.assert_customer_offer_scope_notes(new.body);
  perform public.assert_customer_offer_scope_conditions(new.body);
  perform public.assert_contract_assignment(new.body);
  return new;
end $$;
drop trigger if exists independent_contract_draft_guard on public.action_case_customer_contract_drafts;
create trigger independent_contract_draft_guard before insert or update or delete on public.action_case_customer_contract_drafts
  for each row execute function public.guard_independent_contract_draft();
drop trigger if exists structured_property_contract_draft on public.action_case_customer_contract_drafts;
create trigger structured_property_contract_draft after insert or update of body on public.action_case_customer_contract_drafts
  for each row execute function public.guard_structured_contract_property();

-- Offer property fields are now only a historical snapshot, never a registry write.
create or replace function public.guard_independent_offer_property() returns trigger
language plpgsql set search_path=public,pg_catalog as $$
begin
  perform public.assert_contract_property(new.body,false);
  return new;
end $$;
drop trigger if exists structured_property_draft on public.action_case_customer_offer_drafts;
create trigger structured_property_draft after insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.guard_independent_offer_property();

create or replace function public.write_customer_contract(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  d public.action_case_customer_contract_drafts%rowtype;
  o public.action_case_customer_offers%rowtype;
  c public.action_cases%rowtype;
  recipient public.action_case_participants%rowtype;
  f jsonb; n integer; v_id uuid; v_lease uuid;
begin
  perform 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active=true for share;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into c from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if p_operation in ('save','publish') then
    select * into d from public.action_case_customer_contract_drafts where action_case_id=p_case_id and org_id=p_org_id for update;
    if p_operation='publish' then
      select * into o from public.action_case_customer_offers where action_case_id=p_case_id and contract_revision=(p_data->>'revision')::integer;
      if found then return jsonb_build_object('id',o.id); end if;
    end if;
    if exists(select 1 from public.action_case_customer_offers where action_case_id=p_case_id and status='accepted') then raise exception 'CUSTOMER_OFFER_ACCEPTED'; end if;
    if coalesce(d.revision,0) is distinct from (p_data->>'revision')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
    if p_operation='save' then
      if jsonb_typeof(p_data->'body') is distinct from 'object' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      insert into public.action_case_customer_contract_drafts(action_case_id,org_id,revision,body,updated_by)
      values(p_case_id,p_org_id,1,p_data->'body',p_user_id)
      on conflict(action_case_id) do update set revision=action_case_customer_contract_drafts.revision+1,body=excluded.body,updated_by=p_user_id,updated_at=clock_timestamp();
      return '{}'::jsonb;
    end if;
    if d.action_case_id is null or p_data->>'confirmed' is distinct from 'true' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    select * into recipient from public.action_case_participants where id=(p_data->>'participantId')::uuid and action_case_id=p_case_id and org_id=p_org_id and role='customer' for update;
    if not found or recipient.email is null or lower(btrim(recipient.email)) is distinct from p_data->>'email' then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
    if jsonb_typeof(d.body->'baseAmountOre') is distinct from 'number' or (d.body->>'baseAmountOre')::bigint < 0
      or (d.body->>'validUntil')::date < (now() at time zone 'Europe/Stockholm')::date then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_data->'snapshot' is distinct from d.body || jsonb_build_object('projectTitle',c.title,'propertyAddress',c.property_address,'customerName',recipient.name,'customerEmail',lower(btrim(recipient.email)),'issuerName',p_data->>'issuerName','replyEmail',p_data->>'replyEmail') then raise exception 'CUSTOMER_OFFER_STALE'; end if;
    v_id := (p_data->>'id')::uuid;
    if jsonb_array_length(p_data->'files') <> jsonb_array_length(d.body->'attachmentIds') then raise exception 'CUSTOMER_OFFER_FILES'; end if;
    for f in select value from jsonb_array_elements(p_data->'files') loop
      if not d.body->'attachmentIds' ? (f->>'id') or f->>'path' <> p_org_id::text||'/'||p_case_id::text||'/'||v_id::text||'/'||(f->>'id') then raise exception 'CUSTOMER_OFFER_FILES'; end if;
      if not exists(select 1 from public.action_case_attachments a where a.id=(f->>'id')::uuid and a.org_id=p_org_id and a.action_case_id=p_case_id and a.file_path=f->>'sourcePath' and a.file_size_bytes=(f->>'fileSizeBytes')::bigint) then raise exception 'CUSTOMER_OFFER_FILES'; end if;
      if exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id=(f->>'id')::uuid)
        or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id=(f->>'id')::uuid) then raise exception 'CUSTOMER_OFFER_FILES'; end if;
    end loop;
    if p_data->'emailPayload'->>'to' is distinct from lower(btrim(recipient.email)) then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
    select coalesce(max(version),0)+1 into n from public.action_case_customer_offers where action_case_id=p_case_id;
    update public.action_case_customer_offers set status='superseded' where action_case_id=p_case_id and status='published';
    insert into public.action_case_customer_offers(id,org_id,action_case_id,participant_id,version,draft_revision,contract_revision,snapshot,files,email_payload,published_by)
    values(v_id,p_org_id,p_case_id,recipient.id,n,(select coalesce(max(draft_revision),0)+1 from public.action_case_customer_offers where action_case_id=p_case_id),d.revision,p_data->'snapshot',p_data->'files',p_data->'emailPayload',p_user_id);
    insert into public.action_case_access_links(org_id,action_case_id,participant_id,token_hash,expires_at,created_by)
    values(p_org_id,p_case_id,recipient.id,p_data->>'tokenHash',now()+interval '90 days',p_user_id);
    insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'customer_offer_published','Offertversion '||n,p_user_id);
    return jsonb_build_object('id',v_id);
  end if;
  select * into o from public.action_case_customer_offers where id=(p_data->>'id')::uuid and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if p_operation='withdraw' then
    if o.status <> 'published' then raise exception 'CUSTOMER_OFFER_IMMUTABLE'; end if;
    update public.action_case_customer_offers set status='withdrawn' where id=o.id;
    insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by) values(p_org_id,p_case_id,'customer_offer_withdrawn','Offertversion '||o.version,p_user_id);
    return '{}'::jsonb;
  elsif p_operation='claim_send' then
    if o.sent_at is not null then return jsonb_build_object('sent',true); end if;
    if o.status <> 'published' then raise exception 'CUSTOMER_OFFER_CLOSED'; end if;
    if o.lease_until > now() then raise exception 'CUSTOMER_OFFER_BUSY'; end if;
    -- Resend's idempotency window is 24 hours. Do not blindly retry older ambiguous sends.
    if o.first_attempt_at < now()-interval '23 hours' then raise exception 'CUSTOMER_OFFER_SEND_UNKNOWN'; end if;
    v_lease := gen_random_uuid();
    update public.action_case_customer_offers set lease_id=v_lease,lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=o.id;
    return jsonb_build_object('leaseId',v_lease,'payload',o.email_payload);
  elsif p_operation='finish_send' then
    if o.lease_id is distinct from (p_data->>'leaseId')::uuid then raise exception 'CUSTOMER_OFFER_STALE'; end if;
    update public.action_case_customer_offers set lease_until=null,lease_id=null,sent_at=case when p_data->>'success'='true' then coalesce(sent_at,now()) else sent_at end,provider_message_id=coalesce(provider_message_id,p_data->>'providerMessageId') where id=o.id;
    return '{}'::jsonb;
  end if;
  raise exception 'CUSTOMER_OFFER_INVALID';
end $$;

create or replace function public.save_customer_contract_costing(
  p_org_id uuid, p_case_id uuid, p_user_id uuid, p_data jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare result jsonb;
begin
  if jsonb_typeof(p_data->'costing') is distinct from 'object'
    or octet_length((p_data->'costing')::text) > 1048576 then
    raise exception 'CUSTOMER_OFFER_INVALID';
  end if;
  result := public.write_customer_contract(p_org_id,p_case_id,p_user_id,'save',p_data);
  update public.action_case_customer_contract_drafts
    set internal_costing=p_data->'costing'
    where action_case_id=p_case_id and org_id=p_org_id;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  return result;
end $$;

create or replace function public.write_action_case_contract_parties(
  p_org_id uuid, p_case_id uuid, p_user_id uuid, p_mode text, p_data jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  c public.action_cases%rowtype;
  customer public.organization_customers%rowtype;
  recipient public.action_case_participants%rowtype;
  actor_role text;
  saved_revision integer;
  body jsonb := p_data->'body';
  parties jsonb := body->'contractParties';
  input jsonb := p_data->'customerInput';
  request_id uuid;
  buyer_name text;
  buyer_email text;
  buyer_phone text;
  changed_recipient boolean;
begin
  if p_mode is null or p_mode not in ('save', 'existing', 'create') or p_user_id is null then
    raise exception 'CUSTOMER_OFFER_INVALID';
  end if;
  select role into actor_role from public.org_members
    where org_id = p_org_id and profile_id = p_user_id and is_active = true;
  if not found then raise exception 'CUSTOMER_REGISTRY_FORBIDDEN'; end if;
  select * into c from public.action_cases where id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if exists (select 1 from public.action_case_customer_offers where action_case_id = p_case_id and status = 'accepted') then
    raise exception 'CUSTOMER_OFFER_ACCEPTED';
  end if;
  if p_mode <> 'save' then
    request_id := (p_data->>'requestId')::uuid;
    if request_id is null then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    -- Serialize retries on the project before inserting a customer or incrementing the draft.
    if c.customer_link_request_id = request_id then return '{}'::jsonb; end if;
    if exists (select 1 from public.action_case_customer_offers where action_case_id = p_case_id and status = 'published') then
      raise exception 'CUSTOMER_REGISTRY_WITHDRAW_FIRST';
    end if;
  end if;
  select revision into saved_revision from public.action_case_customer_contract_drafts
    where org_id = p_org_id and action_case_id = p_case_id for update;
  if coalesce(saved_revision, 0) is distinct from (p_data->>'revision')::integer then
    raise exception 'CUSTOMER_OFFER_STALE';
  end if;
  if jsonb_typeof(parties) is distinct from 'object' or parties->>'version' is distinct from '1'
    or jsonb_typeof(parties->'customers') is distinct from 'array'
    or jsonb_array_length(parties->'customers') not between 1 and 2 then
    raise exception 'CUSTOMER_OFFER_INVALID';
  end if;

  if p_mode = 'existing' then
    select * into customer from public.organization_customers
      where org_id = p_org_id and id = (p_data->'binding'->>'customerId')::uuid for share;
    if not found or not customer.is_active or customer.customer_type <> 'private' then
      raise exception 'CUSTOMER_REGISTRY_NOT_FOUND';
    end if;
    if customer.version is distinct from (p_data->'binding'->>'customerVersion')::bigint then
      raise exception 'CUSTOMER_REGISTRY_STALE';
    end if;
    if coalesce((p_data->>'includeIdentity')::boolean, false) and actor_role <> 'admin' then
      raise exception 'CUSTOMER_REGISTRY_FORBIDDEN';
    end if;
    parties := jsonb_set(parties, '{customers,0}', jsonb_build_object('name', customer.name,
      'personalNumber', case when p_data->>'includeIdentity' = 'true' then coalesce(customer.personal_identity_number, '') else '' end));
    parties := parties || jsonb_build_object('street', concat_ws(', ', customer.address, customer.address_line_2),
      'postalCode', coalesce(customer.postal_code, ''), 'city', coalesce(customer.city, ''),
      'phone', '', 'mobile', coalesce(customer.phone, ''), 'email', coalesce(customer.email, ''));
    if char_length(parties->>'street') > 250 then raise exception 'CUSTOMER_REGISTRY_ADDRESS_INVALID'; end if;
    body := jsonb_set(body, '{contractParties}', parties);
  end if;
  buyer_name := nullif(btrim(parties->'customers'->0->>'name'), '');
  buyer_email := nullif(lower(btrim(parties->>'email')), '');
  buyer_phone := coalesce(nullif(btrim(parties->>'mobile'), ''), nullif(btrim(parties->>'phone'), ''));
  -- Incomplete contact details may be saved as an unlinked draft, but never replace a recipient.
  if p_mode <> 'save' and (buyer_name is null or buyer_email is null) then
    raise exception 'CUSTOMER_REGISTRY_CONTACT_INVALID';
  end if;
  if char_length(buyer_name) > 200 or char_length(buyer_phone) > 50
    or (buyer_email is not null and (char_length(buyer_email) > 254
      or buyer_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')) then
    raise exception 'CUSTOMER_REGISTRY_CONTACT_INVALID';
  end if;
  if p_mode = 'create' then
    if actor_role <> 'admin' then raise exception 'CUSTOMER_REGISTRY_FORBIDDEN'; end if;
    if input->>'customerType' is distinct from 'private' or input->>'name' is distinct from buyer_name
      or input->>'email' is distinct from buyer_email or input->>'invoiceSameAsCustomer' is distinct from 'true' then
      raise exception 'CUSTOMER_OFFER_INVALID';
    end if;
    insert into public.organization_customers (org_id, customer_type, name, personal_identity_number,
      email, phone, address, postal_code, city, country_code, invoice_same_as_customer,
      created_by_profile_id, updated_by_profile_id)
      values (p_org_id, 'private', buyer_name, nullif(input->>'identityNumber', ''), buyer_email, buyer_phone,
        nullif(parties->>'street', ''), nullif(parties->>'postalCode', ''), nullif(parties->>'city', ''), 'SE', true, p_user_id, p_user_id)
      returning * into customer;
  end if;
  select * into recipient from public.action_case_participants
    where org_id = p_org_id and action_case_id = p_case_id and role = 'customer' for update;
  changed_recipient := buyer_name is distinct from recipient.name or buyer_email is distinct from lower(btrim(recipient.email));
  if buyer_name is not null and buyer_email is not null then
    if changed_recipient and exists (select 1 from public.action_case_customer_offers
      where action_case_id = p_case_id and status = 'published') then
      raise exception 'CUSTOMER_REGISTRY_WITHDRAW_FIRST';
    end if;
    if (changed_recipient or (p_mode <> 'save' and c.organization_customer_id is distinct from customer.id))
      and exists (select 1 from public.action_case_customer_offers where action_case_id = p_case_id) then
      raise exception 'CUSTOMER_REGISTRY_HISTORY_LOCKED';
    end if;
    if changed_recipient or (p_mode <> 'save' and c.organization_customer_id is distinct from customer.id) then
      -- A different buyer must not inherit another person's links or attachment grants.
      update public.action_case_access_links set revoked_at = clock_timestamp()
        where org_id = p_org_id and participant_id = recipient.id and revoked_at is null;
      delete from public.action_case_attachment_grants where participant_id = recipient.id;
      if to_regclass('public.action_case_customer_planning') is not null then
        update public.action_case_customer_planning set shared_items = '[]'::jsonb, participant_id = null,
          revision = revision + 1, updated_at = clock_timestamp(), updated_by = p_user_id
          where org_id = p_org_id and action_case_id = p_case_id;
      end if;
      if to_regclass('public.action_case_schedules') is not null then
        update public.action_case_schedules set shared_rows = '[]'::jsonb, revision = revision + 1,
          updated_at = clock_timestamp(), updated_by = p_user_id
          where org_id = p_org_id and action_case_id = p_case_id;
      end if;
    end if;
    if recipient.id is null then
      insert into public.action_case_participants (org_id, action_case_id, role, name, email, phone, created_by)
        values (p_org_id, p_case_id, 'customer', buyer_name, buyer_email, buyer_phone, p_user_id);
    else
      update public.action_case_participants set name = buyer_name, email = buyer_email, phone = buyer_phone
        where id = recipient.id and org_id = p_org_id;
    end if;
    update public.action_cases set customer_name = buyer_name, customer_email = buyer_email, customer_phone = buyer_phone
      where id = p_case_id and org_id = p_org_id;
  end if;
  if p_mode <> 'save' then
    update public.action_cases set organization_customer_id = customer.id, customer_link_request_id = request_id
      where id = p_case_id and org_id = p_org_id;
  end if;
  body := jsonb_set(body, '{contractDetails,fields,parties}', jsonb_build_object('status', 'specified',
    'text', 'Beställare: ' || coalesce((select string_agg(value->>'name', ', ') from jsonb_array_elements(parties->'customers')), '')
      || '. Entreprenör: ' || coalesce(parties->'contractor'->>'companyName', '') || '.'));
  if p_data ? 'costing' then
    perform public.save_customer_contract_costing(p_org_id, p_case_id, p_user_id, p_data || jsonb_build_object('body', body));
  else
    perform public.write_customer_contract(p_org_id, p_case_id, p_user_id, 'save', p_data || jsonb_build_object('body', body));
  end if;
  insert into public.action_case_events (org_id, action_case_id, event_type, message, performed_by)
    values (p_org_id, p_case_id, 'contract_customer_saved', case when p_mode = 'create' then 'Ny kund skapad och kopplad'
      when p_mode = 'existing' then 'Befintlig kund kopplad' else 'Avtalets kontaktuppgifter sparade' end, p_user_id);
  return '{}'::jsonb;
end $$;

create or replace function public.write_action_case_contract_property(p_org_id uuid, p_case_id uuid, p_user_id uuid, p_mode text, p_data jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  c public.action_cases%rowtype; r public.properties%rowtype;
  body jsonb := p_data->'body'; input jsonb := p_data->'property'; property jsonb;
  request_id uuid := (p_data->>'requestId')::uuid;
  fingerprint text := md5(p_mode || p_data::text);
  identity text; matches integer; saved_revision integer; k text; field_text text;
begin
  if p_mode is null or p_mode not in ('existing','create') or p_user_id is null or request_id is null
    or jsonb_typeof(p_data->'revision') is distinct from 'number' or (p_data->>'revision')::integer < 0
    or jsonb_typeof(body->'contractDetails') is distinct from 'object' then raise exception 'PROPERTY_INVALID'; end if;
  perform 1 from public.org_members where org_id = p_org_id and profile_id = p_user_id and is_active = true for share;
  if not found then raise exception 'PROPERTY_FORBIDDEN'; end if;
  select * into c from public.action_cases where id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if c.property_link_request_id = request_id then
    if c.property_link_fingerprint is distinct from fingerprint then raise exception 'PROPERTY_STALE'; end if;
    return;
  end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id = p_case_id and status = 'accepted') then raise exception 'CUSTOMER_OFFER_ACCEPTED'; end if;
  if exists(select 1 from public.action_case_customer_offers where action_case_id = p_case_id and status = 'published') then raise exception 'CUSTOMER_OFFER_WITHDRAW_FIRST'; end if;
  select revision into saved_revision from public.action_case_customer_contract_drafts where action_case_id = p_case_id and org_id = p_org_id for update;
  if coalesce(saved_revision, 0) is distinct from (p_data->>'revision')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if jsonb_typeof(input) is distinct from 'object' then raise exception 'PROPERTY_INVALID'; end if;
  foreach k in array array['municipality','cadastralDesignation','street','postalCode','city'] loop
    if jsonb_typeof(input->k) is distinct from 'string' or length(input->>k) > (case k when 'street' then 250 when 'postalCode' then 20 else 200 end)
      then raise exception 'PROPERTY_INVALID'; end if;
  end loop;
  identity := public.property_identity_key(input->>'municipality', input->>'cadastralDesignation');
  if p_mode = 'existing' then
    select * into r from public.properties where id = (p_data->>'propertyId')::uuid for share;
    if not found or not public.action_case_property_access(p_org_id, p_user_id, r.id) then raise exception 'PROPERTY_FORBIDDEN'; end if;
    if public.property_record_details(r) is distinct from input then raise exception 'PROPERTY_STALE'; end if;
  else
    if identity is null or nullif(btrim(input->>'street'), '') is null then raise exception 'PROPERTY_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended(identity, 0));
    select count(*) into matches from public.properties p where public.action_case_property_access(p_org_id, p_user_id, p.id)
      and public.property_identity_key(p.municipality, p.cadastral_id) = identity;
    if matches > 1 then raise exception 'PROPERTY_AMBIGUOUS'; end if;
    if matches = 1 then raise exception 'PROPERTY_EXISTS'; end if;
    insert into public.properties(owner, name, municipality, cadastral_id, address, postal_code, city)
      values(p_user_id, input->>'cadastralDesignation', input->>'municipality', input->>'cadastralDesignation', input->>'street',
        nullif(input->>'postalCode',''), nullif(input->>'city','')) returning * into r;
  end if;
  property := public.property_record_details(r);
  -- Unidentified legacy properties can be viewed, but cannot become a cadastral identity link.
  if public.property_identity_key(r.municipality, r.cadastral_id) is null then raise exception 'PROPERTY_INVALID'; end if;
  field_text := concat_ws(E'\n', 'Kommun: ' || (property->>'municipality'), 'Fastighetsbeteckning: ' || (property->>'cadastralDesignation'),
    case when property->>'street' <> '' then 'Gata: ' || (property->>'street') end,
    case when property->>'postalCode' <> '' then 'Postnummer: ' || (property->>'postalCode') end,
    case when property->>'city' <> '' then 'Ort: ' || (property->>'city') end);
  if not (body->'contractDetails' ? 'property') and coalesce(body->'contractDetails'->'fields'->'property'->>'text', '') <> '' then
    body := jsonb_set(body, '{contractDetails,propertyReference}', body->'contractDetails'->'fields'->'property'->'text');
  end if;
  body := jsonb_set(body, '{contractDetails,property}', property || jsonb_build_object('sourcePropertyId', r.id));
  body := jsonb_set(body, '{contractDetails,fields,property}', jsonb_build_object('text', field_text,
    'status', case when nullif(btrim(r.address),'') is not null and nullif(btrim(r.city),'') is not null then 'specified' else 'unreviewed' end));
  update public.action_cases set property_id = r.id, property_link_request_id = request_id, property_link_fingerprint = fingerprint,
    property_address = coalesce(nullif(r.address,''), property_address) where id = p_case_id and org_id = p_org_id;
  if p_data ? 'costing' then
    perform public.save_customer_contract_costing(p_org_id, p_case_id, p_user_id, p_data || jsonb_build_object('body', body));
  else
    perform public.write_customer_contract(p_org_id, p_case_id, p_user_id, 'save', p_data || jsonb_build_object('body', body));
  end if;
  insert into public.action_case_events(org_id, action_case_id, event_type, message, performed_by)
    values(p_org_id, p_case_id, 'property_linked', 'Fastighet kopplad: ' || r.cadastral_id || ', ' || r.municipality, p_user_id);
end $$;

create or replace function public.separate_independent_contract_choices(
  p_org_id uuid, p_case_id uuid, p_user_id uuid, p_revision integer, p_planning_revision integer
) returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  d public.action_case_customer_contract_drafts%rowtype;
  p public.action_case_customer_planning%rowtype;
  choices jsonb; remaining jsonb; costs jsonb; remaining_costs jsonb;
begin
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into d from public.action_case_customer_contract_drafts
    where action_case_id=p_case_id and org_id=p_org_id for update;
  select * into p from public.action_case_customer_planning
    where action_case_id=p_case_id and org_id=p_org_id for update;
  if d.revision is distinct from p_revision or d.action_case_id is null
    or coalesce(p.revision,0) is distinct from p_planning_revision then
    raise exception 'CUSTOMER_OFFER_STALE';
  end if;
  if exists(select 1 from public.action_case_customer_offers
    where action_case_id=p_case_id and org_id=p_org_id and status in ('published','accepted')) then
    raise exception 'CUSTOMER_OFFER_WITHDRAW_FIRST';
  end if;
  if exists(select 1 from jsonb_array_elements(d.body->'items') i
    join jsonb_array_elements(coalesce(p.items,'[]')) j on i->>'id'=j->>'id'
    where i->>'kind'='option') then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i->>'id','title',i->>'title','scope',i->>'scope','status','planned',
    'budgetOre',i->'amountOre','decisionBy','','optionGroup',coalesce(i->>'optionGroup','')
  ) order by n),'[]') into choices
    from jsonb_array_elements(d.body->'items') with ordinality a(i,n) where i->>'kind'='option';
  if jsonb_array_length(choices)=0 then return; end if;
  select coalesce(jsonb_agg(i order by n),'[]') into remaining
    from jsonb_array_elements(d.body->'items') with ordinality a(i,n) where i->>'kind'<>'option';
  select coalesce(jsonb_object_agg(key,value),'{}') into costs from jsonb_each(d.internal_costing)
    where exists(select 1 from jsonb_array_elements(choices) i where i->>'id'=key);
  select coalesce(jsonb_object_agg(key,value),'{}') into remaining_costs from jsonb_each(d.internal_costing)
    where exists(select 1 from jsonb_array_elements(remaining) i where i->>'id'=key);
  perform public.save_customer_contract_costing(p_org_id,p_case_id,p_user_id,
    jsonb_build_object('revision',p_revision,'body',jsonb_set(d.body,'{items}',remaining),'costing',remaining_costs));
  perform public.save_customer_planning_costing(p_org_id,p_case_id,p_user_id,
    jsonb_build_object('revision',p_planning_revision,'items',coalesce(p.items,'[]')||choices,
      'costing',coalesce(p.internal_costing,'{}')||costs));
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'customer_choices_separated','Val flyttade från avtalsutkast till separat planering',p_user_id);
end $$;

revoke all on function public.write_customer_contract(uuid,uuid,uuid,text,jsonb),
  public.save_customer_contract_costing(uuid,uuid,uuid,jsonb),
  public.write_action_case_contract_parties(uuid,uuid,uuid,text,jsonb),
  public.write_action_case_contract_property(uuid,uuid,uuid,text,jsonb),
  public.separate_independent_contract_choices(uuid,uuid,uuid,integer,integer),
  public.guard_customer_contract_revision(), public.guard_independent_contract_draft(),
  public.guard_independent_offer_property()
from public,anon,authenticated;
grant execute on function public.write_customer_contract(uuid,uuid,uuid,text,jsonb),
  public.save_customer_contract_costing(uuid,uuid,uuid,jsonb),
  public.write_action_case_contract_parties(uuid,uuid,uuid,text,jsonb),
  public.write_action_case_contract_property(uuid,uuid,uuid,text,jsonb),
  public.separate_independent_contract_choices(uuid,uuid,uuid,integer,integer)
to service_role;
comment on table public.action_case_customer_contract_drafts is
  'Independent editable agreement. Project work and offer writes never update this table. Acceptance locks it.';
notify pgrst, 'reload schema';
commit;

