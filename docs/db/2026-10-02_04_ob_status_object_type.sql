-- Independent STB object identity. Apply after 2026-10-02_01 through _03.
-- No existing issued sources, acceptances, archived PDFs or reports are rewritten.
begin;

alter table public.ob_property_snapshot add column if not exists object_type text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ob_property_snapshot'::regclass
    and conname = 'ob_property_snapshot_object_type_check') then
    alter table public.ob_property_snapshot add constraint ob_property_snapshot_object_type_check
      check (object_type is null or object_type in ('property','apartment'));
  end if;
end $$;

create or replace function public.guard_ob_status_object_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare target_inspection_id uuid;
begin
  if tg_table_name = 'assignments' then
    -- A just-issued draft may not have reached sent yet. Changing away from
    -- STATUS must not bypass the object lock and switch back afterwards.
    if (old.assignment_type = 'STATUS') is distinct from (new.assignment_type = 'STATUS') and
      (old.last_sent_at is not null or exists (select 1 from public.assignment_links l
        where l.assignment_id = old.id and l.org_id = old.org_id
          and l.status_document_source is not null and l.revoked_at is null))
    then raise exception 'OB_STATUS_PROFILE_AGREEMENT_LOCKED'; end if;
    if old.assignment_type = 'STATUS' and
      coalesce(old.assignment_details->>'objectType','property') is distinct from coalesce(new.assignment_details->>'objectType','property') and
      (old.accepted_at is not null or old.last_sent_at is not null or old.status in ('sent','ordered','booked','completed')
        or exists (select 1 from public.assignment_links l where l.assignment_id = old.id and l.org_id = old.org_id
          and l.status_document_source is not null and l.revoked_at is null))
    then raise exception 'OB_STATUS_OBJECT_AGREEMENT_LOCKED'; end if;
  else
    target_inspection_id := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;
    -- A linked snapshot cannot be removed/reparented to bypass its type lock.
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.inspection_id is distinct from new.inspection_id) then
      if exists (select 1 from public.assignments a where a.inspection_id = old.inspection_id
        and a.assignment_type = 'STATUS'
        and (a.accepted_at is not null or a.last_sent_at is not null or a.status in ('sent','ordered','booked','completed'))
      ) then raise exception 'OB_STATUS_OBJECT_AGREEMENT_LOCKED'; end if;
      if tg_op = 'DELETE' then return old; end if;
    end if;
    -- Validate inserts too: recreating a missing snapshot must not reclassify
    -- its linked agreement. Accepted snapshot/source wins over live metadata.
    if exists (
      select 1 from public.assignments a where a.inspection_id = target_inspection_id
        and a.assignment_type = 'STATUS'
        and (a.accepted_at is not null or a.last_sent_at is not null or a.status in ('sent','ordered','booked','completed'))
        and coalesce(new.object_type,'property') is distinct from coalesce(
          (select s.snapshot_payload #>> '{assignment,assignment_details,objectType}'
            from public.assignment_confirmation_snapshots s where s.assignment_id = a.id and s.org_id = a.org_id),
          (select l.status_document_source->>'statusObjectType' from public.assignment_links l
            where l.assignment_id = a.id and l.org_id = a.org_id and l.status_document_source is not null
            order by l.created_at desc, l.id desc limit 1),
          'property')
    ) then raise exception 'OB_STATUS_OBJECT_AGREEMENT_LOCKED'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ob_status_assignment_object_guard on public.assignments;
create trigger ob_status_assignment_object_guard before update on public.assignments
for each row execute function public.guard_ob_status_object_change();
drop trigger if exists ob_status_snapshot_object_guard on public.ob_property_snapshot;
create trigger ob_status_snapshot_object_guard before insert or update or delete on public.ob_property_snapshot
for each row execute function public.guard_ob_status_object_change();
revoke all on function public.guard_ob_status_object_change() from public, anon, authenticated, service_role;

create or replace function public.guard_status_assignment_source()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare a public.assignments; source jsonb := new.status_document_source;
begin
  if tg_op = 'UPDATE' and old.status_document_source is not null and (
    new.status_document_source is distinct from old.status_document_source or
    new.terms_version is distinct from old.terms_version or
    new.assignment_id is distinct from old.assignment_id or new.org_id is distinct from old.org_id
  ) then raise exception 'Issued status sources are immutable'; end if;
  select * into strict a from public.assignments where id = new.assignment_id and org_id = new.org_id;
  if a.assignment_type <> 'STATUS' and source is null then return new; end if;
  -- Updating the expiry/used/revoked timestamps does not change the source.
  if tg_op = 'UPDATE' and old.status_document_source = source then return new; end if;
  -- Serialize new source binding with metadata edits. Unchanged link timestamp
  -- updates above retain the prior lock ordering used by the token consumer.
  select * into strict a from public.assignments where id = new.assignment_id and org_id = new.org_id for update;
  if a.assignment_type <> 'STATUS' or current_setting('role', true) not in ('service_role', 'postgres', 'none') or
    source is null or source->>'schemaVersion' is distinct from 'ob-confirmation-v1' or
    source #>> '{terms,role}' is distinct from 'status' or
    source #>> '{terms,verbatim}' is distinct from 'true' or
    source #>> '{terms,sourceId}' is distinct from 'OB_STATUS_2026_1' or
    source->>'statusObjectType' is null or source->>'statusObjectType' not in ('property','apartment') or
    (a.assignment_details ? 'objectType' and (jsonb_typeof(a.assignment_details->'objectType') is distinct from 'string'
      or a.assignment_details->>'objectType' not in ('property','apartment'))) or
    source->>'statusObjectType' is distinct from coalesce(a.assignment_details->>'objectType', 'property') or
    source->>'statusScopeDescription' is distinct from a.scope_description or
    (source->>'statusPriceAmount')::numeric is distinct from a.price_amount or
    source #>> '{terms,version}' is distinct from new.terms_version or
    source #>> '{terms,documentHash}' is distinct from encode(sha256(convert_to(source #>> '{terms,text}', 'UTF8')), 'hex') or
    jsonb_typeof(source->'inspector') is distinct from 'object'
  then raise exception 'STATUS_ISSUED_SOURCE_INVALID'; end if;
  return new;
end;
$$;
drop trigger if exists status_assignment_source_guard on public.assignment_links;
create trigger status_assignment_source_guard before insert or update on public.assignment_links
for each row execute function public.guard_status_assignment_source();
revoke all on function public.guard_status_assignment_source() from public, anon, authenticated, service_role;

create or replace function public.capture_ob_confirmation_snapshot()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  a public.assignments%rowtype;
  source jsonb := new.payload -> 'ob_document_source';
  addons jsonb;
  assignment_snapshot jsonb;
  object_type text;
begin
  select * into strict a from public.assignments where id = new.assignment_id and org_id = new.org_id;
  if a.assignment_type = 'STATUS' then
    if source is null or a.scope_description is distinct from source->>'statusScopeDescription' or
      a.price_amount is distinct from (source->>'statusPriceAmount')::numeric or not exists (
      select 1 from public.assignment_links l where l.id = new.assignment_link_id
        and l.assignment_id = a.id and l.org_id = a.org_id
        and l.status_document_source = source
    ) then raise exception 'STATUS_ISSUED_SOURCE_INVALID'; end if;
  end if;
  -- Older OB agreements retain the existing opt-in behavior.
  if source is null then return new; end if;
  if current_setting('role', true) not in ('service_role', 'postgres', 'none') then
    raise exception 'OB confirmation snapshots require the server';
  end if;
  select * into strict a from public.assignments where id = new.assignment_id and org_id = new.org_id;
  if a.assignment_type not in ('OB', 'STATUS') or source ->> 'schemaVersion' is distinct from 'ob-confirmation-v1'
    or source #>> '{terms,version}' is distinct from new.terms_version
    or source #>> '{terms,documentHash}' is distinct from new.terms_document_hash
    or encode(sha256(convert_to(source #>> '{terms,text}', 'UTF8')), 'hex') is distinct from new.terms_document_hash
    or jsonb_typeof(source -> 'inspector') is distinct from 'object'
    or a.accepted_at is distinct from new.accepted_at then
    raise exception 'Invalid OB confirmation snapshot';
  end if;
  assignment_snapshot := to_jsonb(a) - 'notes_internal' - 'personal_identity_number';
  if a.assignment_type = 'STATUS' and source ? 'statusObjectType' then
    object_type := source->>'statusObjectType';
    if object_type is null or object_type not in ('property','apartment') or
      new.payload #>> '{assignment_details,objectType}' is distinct from object_type or
      (object_type = 'apartment' and nullif(btrim(new.payload->>'apartment_number'), '') is null)
    then raise exception 'STATUS_ISSUED_OBJECT_INVALID'; end if;
    -- The token consumer predates object types and coalesces null fields. Freeze
    -- the accepted object, including explicit nulls, rather than those leftovers.
    assignment_snapshot := assignment_snapshot || jsonb_build_object(
      'assignment_details', coalesce(a.assignment_details, '{}'::jsonb) || jsonb_build_object('objectType', object_type),
      'property_owner_name', case when object_type = 'property' then coalesce(new.payload->'property_owner_name', to_jsonb(a.property_owner_name)) else 'null'::jsonb end,
      'cadastral_id', case when object_type = 'property' then coalesce(new.payload->'cadastral_id', to_jsonb(a.cadastral_id)) else 'null'::jsonb end,
      'brf_name', case when object_type = 'apartment' then coalesce(new.payload->'brf_name', to_jsonb(a.brf_name)) else 'null'::jsonb end,
      'apartment_number', case when object_type = 'apartment' then new.payload->'apartment_number' else 'null'::jsonb end,
      'apartment_holder_name', case when object_type = 'apartment' then coalesce(new.payload->'apartment_holder_name', to_jsonb(a.apartment_holder_name)) else 'null'::jsonb end
    );
  elsif a.assignment_type = 'STATUS' then
    -- A pre-object-type issued link always retains its original property flow.
    assignment_snapshot := jsonb_set(assignment_snapshot, '{assignment_details}',
      coalesce(a.assignment_details, '{}'::jsonb) - 'objectType');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', addon_name_snapshot, 'priceAmount', price_amount_snapshot, 'currency', currency_snapshot
  ) order by addon_name_snapshot, id), '[]'::jsonb) into addons
  from public.assignment_addon_orders where assignment_id = new.assignment_id and org_id = new.org_id;
  insert into public.assignment_confirmation_snapshots(assignment_id, org_id, acceptance_id, accepted_at, schema_version, snapshot_payload)
  values (new.assignment_id, new.org_id, new.id, new.accepted_at, 'ob-confirmation-v1', jsonb_build_object(
    'assignment', assignment_snapshot,
    'issuerName', source -> 'issuerName', 'inspector', source -> 'inspector',
    'terms', source -> 'terms', 'addonOrders', addons,
    'acceptancePayload', new.payload - 'ob_document_source'
  ));
  return new;
end;
$$;

create or replace function public.ob_start_status_assignment_inspection(
  p_assignment_id uuid, p_org_id uuid, p_actor uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  a public.assignments; p public.properties; v_inspection_id uuid;
  number_prefix text; next_number bigint; assignment_number text; snapshot jsonb;
  object_type text; object_data jsonb;
begin
  select * into a from public.assignments where id = p_assignment_id and org_id = p_org_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
  if a.assignment_type <> 'STATUS' or not exists (
    select 1 from public.org_members m where m.org_id = p_org_id and m.profile_id = p_actor and m.is_active
      and (m.role = 'admin' or a.responsible_profile_id = p_actor)
  ) then raise exception 'OB_ASSIGNMENT_FORBIDDEN'; end if;
  if a.inspection_id is not null then
    return jsonb_build_object('propertyId', a.property_id, 'inspectionId', a.inspection_id);
  end if;
  -- STATUS does not inherit the OB pre-approval exception.
  if a.archived_at is not null or a.status <> 'booked' or a.accepted_at is null or a.booked_at is null
    or not exists (select 1 from public.assignment_acceptances ac where ac.assignment_id = a.id
      and ac.org_id = p_org_id and ac.accepted_at = a.accepted_at)
  then raise exception 'OB_APPROVAL_REQUIRED'; end if;

  -- The agreed scope belongs to the accepted, immutable document, not the
  -- mutable assignment row. Bind it to the same acceptance and verified text.
  select s.snapshot_payload into snapshot
    from public.assignment_confirmation_snapshots s
    join public.assignment_acceptances ac on ac.id = s.acceptance_id
      and ac.assignment_id = s.assignment_id and ac.org_id = s.org_id and ac.accepted_at = s.accepted_at
    where s.assignment_id = a.id and s.org_id = p_org_id and s.accepted_at = a.accepted_at
      and s.schema_version = 'ob-confirmation-v1'
      and s.snapshot_payload #>> '{assignment,assignment_type}' = 'STATUS'
      and s.snapshot_payload #>> '{terms,role}' = 'status'
      and s.snapshot_payload #>> '{terms,version}' = ac.terms_version
      and s.snapshot_payload #>> '{terms,documentHash}' = ac.terms_document_hash
      and encode(sha256(convert_to(s.snapshot_payload #>> '{terms,text}', 'UTF8')), 'hex') = ac.terms_document_hash;
  if not found or nullif(btrim(snapshot #>> '{assignment,scope_description}'), '') is null then
    raise exception 'OB_APPROVAL_REQUIRED';
  end if;

  object_type := snapshot #>> '{assignment,assignment_details,objectType}';
  if object_type is not null and object_type not in ('property','apartment') then
    raise exception 'OB_APPROVAL_REQUIRED';
  end if;
  -- New agreements transfer their immutable object data. Older agreements keep
  -- the prior conversion behavior and a null marker; no historical backfill.
  object_data := case when object_type is not null then snapshot->'assignment' else to_jsonb(a) end;

  if a.preferred_date is not null then
    perform pg_advisory_xact_lock(hashtextextended('ob-assignment-number:' || a.preferred_date::text, 0));
    number_prefix := to_char(a.preferred_date, 'YYYY-MMDD');
    select coalesce(max(substring(i.assignment_number from '[0-9]+$')::bigint), 0) + 1 into next_number
      from public.inspections i where i.inspection_family = 'OB' and i.date = a.preferred_date
      and i.assignment_number ~ ('^' || number_prefix || '-[0-9]+$');
    assignment_number := number_prefix || '-' || lpad(next_number::text, greatest(2, length(next_number::text)), '0');
  end if;

  insert into public.properties (owner, name, status, address, postal_code, city, municipality, cadastral_id, client_name, owner_name)
    values (a.responsible_profile_id, coalesce(nullif(btrim(coalesce(object_data->>'property_address', object_data->>'preliminary_address')), ''),
      'Fastighet ' || left(a.id::text, 8)), 'Utkast', coalesce(object_data->>'property_address', object_data->>'preliminary_address'),
      object_data->>'property_postal_code', coalesce(object_data->>'property_city', object_data->>'property_municipality'),
      coalesce(object_data->>'property_municipality', object_data->>'property_city'),
      case when object_type = 'apartment' then null else object_data->>'cadastral_id' end, a.customer_name,
      case when object_type = 'apartment' then null else coalesce(object_data->>'property_owner_name', a.customer_name) end) returning * into p;
  insert into public.inspections (property_id, type, inspection_family, inspection_variant, status,
    inspection_side, date, inspection_time, client_name, client_contact, customer_name, customer_email,
    customer_phone, customer_address, customer_postal_code, customer_city, assignment_number,
    assignment_confirmation_delivered_date)
    values (p.id, 'STATUS', 'OB', 'SB', 'draft', 'status',
      a.preferred_date, a.preferred_time, a.customer_name,
      nullif(concat_ws(' | ', a.customer_phone, a.customer_email), ''), a.customer_name, a.customer_email,
      a.customer_phone, a.customer_address, a.customer_postal_code, a.customer_city, assignment_number,
      (coalesce(a.accepted_at, a.last_sent_at) at time zone 'Europe/Stockholm')::date) returning id into v_inspection_id;
  insert into public.inspection_conditions (inspection_id, furnishing_level) values (v_inspection_id, 'fullt_moblerad');
  insert into public.inspection_addon_orders (inspection_id, org_id, assignment_addon_order_id,
    addon_service_id, addon_key, addon_name_snapshot, sort_order, price_amount_snapshot,
    currency_snapshot, is_selected, selected_source)
    select v_inspection_id, p_org_id, ao.id, s.id, s.key, coalesce(ao.addon_name_snapshot, s.name),
      coalesce(s.sort_order, 100), coalesce(ao.price_amount_snapshot, pas.price_amount, 0),
      coalesce(ao.currency_snapshot, pas.currency, 'SEK'), ao.id is not null,
      case when ao.id is not null then 'assignment' else 'inspection' end
    from public.profile_addon_services pas join public.settings_addon_services s on s.id = pas.addon_service_id
    left join lateral (select o.* from public.assignment_addon_orders o
      where o.assignment_id = a.id and o.org_id = p_org_id and (o.addon_service_id = s.id or o.addon_key = s.key)
      order by (o.addon_service_id = s.id) desc nulls last limit 1) ao on true
    where pas.org_id = p_org_id and pas.profile_id = a.responsible_profile_id and pas.is_enabled and s.is_active;
  update public.inspections i set scope = snapshot #>> '{assignment,scope_description}' where i.id = v_inspection_id;
  -- Copy property defaults too, matching the former application-side snapshot.
  insert into public.ob_property_snapshot select (jsonb_populate_record(null::public.ob_property_snapshot,
    to_jsonb(p) || jsonb_build_object('inspection_id', v_inspection_id,
      'source_property_id', p.id, 'source_property_owner', p.owner, 'source_property_created_at', p.created_at,
      'imported_at', now(), 'snapshot_version', 1, 'created_at', now(), 'updated_at', now(),
      'object_type', object_type,
      'brf_name', object_data->>'brf_name', 'apartment_number', object_data->>'apartment_number',
      'apartment_holder_name', object_data->>'apartment_holder_name'))).*;
  update public.assignments set property_id = p.id, inspection_id = v_inspection_id,
    converted_at = now(), status = 'completed', updated_by = p_actor
    where id = a.id;
  return jsonb_build_object('propertyId', p.id, 'inspectionId', v_inspection_id);
end;
$$;

revoke all on function public.ob_start_status_assignment_inspection(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.ob_start_status_assignment_inspection(uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
