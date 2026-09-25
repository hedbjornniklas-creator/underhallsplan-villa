-- OB image trash: 30-day self-service recovery. No storage deletes or archive rewrites.
-- Requires OB round mutations and building migrations through 2026-09-12_04.
begin;

create index if not exists ob_round_image_trash_list_idx
  on public.ob_round_mutation_events(inspection_id, created_at desc, id desc)
  where operation='remove' and request->>'kind'='image';
create unique index if not exists ob_round_image_restore_source_idx
  on public.ob_round_mutation_events(inspection_id, (request->>'eventId'))
  where operation='image-restore';

-- Resolve pre-building archives using surviving placement, then the primary building.
create or replace function public.ob_round_trash_part(p_inspection_id uuid, p_image jsonb)
returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(
    (p_image->>'building_part_id')::uuid,
    (select building_part_id from public.inspection_interior_rooms where id=(p_image->>'interior_room_id')::uuid and inspection_id=p_inspection_id),
    (select building_part_id from public.inspection_exterior_observations where id=(p_image->>'exterior_observation_id')::uuid and inspection_id=p_inspection_id),
    (p_image->>'origin_building_part_id')::uuid,
    (select building_part_id from public.inspection_interior_rooms where id=(p_image->>'origin_interior_room_id')::uuid and inspection_id=p_inspection_id),
    (select building_part_id from public.inspection_exterior_observations where id=(p_image->>'origin_exterior_observation_id')::uuid and inspection_id=p_inspection_id),
    (select primary_part_id from public.ob_inspection_structure where inspection_id=p_inspection_id)
  )
$$;

create or replace function public.ob_round_image_trash(
  p_inspection_id uuid, p_org_id uuid, p_actor uuid, p_operation text,
  p_payload jsonb default '{}', p_part_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  i public.inspections; e public.ob_round_mutation_events; prior public.ob_round_mutation_events;
  img public.inspection_images; v_image jsonb; v_result jsonb; v_items jsonb;
  v_event uuid; v_request uuid; v_assignment uuid; v_before uuid; v_before_time timestamptz;
  v_room uuid; v_obs uuid; v_part uuid; v_now timestamptz := statement_timestamp();
  v_canonical jsonb;
begin
  if p_actor is null or p_org_id is null or not exists (
    select 1 from public.org_members where org_id=p_org_id and profile_id=p_actor and is_active
  ) or not exists (
    select 1 from public.inspections si join public.properties sp on sp.id=si.property_id
    where si.id=p_inspection_id and sp.owner=p_actor and coalesce(si.inspection_family,si.type)='OB'
  ) then raise exception 'OB_ROUND_FORBIDDEN'; end if;
  if p_operation not in ('list','restore') or jsonb_typeof(p_payload) is distinct from 'object'
    then raise exception 'OB_ROUND_INVALID'; end if;
  if exists(select 1 from public.ob_inspection_structure where inspection_id=p_inspection_id) then
    if p_part_id is null or not exists(select 1 from public.ob_inspection_buildings where id=p_part_id and inspection_id=p_inspection_id)
      then raise exception 'OB_ROUND_FOREIGN'; end if;
  elsif p_part_id is not null then raise exception 'OB_ROUND_FOREIGN'; end if;

  if p_operation='list' then
    v_before := (p_payload->>'beforeEventId')::uuid;
    if v_before is not null then
      select created_at into v_before_time from public.ob_round_mutation_events
        where id=v_before and inspection_id=p_inspection_id and operation='remove' and request->>'kind'='image';
      if not found then raise exception 'OB_ROUND_INVALID'; end if;
    end if;
    select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id desc),'[]') into v_items from (
      select ev.id,ev.created_at,jsonb_build_object('eventId',ev.id,'deletedAt',ev.created_at,
        'expiresAt',ev.created_at+interval '30 days',
        'daysRemaining',ceil(extract(epoch from (ev.created_at+interval '30 days'-v_now))/86400)::int,
        'image',ev.before_data->'record') as item
      from public.ob_round_mutation_events ev
      join public.ob_round_removed_records removed on removed.event_id=ev.id
        and removed.inspection_id=ev.inspection_id and removed.table_name='inspection_images'
        and removed.record_id=(ev.before_data->'record'->>'id')::uuid
      where ev.inspection_id=p_inspection_id and ev.operation='remove' and ev.request->>'kind'='image'
        and ev.created_at>v_now-interval '30 days'
        and public.ob_round_trash_part(p_inspection_id,ev.before_data->'record') is not distinct from p_part_id
        and (v_before is null or (ev.created_at,ev.id)<(v_before_time,v_before))
        and not exists(select 1 from public.ob_round_mutation_events restored where restored.inspection_id=ev.inspection_id
          and restored.operation='image-restore' and restored.request->>'eventId'=ev.id::text)
      order by ev.created_at desc,ev.id desc limit 51
    ) x;
    return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinal),'[]')
      from jsonb_array_elements(v_items) with ordinality as j(value,ordinal) where ordinal<=50),
      'nextCursor',case when jsonb_array_length(v_items)>50 then v_items->49->>'eventId' else null end);
  end if;

  v_event := (p_payload->>'eventId')::uuid; v_request := (p_payload->>'requestId')::uuid;
  if v_event is null or v_request is null then raise exception 'OB_ROUND_INVALID'; end if;
  v_canonical := jsonb_build_object('eventId',v_event,'requestId',v_request,'partId',p_part_id);
  -- Match the round mutation lock order and workflow guards.
  select current_assignment_id into v_assignment from public.ob_assignment_workflows where inspection_id=p_inspection_id;
  if v_assignment is not null then perform 1 from public.assignments where id=v_assignment for update; end if;
  select * into i from public.inspections where id=p_inspection_id for update;
  if i.locked_at is not null or lower(coalesce(i.status,'')) in ('completed','klar','done') then raise exception 'OB_ROUND_LOCKED'; end if;
  if coalesce((public.ob_assignment_workflow_state(i.id)->>'paused')::boolean,false) then raise exception 'OB_ROUND_PAUSED'; end if;

  select * into prior from public.ob_round_mutation_events where inspection_id=i.id and request_id=v_request;
  if found then
    if prior.operation<>'image-restore' or prior.actor_id is distinct from p_actor or prior.request<>v_canonical
      then raise exception 'OB_ROUND_STALE'; end if;
    return jsonb_build_object('image',(select to_jsonb(t) from public.inspection_images t
      where t.id=(prior.result->'image'->>'id')::uuid and t.inspection_id=i.id and t.building_part_id is not distinct from p_part_id));
  end if;
  select * into e from public.ob_round_mutation_events where id=v_event and inspection_id=i.id
    and operation='remove' and request->>'kind'='image';
  if not found then raise exception 'OB_TRASH_NOT_FOUND'; end if;
  v_image := e.before_data->'record';
  v_part := public.ob_round_trash_part(i.id,v_image);
  if (v_image->>'inspection_id')::uuid is distinct from i.id or v_part is distinct from p_part_id
    then raise exception 'OB_ROUND_FOREIGN'; end if;
  -- A different request after a lost response must not duplicate or resurrect a later deletion.
  select * into prior from public.ob_round_mutation_events where inspection_id=i.id
    and operation='image-restore' and request->>'eventId'=v_event::text;
  if found then return jsonb_build_object('image',(select to_jsonb(t) from public.inspection_images t
    where t.id=(prior.result->'image'->>'id')::uuid and t.inspection_id=i.id and t.building_part_id is not distinct from p_part_id)); end if;
  if e.created_at<=v_now-interval '30 days' then raise exception 'OB_TRASH_EXPIRED'; end if;
  if not exists(select 1 from public.ob_round_removed_records where event_id=e.id and inspection_id=i.id
    and table_name='inspection_images' and record_id=(v_image->>'id')::uuid)
    or exists(select 1 from public.inspection_images where id=(v_image->>'id')::uuid)
    then raise exception 'OB_ROUND_STALE'; end if;
  if not exists(select 1 from storage.objects where bucket_id='inspection-images' and name=v_image->>'file_path')
    then raise exception 'OB_TRASH_FILE_MISSING'; end if;

  select id into v_room from public.inspection_interior_rooms where inspection_id=i.id
    and building_part_id is not distinct from p_part_id
    and id=coalesce((v_image->>'interior_room_id')::uuid,(v_image->>'origin_interior_room_id')::uuid);
  if v_room is null then
    select id into v_obs from public.inspection_exterior_observations where inspection_id=i.id
      and building_part_id is not distinct from p_part_id
      and id=coalesce((v_image->>'exterior_observation_id')::uuid,(v_image->>'origin_exterior_observation_id')::uuid);
  end if;
  -- New identity keeps the old tombstone effective against late offline writes.
  -- Original archive/report snapshots and file paths remain unchanged.
  v_image := v_image || jsonb_build_object('id',gen_random_uuid(),'control_item_id',null,
    'interior_room_id',v_room,'exterior_observation_id',v_obs,'building_part_id',p_part_id,
    'processing_status','unprocessed','ignored_at',null,'ob_revision',1);
  if not exists(select 1 from public.inspection_interior_rooms where id=(v_image->>'origin_interior_room_id')::uuid and inspection_id=i.id)
    then v_image := v_image || jsonb_build_object('origin_interior_room_id',null); end if;
  if not exists(select 1 from public.inspection_exterior_observations where id=(v_image->>'origin_exterior_observation_id')::uuid and inspection_id=i.id)
    then v_image := v_image || jsonb_build_object('origin_exterior_observation_id',null); end if;
  if not exists(select 1 from public.settings_exterior_items where id=(v_image->>'origin_exterior_item_id')::uuid)
    then v_image := v_image || jsonb_build_object('origin_exterior_item_id',null); end if;
  if not exists(select 1 from public.ob_inspection_buildings where id=(v_image->>'origin_building_part_id')::uuid and inspection_id=i.id)
    then v_image := v_image || jsonb_build_object('origin_building_part_id',null); end if;
  perform set_config('ob.building_command',i.id::text,true);
  insert into public.inspection_images select (jsonb_populate_record(null::public.inspection_images,v_image)).* returning * into img;
  v_result := jsonb_build_object('image',to_jsonb(img));
  insert into public.ob_round_mutation_events(inspection_id,actor_id,request_id,operation,request,before_data,result)
    values(i.id,p_actor,v_request,'image-restore',v_canonical,jsonb_build_object('sourceEventId',e.id),v_result);
  return v_result;
end $$;
revoke all on function public.ob_round_trash_part(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ob_round_image_trash(uuid,uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ob_round_trash_part(uuid,jsonb) to service_role;
grant execute on function public.ob_round_image_trash(uuid,uuid,uuid,text,jsonb,uuid) to service_role;
commit;
