-- OB: start before customer approval. Apply before deploying the application.
begin;

create table if not exists public.ob_assignment_workflows (
  inspection_id uuid primary key references public.inspections(id) on delete restrict,
  org_id uuid not null references public.organizations(id),
  initial_assignment_id uuid not null references public.assignments(id) on delete restrict,
  current_assignment_id uuid not null unique references public.assignments(id) on delete restrict,
  started_at timestamptz not null default now(),
  started_by uuid not null references public.profiles(id),
  start_reason text not null check (length(btrim(start_reason)) between 5 and 1000),
  initial_snapshot jsonb not null,
  reviewed_snapshot jsonb,
  reviewed_acceptance_id uuid references public.assignment_acceptances(id) on delete restrict,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

create table if not exists public.ob_assignment_workflow_events (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.ob_assignment_workflows(inspection_id) on delete restrict,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  event_type text not null check (event_type in ('started', 'reissued', 'reviewed')),
  performed_by uuid not null references public.profiles(id),
  performed_at timestamptz not null default now(),
  snapshot jsonb not null
);

alter table public.ob_assignment_workflows enable row level security;
alter table public.ob_assignment_workflow_events enable row level security;
revoke all on public.ob_assignment_workflows, public.ob_assignment_workflow_events from anon, authenticated;
grant select on public.ob_assignment_workflows, public.ob_assignment_workflow_events to authenticated;
grant all on public.ob_assignment_workflows, public.ob_assignment_workflow_events to service_role;
drop policy if exists ob_assignment_workflows_read on public.ob_assignment_workflows;
create policy ob_assignment_workflows_read on public.ob_assignment_workflows for select to authenticated
  using (public.is_org_member(org_id));
drop policy if exists ob_assignment_workflow_events_read on public.ob_assignment_workflow_events;
create policy ob_assignment_workflow_events_read on public.ob_assignment_workflow_events for select to authenticated
  using (exists (select 1 from public.ob_assignment_workflows w where w.inspection_id = ob_assignment_workflow_events.inspection_id));

create or replace function public.ob_assignment_snapshot(p_assignment_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'customer_name', a.customer_name, 'customer_email', a.customer_email,
    'customer_phone', a.customer_phone, 'customer_address', a.customer_address,
    'customer_postal_code', a.customer_postal_code, 'customer_city', a.customer_city,
    'property_address', coalesce(a.property_address, a.preliminary_address),
    'property_postal_code', a.property_postal_code, 'property_city', a.property_city,
    'property_municipality', a.property_municipality, 'property_owner_name', a.property_owner_name,
    'cadastral_id', a.cadastral_id, 'brf_name', a.brf_name,
    'apartment_number', a.apartment_number, 'apartment_holder_name', a.apartment_holder_name,
    'orderer_role', a.orderer_role, 'preferred_date', a.preferred_date, 'preferred_time', a.preferred_time,
    'scope_description', a.scope_description, 'price_amount', a.price_amount, 'currency', a.currency,
    'terms_version', coalesce(a.terms_version, (select l.terms_version from public.assignment_links l
      where l.assignment_id = a.id and l.revoked_at is null order by l.created_at desc limit 1)),
    'terms_document_hash', a.terms_document_hash,
    'invoice_name', a.invoice_name, 'invoice_address', a.invoice_address, 'invoice_email', a.invoice_email,
    'addons', coalesce((select jsonb_agg(jsonb_build_object(
      'key', o.addon_key, 'name', o.addon_name_snapshot,
      'price', o.price_amount_snapshot, 'currency', o.currency_snapshot) order by o.addon_key)
      from public.assignment_addon_orders o where o.assignment_id = a.id), '[]'::jsonb)
  ) from public.assignments a where a.id = p_assignment_id;
$$;

create or replace function public.ob_assignment_workflow_state(p_inspection_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  w public.ob_assignment_workflows; a public.assignments;
  acceptance_id uuid; snapshot jsonb; block_reason text; paused boolean; reviewed boolean;
begin
  select * into w from public.ob_assignment_workflows where inspection_id = p_inspection_id;
  if not found then return null; end if;
  select * into a from public.assignments where id = w.current_assignment_id;
  select id into acceptance_id from public.assignment_acceptances
    where assignment_id = a.id and accepted_at = a.accepted_at order by created_at desc, id limit 1;
  snapshot := public.ob_assignment_snapshot(a.id);
  paused := a.status in ('cancelled', 'expired', 'draft') or a.archived_at is not null or
    (a.status = 'sent' and not exists (select 1 from public.assignment_links l where l.assignment_id = a.id
      and l.used_at is null and l.revoked_at is null and l.expires_at > now()));
  reviewed := acceptance_id is not null and w.reviewed_acceptance_id = acceptance_id
    and w.reviewed_snapshot = snapshot;
  block_reason := case
    when paused then 'Arbetet är pausat. Uppdragsbekräftelsen behöver vara aktuell och skickad.'
    when a.accepted_at is null or acceptance_id is null then 'Inväntar kundens godkännande.'
    when a.booked_at is null or a.status not in ('booked', 'completed') then 'Kunden har godkänt. Besiktningsmannen behöver acceptera uppdraget.'
    when not coalesce(reviewed, false) then 'Kundens uppgifter och tillägg behöver stämmas av mot besiktningen.'
    else null end;
  return jsonb_build_object(
    'inspectionId', w.inspection_id, 'assignmentId', a.id, 'status', a.status,
    'startedAt', w.started_at, 'startReason', w.start_reason,
    'acceptedAt', a.accepted_at, 'bookedAt', a.booked_at,
    'initialSnapshot', w.initial_snapshot, 'currentSnapshot', snapshot,
    'reviewToken', md5(snapshot::text || coalesce(acceptance_id::text, '')),
    'needsReview', not coalesce(reviewed, false), 'paused', paused,
    'canDeliver', block_reason is null, 'reason', block_reason);
end;
$$;

create or replace function public.ob_assert_assignment_actor(p_assignment_id uuid, p_org_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (
    select 1 from public.assignments a join public.org_members m on m.org_id = a.org_id
    where a.id = p_assignment_id and a.org_id = p_org_id and a.assignment_type = 'OB'
      and m.profile_id = p_actor and m.is_active
      and (m.role = 'admin' or a.responsible_profile_id = p_actor)
  ) then raise exception 'OB_ASSIGNMENT_FORBIDDEN'; end if;
end;
$$;

-- All OB starts share the same assignment lock, including the normal booked path.
create or replace function public.ob_start_assignment_inspection(
  p_assignment_id uuid, p_org_id uuid, p_actor uuid, p_early_reason text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  a public.assignments; p public.properties; v_inspection_id uuid;
  early boolean; number_prefix text; next_number bigint; assignment_number text; snapshot jsonb;
begin
  select * into a from public.assignments where id = p_assignment_id and org_id = p_org_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
  perform public.ob_assert_assignment_actor(a.id, p_org_id, p_actor);
  if a.inspection_id is not null then
    return jsonb_build_object('propertyId', a.property_id, 'inspectionId', a.inspection_id);
  end if;
  if a.archived_at is not null or a.status not in ('sent', 'booked') then
    raise exception 'OB_START_NOT_ALLOWED';
  end if;
  early := a.status = 'sent';
  if early then
    if a.accepted_at is not null or a.last_sent_at is null or
      length(btrim(coalesce(p_early_reason, ''))) not between 5 and 1000 then
      raise exception 'OB_EARLY_REASON_REQUIRED';
    end if;
    if not exists (select 1 from public.assignment_links l where l.assignment_id = a.id
      and l.org_id = p_org_id and l.used_at is null and l.revoked_at is null and l.expires_at > now()) then
      raise exception 'OB_APPROVAL_LINK_REQUIRED';
    end if;
  elsif a.accepted_at is null then raise exception 'OB_APPROVAL_REQUIRED'; end if;

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
    values (p.id, 'OB', 'OB', 'OB', 'draft',
      case when lower(coalesce(a.orderer_role, '')) ~ '(sell|sälj|salj)' then 'seller'
        when lower(coalesce(a.orderer_role, '')) ~ '(apt|apartment|lägenhet|lagenhet)' then 'apartment' else 'buyer' end,
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
  update public.inspections i set scope = (
    select string_agg(o.addon_name_snapshot, '; ' order by o.sort_order, o.addon_key)
    from public.inspection_addon_orders o where o.inspection_id = i.id and o.is_selected
  ) where i.id = v_inspection_id;
  -- Copy property defaults too, matching the former application-side snapshot.
  insert into public.ob_property_snapshot select (jsonb_populate_record(null::public.ob_property_snapshot,
    to_jsonb(p) || jsonb_build_object('inspection_id', v_inspection_id,
      'source_property_id', p.id, 'source_property_owner', p.owner, 'source_property_created_at', p.created_at,
      'imported_at', now(), 'snapshot_version', 1, 'created_at', now(), 'updated_at', now(),
      'brf_name', a.brf_name, 'apartment_number', a.apartment_number,
      'apartment_holder_name', a.apartment_holder_name))).*;
  update public.assignments set property_id = p.id, inspection_id = v_inspection_id,
    converted_at = now(), status = case when early then a.status else 'completed' end, updated_by = p_actor
    where id = a.id;
  if early then
    snapshot := public.ob_assignment_snapshot(a.id);
    insert into public.ob_assignment_workflows (inspection_id, org_id, initial_assignment_id, current_assignment_id,
      started_by, start_reason, initial_snapshot) values (v_inspection_id, p_org_id, a.id, a.id, p_actor, btrim(p_early_reason), snapshot);
    insert into public.ob_assignment_workflow_events (inspection_id, assignment_id, event_type, performed_by, snapshot)
      values (v_inspection_id, a.id, 'started', p_actor, snapshot);
  end if;
  return jsonb_build_object('propertyId', p.id, 'inspectionId', v_inspection_id);
end;
$$;

create or replace function public.ob_review_assignment_workflow(p_inspection_id uuid, p_org_id uuid, p_actor uuid, p_review_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare w public.ob_assignment_workflows; a public.assignments; state jsonb; acceptance_id uuid;
begin
  select * into w from public.ob_assignment_workflows where inspection_id = p_inspection_id and org_id = p_org_id;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
  select * into a from public.assignments where id = w.current_assignment_id for update;
  perform public.ob_assert_assignment_actor(a.id, p_org_id, p_actor);
  select * into w from public.ob_assignment_workflows where inspection_id = p_inspection_id for update;
  if w.current_assignment_id <> a.id then raise exception 'OB_WORKFLOW_CHANGED'; end if;
  state := public.ob_assignment_workflow_state(p_inspection_id);
  if a.status not in ('booked', 'completed') or a.accepted_at is null or a.booked_at is null
    or (state->>'paused')::boolean then raise exception 'OB_APPROVAL_REQUIRED'; end if;
  if p_review_token is null or state->>'reviewToken' <> p_review_token then raise exception 'OB_WORKFLOW_CHANGED'; end if;
  select id into acceptance_id from public.assignment_acceptances where assignment_id = a.id
    and accepted_at = a.accepted_at order by created_at desc, id limit 1;
  if acceptance_id is null then raise exception 'OB_APPROVAL_REQUIRED'; end if;
  update public.ob_assignment_workflows set reviewed_snapshot = state->'currentSnapshot',
    reviewed_acceptance_id = acceptance_id, reviewed_at = now(), reviewed_by = p_actor where inspection_id = p_inspection_id;
  insert into public.ob_assignment_workflow_events (inspection_id, assignment_id, event_type, performed_by, snapshot)
    values (p_inspection_id, a.id, 'reviewed', p_actor, state->'currentSnapshot');
  return public.ob_assignment_workflow_state(p_inspection_id);
end;
$$;

-- Reissue and move the live link in one transaction. Old versions remain in the event history.
create or replace function public.ob_reissue_started_assignment(p_assignment_id uuid, p_org_id uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare a public.assignments; draft public.assignments; w public.ob_assignment_workflows;
begin
  select * into a from public.assignments where id = p_assignment_id and org_id = p_org_id for update;
  perform public.ob_assert_assignment_actor(a.id, p_org_id, p_actor);
  select * into w from public.ob_assignment_workflows where current_assignment_id = a.id for update;
  if not found or a.status not in ('sent', 'ordered', 'booked') or a.archived_at is not null then
    raise exception 'ASSIGNMENT_REISSUE_NOT_ALLOWED'; end if;
  if exists (select 1 from public.inspections where id = w.inspection_id and locked_at is not null) then
    raise exception 'OB_INSPECTION_LOCKED'; end if;
  draft := a;
  draft.id := gen_random_uuid(); draft.status := 'draft'; draft.accepted_at := null;
  draft.accepted_via_ip := null; draft.accepted_user_agent := null;
  draft.terms_version := null; draft.terms_document_hash := null; draft.booked_at := null;
  draft.last_sent_at := null; draft.created_at := now(); draft.updated_at := now();
  draft.created_by := p_actor; draft.updated_by := p_actor;
  update public.assignment_links set revoked_at = now() where assignment_id = a.id and used_at is null and revoked_at is null;
  update public.assignments set status = 'cancelled', inspection_id = null, updated_by = p_actor where id = a.id;
  insert into public.assignments select draft.*;
  insert into public.assignment_addon_orders (assignment_id, org_id, addon_service_id, addon_key,
    addon_name_snapshot, price_amount_snapshot, currency_snapshot)
    select draft.id, org_id, addon_service_id, addon_key, addon_name_snapshot, price_amount_snapshot, currency_snapshot
      from public.assignment_addon_orders where assignment_id = a.id;
  update public.ob_assignment_workflows set current_assignment_id = draft.id,
    reviewed_snapshot = null, reviewed_acceptance_id = null, reviewed_at = null, reviewed_by = null
    where inspection_id = w.inspection_id;
  insert into public.ob_assignment_workflow_events (inspection_id, assignment_id, event_type, performed_by, snapshot)
    values (w.inspection_id, draft.id, 'reissued', p_actor, public.ob_assignment_snapshot(draft.id));
  update public.inspection_report_links set revoked_at = now() where inspection_id = w.inspection_id and revoked_at is null;
  return draft.id;
end;
$$;

-- Protect direct database writes as well as API calls. Existing lock guards remain intact.
create or replace function public.ob_guard_workflow_write()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_inspection_id uuid; state jsonb; row_data jsonb; assignment_id uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = 'UPDATE' and tg_table_name <> 'inspections' and
    to_jsonb(old)->>'inspection_id' is distinct from row_data->>'inspection_id' and exists (
      select 1 from public.ob_assignment_workflows where inspection_id = (to_jsonb(old)->>'inspection_id')::uuid
  ) then raise exception 'OB_INSPECTION_LINK_IMMUTABLE'; end if;
  v_inspection_id := case when tg_table_name = 'inspections' then (row_data->>'id')::uuid else (row_data->>'inspection_id')::uuid end;
  select current_assignment_id into assignment_id from public.ob_assignment_workflows w where w.inspection_id = v_inspection_id;
  if assignment_id is null then return coalesce(new, old); end if;
  if tg_table_name = 'inspections' and tg_op = 'UPDATE' and (
    row_data->'property_id' is distinct from to_jsonb(old)->'property_id' or
    row_data->'type' is distinct from to_jsonb(old)->'type' or
    row_data->'inspection_family' is distinct from to_jsonb(old)->'inspection_family' or
    row_data->'inspection_variant' is distinct from to_jsonb(old)->'inspection_variant'
  ) then raise exception 'OB_INSPECTION_LINK_IMMUTABLE'; end if;
  perform 1 from public.assignments where id = assignment_id for update;
  state := public.ob_assignment_workflow_state(v_inspection_id);
  if tg_table_name = 'inspection_report_links' then
    if tg_op = 'UPDATE' and new.revoked_at is not null then return new; end if;
    if not (state->>'canDeliver')::boolean then raise exception 'OB_DELIVERY_BLOCKED: %', state->>'reason'; end if;
  else
    if (state->>'paused')::boolean then raise exception 'OB_WORK_PAUSED'; end if;
    if tg_table_name = 'inspections' and tg_op = 'UPDATE' and
      (row_data->>'locked_at' is not null or lower(coalesce(row_data->>'status', '')) in ('completed', 'klar', 'done'))
      and not (state->>'canDeliver')::boolean then raise exception 'OB_DELIVERY_BLOCKED: %', state->>'reason'; end if;
  end if;
  return coalesce(new, old);
end;
$$;

do $$ declare t text; begin
  foreach t in array array['inspections', 'inspection_conditions', 'inspection_overview_selections',
    'inspection_documents', 'inspection_disclosures', 'inspection_exterior_observations',
    'inspection_interior_rooms', 'inspection_control_items', 'inspection_images', 'inspection_round_quick_notes', 'inspection_addon_orders',
    'inspection_area_measurements', 'inspection_area_measurement_rows', 'inspection_moisture_controls',
    'inspection_moisture_control_rows', 'inspection_moisture_control_images', 'ob_property_snapshot', 'inspection_report_links'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_ob_guard_workflow on public.%I', t);
      execute format('create trigger trg_ob_guard_workflow before insert or update or delete on public.%I for each row execute function public.ob_guard_workflow_write()', t);
    end if;
  end loop;
end $$;

create or replace function public.ob_guard_workflow_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare w public.ob_assignment_workflows;
begin
  select * into w from public.ob_assignment_workflows where current_assignment_id = old.id;
  if not found then return new; end if;
  if new.org_id is distinct from old.org_id or new.property_id is distinct from old.property_id
    or new.assignment_type is distinct from old.assignment_type
    or new.responsible_profile_id is distinct from old.responsible_profile_id then
    raise exception 'OB_INSPECTION_LINK_IMMUTABLE'; end if;
  -- Never let browser writes fabricate approval/booking or detach the tracked inspection.
  if coalesce(auth.role(), current_setting('role', true)) not in ('service_role', 'none') then
    raise exception 'OB_ASSIGNMENT_SERVER_WRITE_REQUIRED'; end if;
  if new.status not in ('booked', 'completed') or new.archived_at is not null or
    (to_jsonb(new) - array['updated_at','updated_by','status','notes_internal','archived_at','archived_by'])
      is distinct from
    (to_jsonb(old) - array['updated_at','updated_by','status','notes_internal','archived_at','archived_by']) then
    update public.inspection_report_links set revoked_at = now() where inspection_id = w.inspection_id and revoked_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ob_guard_workflow_assignment on public.assignments;
create trigger trg_ob_guard_workflow_assignment before update on public.assignments
  for each row execute function public.ob_guard_workflow_assignment();

create or replace function public.ob_guard_workflow_evidence()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare w public.ob_assignment_workflows;
begin
  for w in select * from public.ob_assignment_workflows
    where current_assignment_id in (
      (to_jsonb(old)->>'assignment_id')::uuid, (to_jsonb(new)->>'assignment_id')::uuid
    ) loop
    if coalesce(auth.role(), current_setting('role', true)) not in ('service_role', 'none') then
      raise exception 'OB_ASSIGNMENT_SERVER_WRITE_REQUIRED'; end if;
    perform 1 from public.assignments where id = w.current_assignment_id for update;
    update public.inspection_report_links set revoked_at = now() where inspection_id = w.inspection_id and revoked_at is null;
  end loop;
  return coalesce(new, old);
end;
$$;
do $$ declare t text; begin
  foreach t in array array['assignment_acceptances', 'assignment_links', 'assignment_addon_orders'] loop
    execute format('drop trigger if exists trg_ob_guard_workflow_evidence on public.%I', t);
    execute format('create trigger trg_ob_guard_workflow_evidence before insert or update or delete on public.%I for each row execute function public.ob_guard_workflow_evidence()', t);
  end loop;
end $$;

-- Serialize public approval with start/reissue; retain the installed acceptance implementation.
do $$ begin
  if to_regprocedure('public.consume_assignment_token_before_ob_early_start(text,text,jsonb,inet,text)') is null then
    alter function public.consume_assignment_token(text,text,jsonb,inet,text) rename to consume_assignment_token_before_ob_early_start;
  end if;
end $$;
create or replace function public.consume_assignment_token(p_token text, p_terms_version text,
  p_payload jsonb default '{}'::jsonb, p_ip inet default null, p_user_agent text default null)
returns table (assignment_id uuid, org_id uuid, status text)
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare a public.assignments;
begin
  select a0.* into a from public.assignments a0 join public.assignment_links l on l.assignment_id = a0.id
    where l.token_hash = encode(digest(p_token, 'sha256'), 'hex') for update of a0;
  if a.assignment_type = 'OB' and (a.status = 'cancelled' or a.archived_at is not null) then
    raise exception 'assignment_cancelled'; end if;
  return query select * from public.consume_assignment_token_before_ob_early_start(p_token, p_terms_version, p_payload, p_ip, p_user_agent);
end;
$$;

revoke all on function public.ob_assignment_snapshot(uuid), public.ob_assignment_workflow_state(uuid),
  public.ob_assert_assignment_actor(uuid,uuid,uuid), public.ob_start_assignment_inspection(uuid,uuid,uuid,text),
  public.ob_review_assignment_workflow(uuid,uuid,uuid,text), public.ob_reissue_started_assignment(uuid,uuid,uuid),
  public.ob_guard_workflow_write(), public.ob_guard_workflow_assignment(), public.ob_guard_workflow_evidence(), public.consume_assignment_token(text,text,jsonb,inet,text),
  public.consume_assignment_token_before_ob_early_start(text,text,jsonb,inet,text) from public, anon, authenticated;
revoke all on function public.consume_assignment_token_before_ob_early_start(text,text,jsonb,inet,text) from service_role;
grant execute on function public.ob_assignment_workflow_state(uuid), public.ob_start_assignment_inspection(uuid,uuid,uuid,text),
  public.ob_review_assignment_workflow(uuid,uuid,uuid,text), public.ob_reissue_started_assignment(uuid,uuid,uuid),
  public.consume_assignment_token(text,text,jsonb,inet,text) to service_role;
commit;
