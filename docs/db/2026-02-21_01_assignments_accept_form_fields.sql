-- Assignments accept form fields (public confirmation v2)
-- Date: 2026-02-21
-- Prerequisites:
--  - 2026-02-20_02_assignments_core.sql
--  - 2026-02-20_04_assignments_accept_functions.sql

alter table public.assignments
  add column if not exists customer_address text,
  add column if not exists property_municipality text,
  add column if not exists property_owner_name text;

create extension if not exists pgcrypto;

create or replace function public.consume_assignment_token(
  p_token text,
  p_terms_version text,
  p_payload jsonb default '{}'::jsonb,
  p_ip inet default null,
  p_user_agent text default null
)
returns table (
  assignment_id uuid,
  org_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text;
  v_assignment_id uuid;
  v_org_id uuid;
  v_now timestamptz := now();
  v_preferred_date date;
  v_preferred_time time;
  v_price_amount numeric(12, 2);
  v_currency text;
begin
  if p_token is null or char_length(trim(p_token)) < 20 then
    raise exception 'invalid_token';
  end if;

  if p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'missing_terms_version';
  end if;

  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  select l.assignment_id, l.org_id
    into v_assignment_id, v_org_id
  from public.assignment_links l
  where l.token_hash = v_token_hash
    and l.used_at is null
    and l.revoked_at is null
    and l.expires_at > v_now
  for update of l;

  if v_assignment_id is null then
    raise exception 'token_not_valid_or_expired';
  end if;

  update public.assignment_links
  set used_at = v_now
  where token_hash = v_token_hash
    and used_at is null
    and revoked_at is null
    and expires_at > v_now;

  if not found then
    raise exception 'token_already_used';
  end if;

  v_preferred_date := case
    when btrim(coalesce((p_payload ->> 'preferred_date'), '')) ~ '^\d{4}-\d{2}-\d{2}$'
      then (p_payload ->> 'preferred_date')::date
    else null
  end;

  v_preferred_time := case
    when btrim(coalesce((p_payload ->> 'preferred_time'), '')) ~ '^\d{2}:\d{2}(:\d{2})?$'
      then (p_payload ->> 'preferred_time')::time
    else null
  end;

  v_price_amount := case
    when btrim(coalesce((p_payload ->> 'price_amount'), '')) ~ '^\d+([.,]\d{1,2})?$'
      then replace(btrim((p_payload ->> 'price_amount')), ',', '.')::numeric(12, 2)
    else null
  end;

  v_currency := case
    when char_length(btrim(coalesce((p_payload ->> 'currency'), ''))) = 3
      then upper(btrim((p_payload ->> 'currency')))
    else null
  end;

  update public.assignments
  set
    customer_name = coalesce(nullif(trim((p_payload ->> 'customer_name')), ''), customer_name),
    customer_email = coalesce(nullif(lower(trim((p_payload ->> 'customer_email'))), ''), customer_email),
    customer_phone = coalesce(nullif(trim((p_payload ->> 'customer_phone')), ''), customer_phone),
    customer_address = coalesce(nullif(trim((p_payload ->> 'customer_address')), ''), customer_address),
    property_address = coalesce(nullif(trim((p_payload ->> 'property_address')), ''), property_address),
    property_postal_code = coalesce(nullif(trim((p_payload ->> 'property_postal_code')), ''), property_postal_code),
    property_city = coalesce(nullif(trim((p_payload ->> 'property_city')), ''), property_city),
    property_municipality = coalesce(
      nullif(trim((p_payload ->> 'property_municipality')), ''),
      property_municipality
    ),
    property_owner_name = coalesce(
      nullif(trim((p_payload ->> 'property_owner_name')), ''),
      property_owner_name
    ),
    cadastral_id = coalesce(nullif(trim((p_payload ->> 'cadastral_id')), ''), cadastral_id),
    preferred_date = coalesce(v_preferred_date, preferred_date),
    preferred_time = coalesce(v_preferred_time, preferred_time),
    price_amount = coalesce(v_price_amount, price_amount),
    currency = coalesce(v_currency, currency),
    invoice_name = coalesce(nullif(trim((p_payload ->> 'invoice_name')), ''), invoice_name),
    invoice_address = coalesce(nullif(trim((p_payload ->> 'invoice_address')), ''), invoice_address),
    orderer_role = coalesce(nullif(trim((p_payload ->> 'orderer_role')), ''), orderer_role),
    personal_identity_number = coalesce(
      nullif(trim((p_payload ->> 'personal_identity_number')), ''),
      personal_identity_number
    ),
    accepted_at = v_now,
    accepted_via_ip = p_ip,
    accepted_user_agent = p_user_agent,
    terms_version = p_terms_version,
    status = case when status = 'completed' then status else 'booked' end
  where id = v_assignment_id;

  insert into public.assignment_acceptances (
    assignment_id,
    assignment_link_id,
    org_id,
    accepted_at,
    terms_version,
    ip_address,
    user_agent,
    payload
  )
  select
    l.assignment_id,
    l.id,
    l.org_id,
    v_now,
    p_terms_version,
    p_ip,
    p_user_agent,
    p_payload
  from public.assignment_links l
  where l.token_hash = v_token_hash
  limit 1;

  return query
  select a.id, a.org_id, a.status
  from public.assignments a
  where a.id = v_assignment_id;
end;
$$;

revoke all on function public.consume_assignment_token(text, text, jsonb, inet, text) from public;
grant execute on function public.consume_assignment_token(text, text, jsonb, inet, text) to service_role;
