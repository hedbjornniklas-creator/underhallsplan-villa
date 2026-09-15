-- Scoped counterpart of the established round mutation contract. Root inspection
-- authorization, audit and recovery are retained. Original RPC remains for legacy.
begin;
create or replace function public.ob_building_round_mutate(
  p_inspection_id uuid, p_org_id uuid, p_actor uuid, p_operation text, p_payload jsonb,
  p_part_id uuid, p_floor_keys text[] default '{}'::text[]
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  i public.inspections; r public.inspection_interior_rooms; n public.inspection_control_items;
  img public.inspection_images; obs public.inspection_exterior_observations; ext public.settings_exterior_items;
  outcome public.settings_control_point_outcomes; point public.settings_control_points;
  prior public.ob_round_mutation_events; v_assignment uuid; v_state jsonb;
  v_id uuid; v_request_id uuid; v_event_id uuid := gen_random_uuid(); v_kind text;
  v_room_id uuid; v_obs_id uuid; v_item_id uuid; v_floor text; v_token text;
  v_explicit_place boolean := false; v_target jsonb; v_destination uuid; v_levels jsonb;
  v_before jsonb; v_result jsonb; v_record jsonb; v_notes jsonb := '[]'; v_images jsonb := '[]'; v_quick jsonb := '[]';
  v_label text; v_blocked text; v_draft jsonb; v_note_ids jsonb := '[]'; v_image_ids jsonb := '[]'; v_quick_ids jsonb := '[]';
begin
  if p_actor is null or p_org_id is null or not exists (
    select 1 from public.org_members where org_id = p_org_id and profile_id = p_actor and is_active
  ) then raise exception 'OB_ROUND_FORBIDDEN'; end if;
  -- Same owner rule as OB unlock; no new organization-wide data access.
  if not exists (select 1 from public.inspections si join public.properties sp on sp.id = si.property_id
    where si.id = p_inspection_id and sp.owner = p_actor and coalesce(si.inspection_family, si.type) = 'OB') then
    raise exception 'OB_ROUND_FORBIDDEN'; end if;
  select current_assignment_id into v_assignment from public.ob_assignment_workflows where inspection_id = p_inspection_id;
  if v_assignment is not null then perform 1 from public.assignments where id = v_assignment for update; end if;
  select * into i from public.inspections where id = p_inspection_id for update;
  if i.locked_at is not null or lower(coalesce(i.status, '')) in ('completed','klar','done') then raise exception 'OB_ROUND_LOCKED'; end if;
  v_state := public.ob_assignment_workflow_state(p_inspection_id);
  if coalesce((v_state->>'paused')::boolean, false) then raise exception 'OB_ROUND_PAUSED'; end if;

  if not exists(select 1 from public.ob_inspection_buildings where id=p_part_id and inspection_id=i.id)
    or not exists(select 1 from public.ob_inspection_structure where inspection_id=i.id) then raise exception 'OB_ROUND_FOREIGN'; end if;
  perform set_config('ob.building_command',i.id::text,true);
  v_destination := coalesce((p_payload->>'targetBuildingPartId')::uuid,p_part_id);
  if not exists(select 1 from public.ob_inspection_buildings where id=v_destination and inspection_id=i.id) then raise exception 'OB_ROUND_FOREIGN'; end if;
  p_payload := p_payload || jsonb_build_object('_buildingPartId',p_part_id);
  select levels into v_levels from public.ob_building_floor_models where building_part_id=v_destination;
  if v_levels is not null then
    select array_agg('plan'||(x->>'level')) || array['ovrigt'] into p_floor_keys from jsonb_array_elements(v_levels) x;
  end if;

  if p_operation = 'floor-context' then
    return jsonb_build_object(
      'rooms', (select coalesce(jsonb_agg(jsonb_build_object('floor_label', floor_label)), '[]') from public.inspection_interior_rooms where inspection_id = i.id and building_part_id = p_part_id),
      'values', (select s.values from public.inspection_overview_selections s join public.settings_overview_items o on o.id = s.overview_item_id
        where s.inspection_id = i.id and s.building_part_id = p_part_id and o.key = 'building_type' and o.is_active order by s.set_index limit 1),
      'groups', (select coalesce(jsonb_agg(jsonb_build_object('key', g.key, 'options',
        (select coalesce(jsonb_agg(to_jsonb(opt)), '[]') from public.settings_overview_options opt where opt.group_id = g.id and opt.is_active))), '[]')
        from public.settings_overview_groups g join public.settings_overview_items o on o.id = g.overview_item_id
        where o.key = 'building_type' and o.is_active and g.is_active));
  end if;
  -- Distinct wire operations make deployments fail closed against the original
  -- function: it rejects unknown operations rather than silently ignoring target.
  -- Normalize before receipt lookup so all creates use the existing atomic path;
  -- the complete target remains part of the request used for idempotency.
  if p_operation in ('image-note-place-preview', 'image-note-place') then
    v_target := p_payload->'target';
    if jsonb_typeof(v_target) is distinct from 'object' or not coalesce(
      (v_target->>'area' = 'interior' and not (v_target ? 'exteriorItemId')
        and (v_target->>'roomId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or (v_target->>'area' = 'exterior' and not (v_target ? 'roomId')
        and (v_target->>'exteriorItemId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), false)
      then raise exception 'OB_ROUND_INVALID'; end if;
    v_explicit_place := true;
    p_operation := case when p_operation = 'image-note-place-preview' then 'image-note-preview' else 'image-note' end;
  elsif p_operation in ('image-note-preview', 'image-note') and p_payload ? 'target' then
    raise exception 'OB_ROUND_INVALID';
  end if;
  if p_operation not in ('move', 'remove-preview', 'remove', 'image-note-preview', 'image-note')
    or jsonb_typeof(p_payload) <> 'object' then raise exception 'OB_ROUND_INVALID'; end if;
  if p_operation in ('move', 'remove', 'image-note') then
    v_request_id := (p_payload->>'requestId')::uuid;
    if v_request_id is null then raise exception 'OB_ROUND_INVALID'; end if;
    select * into prior from public.ob_round_mutation_events where inspection_id = i.id and request_id = v_request_id;
    if found then
      if prior.actor_id is distinct from p_actor or prior.operation <> p_operation or prior.request <> p_payload then raise exception 'OB_ROUND_STALE'; end if;
      -- Return current surviving records, not stale snapshots that undo later edits in the UI.
      v_result := prior.result;
      if v_result->'room' <> 'null'::jsonb then v_result := jsonb_set(v_result, '{room}', coalesce((select to_jsonb(t) from public.inspection_interior_rooms t where t.id = (v_result->'room'->>'id')::uuid), 'null')); end if;
      if v_result->'note' <> 'null'::jsonb then v_result := jsonb_set(v_result, '{note}', coalesce((select to_jsonb(t) from public.inspection_control_items t where t.id = (v_result->'note'->>'id')::uuid), 'null')); end if;
      if v_result ? 'images' then v_result := jsonb_set(v_result, '{images}', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.inspection_images t where t.id in (select (x->>'id')::uuid from jsonb_array_elements(prior.result->'images') x))); end if;
      if v_result ? 'image' then v_result := jsonb_set(v_result, '{image}', coalesce((select to_jsonb(t) from public.inspection_images t where t.id = (v_result->'image'->>'id')::uuid), 'null')); end if;
      if v_result ? 'observation' then v_result := jsonb_set(v_result, '{observation}', coalesce((select to_jsonb(t) from public.inspection_exterior_observations t where t.id = (v_result->'note'->>'exterior_observation_id')::uuid and t.inspection_id = i.id), 'null')); end if;
      return v_result;
    end if;
  end if;
  v_id := coalesce(p_payload->>'id', p_payload->>'imageId')::uuid;
  v_kind := case when p_operation like 'image-note%' then 'image' else p_payload->>'kind' end;
  if v_kind = 'room' then
    select * into r from public.inspection_interior_rooms where id = v_id and inspection_id = i.id and building_part_id = p_part_id for update;
    if not found then raise exception 'OB_ROUND_NOT_FOUND'; end if;
    v_record := to_jsonb(r); v_label := r.room_label;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') into v_notes from public.inspection_control_items t where interior_room_id = r.id;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') into v_images from public.inspection_images t
      where interior_room_id = r.id or origin_interior_room_id = r.id or control_item_id in (select (x->>'id')::uuid from jsonb_array_elements(v_notes) x);
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') into v_quick from public.inspection_round_quick_notes t where interior_room_id = r.id;
  elsif v_kind = 'note' then
    select * into n from public.inspection_control_items where id = v_id and inspection_id = i.id and building_part_id = p_part_id for update;
    if not found then raise exception 'OB_ROUND_NOT_FOUND'; end if;
    v_record := to_jsonb(n); v_label := coalesce(nullif(n.note,''), n.title);
    select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') into v_images from public.inspection_images t where control_item_id = n.id;
  elsif v_kind = 'image' then
    select * into img from public.inspection_images where id = v_id and inspection_id = i.id and (building_part_id = p_part_id or building_part_id is null) for update;
    if not found then raise exception 'OB_ROUND_NOT_FOUND'; end if;
    v_record := to_jsonb(img); v_label := coalesce(img.label, 'Bild');
  else raise exception 'OB_ROUND_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(v_notes || v_images || v_quick) x where x->>'inspection_id' <> i.id::text) then
    raise exception 'OB_ROUND_FOREIGN'; end if;
  v_before := jsonb_build_object('record', v_record, 'notes', v_notes, 'images', v_images, 'quickNotes', v_quick);

  if p_operation in ('remove-preview', 'remove') then
    v_token := md5(v_before::text);
    if v_kind = 'room' and (coalesce(r.values, '{}') <> '{}'::jsonb or length(btrim(coalesce(r.note,''))) > 0
      or jsonb_array_length(v_images) > 0
      or exists (select 1 from jsonb_array_elements(v_quick) x where length(btrim(coalesce(x->>'note',''))) > 0)
      or exists (select 1 from jsonb_array_elements(v_notes) x where x->>'control_point_id' is null
        or x->>'status' is not null or x->>'selected_outcome_id' is not null
        or length(btrim(coalesce(x->>'note','') || coalesce(x->>'risk_text','') || coalesce(x->>'ftu_text',''))) > 0)) then
      v_blocked := 'Rummet innehaller uppgifter, noteringar eller bilder.';
    end if;
    if p_operation = 'remove-preview' then return jsonb_build_object('kind', v_kind, 'id', v_id, 'token', v_token,
      'label', v_label, 'blockedReason', v_blocked, 'counts', jsonb_build_object('notes', jsonb_array_length(v_notes), 'images', jsonb_array_length(v_images), 'quickNotes', jsonb_array_length(v_quick))); end if;
    if p_payload->>'token' is distinct from v_token then raise exception 'OB_ROUND_STALE'; end if;
    if v_blocked is not null then raise exception 'OB_ROUND_ROOM_NOT_EMPTY'; end if;
    if v_kind = 'note' then
      -- Unlink before deleting; some existing FKs cascade image rows.
      update public.inspection_images set control_item_id = null, interior_room_id = n.interior_room_id,
        exterior_observation_id = n.exterior_observation_id, processing_status = 'unprocessed', ignored_at = null where control_item_id = n.id;
      delete from public.inspection_control_items where id = n.id;
      v_note_ids := jsonb_build_array(n.id);
      select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v_images from public.inspection_images t
        where t.id in (select (x->>'id')::uuid from jsonb_array_elements(v_before->'images') x);
    elsif v_kind = 'image' then
      delete from public.inspection_images where id = img.id;
      v_image_ids := jsonb_build_array(img.id);
    else
      select coalesce(jsonb_agg(x->'id'), '[]') into v_note_ids from jsonb_array_elements(v_notes) x;
      select coalesce(jsonb_agg(x->'id'), '[]') into v_quick_ids from jsonb_array_elements(v_quick) x;
      delete from public.inspection_control_items where interior_room_id = r.id;
      delete from public.inspection_round_quick_notes where interior_room_id = r.id;
      delete from public.inspection_interior_rooms where id = r.id;
    end if;
    v_result := jsonb_build_object('roomId', case when v_kind = 'room' then r.id end, 'noteIds', v_note_ids,
      'imageIds', v_image_ids, 'quickNoteIds', v_quick_ids, 'images', v_images, 'archiveId', v_event_id);
  elsif p_operation = 'move' then
    if v_kind = 'room' then
      v_floor := p_payload->>'floor';
      if v_floor is null or not (v_floor = any(p_floor_keys)) or (v_floor = r.floor_label and v_destination = p_part_id) then raise exception 'OB_ROUND_INVALID'; end if;
      if p_payload->'from'->>'floor' is distinct from r.floor_label then raise exception 'OB_ROUND_STALE'; end if;
      update public.inspection_interior_rooms set floor_label = v_floor, building_part_id = v_destination, updated_at = now(),
        order_index = (select coalesce(max(order_index),0) + 10 from public.inspection_interior_rooms where inspection_id = i.id and building_part_id = v_destination and floor_label = v_floor)
        where id = r.id returning * into r;
      update public.inspection_control_items set building_part_id=v_destination where interior_room_id=r.id;
      update public.inspection_round_quick_notes set building_part_id=v_destination where interior_room_id=r.id;
      update public.inspection_images set building_part_id=v_destination where interior_room_id=r.id;
      v_result := jsonb_build_object('room', to_jsonb(r), 'note', null, 'images', '[]'::jsonb, 'observation', null);
    elsif v_kind = 'note' then
      if (p_payload->'from'->>'roomId')::uuid is distinct from n.interior_room_id
        or (p_payload->'from'->>'observationId')::uuid is distinct from n.exterior_observation_id then raise exception 'OB_ROUND_STALE'; end if;
      if p_payload->'target'->>'area' = 'interior' then v_room_id := (p_payload->'target'->>'roomId')::uuid;
      elsif p_payload->'target'->>'area' = 'exterior' then v_item_id := (p_payload->'target'->>'exteriorItemId')::uuid;
      else raise exception 'OB_ROUND_INVALID'; end if;
    else raise exception 'OB_ROUND_INVALID'; end if;
  else
    if img.control_item_id is not null then raise exception 'OB_ROUND_IMAGE_LINKED'; end if;
    if v_explicit_place then
      if v_target->>'area' = 'interior' then v_room_id := (v_target->>'roomId')::uuid;
      else v_item_id := (v_target->>'exteriorItemId')::uuid; end if;
    -- Without an explicit choice, keep current placement then capture origin.
    -- Never infer a place from the active UI room.
    elsif img.interior_room_id is not null or img.exterior_observation_id is not null then
      v_room_id := img.interior_room_id; v_obs_id := img.exterior_observation_id;
    else v_room_id := img.origin_interior_room_id; v_obs_id := img.origin_exterior_observation_id; v_item_id := img.origin_exterior_item_id; end if;
  end if;

  if (p_operation = 'move' and v_kind = 'note') or p_operation like 'image-note%' then
    if v_room_id is not null then
      if v_obs_id is not null or v_item_id is not null then raise exception 'OB_ROUND_PLACE_REQUIRED'; end if;
      select * into r from public.inspection_interior_rooms where id = v_room_id and inspection_id = i.id and building_part_id=v_destination for update;
      if not found then raise exception 'OB_ROUND_PLACE_REQUIRED'; end if;
    else
      if v_obs_id is not null then
        select * into obs from public.inspection_exterior_observations where id = v_obs_id and inspection_id = i.id and building_part_id=v_destination
          and not coalesce(is_free_note,false) and coalesce(values->>'_free_note','false') <> 'true' for update;
        if not found then raise exception 'OB_ROUND_PLACE_REQUIRED'; end if;
        if v_item_id is not null and v_item_id <> obs.exterior_item_id then raise exception 'OB_ROUND_PLACE_REQUIRED'; end if;
        v_item_id := obs.exterior_item_id;
      end if;
      select * into ext from public.settings_exterior_items where id = v_item_id and is_active for share;
      if not found then raise exception 'OB_ROUND_PLACE_REQUIRED'; end if;
      if obs.id is null then
        select * into obs from public.inspection_exterior_observations where inspection_id = i.id and building_part_id=v_destination and exterior_item_id = ext.id
          and not coalesce(is_free_note,false) and coalesce(values->>'_free_note','false') <> 'true'
          order by created_at, id limit 1 for update;
      end if;
    end if;
    if p_operation like 'image-note%' then
      -- Preserve legacy tokens when no place was chosen. Explicit tokens bind
      -- the original image snapshot AND the validated chosen place snapshot.
      v_token := md5((jsonb_build_object('image', img, 'room', r, 'observation', obs, 'exteriorItem', ext)
        || case when v_explicit_place then jsonb_build_object('target', v_target) else '{}'::jsonb end)::text);
      if p_operation = 'image-note-preview' then return jsonb_build_object('token', v_token,
        'room', case when r.id is not null then to_jsonb(r) end,
        'observation', case when obs.id is not null then to_jsonb(obs) end,
        'exteriorItem', case when ext.id is not null then to_jsonb(ext) end); end if;
      if p_payload->>'token' is distinct from v_token then raise exception 'OB_ROUND_STALE'; end if;
      v_draft := p_payload->'draft';
      if jsonb_typeof(v_draft) <> 'object' or not exists (select 1 from unnest(array['note','risk_text','ftu_text']) k
        where length(btrim(coalesce(v_draft->>k,''))) > 0) then raise exception 'OB_ROUND_TEXT_REQUIRED'; end if;
      if exists (select 1 from unnest(array['note','risk_text','ftu_text']) k where jsonb_typeof(v_draft->k) <> 'string' or length(v_draft->>k) > 20000) then raise exception 'OB_ROUND_INVALID'; end if;
      if v_draft->>'outcomeId' is not null then
        select * into outcome from public.settings_control_point_outcomes where id = (v_draft->>'outcomeId')::uuid and is_active;
        if not found then raise exception 'OB_ROUND_INVALID'; end if;
        select * into point from public.settings_control_points where id = outcome.control_point_id and is_active;
        if not found then raise exception 'OB_ROUND_INVALID'; end if;
        if coalesce(cardinality(point.applies_to),0) > 0 and not (coalesce(i.inspection_side,'buyer') = any(point.applies_to)
          or 'all' = any(point.applies_to)) then raise exception 'OB_ROUND_INVALID'; end if;
      end if;
    end if;
    if r.id is null and obs.id is null then
      insert into public.inspection_exterior_observations(inspection_id, building_part_id, exterior_item_id, part_label, values, is_free_note)
        values(i.id, v_destination, ext.id, null, '{}', false) returning * into obs;
    end if;
    if p_operation = 'move' then
      update public.inspection_control_items set building_part_id=v_destination, interior_room_id = r.id, exterior_observation_id = obs.id, updated_at = now(),
        sort_order = (select coalesce(max(sort_order),0) + 10 from public.inspection_control_items
          where inspection_id = i.id and building_part_id=v_destination and interior_room_id is not distinct from r.id and exterior_observation_id is not distinct from obs.id)
        where id = n.id returning * into n;
      update public.inspection_images set building_part_id=v_destination, interior_room_id = n.interior_room_id, exterior_observation_id = n.exterior_observation_id where control_item_id = n.id;
      select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v_images from public.inspection_images t where control_item_id = n.id;
      v_result := jsonb_build_object('room', null, 'note', to_jsonb(n), 'images', v_images,
        'observation', case when obs.id is not null then to_jsonb(obs) end);
    else
      insert into public.inspection_control_items(inspection_id, building_part_id, interior_room_id, exterior_observation_id,
        control_point_id, selected_outcome_id, title, status, note, risk_text, ftu_text, sort_order)
        values(i.id, v_destination, r.id, obs.id, point.id, outcome.id, coalesce(nullif(point.title,''), point.label, point.key, 'Fri notering'),
          case when outcome.id is not null then 'remark' end, v_draft->>'note', v_draft->>'risk_text', v_draft->>'ftu_text',
          (select coalesce(max(sort_order),0) + 10 from public.inspection_control_items where inspection_id = i.id and building_part_id=v_destination
            and interior_room_id is not distinct from r.id and exterior_observation_id is not distinct from obs.id)) returning * into n;
      update public.inspection_images set building_part_id=v_destination, control_item_id = n.id, interior_room_id = r.id, exterior_observation_id = obs.id,
        processing_status = 'linked', ignored_at = null where id = img.id returning * into img;
      v_result := jsonb_build_object('note', to_jsonb(n), 'image', to_jsonb(img),
        'observation', case when obs.id is not null then to_jsonb(obs) end);
    end if;
  end if;
  insert into public.ob_round_mutation_events(id, inspection_id, actor_id, request_id, operation, request, before_data, result)
    values(v_event_id, i.id, p_actor, v_request_id, p_operation, p_payload, v_before, v_result);
  if p_operation = 'remove' then
    insert into public.ob_round_removed_records(table_name, record_id, inspection_id, event_id)
      select 'inspection_control_items', x::uuid, i.id, v_event_id from jsonb_array_elements_text(v_note_ids) x
      union all select 'inspection_images', x::uuid, i.id, v_event_id from jsonb_array_elements_text(v_image_ids) x
      union all select 'inspection_round_quick_notes', x::uuid, i.id, v_event_id from jsonb_array_elements_text(v_quick_ids) x
      union all select 'inspection_interior_rooms', r.id, i.id, v_event_id where v_kind = 'room';
  end if;
  return v_result;
end;
$$;
revoke all on function public.ob_building_round_mutate(uuid,uuid,uuid,text,jsonb,uuid,text[]) from public, anon, authenticated;
grant execute on function public.ob_building_round_mutate(uuid,uuid,uuid,text,jsonb,uuid,text[]) to service_role;

create or replace function public.ob_guard_floor_key()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_key text; v_levels jsonb;
begin
  if to_jsonb(new)->>'building_part_id' is not null then return new; end if;
  v_key := to_jsonb(new)->>tg_argv[0];
  if tg_op = 'UPDATE' and v_key is not distinct from (to_jsonb(old)->>tg_argv[0])
    and old.inspection_id = new.inspection_id then return new; end if;
  perform 1 from public.inspections where id = new.inspection_id for update;
  select levels into v_levels from public.inspection_floor_models where inspection_id = new.inspection_id;
  if v_levels is null or v_key is null or v_key in ('ovrigt', U&'\00F6vrigt') then return new; end if;
  if not exists(select 1 from jsonb_array_elements(v_levels) r where 'plan' || (r->>'level') = v_key) then
    raise exception 'OB_FLOOR_UNKNOWN';
  end if;
  return new;
end $$;

create or replace function public.ob_building_basement(p_inspection uuid,p_part uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_room uuid;
begin
  if not exists(select 1 from public.ob_building_floor_models where building_part_id=p_part and levels is not null)
    or exists(select 1 from public.ob_building_auto_rooms where building_part_id=p_part and rule_key='basement') then return; end if;
  if not exists(select 1 from public.inspection_overview_selections s
    join public.settings_overview_items it on it.id=s.overview_item_id and it.key='building_type'
    join public.settings_overview_groups g on g.overview_item_id=it.id and g.key in ('basement','kallare',U&'k\00E4llare')
    join public.settings_overview_options o on o.group_id=g.id and o.value=s.values->>g.key
    where s.inspection_id=p_inspection and s.building_part_id=p_part and lower(btrim(o.system_value)) in ('ja','yes','true')
      and s.set_index=(select min(x.set_index) from public.inspection_overview_selections x where x.building_part_id=p_part and x.overview_item_id=it.id)) then return; end if;
  insert into public.ob_building_auto_rooms(building_part_id,rule_key) values(p_part,'basement') on conflict do nothing;
  if not found then return; end if;
  select id into v_room from public.inspection_interior_rooms where building_part_id=p_part and floor_label='ovrigt' and room_type_key='kallare' order by order_index,id limit 1;
  if v_room is null then
    insert into public.inspection_interior_rooms(inspection_id,building_part_id,floor_label,room_type_key,room_label,order_index,values)
      select p_inspection,p_part,'ovrigt','kallare',U&'K\00E4llare',coalesce(max(order_index),0)+10,'{}'::jsonb
      from public.inspection_interior_rooms where building_part_id=p_part and floor_label='ovrigt' returning id into v_room;
  end if;
  update public.ob_building_auto_rooms set room_id=v_room where building_part_id=p_part and rule_key='basement';
end $$;
revoke all on function public.ob_building_basement(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ob_building_basement(uuid,uuid) to service_role;

create or replace function public.ob_ensure_basement_room()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_room uuid; i public.inspections;
begin
  if to_jsonb(new)->>'building_part_id' is not null then
    if current_setting('ob.building_activation',true)='true' then return new; end if;
    perform public.ob_building_basement(new.inspection_id,(to_jsonb(new)->>'building_part_id')::uuid);
    return new;
  end if;
  if not exists(select 1 from public.inspection_floor_models where inspection_id = new.inspection_id)
    or exists(select 1 from public.ob_auto_rooms where inspection_id = new.inspection_id and rule_key = 'basement') then return new; end if;
  select * into i from public.inspections where id = new.inspection_id for update;
  if i.locked_at is not null or lower(coalesce(i.status,'')) in ('completed','klar','done')
    or coalesce((public.ob_assignment_workflow_state(i.id)->>'paused')::boolean,false) then return new; end if;
  if not exists (
    select 1 from public.inspection_overview_selections s
    join public.settings_overview_items it on it.id = s.overview_item_id and it.key = 'building_type'
    join public.settings_overview_groups g on g.overview_item_id = it.id and g.key in ('basement','kallare',U&'k\00E4llare')
    join public.settings_overview_options o on o.group_id = g.id and o.value = s.values->>g.key
    where s.inspection_id = i.id and lower(btrim(o.system_value)) in ('ja','yes','true')
      and s.set_index = (select min(s2.set_index) from public.inspection_overview_selections s2
        where s2.inspection_id = i.id and s2.overview_item_id = it.id)
  ) then return new; end if;
  -- The marker survives a user's move, rename or deletion of the auto-created room.
  insert into public.ob_auto_rooms(inspection_id,rule_key) values(i.id,'basement') on conflict do nothing;
  if not found then return new; end if;
  select id into v_room from public.inspection_interior_rooms where inspection_id = i.id
    and floor_label = 'ovrigt' and (room_type_key = 'kallare' or lower(btrim(room_label)) = U&'k\00E4llare')
    order by order_index, id limit 1;
  if v_room is null then
    insert into public.inspection_interior_rooms(inspection_id,floor_label,room_type_key,room_label,order_index,values)
    select i.id,'ovrigt','kallare',U&'K\00E4llare',coalesce(max(order_index),0) + 10,'{}'::jsonb
    from public.inspection_interior_rooms where inspection_id = i.id and floor_label = 'ovrigt'
    returning id into v_room;
  end if;
  update public.ob_auto_rooms set room_id = v_room where inspection_id = i.id and rule_key = 'basement';
  return new;
end $$;

commit;
