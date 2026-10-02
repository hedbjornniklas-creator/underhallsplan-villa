-- Statusbesiktning: additive assignment support, source-at-issue freeze and booked-only start.
-- Apply after OB early start/reconciliation, PDF archive and overview pagination.
-- No historical assignment, source, acceptance or inspection is rewritten.
-- Existing OB source handling and pre-approval policy remain unchanged.
begin;

alter table public.assignment_links add column if not exists status_document_source jsonb;

-- Switching the inspection's legal profile requires a new agreement. Ordinary
-- buyer/seller/apartment switches and unrelated inspection edits are unchanged.
create or replace function public.guard_ob_status_profile_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare old_status boolean; new_status boolean;
begin
  if tg_table_name = 'assignments' then
    if (old.assignment_type = 'STATUS') is distinct from (new.assignment_type = 'STATUS') and
      (old.accepted_at is not null or old.status in ('sent','ordered','booked','completed')) then
      raise exception 'OB_STATUS_PROFILE_AGREEMENT_LOCKED';
    end if;
  else
    old_status := upper(coalesce(old.type,'')) = 'STATUS' or upper(coalesce(old.inspection_variant,'')) in ('SB','STB')
      or lower(coalesce(old.inspection_side,'')) in ('status','statusbesiktning','stb');
    new_status := upper(coalesce(new.type,'')) = 'STATUS' or upper(coalesce(new.inspection_variant,'')) in ('SB','STB')
      or lower(coalesce(new.inspection_side,'')) in ('status','statusbesiktning','stb');
    if (old_status is distinct from new_status or (old_status and (
      new.type is distinct from old.type or new.inspection_family is distinct from old.inspection_family or
      new.inspection_variant is distinct from old.inspection_variant or new.inspection_side is distinct from old.inspection_side
    ))) and exists (
      select 1 from public.assignments a where a.inspection_id = old.id
        and (a.accepted_at is not null or a.status in ('sent','ordered','booked','completed'))
    ) then raise exception 'OB_STATUS_PROFILE_AGREEMENT_LOCKED'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ob_status_assignment_profile_guard on public.assignments;
create trigger ob_status_assignment_profile_guard before update on public.assignments
for each row execute function public.guard_ob_status_profile_change();
drop trigger if exists ob_status_inspection_profile_guard on public.inspections;
create trigger ob_status_inspection_profile_guard before update on public.inspections
for each row execute function public.guard_ob_status_profile_change();
revoke all on function public.guard_ob_status_profile_change() from public, anon, authenticated, service_role;

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
  if a.assignment_type <> 'STATUS' or current_setting('role', true) not in ('service_role', 'postgres', 'none') or
    source is null or source->>'schemaVersion' is distinct from 'ob-confirmation-v1' or
    source #>> '{terms,role}' is distinct from 'status' or
    source #>> '{terms,verbatim}' is distinct from 'true' or
    source #>> '{terms,sourceId}' is distinct from 'OB_STATUS_2026_1' or
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
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', addon_name_snapshot, 'priceAmount', price_amount_snapshot, 'currency', currency_snapshot
  ) order by addon_name_snapshot, id), '[]'::jsonb) into addons
  from public.assignment_addon_orders where assignment_id = new.assignment_id and org_id = new.org_id;
  insert into public.assignment_confirmation_snapshots(assignment_id, org_id, acceptance_id, accepted_at, schema_version, snapshot_payload)
  values (new.assignment_id, new.org_id, new.id, new.accepted_at, 'ob-confirmation-v1', jsonb_build_object(
    'assignment', to_jsonb(a) - 'notes_internal' - 'personal_identity_number',
    'issuerName', source -> 'issuerName', 'inspector', source -> 'inspector',
    'terms', source -> 'terms', 'addonOrders', addons,
    'acceptancePayload', new.payload - 'ob_document_source'
  ));
  return new;
end;
$$;

create or replace function public.guard_assignment_confirmation_pdf()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Archived assignment documents are immutable';
  end if;
  if not exists (
    select 1 from public.assignment_acceptances ac
    join public.assignments a on a.id = ac.assignment_id and a.org_id = ac.org_id
    where ac.id = new.acceptance_id and ac.org_id = new.org_id
      and ac.assignment_id = new.assignment_id and ac.accepted_at = new.accepted_at
      and a.assignment_type in ('OB', 'STATUS')
  ) then
    raise exception 'Assignment PDF acceptance mismatch';
  end if;
  return new;
end;
$$;

create or replace function public.consume_assignment_token(p_token text, p_terms_version text,
  p_payload jsonb default '{}'::jsonb, p_ip inet default null, p_user_agent text default null)
returns table (assignment_id uuid, org_id uuid, status text)
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare a public.assignments;
begin
  select a0.* into a from public.assignments a0 join public.assignment_links l on l.assignment_id = a0.id
    where l.token_hash = encode(digest(p_token, 'sha256'), 'hex') for update of a0;
  if a.assignment_type in ('OB', 'STATUS') and (a.status = 'cancelled' or a.archived_at is not null) then
    raise exception 'assignment_cancelled'; end if;
  return query select * from public.consume_assignment_token_before_ob_early_start(p_token, p_terms_version, p_payload, p_ip, p_user_agent);
end;
$$;

create or replace function public.ob_start_status_assignment_inspection(
  p_assignment_id uuid, p_org_id uuid, p_actor uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  a public.assignments; p public.properties; v_inspection_id uuid;
  number_prefix text; next_number bigint; assignment_number text; snapshot jsonb;
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

  if a.preferred_date is not null then
    perform pg_advisory_xact_lock(hashtextextended('ob-assignment-number:' || a.preferred_date::text, 0));
    number_prefix := to_char(a.preferred_date, 'YYYY-MMDD');
    select coalesce(max(substring(i.assignment_number from '[0-9]+$')::bigint), 0) + 1 into next_number
      from public.inspections i where i.inspection_family = 'OB' and i.date = a.preferred_date
      and i.assignment_number ~ ('^' || number_prefix || '-[0-9]+$');
    assignment_number := number_prefix || '-' || lpad(next_number::text, greatest(2, length(next_number::text)), '0');
  end if;

  insert into public.properties (owner, name, status, address, postal_code, city, municipality, cadastral_id, client_name, owner_name)
    values (a.responsible_profile_id, coalesce(nullif(btrim(coalesce(a.property_address, a.preliminary_address)), ''),
      'Fastighet ' || left(a.id::text, 8)), 'Utkast', coalesce(a.property_address, a.preliminary_address),
      a.property_postal_code, coalesce(a.property_city, a.property_municipality),
      coalesce(a.property_municipality, a.property_city), a.cadastral_id, a.customer_name,
      coalesce(a.property_owner_name, a.customer_name)) returning * into p;
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
      'brf_name', a.brf_name, 'apartment_number', a.apartment_number,
      'apartment_holder_name', a.apartment_holder_name))).*;
  update public.assignments set property_id = p.id, inspection_id = v_inspection_id,
    converted_at = now(), status = 'completed', updated_by = p_actor
    where id = a.id;
  return jsonb_build_object('propertyId', p.id, 'inspectionId', v_inspection_id);
end;
$$;

create or replace function public.ob_overview_item_flags(
  p_org_id uuid, p_assignment_id uuid, p_workflow_inspection_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare
  a public.assignments;
  current_assignment_id uuid;
  state jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_org_member(p_org_id), false) then
    raise exception 'OB_OVERVIEW_ORG_FORBIDDEN' using errcode = '42501';
  end if;

  if p_assignment_id is not null then
    select * into a from public.assignments
      where id = p_assignment_id and org_id = p_org_id and assignment_type in ('OB', 'STATUS');
    if not found then
      raise exception 'OB_OVERVIEW_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if p_workflow_inspection_id is not null then
    select w.current_assignment_id into current_assignment_id
      from public.ob_assignment_workflows w
      join public.assignments current_a on current_a.id = w.current_assignment_id
      where w.inspection_id = p_workflow_inspection_id and w.org_id = p_org_id
        and current_a.org_id = p_org_id and current_a.assignment_type = 'OB';
    if not found then
      raise exception 'OB_OVERVIEW_WORKFLOW_FORBIDDEN' using errcode = '42501';
    end if;
    if p_assignment_id is not null and p_assignment_id <> current_assignment_id then
      raise exception 'OB_OVERVIEW_WORKFLOW_CHANGED';
    end if;
    state := public.ob_assignment_workflow_state(p_workflow_inspection_id);
    if state is null or (state->>'assignmentId')::uuid is distinct from current_assignment_id then
      raise exception 'OB_OVERVIEW_WORKFLOW_CHANGED';
    end if;
  end if;

  return jsonb_build_object(
    'activeLink', exists (select 1 from public.assignment_links l
      where l.assignment_id = a.id and l.org_id = p_org_id and l.used_at is null
        and l.revoked_at is null and l.expires_at > now()),
    'approvalVerified', a.accepted_at is not null and exists (
      select 1 from public.assignment_acceptances accepted
      where accepted.assignment_id = a.id and accepted.org_id = p_org_id
        and accepted.accepted_at = a.accepted_at),
    'linkIssue', exists (select 1 from public.assignment_link_incidents incident
      where incident.assignment_id = a.id and incident.org_id = p_org_id and incident.resolved_at is null),
    'assignmentId', case when state is null then to_jsonb(a.id) else state->'assignmentId' end,
    'needsReview', coalesce((state->>'needsReview')::boolean, false),
    'paused', coalesce((state->>'paused')::boolean, false),
    'reason', state->'reason'
  );
end;
$$;

create or replace function public.ob_overview_page(
  p_org_id uuid,
  p_search text default '',
  p_filter text default 'all',
  p_sort text default 'date-desc',
  p_attention_only boolean default false,
  p_show_archived boolean default false,
  p_page integer default 1,
  p_page_size integer default 10
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public as $$
declare
  result jsonb;
  use_icu boolean;
begin
  if auth.uid() is null or not coalesce(public.is_org_member(p_org_id), false) then
    raise exception 'OB_OVERVIEW_ORG_FORBIDDEN' using errcode = '42501';
  end if;
  if p_page is null or p_page not between 1 and 999999
    or p_page_size is null or p_page_size not in (10, 25, 50) then
    raise exception 'OB_OVERVIEW_PAGE_INVALID' using errcode = '22023';
  end if;
  if char_length(coalesce(p_search, '')) > 200 then
    raise exception 'OB_OVERVIEW_SEARCH_INVALID' using errcode = '22023';
  end if;
  if p_filter is null or p_filter not in ('all', 'active', 'closed')
    or p_sort is null or p_sort not in ('date-desc', 'date-asc', 'customer', 'address') then
    raise exception 'OB_OVERVIEW_FILTER_INVALID' using errcode = '22023';
  end if;
  p_attention_only := coalesce(p_attention_only, false);
  p_show_archived := coalesce(p_show_archived, false);
  -- Some runtimes expose ICU but ship only root-locale data. Use it only when
  -- Swedish letter ordering actually works, otherwise use the explicit C key.
  select collprovider = 'i'
    and ('z' collate public.ob_overview_swedish < 'å' collate public.ob_overview_swedish)
    and ('å' collate public.ob_overview_swedish < 'ä' collate public.ob_overview_swedish)
    and ('ä' collate public.ob_overview_swedish < 'ö' collate public.ob_overview_swedish)
    into use_icu from pg_catalog.pg_collation
    where oid = 'public.ob_overview_swedish'::regcollation;

  with
  -- These reads deliberately run as the authenticated caller: owner checks do
  -- not replace any additional RLS restrictions on inspections or snapshots.
  owned_properties as materialized (
    select p.id, p.address, p.city, p.client_name
    from public.properties p where p.owner = auth.uid()
  ),
  visible_inspections as materialized (
    select i.id, i.property_id, i.status, i.type, i.inspection_family, i.inspection_variant, i.inspection_side, i.date, i.created_at, i.assignment_number,
      i.customer_name, i.client_name,
      coalesce(s.address, p.address) as address,
      coalesce(s.city, p.city) as city,
      coalesce(s.client_name, p.client_name) as snapshot_customer
    from public.inspections i join owned_properties p on p.id = i.property_id
    left join public.ob_property_snapshot s on s.inspection_id = i.id
    where i.inspection_family = 'OB'
  ),
  scoped_assignments as materialized (
    select a.id, a.inspection_id, a.status, a.assignment_type, a.customer_name, a.customer_email,
      a.property_address, a.preliminary_address, a.property_city, a.preferred_date,
      a.accepted_at, a.booked_at, a.archived_at, a.created_at
    from public.assignments a where a.org_id = p_org_id and a.assignment_type in ('OB', 'STATUS')
  ),
  scoped_workflows as materialized (
    select w.inspection_id, w.current_assignment_id, w.initial_assignment_id
    from public.ob_assignment_workflows w where w.org_id = p_org_id and (
      exists (select 1 from scoped_assignments a where a.id = w.current_assignment_id)
      or exists (select 1 from visible_inspections i where i.id = w.inspection_id))
  ),
  linked_assignments as materialized (
    select inspection_id, count(*) as candidate_count, (array_agg(id order by id))[1] as first_id
    from scoped_assignments where inspection_id is not null group by inspection_id
  ),
  workflow_rows as (
    select a.id as assignment_id, i.id as inspection_id, w.inspection_id as workflow_inspection_id,
      case when a.id is not null then to_jsonb(a) end as assignment,
      case when i.id is not null then to_jsonb(i) end as inspection,
      to_jsonb(w) as workflow
    from scoped_workflows w left join scoped_assignments a on a.id = w.current_assignment_id
    left join visible_inspections i on i.id = w.inspection_id
  ),
  legacy_rows as materialized (
    select a.id as assignment_id, i.id as inspection_id, null::uuid as workflow_inspection_id,
      case when a.id is not null then to_jsonb(a) end as assignment,
      to_jsonb(i) as inspection, null::jsonb as workflow
    from visible_inspections i
    left join linked_assignments linked on linked.inspection_id = i.id and linked.candidate_count = 1
    left join scoped_assignments a on a.id = linked.first_id
    where not exists (select 1 from scoped_workflows w where w.inspection_id = i.id)
  ),
  consumed_assignments as (
    select initial_assignment_id as id from scoped_workflows
    union select current_assignment_id from scoped_workflows
    union select a.id from scoped_assignments a join scoped_workflows w on w.inspection_id = a.inspection_id
    union select assignment_id from legacy_rows where assignment_id is not null
  ),
  graph_rows as (
    select * from workflow_rows
    union all select * from legacy_rows
    union all
    select a.id, null::uuid, null::uuid, to_jsonb(a), null::jsonb, null::jsonb
    from scoped_assignments a where not exists (select 1 from consumed_assignments c where c.id = a.id)
  ),
  display_rows as (
    select g.*,
      case when inspection_id is not null then 'inspection:' || inspection_id else 'assignment:' || assignment_id end as item_id,
      coalesce(nullif(btrim(inspection->>'date'), ''), nullif(btrim(assignment->>'preferred_date'), '')) as display_date,
      coalesce(inspection->>'created_at', assignment->>'created_at')::timestamptz as created_at,
      coalesce(nullif(btrim(inspection->>'address'), ''), nullif(btrim(assignment->>'property_address'), ''),
        nullif(btrim(assignment->>'preliminary_address'), ''), 'Adress saknas') as address,
      coalesce(nullif(btrim(inspection->>'city'), ''), nullif(btrim(assignment->>'property_city'), ''), '') as city,
      coalesce(nullif(btrim(inspection->>'customer_name'), ''), nullif(btrim(inspection->>'client_name'), ''),
        nullif(btrim(inspection->>'snapshot_customer'), ''), nullif(btrim(assignment->>'customer_name'), ''),
        nullif(btrim(assignment->>'customer_email'), ''), 'Kund saknas') as customer,
      coalesce(nullif(btrim(inspection->>'assignment_number'), ''), '') as assignment_number,
      case when inspection_id is not null then coalesce(lower(inspection->>'status') in ('archived', 'arkiverad'), false)
        else assignment->>'archived_at' is not null end as archived,
      case when inspection_id is not null then
        coalesce(lower(btrim(inspection->>'status')) in ('completed', 'done', 'klar', 'archived', 'arkiverad'), false)
        else assignment->>'inspection_id' is null and workflow is null and coalesce(assignment->>'status' = 'cancelled', false)
        end as status_closed
    from graph_rows g
  ),
  candidates as materialized (
    select d.*, d.status_closed or d.archived as closed
    from display_rows d where (p_show_archived or not d.archived)
      and not exists (
        select 1 from regexp_split_to_table(lower(btrim(coalesce(p_search, ''))), '\s+') word
        where word <> '' and strpos(lower(d.address || ' ' || d.city || ' ' || d.customer || ' ' || d.assignment_number), word) = 0
      )
  ),
  -- MATERIALIZED evaluates each privileged status read exactly once. With the
  -- default filter this CTE is empty; ordinary pagination never reads all states.
  attention_flags as materialized (
    select c.item_id, public.ob_overview_item_flags(p_org_id, c.assignment_id, c.workflow_inspection_id) as flags
    from candidates c where p_attention_only and not c.archived
  ),
  attention_candidates as materialized (
    select c.*, f.flags from candidates c left join attention_flags f using (item_id)
    where not p_attention_only or (not c.archived and (
      case when c.assignment is not null then
        case
          when c.assignment->>'status' = 'cancelled' then false
          when c.assignment->>'status' in ('expired', 'draft') then true
          when c.assignment->>'accepted_at' is not null and (f.flags->>'approvalVerified')::boolean then
            not (c.assignment->>'booked_at' is not null and c.assignment->>'status' in ('booked', 'completed'))
          when c.assignment->>'status' = 'sent' and c.assignment->>'accepted_at' is null then not (f.flags->>'activeLink')::boolean
          else true end
        else c.workflow is not null end
      or coalesce((f.flags->>'linkIssue')::boolean, false)
      or (c.inspection_id is not null and coalesce(lower(btrim(c.inspection->>'status')), '') not in
        ('draft', 'utkast', 'ongoing', 'in_progress', 'pågående', 'pågår', 'completed', 'done', 'klar', 'archived', 'arkiverad'))
      or (c.workflow is not null and ((f.flags->>'paused')::boolean or
        ((f.flags->>'needsReview')::boolean and (f.flags->>'approvalVerified')::boolean and c.assignment->>'booked_at' is not null)))
    ))
  ),
  -- Tab counts share search/archive/attention filters, but not the selected tab.
  counts as (
    select count(*) as all_count, count(*) filter (where not closed) as active_count,
      count(*) filter (where closed) as closed_count
    from attention_candidates
  ),
  filtered as materialized (
    select * from attention_candidates where p_filter = 'all'
      or (p_filter = 'active' and not closed) or (p_filter = 'closed' and closed)
  ),
  -- A stale last page after deletion/filtering resolves to the current last page.
  page_bounds as materialized (
    select count(*) as total_count,
      least(p_page::bigint, greatest(1::bigint, (count(*) + p_page_size - 1) / p_page_size)) as effective_page
    from filtered
  ),
  ordered as (
    select f.*, row_number() over (order by
      case when p_sort in ('date-desc', 'date-asc') then display_date is null end asc,
      case when p_sort = 'date-desc' then coalesce(display_date::timestamptz, created_at) end desc,
      case when p_sort = 'date-asc' then coalesce(display_date::timestamptz, created_at) end asc,
      (case when use_icu and p_sort = 'customer' then customer
        when use_icu and p_sort = 'address' then address end)
        collate public.ob_overview_swedish asc,
      (case when not use_icu and p_sort = 'customer' then translate(lower(customer), 'åäö', '{|}')
        when not use_icu and p_sort = 'address' then translate(lower(address), 'åäö', '{|}') end) collate "C" asc,
      item_id asc) as ordinal
    from filtered f
  ),
  page_rows as materialized (
    select * from ordered order by ordinal limit p_page_size
      offset (select (effective_page - 1) * p_page_size from page_bounds)
  ),
  page_flags as materialized (
    select p.*, case when p_attention_only then p.flags
      else public.ob_overview_item_flags(p_org_id, p.assignment_id, p.workflow_inspection_id) end as item_flags
    from page_rows p
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'assignment', case when p.assignment is not null then p.assignment || jsonb_build_object(
        'activeLink', p.item_flags->'activeLink', 'approvalVerified', p.item_flags->'approvalVerified', 'linkIssue', p.item_flags->'linkIssue') end,
      'inspection', p.inspection,
      'workflow', case when p.workflow is not null then p.workflow || jsonb_build_object(
        'needsReview', p.item_flags->'needsReview', 'paused', p.item_flags->'paused', 'reason', p.item_flags->'reason') end
    ) order by p.ordinal) from page_flags p), '[]'::jsonb),
    'total', (select total_count from page_bounds),
    'counts', (select jsonb_build_object('all', all_count, 'active', active_count, 'closed', closed_count) from counts),
    'page', (select effective_page from page_bounds), 'pageSize', p_page_size
  ) into result;
  return result;
end;
$$;


revoke all on function public.ob_start_status_assignment_inspection(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.ob_start_status_assignment_inspection(uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
