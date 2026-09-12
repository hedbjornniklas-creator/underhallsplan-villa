-- OB: explicitly apply selected customer-approved details to an early-start inspection.
-- Prerequisite: 2026-09-10_02_ob_early_start.sql and its snapshot/acceptance prerequisites.
-- No existing inspection or property data is changed when this migration is installed.
begin;

create or replace function public.ob_reconciliation_inspection_side(p_value text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select case
    when translate(lower(btrim(p_value)), 'åäö', 'aao') ~ '(buy|kop)' then 'buyer'
    when translate(lower(btrim(p_value)), 'åäö', 'aao') ~ '(sell|salj)' then 'seller'
    when translate(lower(btrim(p_value)), 'åäö', 'aao') ~ '(apt|apartment|lagenhet)' then 'apartment'
    else null end;
$$;

-- Names match ob_assignment_snapshot. Values deliberately match the *displayed*
-- Grunddata loader, including legacy contacts, assignment customer fallback when
-- all structured customer fields are empty, and nullable property fallback.
-- Otherwise an apparently blank comparison could overwrite a value visible in
-- Grunddata. RPC import still requires a real inspection-local property snapshot.
create or replace function public.ob_assignment_inspection_snapshot(p_inspection_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with source as (
    select i.*, num_nonnulls(nullif(btrim(i.customer_name), ''), nullif(btrim(i.customer_email), ''),
      nullif(btrim(i.customer_phone), ''), nullif(btrim(i.customer_address), ''),
      nullif(btrim(i.customer_postal_code), ''), nullif(btrim(i.customer_city), '')) > 0 as has_customer_fields,
      lower(substring(i.client_contact from '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}')) as legacy_email,
      nullif(btrim(regexp_replace(regexp_replace(coalesce(i.client_contact, ''),
        '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '', 'i'), '\s*\|\s*', ' ', 'g')), '') as legacy_phone
    from public.inspections i where i.id = p_inspection_id
  )
  select jsonb_build_object(
    'customer_name', coalesce(nullif(btrim(i.customer_name), ''), nullif(btrim(i.client_name), ''),
      case when not i.has_customer_fields then a.customer_name end),
    'customer_email', coalesce(lower(nullif(btrim(i.customer_email), '')), i.legacy_email,
      case when not i.has_customer_fields then a.customer_email end),
    'customer_phone', coalesce(nullif(btrim(i.customer_phone), ''), i.legacy_phone,
      case when not i.has_customer_fields then a.customer_phone end),
    'customer_address', case when i.has_customer_fields then i.customer_address else a.customer_address end,
    'customer_postal_code', case when i.has_customer_fields then i.customer_postal_code else a.customer_postal_code end,
    'customer_city', case when i.has_customer_fields then i.customer_city else a.customer_city end,
    'property_address', coalesce(s.address, p.address), 'property_postal_code', coalesce(s.postal_code, p.postal_code),
    'property_city', coalesce(s.city, p.city), 'property_municipality', coalesce(s.municipality, p.municipality),
    'property_owner_name', coalesce(s.owner_name, p.owner_name), 'cadastral_id', coalesce(s.cadastral_id, p.cadastral_id),
    'brf_name', coalesce(s.brf_name, a.brf_name), 'apartment_number', coalesce(s.apartment_number, a.apartment_number),
    'apartment_holder_name', coalesce(s.apartment_holder_name, a.apartment_holder_name),
    'orderer_role', coalesce(public.ob_reconciliation_inspection_side(i.inspection_side),
      public.ob_reconciliation_inspection_side(a.orderer_role), 'buyer'), 'preferred_date', i.date,
    'preferred_time', i.inspection_time, 'assignment_number', i.assignment_number
  ) from source i
  join public.ob_property_snapshot s on s.inspection_id = i.id
  join public.ob_assignment_workflows w on w.inspection_id = i.id
  join public.assignments a on a.id = w.current_assignment_id
  left join public.properties p on p.id = i.property_id;
$$;

-- Keep approval/review state independent of inspector edits. The separate token
-- protects the *displayed* inspection values during an explicit import only.
create or replace function public.ob_assignment_workflow_state(p_inspection_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  w public.ob_assignment_workflows; a public.assignments; i public.inspections;
  acceptance_id uuid; snapshot jsonb; inspection_snapshot jsonb;
  block_reason text; paused boolean; reviewed boolean; review_token text; inspection_locked boolean;
begin
  select * into w from public.ob_assignment_workflows where inspection_id = p_inspection_id;
  if not found then return null; end if;
  select * into a from public.assignments where id = w.current_assignment_id;
  select * into i from public.inspections where id = p_inspection_id;
  select id into acceptance_id from public.assignment_acceptances
    where assignment_id = a.id and accepted_at = a.accepted_at order by created_at desc, id limit 1;
  snapshot := public.ob_assignment_snapshot(a.id);
  inspection_snapshot := public.ob_assignment_inspection_snapshot(p_inspection_id);
  inspection_locked := i.locked_at is not null or lower(coalesce(i.status, '')) in ('completed', 'klar', 'done');
  paused := a.status in ('cancelled', 'expired', 'draft') or a.archived_at is not null or
    (a.status = 'sent' and not exists (select 1 from public.assignment_links l where l.assignment_id = a.id
      and l.used_at is null and l.revoked_at is null and l.expires_at > now()));
  reviewed := acceptance_id is not null and w.reviewed_acceptance_id = acceptance_id
    and w.reviewed_snapshot = snapshot;
  review_token := md5(snapshot::text || coalesce(acceptance_id::text, ''));
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
    'inspectionSnapshot', inspection_snapshot, 'inspectionLocked', inspection_locked,
    'reviewToken', review_token,
    'reconciliationToken', case when inspection_snapshot is not null then md5(
      jsonb_build_array(review_token, inspection_snapshot, i.client_name, i.client_contact, inspection_locked,
        jsonb_build_array(i.customer_name, i.customer_email, i.customer_phone, i.customer_address,
          i.customer_postal_code, i.customer_city))::text) end,
    'needsReview', not coalesce(reviewed, false), 'paused', paused,
    'canDeliver', block_reason is null, 'reason', block_reason);
end;
$$;

create or replace function public.ob_reconcile_assignment_workflow(
  p_inspection_id uuid, p_org_id uuid, p_actor uuid, p_review_token text,
  p_reconciliation_token text, p_fields text[]
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  w public.ob_assignment_workflows; a public.assignments; i public.inspections;
  s public.ob_property_snapshot; state jsonb; after_state jsonb; before_snapshot jsonb; after_snapshot jsonb;
  acceptance_id uuid; selected_fields text[]; inspection_fields text[];
  property_fields text[]; allowed_fields text[]; normalized_role text; preserve_customer_fallback boolean;
  number_prefix text; next_number bigint; reconciled_number text;
begin
  inspection_fields := array['customer_name','customer_email','customer_phone','customer_address',
    'customer_postal_code','customer_city','preferred_date','preferred_time','orderer_role'];
  property_fields := array['property_address','property_postal_code','property_city','property_municipality',
    'property_owner_name','cadastral_id','brf_name','apartment_number','apartment_holder_name'];
  allowed_fields := inspection_fields || property_fields;
  -- [] is an explicit keep-my-values review. NULL and unknown/commercial keys
  -- must not silently turn into an acknowledgement that looks like an import.
  if p_fields is null or array_ndims(p_fields) > 1 or exists (
    select 1 from unnest(p_fields) f where f is null or not (f = any(allowed_fields))
  ) then raise exception 'OB_RECONCILIATION_INVALID_FIELDS'; end if;
  select coalesce(array_agg(distinct f order by f), array[]::text[]) into selected_fields from unnest(p_fields) f;

  select * into w from public.ob_assignment_workflows where inspection_id = p_inspection_id and org_id = p_org_id;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
  -- Same ordering as start/reissue/review: assignment -> workflow -> inspection
  -- -> snapshot. Re-check the workflow after taking its lock (reissue may race).
  select * into a from public.assignments where id = w.current_assignment_id for update;
  perform public.ob_assert_assignment_actor(a.id, p_org_id, p_actor);
  select * into w from public.ob_assignment_workflows where inspection_id = p_inspection_id and org_id = p_org_id for update;
  if w.current_assignment_id is distinct from a.id then raise exception 'OB_WORKFLOW_CHANGED'; end if;
  select * into i from public.inspections where id = p_inspection_id for update;
  if not found or i.property_id is distinct from a.property_id or a.inspection_id is distinct from i.id
    or i.inspection_family is distinct from 'OB' then raise exception 'OB_WORKFLOW_CHANGED'; end if;
  if i.locked_at is not null or lower(coalesce(i.status, '')) in ('completed', 'klar', 'done') then
    raise exception 'OB_INSPECTION_LOCKED'; end if;
  select * into s from public.ob_property_snapshot where inspection_id = p_inspection_id for update;
  if not found then raise exception 'OB_RECONCILIATION_SNAPSHOT_MISSING'; end if;
  -- Grunddata falls back to nullable shared property values. Lock that source
  -- after the local snapshot before comparing the displayed-value token.
  perform 1 from public.properties where id = i.property_id for share;

  state := public.ob_assignment_workflow_state(p_inspection_id);
  if a.status not in ('booked', 'completed') or a.accepted_at is null or a.booked_at is null
    or coalesce((state->>'paused')::boolean, true) then raise exception 'OB_APPROVAL_REQUIRED'; end if;
  if p_review_token is null or state->>'reviewToken' is distinct from p_review_token then
    raise exception 'OB_WORKFLOW_CHANGED'; end if;
  if p_reconciliation_token is null or state->>'reconciliationToken' is distinct from p_reconciliation_token then
    raise exception 'OB_RECONCILIATION_CHANGED'; end if;
  select id into acceptance_id from public.assignment_acceptances where assignment_id = a.id
    and accepted_at = a.accepted_at order by created_at desc, id limit 1;
  if acceptance_id is null then raise exception 'OB_APPROVAL_REQUIRED'; end if;
  -- A blank customer form is not authority to erase inspection data. Empty
  -- values remain visible for comparison but are not transferable here.
  if exists (select 1 from unnest(selected_fields) f
    where nullif(btrim(state->'currentSnapshot'->>f), '') is null) then
    raise exception 'OB_RECONCILIATION_FIELD_EMPTY'; end if;
  before_snapshot := state->'inspectionSnapshot';
  normalized_role := coalesce(public.ob_reconciliation_inspection_side(a.orderer_role), 'buyer');
  -- The loader switches all six customer fields from assignment fallback to
  -- inspection data when any structured field is filled. Preserve the other
  -- currently displayed values when an import first makes that switch. This is
  -- the sole case where unselected empty storage fields need materialization;
  -- their effective values are unchanged and are included in the audit.
  preserve_customer_fallback := selected_fields && array['customer_name','customer_email','customer_phone',
    'customer_address','customer_postal_code','customer_city'] and
    num_nonnulls(nullif(btrim(i.customer_name), ''), nullif(btrim(i.customer_email), ''),
      nullif(btrim(i.customer_phone), ''), nullif(btrim(i.customer_address), ''),
      nullif(btrim(i.customer_postal_code), ''), nullif(btrim(i.customer_city), '')) = 0;
  reconciled_number := i.assignment_number;
  if 'preferred_date' = any(selected_fields) then
    number_prefix := to_char(a.preferred_date, 'YYYY-MMDD');
    if coalesce(i.assignment_number, '') !~ ('^' || number_prefix || '-[0-9]{2,}$') then
      -- Match the normal start numbering rule under its same per-day lock, so
      -- reconciliation from Handlingar/Runda is just as consistent as Grunddata.
      perform pg_advisory_xact_lock(hashtextextended('ob-assignment-number:' || a.preferred_date::text, 0));
      select coalesce(max(substring(other_i.assignment_number from '[0-9]+$')::bigint), 0) + 1 into next_number
        from public.inspections other_i where other_i.inspection_family = 'OB' and other_i.date = a.preferred_date
          and other_i.assignment_number ~ ('^' || number_prefix || '-[0-9]+$');
      reconciled_number := number_prefix || '-' || lpad(next_number::text, greatest(2, length(next_number::text)), '0');
    end if;
  end if;

  if selected_fields && inspection_fields then
    update public.inspections set
      customer_name = case when 'customer_name' = any(selected_fields) then a.customer_name
        when preserve_customer_fallback then before_snapshot->>'customer_name' else i.customer_name end,
      customer_email = case when 'customer_email' = any(selected_fields) then a.customer_email
        when preserve_customer_fallback then before_snapshot->>'customer_email' else i.customer_email end,
      customer_phone = case when 'customer_phone' = any(selected_fields) then a.customer_phone
        when preserve_customer_fallback then before_snapshot->>'customer_phone' else i.customer_phone end,
      customer_address = case when 'customer_address' = any(selected_fields) then a.customer_address
        when preserve_customer_fallback then before_snapshot->>'customer_address' else i.customer_address end,
      customer_postal_code = case when 'customer_postal_code' = any(selected_fields) then a.customer_postal_code
        when preserve_customer_fallback then before_snapshot->>'customer_postal_code' else i.customer_postal_code end,
      customer_city = case when 'customer_city' = any(selected_fields) then a.customer_city
        when preserve_customer_fallback then before_snapshot->>'customer_city' else i.customer_city end,
      client_name = case when 'customer_name' = any(selected_fields) then a.customer_name else i.client_name end,
      client_contact = case when selected_fields && array['customer_phone','customer_email'] then nullif(concat_ws(' | ',
        nullif(case when 'customer_phone' = any(selected_fields) then a.customer_phone else before_snapshot->>'customer_phone' end, ''),
        nullif(case when 'customer_email' = any(selected_fields) then a.customer_email else before_snapshot->>'customer_email' end, '')), '') else i.client_contact end,
      date = case when 'preferred_date' = any(selected_fields) then a.preferred_date else i.date end,
      inspection_time = case when 'preferred_time' = any(selected_fields) then a.preferred_time else i.inspection_time end,
      inspection_side = case when 'orderer_role' = any(selected_fields) then normalized_role else i.inspection_side end,
      assignment_number = reconciled_number
    where id = p_inspection_id;
  end if;
  if selected_fields && property_fields then
    update public.ob_property_snapshot set
      address = case when 'property_address' = any(selected_fields) then coalesce(a.property_address, a.preliminary_address) else s.address end,
      postal_code = case when 'property_postal_code' = any(selected_fields) then a.property_postal_code else s.postal_code end,
      city = case when 'property_city' = any(selected_fields) then a.property_city else s.city end,
      municipality = case when 'property_municipality' = any(selected_fields) then a.property_municipality else s.municipality end,
      owner_name = case when 'property_owner_name' = any(selected_fields) then a.property_owner_name else s.owner_name end,
      cadastral_id = case when 'cadastral_id' = any(selected_fields) then a.cadastral_id else s.cadastral_id end,
      brf_name = case when 'brf_name' = any(selected_fields) then a.brf_name else s.brf_name end,
      apartment_number = case when 'apartment_number' = any(selected_fields) then a.apartment_number else s.apartment_number end,
      apartment_holder_name = case when 'apartment_holder_name' = any(selected_fields) then a.apartment_holder_name else s.apartment_holder_name end
    where inspection_id = p_inspection_id;
  end if;
  after_snapshot := public.ob_assignment_inspection_snapshot(p_inspection_id);
  after_state := public.ob_assignment_workflow_state(p_inspection_id);
  -- Reopening an already reviewed workflow is allowed. Exact no-op retries do
  -- not create repeated audit events; stale imports with changed values fail above.
  -- Include aliases in the comparison: correcting client_contact is a real edit
  -- even if the structured phone/email were already the same.
  if not (state->>'needsReview')::boolean and state->>'reconciliationToken' = after_state->>'reconciliationToken' then
    return after_state; end if;
  update public.ob_assignment_workflows set reviewed_snapshot = state->'currentSnapshot',
    reviewed_acceptance_id = acceptance_id, reviewed_at = now(), reviewed_by = p_actor
    where inspection_id = p_inspection_id;
  insert into public.ob_assignment_workflow_events (inspection_id, assignment_id, event_type, performed_by, snapshot)
    values (p_inspection_id, a.id, 'reviewed', p_actor,
      (state->'currentSnapshot') || jsonb_build_object('_reconciliation', jsonb_build_object(
        'version', 1, 'selectedFields', to_jsonb(selected_fields),
        'before', before_snapshot, 'after', after_snapshot,
        'preservedCustomerFallback', preserve_customer_fallback,
        'storedCustomerBefore', jsonb_build_object('customer_name', i.customer_name, 'customer_email', i.customer_email,
          'customer_phone', i.customer_phone, 'customer_address', i.customer_address,
          'customer_postal_code', i.customer_postal_code, 'customer_city', i.customer_city),
        'storedCustomerAfter', (select jsonb_build_object('customer_name', current_i.customer_name, 'customer_email', current_i.customer_email,
          'customer_phone', current_i.customer_phone, 'customer_address', current_i.customer_address,
          'customer_postal_code', current_i.customer_postal_code, 'customer_city', current_i.customer_city)
          from public.inspections current_i where current_i.id = p_inspection_id),
        'legacyBefore', jsonb_build_object('client_name', i.client_name, 'client_contact', i.client_contact),
        'legacyAfter', (select jsonb_build_object('client_name', current_i.client_name, 'client_contact', current_i.client_contact)
          from public.inspections current_i where current_i.id = p_inspection_id))));
  return public.ob_assignment_workflow_state(p_inspection_id);
end;
$$;

revoke all on function public.ob_reconciliation_inspection_side(text), public.ob_assignment_inspection_snapshot(uuid), public.ob_assignment_workflow_state(uuid),
  public.ob_reconcile_assignment_workflow(uuid,uuid,uuid,text,text,text[]) from public, anon, authenticated;
grant execute on function public.ob_assignment_workflow_state(uuid),
  public.ob_reconcile_assignment_workflow(uuid,uuid,uuid,text,text,text[]) to service_role;
commit;
