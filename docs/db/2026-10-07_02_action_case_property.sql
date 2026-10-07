-- Gizmo: structured ABS 18 property details, linked to the existing HusHub properties register.
-- No legacy properties, drafts, inspections or frozen agreements are rewritten or merged.
-- Requires properties, action_cases, customer offers, internal costing and contract-details migrations.
begin;
set local lock_timeout = '10s';

alter table public.action_cases
  add column if not exists property_id uuid references public.properties(id) on delete restrict,
  add column if not exists property_link_request_id uuid,
  add column if not exists property_link_fingerprint text;
create index if not exists action_cases_property_idx on public.action_cases(org_id, property_id) where property_id is not null;
comment on column public.action_cases.property_id is
  'Shared HusHub properties UUID. Explicit connection; designation and municipality identify candidates, not access rights.';

create or replace function public.property_identity_key(p_municipality text, p_designation text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case when nullif(btrim(regexp_replace(p_municipality, '[[:space:]]+', ' ', 'g')), '') is null
    or nullif(regexp_replace(p_designation, '[[:space:]]+', '', 'g'), '') is null then null
    else lower(btrim(regexp_replace(p_municipality, '[[:space:]]+', ' ', 'g'))) || '|' ||
      lower(regexp_replace(p_designation, '[[:space:]]+', '', 'g')) end
$$;

create or replace function public.property_record_details(p public.properties)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select jsonb_build_object('municipality', btrim(coalesce(p.municipality,'')), 'cadastralDesignation', btrim(coalesce(p.cadastral_id,'')),
    'street', btrim(coalesce(p.address,'')), 'postalCode', btrim(coalesce(p.postal_code,'')), 'city', btrim(coalesce(p.city,'')))
$$;
revoke all on function public.property_record_details(public.properties) from public, anon, authenticated;
grant execute on function public.property_record_details(public.properties) to service_role;

create or replace function public.action_case_property_access(p_org_id uuid, p_user_id uuid, p_property_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.properties p where p.id = p_property_id and
    (p.owner = p_user_id or exists(select 1 from public.action_cases c where c.org_id = p_org_id and c.property_id = p.id)))
$$;
revoke all on function public.action_case_property_access(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.action_case_property_access(uuid,uuid,uuid) to service_role;

create or replace function public.action_case_property_options(p_org_id uuid, p_case_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.org_members where org_id = p_org_id and profile_id = p_user_id and is_active = true;
  if not found then raise exception 'PROPERTY_FORBIDDEN'; end if;
  perform 1 from public.action_cases where id = p_case_id and org_id = p_org_id;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  return coalesce((select jsonb_agg(public.property_record_details(p) || jsonb_build_object('id', p.id, 'name', coalesce(p.name, ''))
    order by p.municipality, p.cadastral_id, p.name, p.id)
    from public.properties p where public.action_case_property_access(p_org_id, p_user_id, p.id)), '[]'::jsonb);
end $$;
revoke all on function public.action_case_property_options(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.action_case_property_options(uuid,uuid,uuid) to service_role;

create or replace function public.action_cases_protect_property_link()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'INSERT' then
      if new.property_id is not null or new.property_link_request_id is not null or new.property_link_fingerprint is not null then
        raise exception 'PROPERTY_FORBIDDEN';
      end if;
    elsif new.property_id is distinct from old.property_id or new.property_link_request_id is distinct from old.property_link_request_id
      or new.property_link_fingerprint is distinct from old.property_link_fingerprint then raise exception 'PROPERTY_FORBIDDEN'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_action_cases_protect_property_link on public.action_cases;
create trigger trg_action_cases_protect_property_link before insert or update on public.action_cases
  for each row execute function public.action_cases_protect_property_link();

create or replace function public.assert_contract_property(p_body jsonb, p_complete boolean default false)
returns void language plpgsql set search_path = pg_catalog, public as $$
declare p jsonb := p_body->'contractDetails'->'property'; k text; expected text := ''; complete boolean := true;
begin
  if p_body->'contractDetails' ? 'propertyReference' and
    (jsonb_typeof(p_body->'contractDetails'->'propertyReference') is distinct from 'string'
      or length(p_body->'contractDetails'->>'propertyReference') > 6000) then raise exception 'PROPERTY_INVALID'; end if;
  if p is null then return; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'PROPERTY_INVALID'; end if;
  foreach k in array array['municipality','cadastralDesignation','street','postalCode','city'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k) > (case k when 'street' then 250 when 'postalCode' then 20 else 200 end)
      then raise exception 'PROPERTY_INVALID'; end if;
    if k <> 'postalCode' and btrim(p->>k) = '' then complete := false; end if;
    if btrim(p->>k) <> '' then
      expected := concat_ws(E'\n', nullif(expected, ''), case k when 'municipality' then 'Kommun' when 'cadastralDesignation' then 'Fastighetsbeteckning'
        when 'street' then 'Gata' when 'postalCode' then 'Postnummer' else 'Ort' end || ': ' || btrim(p->>k));
    end if;
  end loop;
  if p ? 'sourcePropertyId' then
    if jsonb_typeof(p->'sourcePropertyId') is distinct from 'string' or p->>'sourcePropertyId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise exception 'PROPERTY_INVALID'; end if;
  end if;
  if p_body->'contractDetails'->'fields'->'property' is distinct from jsonb_build_object('text', expected,
    'status', case when complete then 'specified' else 'unreviewed' end) then raise exception 'PROPERTY_INVALID'; end if;
  if p_complete and not complete then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
end $$;
revoke all on function public.assert_contract_property(jsonb,boolean) from public, anon, authenticated;
grant execute on function public.assert_contract_property(jsonb,boolean) to service_role;

create or replace function public.guard_structured_contract_property()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare p jsonb; linked uuid;
begin
  if tg_table_name = 'action_case_customer_offers' then
    perform public.assert_contract_property(new.snapshot, true);
    return new;
  end if;
  if tg_op = 'UPDATE' and old.body->'contractDetails' ? 'property'
    and not (new.body->'contractDetails' ? 'property') then raise exception 'PROPERTY_INVALID'; end if;
  perform public.assert_contract_property(new.body, false);
  p := new.body->'contractDetails'->'property';
  if p is not null then
    if p ? 'sourcePropertyId' then
      select c.property_id into linked from public.action_cases c
        join public.properties r on r.id = c.property_id
        where c.id = new.action_case_id and c.org_id = new.org_id
          and public.property_identity_key(r.municipality, r.cadastral_id) = public.property_identity_key(p->>'municipality', p->>'cadastralDesignation');
      if linked is distinct from (p->>'sourcePropertyId')::uuid then raise exception 'PROPERTY_STALE'; end if;
    else
      -- Changing identity removes only this project's link, never the shared property or its reports.
      update public.action_cases set property_id = null, property_link_request_id = null, property_link_fingerprint = null
        where id = new.action_case_id and org_id = new.org_id and property_id is not null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists structured_property_draft on public.action_case_customer_offer_drafts;
create trigger structured_property_draft after insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.guard_structured_contract_property();
drop trigger if exists structured_property_publication on public.action_case_customer_offers;
create trigger structured_property_publication before insert on public.action_case_customer_offers
  for each row execute function public.guard_structured_contract_property();

create or replace function public.write_action_case_property(p_org_id uuid, p_case_id uuid, p_user_id uuid, p_mode text, p_data jsonb)
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
  select revision into saved_revision from public.action_case_customer_offer_drafts where action_case_id = p_case_id and org_id = p_org_id for update;
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
    perform public.save_customer_offer_costing(p_org_id, p_case_id, p_user_id, p_data || jsonb_build_object('body', body));
  else
    perform public.write_customer_offer(p_org_id, p_case_id, p_user_id, 'save', p_data || jsonb_build_object('body', body));
  end if;
  insert into public.action_case_events(org_id, action_case_id, event_type, message, performed_by)
    values(p_org_id, p_case_id, 'property_linked', 'Fastighet kopplad: ' || r.cadastral_id || ', ' || r.municipality, p_user_id);
end $$;
revoke all on function public.write_action_case_property(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.write_action_case_property(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
