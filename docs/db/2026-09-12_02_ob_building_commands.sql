-- Building commands. Service-only; actor/owner/workflow guards apply to the root.
begin;
create or replace function public.ob_building_access(p_inspection uuid,p_org uuid,p_actor uuid,p_write boolean default false)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_actor is null or not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_actor and is_active)
    or not exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id
      where i.id=p_inspection and p.owner=p_actor and coalesce(i.inspection_family,i.type)='OB') then raise exception 'OB_ROUND_FORBIDDEN'; end if;
  if p_write then
    perform public.ob_round_mutate(p_inspection,p_org,p_actor,'floor-context','{}');
    perform set_config('ob.building_command',p_inspection::text,true);
  end if;
end $$;

create or replace function public.ob_building_activation_data(p_inspection uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t text; rows jsonb; result jsonb := '{}'; begin
  foreach t in array array['inspection_interior_rooms','inspection_exterior_observations','inspection_control_items',
    'inspection_overview_selections','inspection_images','inspection_round_quick_notes','inspection_conditions'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by r.id),''[]'') from public.%I r where inspection_id=$1',t) into rows using p_inspection;
    result := result || jsonb_build_object(t,rows);
  end loop;
  result := result || jsonb_build_object('floors',(select to_jsonb(f) from public.inspection_floor_models f where inspection_id=p_inspection),
    'autoRooms',(select coalesce(jsonb_agg(to_jsonb(a) order by rule_key),'[]') from public.ob_auto_rooms a where inspection_id=p_inspection));
  return result;
end $$;

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
    'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by sort_order),'[]') from public.settings_ob_building_categories c where is_active),
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
      select p_inspection_id,v_building,btrim(p_payload->>'name'),case when p_operation='activate' then 'main' else p_payload->>'categoryKey' end,
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
        category_key=coalesce(p_payload->>'categoryKey',category_key),
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
create or replace function public.ob_building_write_row(p_inspection_id uuid,p_org_id uuid,p_actor uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t text := p_payload->>'table'; op text := p_payload->>'operation'; v_part uuid := (p_payload->>'partId')::uuid;
  row_data jsonb := p_payload->'row'; old_row jsonb; result jsonb; v_id uuid; cols text; expr text; v_request uuid;
  prior public.ob_building_events;
begin
  perform public.ob_building_access(p_inspection_id,p_org_id,p_actor,true);
  if not exists(select 1 from public.ob_inspection_structure where inspection_id=p_inspection_id) then raise exception 'OB_BUILDING_NOT_ACTIVE'; end if;
  if not exists(select 1 from public.ob_inspection_buildings where id=v_part and inspection_id=p_inspection_id) then raise exception 'OB_ROUND_FOREIGN'; end if;
  if t not in ('inspection_interior_rooms','inspection_exterior_observations','inspection_control_items','inspection_images',
    'inspection_round_quick_notes','inspection_overview_selections','ob_building_conditions') or op not in ('insert','update','delete') then raise exception 'OB_ROUND_INVALID'; end if;
  if op='delete' and t<>'inspection_overview_selections' then raise exception 'OB_ROUND_INVALID'; end if;
  v_id := (p_payload->>'id')::uuid; v_request := (p_payload->>'requestId')::uuid;
  if v_id is null or v_request is null then raise exception 'OB_ROUND_INVALID'; end if;
  execute format('select to_jsonb(r) from public.%I r where id=$1 for update',t) into old_row using v_id;
  if old_row is not null and (old_row->>'inspection_id'<>p_inspection_id::text or
    (old_row->>'building_part_id' is distinct from v_part::text and not(t='inspection_images' and old_row->>'building_part_id' is null and op='update')))
    then raise exception 'OB_ROUND_FOREIGN'; end if;
  select * into prior from public.ob_building_events where inspection_id=p_inspection_id and request_id=v_request;
  if found then
    if prior.actor_id<>p_actor or prior.request<>p_payload then raise exception 'OB_ROUND_STALE'; end if;
    return old_row;
  end if;
  if op='insert' and old_row is not null then raise exception 'OB_ROUND_STALE'; end if;
  if op<>'insert' and (old_row is null or (old_row->>'ob_revision')::integer is distinct from (p_payload->>'revision')::integer) then raise exception 'OB_ROUND_STALE'; end if;
  if row_data ?| array['ob_revision','created_at','updated_at','building_part_id','inspection_id','id'] then raise exception 'OB_ROUND_INVALID'; end if;
  if t='inspection_images' and op='update' and old_row->>'building_part_id' is null then
    row_data := row_data || jsonb_build_object('building_part_id',v_part);
  end if;
  if op='delete' then
    execute format('delete from public.%I where id=$1',t) using v_id;
    result := old_row;
  elsif op='insert' then
    row_data := row_data || jsonb_build_object('id',v_id,'inspection_id',p_inspection_id,'building_part_id',v_part);
    select string_agg(format('%I',key),','),string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',t,key),',') into cols,expr from jsonb_object_keys(row_data) key;
    execute format('insert into public.%I(%s) select %s returning to_jsonb(%I.*)',t,cols,expr,t) into result using row_data;
  else
    select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',key,t,key),',') into expr from jsonb_object_keys(row_data) key;
    if expr is null then raise exception 'OB_ROUND_INVALID'; end if;
    execute format('update public.%I set %s where id=$2 returning to_jsonb(%I.*)',t,expr,t) into result using row_data,v_id;
  end if;
  insert into public.ob_building_events(inspection_id,request_id,actor_id,operation,request,before_data,result)
    values(p_inspection_id,v_request,p_actor,'row',p_payload,coalesce(old_row,'{}'),jsonb_build_object('table',t,'id',v_id));
  return result;
end $$;
create or replace function public.ob_building_write_rows(p_inspection_id uuid,p_org_id uuid,p_actor uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb; result jsonb := '[]'; begin
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 50 then raise exception 'OB_ROUND_INVALID'; end if;
  for r in select value from jsonb_array_elements(p_payload->'rows') loop
    if r->>'partId' is distinct from p_payload->>'partId' then raise exception 'OB_ROUND_FOREIGN'; end if;
    result := result || jsonb_build_array(public.ob_building_write_row(p_inspection_id,p_org_id,p_actor,r));
  end loop;
  return result;
end $$;
do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and proname in ('ob_building_access','ob_building_activation_data','ob_building_get','ob_building_command','ob_building_write_row','ob_building_write_rows') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;
