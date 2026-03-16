-- Assignments: add ordered status and set accept transition to ordered
-- Date: 2026-03-16
-- Prerequisites:
--  - 2026-03-16_01_assignments_accept_addon_conflict_target_fix.sql

create extension if not exists pgcrypto;

alter table public.assignments
  drop constraint if exists assignments_status_check;

alter table public.assignments
  add constraint assignments_status_check
  check (status in ('draft', 'sent', 'ordered', 'booked', 'completed', 'expired', 'cancelled'));

alter table public.assignments
  drop constraint if exists assignments_booked_requires_accept_check;

alter table public.assignments
  add constraint assignments_booked_requires_accept_check
  check (status not in ('ordered', 'booked') or accepted_at is not null);
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
set search_path = public, extensions, pg_catalog
as $$
declare
  v_token_hash text;
  v_assignment_id uuid;
  v_org_id uuid;
  v_link_terms_version text;
  v_terms_document_hash text;
  v_now timestamptz := now();
  v_preferred_date date;
  v_preferred_time time;
  v_price_amount numeric(12, 2);
  v_currency text;
  v_responsible_profile_id uuid;
  v_selected_addon_ids uuid[] := array[]::uuid[];
  v_has_invalid_addon_id boolean := false;
  v_selected_addon_count integer := 0;
  v_allowed_selected_count integer := 0;
begin
  if p_token is null or char_length(trim(p_token)) < 20 then
    raise exception 'invalid_token';
  end if;

  if p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'missing_terms_version';
  end if;

  v_terms_document_hash := lower(btrim(coalesce((p_payload ->> 'terms_document_hash'), '')));
  if v_terms_document_hash = '' then
    raise exception 'missing_terms_document_hash';
  end if;

  if v_terms_document_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_terms_document_hash';
  end if;

  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  select l.assignment_id, l.org_id, l.terms_version
    into v_assignment_id, v_org_id, v_link_terms_version
  from public.assignment_links l
  where l.token_hash = v_token_hash
    and l.used_at is null
    and l.revoked_at is null
    and l.expires_at > v_now
  for update of l;

  if v_assignment_id is null then
    raise exception 'token_not_valid_or_expired';
  end if;

  if v_link_terms_version is null or btrim(v_link_terms_version) = '' then
    raise exception 'terms_version_required_for_link';
  end if;

  if v_link_terms_version <> p_terms_version then
    raise exception 'terms_version_mismatch';
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

  if p_payload ? 'addon_service_ids' then
    if jsonb_typeof(coalesce(p_payload -> 'addon_service_ids', 'null'::jsonb)) <> 'array' then
      raise exception 'invalid_addon_service_ids';
    end if;

    with raw as (
      select btrim(value) as raw_value
      from jsonb_array_elements_text(coalesce(p_payload -> 'addon_service_ids', '[]'::jsonb)) t(value)
    ),
    parsed as (
      select
        raw_value,
        case
          when raw_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then raw_value::uuid
          else null
        end as addon_id
      from raw
      where raw_value <> ''
    )
    select
      coalesce(array_agg(distinct addon_id) filter (where addon_id is not null), array[]::uuid[]),
      coalesce(bool_or(addon_id is null), false)
      into v_selected_addon_ids, v_has_invalid_addon_id
    from parsed;

    if v_has_invalid_addon_id then
      raise exception 'invalid_addon_service_ids';
    end if;
  end if;

  v_selected_addon_count := coalesce(array_length(v_selected_addon_ids, 1), 0);

  select a.responsible_profile_id
    into v_responsible_profile_id
  from public.assignments a
  where a.id = v_assignment_id
    and a.org_id = v_org_id
  limit 1;

  if v_selected_addon_count > 0 then
    if v_responsible_profile_id is null then
      raise exception 'responsible_profile_missing';
    end if;

    select count(*)::integer
      into v_allowed_selected_count
    from (
      select distinct s.id
      from public.settings_addon_services s
      join public.profile_addon_services pas
        on pas.addon_service_id = s.id
       and pas.org_id = v_org_id
       and pas.profile_id = v_responsible_profile_id
       and pas.is_enabled = true
      where s.is_active = true
        and s.id = any(v_selected_addon_ids)
    ) allowed;

    if v_allowed_selected_count <> v_selected_addon_count then
      raise exception 'invalid_selected_addon_services';
    end if;
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

  update public.assignments a
  set
    customer_name = coalesce(nullif(trim((p_payload ->> 'customer_name')), ''), a.customer_name),
    customer_email = coalesce(nullif(lower(trim((p_payload ->> 'customer_email'))), ''), a.customer_email),
    customer_phone = coalesce(nullif(trim((p_payload ->> 'customer_phone')), ''), a.customer_phone),
    customer_address = coalesce(nullif(trim((p_payload ->> 'customer_address')), ''), a.customer_address),
    property_address = coalesce(nullif(trim((p_payload ->> 'property_address')), ''), a.property_address),
    property_postal_code = coalesce(nullif(trim((p_payload ->> 'property_postal_code')), ''), a.property_postal_code),
    property_city = coalesce(nullif(trim((p_payload ->> 'property_city')), ''), a.property_city),
    property_municipality = coalesce(
      nullif(trim((p_payload ->> 'property_municipality')), ''),
      a.property_municipality
    ),
    property_owner_name = coalesce(
      nullif(trim((p_payload ->> 'property_owner_name')), ''),
      a.property_owner_name
    ),
    cadastral_id = coalesce(nullif(trim((p_payload ->> 'cadastral_id')), ''), a.cadastral_id),
    preferred_date = coalesce(v_preferred_date, a.preferred_date),
    preferred_time = coalesce(v_preferred_time, a.preferred_time),
    price_amount = coalesce(v_price_amount, a.price_amount),
    currency = coalesce(v_currency, a.currency),
    invoice_name = coalesce(nullif(trim((p_payload ->> 'invoice_name')), ''), a.invoice_name),
    invoice_address = coalesce(nullif(trim((p_payload ->> 'invoice_address')), ''), a.invoice_address),
    orderer_role = coalesce(nullif(trim((p_payload ->> 'orderer_role')), ''), a.orderer_role),
    personal_identity_number = coalesce(
      nullif(trim((p_payload ->> 'personal_identity_number')), ''),
      a.personal_identity_number
    ),
    accepted_at = v_now,
    accepted_via_ip = p_ip,
    accepted_user_agent = p_user_agent,
    terms_version = p_terms_version,
    terms_document_hash = v_terms_document_hash,
    status = case when a.status = 'completed' then a.status else 'ordered' end
  where a.id = v_assignment_id;

  delete from public.assignment_addon_orders ao
  where ao.assignment_id = v_assignment_id;

  if v_selected_addon_count > 0 then
    insert into public.assignment_addon_orders (
      assignment_id,
      org_id,
      addon_service_id,
      addon_key,
      addon_name_snapshot,
      price_amount_snapshot,
      currency_snapshot,
      created_at
    )
    select
      v_assignment_id,
      v_org_id,
      s.id,
      s.key,
      s.name,
      coalesce(pas.price_amount, 0)::numeric(12, 2),
      upper(coalesce(nullif(btrim(pas.currency), ''), 'SEK')),
      v_now
    from public.settings_addon_services s
    join public.profile_addon_services pas
      on pas.addon_service_id = s.id
     and pas.org_id = v_org_id
     and pas.profile_id = v_responsible_profile_id
     and pas.is_enabled = true
    where s.is_active = true
      and s.id = any(v_selected_addon_ids)
    on conflict on constraint assignment_addon_orders_unique_per_assignment do update
    set
      addon_service_id = excluded.addon_service_id,
      addon_name_snapshot = excluded.addon_name_snapshot,
      price_amount_snapshot = excluded.price_amount_snapshot,
      currency_snapshot = excluded.currency_snapshot,
      created_at = excluded.created_at;
  end if;

  insert into public.assignment_acceptances (
    assignment_id,
    assignment_link_id,
    org_id,
    accepted_at,
    terms_version,
    terms_document_hash,
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
    v_terms_document_hash,
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

