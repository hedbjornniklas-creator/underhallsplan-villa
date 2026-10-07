-- Gizmo: independent invoice customer; never changes contract parties or portal access.
-- Requires organization_customers and action_cases. Run after the existing migrations.
begin;
set local lock_timeout = '10s';

create table if not exists public.action_case_billing (
  action_case_id uuid primary key references public.action_cases(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  revision bigint not null default 0 check (revision >= 0),
  request_id uuid,
  request_fingerprint text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  foreign key (org_id, customer_id) references public.organization_customers(org_id, id)
);
comment on table public.action_case_billing is
  'Private project invoice-customer link. Independent of contractual buyers, offer snapshots and customer access.';
alter table public.action_case_billing enable row level security;
revoke all on public.action_case_billing from public, anon, authenticated;
grant all on public.action_case_billing to service_role;

create or replace function public.write_action_case_billing(
  p_org_id uuid, p_case_id uuid, p_user_id uuid, p_mode text, p_data jsonb
) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor_role text;
  billing public.action_case_billing%rowtype;
  customer public.organization_customers%rowtype;
  input jsonb := p_data->'customer';
  requested_id uuid := (p_data->>'requestId')::uuid;
  fingerprint text := md5(p_mode || p_data::text);
begin
  if p_mode is null or p_mode not in ('existing', 'create', 'update') or p_user_id is null
    or requested_id is null or jsonb_typeof(p_data->'revision') is distinct from 'number'
    or (p_data->>'revision')::bigint < 0 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  select role into actor_role from public.org_members
    where org_id = p_org_id and profile_id = p_user_id and is_active = true;
  if not found or (p_mode <> 'existing' and actor_role <> 'admin') then raise exception 'CUSTOMER_REGISTRY_FORBIDDEN'; end if;
  perform 1 from public.action_cases where id = p_case_id and org_id = p_org_id for key share;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  insert into public.action_case_billing(action_case_id, org_id) values(p_case_id, p_org_id)
    on conflict(action_case_id) do nothing;
  select * into billing from public.action_case_billing where action_case_id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'CUSTOMER_REGISTRY_FORBIDDEN'; end if;
  -- Retry the identical request before checking versions; an uncertain response must not create a second customer.
  if billing.request_id = requested_id then
    if billing.request_fingerprint is distinct from fingerprint then raise exception 'PROJECT_BILLING_STALE'; end if;
    return;
  end if;
  if billing.revision is distinct from (p_data->>'revision')::bigint then raise exception 'PROJECT_BILLING_STALE'; end if;
  if p_mode <> 'create' then
    select * into customer from public.organization_customers
      where org_id = p_org_id and id = (p_data->>'customerId')::uuid for update;
    if not found or not customer.is_active or customer.version is distinct from (p_data->>'customerVersion')::bigint
      then raise exception 'PROJECT_BILLING_CUSTOMER'; end if;
    if p_mode = 'update' and billing.customer_id is distinct from customer.id then raise exception 'PROJECT_BILLING_CUSTOMER'; end if;
  end if;
  if p_mode in ('create', 'update') then
    if jsonb_typeof(input) is distinct from 'object' or input->>'customerType' is null or input->>'customerType' not in ('private', 'business')
      or nullif(btrim(input->>'name'), '') is null or jsonb_typeof(input->'invoiceSameAsCustomer') is distinct from 'boolean'
      then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_mode = 'create' then
      insert into public.organization_customers(org_id, customer_type, name, organization_number, personal_identity_number,
        email, phone, address, address_line_2, postal_code, city, country_code, invoice_same_as_customer,
        invoice_name, invoice_email, invoice_address, invoice_address_line_2, invoice_postal_code, invoice_city,
        invoice_country_code, invoice_reference, created_by_profile_id, updated_by_profile_id)
      values(p_org_id, input->>'customerType', input->>'name',
        case when input->>'customerType' = 'business' then input->>'identityNumber' end,
        case when input->>'customerType' = 'private' then input->>'identityNumber' end,
        input->>'email', input->>'phone', input->>'address', input->>'addressLine2', input->>'postalCode', input->>'city',
        input->>'countryCode', (input->>'invoiceSameAsCustomer')::boolean, input->>'invoiceName', input->>'invoiceEmail',
        input->>'invoiceAddress', input->>'invoiceAddressLine2', input->>'invoicePostalCode', input->>'invoiceCity',
        input->>'invoiceCountryCode', input->>'invoiceReference', p_user_id, p_user_id) returning * into customer;
    else
      update public.organization_customers set customer_type = input->>'customerType', name = input->>'name',
        organization_number = case when input->>'customerType' = 'business' then input->>'identityNumber' end,
        personal_identity_number = case when input->>'customerType' = 'private' then input->>'identityNumber' end,
        email = input->>'email', phone = input->>'phone', address = input->>'address', address_line_2 = input->>'addressLine2',
        postal_code = input->>'postalCode', city = input->>'city', country_code = input->>'countryCode',
        invoice_same_as_customer = (input->>'invoiceSameAsCustomer')::boolean, invoice_name = input->>'invoiceName',
        invoice_email = input->>'invoiceEmail', invoice_address = input->>'invoiceAddress', invoice_address_line_2 = input->>'invoiceAddressLine2',
        invoice_postal_code = input->>'invoicePostalCode', invoice_city = input->>'invoiceCity', invoice_country_code = input->>'invoiceCountryCode',
        invoice_reference = input->>'invoiceReference', updated_by_profile_id = p_user_id
        where id = customer.id and org_id = p_org_id;
    end if;
  end if;
  update public.action_case_billing set customer_id = customer.id, revision = revision + 1,
    request_id = requested_id, request_fingerprint = fingerprint,
    updated_at = clock_timestamp(), updated_by = p_user_id where action_case_id = p_case_id and org_id = p_org_id;
  insert into public.action_case_events(org_id, action_case_id, event_type, message, performed_by)
    values(p_org_id, p_case_id, 'billing_customer_saved', 'Fakturakund ' || customer.customer_number || ' sparad', p_user_id);
end $$;
revoke all on function public.write_action_case_billing(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_action_case_billing(uuid, uuid, uuid, text, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
