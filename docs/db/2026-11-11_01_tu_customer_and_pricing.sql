begin;

alter table public.technical_investigation_details
  add column if not exists customer_details jsonb;

-- New investigations inherit the contracting party, never the object's BRF.
create or replace function public.tu_initialize_customer_details()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_details is null and new.assignment_id is not null then
    select a.assignment_details -> 'tuCustomer' into new.customer_details
    from public.assignments a
    where a.id = new.assignment_id and a.org_id = new.org_id and a.assignment_type = 'TU';
  end if;
  return new;
end;
$$;
drop trigger if exists tu_initialize_customer_details on public.technical_investigation_details;
create trigger tu_initialize_customer_details
before insert on public.technical_investigation_details
for each row execute function public.tu_initialize_customer_details();

-- Runs inside consume_assignment_token's transaction. No historical backfill:
-- locked reports, older acceptances and other modules remain unchanged.
create or replace function public.tu_accept_customer_details()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_assignment public.assignments%rowtype;
  v_customer jsonb;
begin
  select * into v_assignment from public.assignments
  where id = new.assignment_id and org_id = new.org_id for update;
  if v_assignment.assignment_type is distinct from 'TU'
     or v_assignment.assignment_details -> 'tuCustomer' ->> 'version' is distinct from '1' then
    return new;
  end if;
  v_customer := new.payload -> 'assignment_details' -> 'tuCustomer';
  if v_customer ->> 'version' is distinct from '1'
     or v_customer ->> 'kind' is distinct from v_assignment.assignment_details -> 'tuCustomer' ->> 'kind'
     or v_customer ->> 'kind' not in ('consumer', 'business', 'association') then
    raise exception 'tu_customer_acceptance_invalid';
  end if;
  if v_customer ->> 'kind' <> 'consumer' and (
    coalesce(v_customer ->> 'contactName', '') = ''
    or coalesce(v_customer ->> 'identityNumber', '') !~ '^[0-9]{6}[- ]?[0-9]{4}$'
    or new.payload -> 'assignment_details' ->> 'representativeConfirmed' is distinct from 'true'
  ) then
    raise exception 'tu_customer_acceptance_invalid';
  end if;
  -- Price and legal category are issued by the inspector, not the public form.
  if new.payload -> 'assignment_details' -> 'tuPricing'
       is distinct from v_assignment.assignment_details -> 'tuPricing' then
    raise exception 'tu_pricing_acceptance_invalid';
  end if;
  update public.assignments set
    assignment_details = jsonb_set(coalesce(assignment_details, '{}'::jsonb), '{tuCustomer}', v_customer),
    personal_identity_number = nullif(v_customer ->> 'identityNumber', ''),
    invoice_name = nullif(v_customer ->> 'invoiceName', ''),
    invoice_address = nullif(v_customer ->> 'invoiceAddress', ''),
    invoice_email = nullif(new.payload ->> 'invoice_email', '')
  where id = new.assignment_id and org_id = new.org_id;
  return new;
end;
$$;
drop trigger if exists tu_accept_customer_details on public.assignment_acceptances;
create trigger tu_accept_customer_details
before insert on public.assignment_acceptances
for each row execute function public.tu_accept_customer_details();

revoke all on function public.tu_initialize_customer_details() from public;
revoke all on function public.tu_accept_customer_details() from public;

create or replace function public.tu_guard_customer_kind()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.assignment_type = 'TU' and new.assignment_details -> 'tuCustomer' ->> 'version' = '1'
     and new.assignment_details ->> 'customerType' is distinct from
       (case when new.assignment_details -> 'tuCustomer' ->> 'kind' = 'consumer' then 'consumer' else 'business' end) then
    raise exception 'tu_customer_kind_conflict';
  end if;
  return new;
end;
$$;
drop trigger if exists tu_guard_customer_kind on public.assignments;
create trigger tu_guard_customer_kind before insert or update of assignment_details on public.assignments
for each row execute function public.tu_guard_customer_kind();
revoke all on function public.tu_guard_customer_kind() from public;

-- Preserve the exact snapshot shape of legacy workflows.
create or replace function public.tu_customer_comparison(p_customer jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when p_customer ->> 'version' = '1' then jsonb_build_object(
    'tu_customer_kind', case p_customer ->> 'kind' when 'consumer' then 'Privatperson' when 'business' then 'Företag' else 'Förening' end,
    'tu_contact_name', p_customer ->> 'contactName', 'tu_contact_role', p_customer ->> 'contactRole',
    'tu_identity_number', p_customer ->> 'identityNumber', 'tu_invoice_reference', p_customer ->> 'invoiceReference'
  ) else '{}'::jsonb end;
$$;
create or replace function public.tu_assignment_snapshot(p_assignment_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select public.ob_assignment_snapshot(p_assignment_id) ||
    public.tu_customer_comparison(a.assignment_details -> 'tuCustomer') ||
    case when a.assignment_details -> 'tuPricing' ->> 'version' = '1' then jsonb_build_object(
      'tu_price_net', a.assignment_details -> 'tuPricing' -> 'net',
      'tu_price_vat', a.assignment_details -> 'tuPricing' -> 'vat',
      'tu_vat_rate', a.assignment_details -> 'tuPricing' -> 'vatRate',
      'tu_price_gross', a.assignment_details -> 'tuPricing' -> 'gross'
    ) else '{}'::jsonb end
  from public.assignments a where a.id = p_assignment_id;
$$;
create or replace function public.tu_assignment_inspection_snapshot(p_inspection_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'customer_name', i.customer_name, 'customer_email', i.customer_email, 'customer_phone', i.customer_phone,
    'customer_address', i.customer_address, 'customer_postal_code', i.customer_postal_code, 'customer_city', i.customer_city,
    'property_address', p.address, 'property_postal_code', p.postal_code, 'property_city', p.city,
    'property_municipality', p.municipality, 'property_owner_name', p.owner_name, 'cadastral_id', p.cadastral_id,
    'brf_name', d.brf_name, 'apartment_number', d.apartment_number, 'apartment_holder_name', d.apartment_holder_name,
    'preferred_date', i.date, 'preferred_time', i.inspection_time, 'scope_description', d.scope_description,
    'reportVersion', md5(coalesce(d.report_draft::text, ''))) || public.tu_customer_comparison(d.customer_details)
  from public.technical_investigation_details d join public.inspections i on i.id = d.inspection_id
    join public.properties p on p.id = i.property_id where i.id = p_inspection_id;
$$;
revoke all on function public.tu_customer_comparison(jsonb), public.tu_assignment_snapshot(uuid),
  public.tu_assignment_inspection_snapshot(uuid) from public, anon, authenticated;

commit;
