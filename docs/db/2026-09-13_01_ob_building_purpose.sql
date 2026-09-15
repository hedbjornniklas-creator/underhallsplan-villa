-- Optional, versioned building purpose. Requires OB building migrations 01..04.
-- No existing inspection, building category or report is reclassified.
begin;
alter table public.settings_ob_building_categories add column if not exists catalogue_entry jsonb;
-- Report snapshots also resolve catalogue versions with the server client.
grant select on public.settings_ob_building_categories to service_role;
alter table public.ob_inspection_buildings alter column category_key drop not null;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='ob_building_catalogue_entry_check') then
    alter table public.settings_ob_building_categories add constraint ob_building_catalogue_entry_check check (
      catalogue_entry is null or (
        jsonb_typeof(catalogue_entry)='object'
        and catalogue_entry->>'source'='boverket-andamalskatalogen'
        and catalogue_entry->>'conceptNumber' ~ '^([0-9]{2}){1,3}$'
        and jsonb_typeof(catalogue_entry->'version')='number'
        and catalogue_entry->>'version' ~ '^[1-9][0-9]*$'
        and key='boverket:'||(catalogue_entry->>'conceptNumber')||':v'||(catalogue_entry->>'version')
        and catalogue_entry->>'key'=key
        and catalogue_entry->>'label'=label
        and catalogue_entry->>'uri'='https://api.boverket.se/andamalskatalogen/v1/concepts/'||
          (catalogue_entry->>'conceptNumber')||'/'||(catalogue_entry->>'version')
        and jsonb_typeof(catalogue_entry->'path')='array'
      ) is true
    );
  end if;
end $$;

create or replace function public.ob_protect_building_catalogue_version()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if old.catalogue_entry is not null then
    if tg_op='DELETE' then raise exception 'OB_BUILDING_CATALOGUE_IMMUTABLE'; end if;
    if new.key is distinct from old.key or new.label is distinct from old.label
      or new.catalogue_entry is distinct from old.catalogue_entry then
      raise exception 'OB_BUILDING_CATALOGUE_IMMUTABLE';
    end if;
  elsif tg_op='UPDATE' and new.catalogue_entry is not null then
    raise exception 'OB_BUILDING_CATALOGUE_IMMUTABLE';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.ob_protect_building_catalogue_version() from public,anon,authenticated;
drop trigger if exists ob_building_catalogue_immutable on public.settings_ob_building_categories;
create trigger ob_building_catalogue_immutable before update or delete on public.settings_ob_building_categories
  for each row execute function public.ob_protect_building_catalogue_version();

-- Forward definitions below retain the existing access, lock, revision and retry guards.

create or replace function public.ob_building_get(p_inspection_id uuid,p_org_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_property uuid; v_active boolean; v_preview jsonb;
begin
  perform public.ob_building_access(p_inspection_id,p_org_id,p_actor);
  select property_id into v_property from public.inspections where id=p_inspection_id;
  v_active := exists(select 1 from public.ob_inspection_structure where inspection_id=p_inspection_id);
  if not v_active then v_preview := public.ob_building_activation_data(p_inspection_id); end if;
  return jsonb_build_object('available',exists(select 1 from public.ob_building_rollout where enabled),
    'structure',(select to_jsonb(s) from public.ob_inspection_structure s where inspection_id=p_inspection_id),
    'parts',(select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object('floor_model',
      case when m.levels is null then null else jsonb_build_object('levels',m.levels,'revision',m.revision) end) order by b.sort_order,b.id),'[]')
      from public.ob_inspection_buildings b left join public.ob_building_floor_models m on m.building_part_id=b.id where b.inspection_id=p_inspection_id),
    'buildings',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.buildings where property_id=v_property),
    'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by sort_order),'[]') from public.settings_ob_building_categories c where is_active or exists(select 1 from public.ob_inspection_buildings used where used.inspection_id=p_inspection_id and used.category_key=c.key)),
    'activationToken',case when not v_active then md5(v_preview::text) end);
end $$;

create or replace function public.ob_building_command(p_inspection_id uuid,p_org_id uuid,p_actor uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_part public.ob_inspection_buildings; v_before jsonb := '{}'; v_result jsonb; v_prior public.ob_building_events;
  v_id uuid; v_building uuid; v_property uuid; v_request uuid; t text; v_source public.inspection_conditions;
  v_levels jsonb; v_revision integer; v_removed text[]; v_exists boolean;
begin
  perform public.ob_building_access(p_inspection_id,p_org_id,p_actor,true);
  v_request := (p_payload->>'requestId')::uuid;
  if v_request is null then raise exception 'OB_ROUND_INVALID'; end if;
  select * into v_prior from public.ob_building_events where inspection_id=p_inspection_id and request_id=v_request;
  if found then
    if v_prior.actor_id<>p_actor or v_prior.operation<>p_operation or v_prior.request<>p_payload then raise exception 'OB_ROUND_STALE'; end if;
    return public.ob_building_get(p_inspection_id,p_org_id,p_actor);
  end if;
  select property_id into v_property from public.inspections where id=p_inspection_id;
  if p_operation in ('activate','add') then
    if not exists(select 1 from public.ob_building_rollout where enabled) then raise exception 'OB_BUILDING_DISABLED'; end if;
    if p_operation='activate' then
      if exists(select 1 from public.ob_inspection_structure where inspection_id=p_inspection_id) then raise exception 'OB_ROUND_STALE'; end if;
      v_before := public.ob_building_activation_data(p_inspection_id);
      if p_payload->>'activationToken' is distinct from md5(v_before::text) or p_payload->>'confirmed' is distinct from 'true' then raise exception 'OB_ROUND_STALE'; end if;
    elsif not exists(select 1 from public.ob_inspection_structure where inspection_id=p_inspection_id) then raise exception 'OB_BUILDING_NOT_ACTIVE'; end if;
    v_building := (p_payload->>'buildingId')::uuid;
    if v_building is null then
      insert into public.buildings(property_id,name) values(v_property,btrim(p_payload->>'name')) returning id into v_building;
    elsif not exists(select 1 from public.buildings where id=v_building and property_id=v_property) then raise exception 'OB_ROUND_FOREIGN'; end if;
    insert into public.ob_inspection_buildings(inspection_id,building_id,name,category_key,sort_order)
      select p_inspection_id,v_building,btrim(p_payload->>'name'),
        case when p_operation='activate' and (p_payload->>'purposeCatalogueVersion') is distinct from '1' then 'main' else p_payload->>'categoryKey' end,
        coalesce(max(sort_order),0)+100 from public.ob_inspection_buildings where inspection_id=p_inspection_id returning * into v_part;
    if p_operation='activate' then
      insert into public.ob_inspection_structure(inspection_id,primary_part_id,activated_by) values(p_inspection_id,v_part.id,p_actor);
      select levels into v_levels from public.inspection_floor_models where inspection_id=p_inspection_id;
      perform set_config('ob.building_activation','true',true);
      insert into public.ob_building_floor_models(building_part_id,inspection_id,levels) values(v_part.id,p_inspection_id,v_levels);
      foreach t in array array['inspection_interior_rooms','inspection_exterior_observations','inspection_control_items',
        'inspection_overview_selections','inspection_round_quick_notes'] loop
        execute format('update public.%I set building_part_id=$1 where inspection_id=$2',t) using v_part.id,p_inspection_id;
      end loop;
      update public.inspection_images set building_part_id=case when control_item_id is not null or interior_room_id is not null or exterior_observation_id is not null
        or origin_interior_room_id is not null or origin_exterior_observation_id is not null or origin_exterior_item_id is not null then v_part.id end,
        origin_building_part_id=case when origin_interior_room_id is not null or origin_exterior_observation_id is not null or origin_exterior_item_id is not null then v_part.id end
        where inspection_id=p_inspection_id;
      select * into v_source from public.inspection_conditions where inspection_id=p_inspection_id;
      if found then
        insert into public.ob_building_conditions select (jsonb_populate_record(null::public.ob_building_conditions,
          to_jsonb(v_source)||jsonb_build_object('building_part_id',v_part.id,'ob_revision',1))).*;
      else insert into public.ob_building_conditions(inspection_id,building_part_id) values(p_inspection_id,v_part.id); end if;
      insert into public.ob_building_auto_rooms(building_part_id,rule_key,room_id)
        select v_part.id,rule_key,room_id from public.ob_auto_rooms where inspection_id=p_inspection_id;
      perform set_config('ob.building_activation','false',true);
    else
      insert into public.ob_building_floor_models(building_part_id,inspection_id,levels)
        values(v_part.id,p_inspection_id,'[{"level":0,"name":"Entr\u00e9plan"}]');
      insert into public.ob_building_conditions(inspection_id,building_part_id) values(p_inspection_id,v_part.id);
    end if;
  else
    v_id := (p_payload->>'partId')::uuid;
    select * into v_part from public.ob_inspection_buildings where id=v_id and inspection_id=p_inspection_id for update;
    if not found then raise exception 'OB_ROUND_NOT_FOUND'; end if;
    v_before := to_jsonb(v_part);
    if p_operation='edit' then
      if v_part.revision is distinct from (p_payload->>'revision')::integer then raise exception 'OB_ROUND_STALE'; end if;
      if p_payload ? 'coverPath' and p_payload->>'coverPath' is not null and
        ((p_payload->>'coverPath') not like p_inspection_id::text || '/building-covers/' || v_id::text || '/%'
        or position('..' in p_payload->>'coverPath')>0) then raise exception 'OB_ROUND_INVALID'; end if;
      update public.ob_inspection_buildings set name=coalesce(p_payload->>'name',name),
        category_key=case when p_payload ? 'categoryKey' then p_payload->>'categoryKey' else category_key end,
        cover_path=case when p_payload ? 'coverPath' then p_payload->>'coverPath' else cover_path end,
        scope_note=case when p_payload ? 'scopeNote' then p_payload->>'scopeNote' else scope_note end,
        revision=revision+1,updated_at=now() where id=v_id;
    elsif p_operation='floors' then
      select levels,revision into v_levels,v_revision from public.ob_building_floor_models where building_part_id=v_id for update;
      if v_levels is null then raise exception 'OB_FLOOR_LEGACY'; end if;
      if v_revision is distinct from (p_payload->>'revision')::integer then raise exception 'OB_ROUND_STALE'; end if;
      if not public.ob_valid_floor_levels(p_payload->'levels') then raise exception 'OB_ROUND_INVALID'; end if;
      select array_agg('plan'||(x->>'level')) into v_removed from jsonb_array_elements(v_levels) x
        where not exists(select 1 from jsonb_array_elements(p_payload->'levels') n where n->'level'=x->'level');
      if exists(select 1 from public.inspection_interior_rooms where building_part_id=v_id and floor_label=any(v_removed))
        or exists(select 1 from public.inspection_overview_selections where building_part_id=v_id and floor_key=any(v_removed))
        or exists(select 1 from public.inspection_images where origin_building_part_id=v_id and origin_floor_label=any(v_removed)) then raise exception 'OB_FLOOR_IN_USE'; end if;
      v_before := jsonb_build_object('levels',v_levels,'revision',v_revision);
      update public.ob_building_floor_models set levels=p_payload->'levels',revision=revision+1 where building_part_id=v_id;
    elsif p_operation='remove' then
      if v_part.revision is distinct from (p_payload->>'revision')::integer then raise exception 'OB_ROUND_STALE'; end if;
      if exists(select 1 from public.ob_inspection_structure where primary_part_id=v_id) then raise exception 'OB_BUILDING_PRIMARY'; end if;
      if v_part.cover_path is not null or length(btrim(coalesce(v_part.scope_note,'')))>0 then raise exception 'OB_BUILDING_NOT_EMPTY'; end if;
      if exists(select 1 from public.ob_building_conditions where building_part_id=v_id and ob_revision>1)
        or exists(select 1 from public.ob_building_floor_models where building_part_id=v_id and revision>1) then raise exception 'OB_BUILDING_NOT_EMPTY'; end if;
      foreach t in array array['inspection_interior_rooms','inspection_exterior_observations','inspection_control_items',
        'inspection_overview_selections','inspection_round_quick_notes'] loop
        execute format('select exists(select 1 from public.%I where building_part_id=$1)',t) into v_exists using v_id;
        if v_exists then raise exception 'OB_BUILDING_NOT_EMPTY'; end if;
      end loop;
      if exists(select 1 from public.inspection_images where building_part_id=v_id or origin_building_part_id=v_id) then raise exception 'OB_BUILDING_NOT_EMPTY'; end if;
      delete from public.ob_building_conditions where building_part_id=v_id;
      delete from public.ob_building_floor_models where building_part_id=v_id;
      delete from public.ob_building_auto_rooms where building_part_id=v_id;
      delete from public.ob_inspection_buildings where id=v_id;
    else raise exception 'OB_ROUND_INVALID'; end if;
  end if;
  update public.ob_inspection_structure set revision=revision+1 where inspection_id=p_inspection_id;
  v_result := public.ob_building_get(p_inspection_id,p_org_id,p_actor);
  insert into public.ob_building_events(inspection_id,request_id,actor_id,operation,request,before_data,result)
    values(p_inspection_id,v_request,p_actor,p_operation,p_payload,v_before,jsonb_build_object('partId',v_part.id));
  return v_result;
end $$;

-- Row writes are restricted to whitelisted tables/fields by the API. This RPC
-- additionally binds each row to the root/part and checks its expected version.

revoke all on function public.ob_building_get(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.ob_building_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ob_building_get(uuid,uuid,uuid) to service_role;
grant execute on function public.ob_building_command(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
