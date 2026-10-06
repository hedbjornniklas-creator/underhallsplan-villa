-- Gizmo: use the shared HusHub customer register for contract buyers.
-- Prerequisites: organization_customers, action_cases, customer offers and internal costing.
begin;

alter table public.action_cases
  add column if not exists organization_customer_id uuid,
  add column if not exists customer_link_request_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.action_cases'::regclass
    and conname = 'action_cases_org_customer_fk') then
    alter table public.action_cases add constraint action_cases_org_customer_fk
      foreign key (org_id, organization_customer_id) references public.organization_customers (org_id, id);
  end if;
end $$;
create index if not exists action_cases_org_customer_idx
  on public.action_cases (org_id, organization_customer_id) where organization_customer_id is not null;
comment on column public.action_cases.organization_customer_id is
  'Explicit link to the shared organization-local HusHub customer. Contract versions retain their own snapshots.';

create or replace function public.action_cases_protect_customer_link()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'INSERT' then
      if new.organization_customer_id is not null or new.customer_link_request_id is not null then
        raise exception 'CUSTOMER_REGISTRY_FORBIDDEN';
      end if;
    elsif new.organization_customer_id is distinct from old.organization_customer_id
      or new.customer_link_request_id is distinct from old.customer_link_request_id then
      raise exception 'CUSTOMER_REGISTRY_FORBIDDEN';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_action_cases_protect_customer_link on public.action_cases;
create trigger trg_action_cases_protect_customer_link before insert or update on public.action_cases
  for each row execute function public.action_cases_protect_customer_link();

create or replace function public.write_action_case_contract_customer(
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
  select revision into saved_revision from public.action_case_customer_offer_drafts
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
    perform public.save_customer_offer_costing(p_org_id, p_case_id, p_user_id, p_data || jsonb_build_object('body', body));
  else
    perform public.write_customer_offer(p_org_id, p_case_id, p_user_id, 'save', p_data || jsonb_build_object('body', body));
  end if;
  insert into public.action_case_events (org_id, action_case_id, event_type, message, performed_by)
    values (p_org_id, p_case_id, 'contract_customer_saved', case when p_mode = 'create' then 'Ny kund skapad och kopplad'
      when p_mode = 'existing' then 'Befintlig kund kopplad' else 'Avtalets kontaktuppgifter sparade' end, p_user_id);
  return '{}'::jsonb;
end $$;
revoke all on function public.write_action_case_contract_customer(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_action_case_contract_customer(uuid, uuid, uuid, text, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
