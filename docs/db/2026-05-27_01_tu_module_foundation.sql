-- Technical investigations module foundation
-- Date: 2026-05-27
-- Scope:
-- 1) Add standalone Dashboard access module for technical investigations
-- 2) Allow TU assignments and TU inspections
-- 3) Add assignment scope text used in TU assignment confirmations
-- 4) Add TU investigation detail and image tables
-- 5) Update public assignment acceptance function to persist TU fields

create extension if not exists pgcrypto;

insert into public.platform_modules (product_id, key, label, description, is_active, sort_order)
select
  p.id,
  'technical_investigations',
  'Tekniska utredningar',
  'Fristående modul för tekniska utredningar och skadeutredningar.',
  true,
  275
from public.platform_products p
where p.key = 'dashboard'
on conflict (product_id, key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

with target_profiles as (
  select distinct paa.profile_id
  from public.platform_access_assignments paa
  join public.platform_products hp on hp.id = paa.product_id and hp.key = 'hushub_admin'
  join public.platform_modules hm on hm.id = paa.module_id and hm.key = 'access_management'
  join public.platform_roles hr on hr.id = paa.role_id and hr.key = 'hushub_superadmin'
  where paa.is_active = true
    and (paa.expires_at is null or paa.expires_at > now())

  union

  select p.id
  from public.profiles p
  where coalesce(p.is_admin, false) = true
),
target_assignment as (
  select
    tp.profile_id,
    dp.id as product_id,
    tm.id as module_id,
    ir.id as role_id
  from target_profiles tp
  join public.platform_products dp on dp.key = 'dashboard'
  join public.platform_modules tm
    on tm.product_id = dp.id
   and tm.key = 'technical_investigations'
  join public.platform_roles ir
    on ir.product_id = dp.id
   and ir.key = 'inspector'
),
reactivated as (
  update public.platform_access_assignments paa
  set
    is_active = true,
    granted_reason = coalesce(paa.granted_reason, 'Bootstrap TU access for access admins.'),
    source_system = coalesce(paa.source_system, 'tu_module_bootstrap'),
    updated_at = now()
  from target_assignment ta
  where paa.profile_id = ta.profile_id
    and paa.product_id = ta.product_id
    and paa.module_id = ta.module_id
    and paa.role_id = ta.role_id
    and paa.scope_type = 'global'
    and paa.scope_id is null
  returning paa.id
)
insert into public.platform_access_assignments (
  profile_id,
  product_id,
  module_id,
  role_id,
  scope_type,
  scope_id,
  is_active,
  granted_by_profile_id,
  granted_reason,
  source_system
)
select
  ta.profile_id,
  ta.product_id,
  ta.module_id,
  ta.role_id,
  'global',
  null,
  true,
  ta.profile_id,
  'Bootstrap TU access for access admins.',
  'tu_module_bootstrap'
from target_assignment ta
where not exists (
  select 1
  from public.platform_access_assignments paa
  where paa.profile_id = ta.profile_id
    and paa.product_id = ta.product_id
    and paa.module_id = ta.module_id
    and paa.role_id = ta.role_id
    and paa.scope_type = 'global'
    and paa.scope_id is null
);

alter table public.assignments
  add column if not exists scope_description text;

alter table public.assignments
  drop constraint if exists assignments_type_check;

alter table public.assignments
  add constraint assignments_type_check
  check (assignment_type in ('OB', 'STATUS', 'UHP', 'EB', 'TU'));

alter table public.inspections
  drop constraint if exists inspections_family_check;

alter table public.inspections
  add constraint inspections_family_check
  check (inspection_family in ('OB', 'EB', 'UHP', 'TU'));

create table if not exists public.technical_investigation_details (
  inspection_id uuid primary key references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  property_id uuid references public.properties (id) on delete set null,
  title text not null default 'Teknisk utredning',
  scope_description text,
  background text,
  basis text,
  accessibility text,
  report_draft jsonb not null default '{}'::jsonb,
  report_draft_updated_at timestamptz,
  report_locked_at timestamptz,
  report_locked_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technical_investigation_details_title_check check (btrim(title) <> '')
);

create index if not exists technical_investigation_details_org_idx
  on public.technical_investigation_details (org_id, updated_at desc);

create index if not exists technical_investigation_details_assignment_idx
  on public.technical_investigation_details (assignment_id)
  where assignment_id is not null;

create index if not exists technical_investigation_details_report_draft_gin_idx
  on public.technical_investigation_details using gin (report_draft);

create table if not exists public.technical_investigation_images (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  section_key text,
  storage_bucket text not null default 'inspection-images',
  file_path text not null,
  caption text,
  sort_order integer not null default 100,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technical_investigation_images_file_path_check check (btrim(file_path) <> '')
);

create index if not exists technical_investigation_images_inspection_idx
  on public.technical_investigation_images (inspection_id, sort_order, created_at);

create index if not exists technical_investigation_images_org_idx
  on public.technical_investigation_images (org_id, created_at desc);

create or replace function public.technical_investigations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_technical_investigation_details_set_updated_at
  on public.technical_investigation_details;
create trigger trg_technical_investigation_details_set_updated_at
before update on public.technical_investigation_details
for each row
execute function public.technical_investigations_set_updated_at();

drop trigger if exists trg_technical_investigation_images_set_updated_at
  on public.technical_investigation_images;
create trigger trg_technical_investigation_images_set_updated_at
before update on public.technical_investigation_images
for each row
execute function public.technical_investigations_set_updated_at();

alter table public.technical_investigation_details enable row level security;
alter table public.technical_investigation_images enable row level security;

grant select, insert, update, delete on table
  public.technical_investigation_details,
  public.technical_investigation_images
to authenticated;

drop policy if exists technical_investigation_details_member_all
  on public.technical_investigation_details;
create policy technical_investigation_details_member_all
  on public.technical_investigation_details
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists technical_investigation_images_member_all
  on public.technical_investigation_images;
create policy technical_investigation_images_member_all
  on public.technical_investigation_images
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

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
    customer_postal_code = coalesce(
      nullif(trim((p_payload ->> 'customer_postal_code')), ''),
      a.customer_postal_code
    ),
    customer_city = coalesce(nullif(trim((p_payload ->> 'customer_city')), ''), a.customer_city),
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
    brf_name = coalesce(nullif(trim((p_payload ->> 'brf_name')), ''), a.brf_name),
    apartment_number = coalesce(nullif(trim((p_payload ->> 'apartment_number')), ''), a.apartment_number),
    apartment_holder_name = coalesce(
      nullif(trim((p_payload ->> 'apartment_holder_name')), ''),
      a.apartment_holder_name
    ),
    scope_description = coalesce(
      nullif(trim((p_payload ->> 'scope_description')), ''),
      a.scope_description
    ),
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
