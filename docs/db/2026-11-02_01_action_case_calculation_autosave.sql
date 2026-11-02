-- Additive, service-only background calculation writes. Existing contracts are not updated.
-- Requires costing, work parts, completion and the 2026-10-29 contract-work lock migration.
begin;
create table if not exists public.action_case_calculation_requests (
  request_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  action_case_item_id uuid not null references public.action_case_items(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  operation text not null,
  expected_updated_at timestamptz not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.action_case_calculation_requests enable row level security;
revoke all on public.action_case_calculation_requests from public,anon,authenticated;
grant select,insert on public.action_case_calculation_requests to service_role;

create or replace function public.save_action_case_calculation(
  p_org_id uuid,p_case_id uuid,p_item_id uuid,p_user_id uuid,p_request_id uuid,
  p_expected_updated_at timestamptz,p_operation text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare i public.action_case_items%rowtype; l public.action_case_cost_lines%rowtype;
  prior public.action_case_calculation_requests%rowtype; answer jsonb; part jsonb; next_sort integer;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_request_id is null or p_expected_updated_at is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
  -- Match the lock order used by freeze/contract guards.
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  select * into i from public.action_case_items where id=p_item_id and action_case_id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  select * into prior from public.action_case_calculation_requests where request_id=p_request_id;
  if found then
    if prior.org_id<>p_org_id or prior.action_case_id<>p_case_id or prior.action_case_item_id<>p_item_id or prior.actor_id<>p_user_id
      or prior.operation<>p_operation or prior.expected_updated_at<>p_expected_updated_at or prior.payload<>p_data then raise exception 'ACTION_CASE_CALCULATION_REQUEST_CONFLICT'; end if;
    return prior.result;
  end if;
  if public.contract_work_locked(p_org_id,p_case_id,p_item_id) then raise exception 'ACTION_CASE_CONTRACT_LOCKED'; end if;
  if i.updated_at<>p_expected_updated_at then raise exception 'ACTION_CASE_ITEM_STALE'; end if;
  if i.status not in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote') then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;

  if p_operation='line' then
    if i.lump_sum is not null then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;
    if (p_data->>'create')::boolean then
      if exists(select 1 from public.action_case_cost_lines where id=(p_data->>'id')::uuid) then raise exception 'ACTION_CASE_CALCULATION_REQUEST_CONFLICT'; end if;
      select coalesce(max(sort_order),0)+100 into next_sort from public.action_case_cost_lines where action_case_item_id=p_item_id;
      insert into public.action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost,markup_percent,
        price_source,source_url,quantity_basis,notes,is_verified,verified_by,verified_at,source_checked_at,sort_order,created_by,updated_by)
      values((p_data->>'id')::uuid,p_org_id,p_case_id,p_item_id,p_data->>'category',p_data->>'description',(p_data->>'quantity')::numeric,p_data->>'unit',
        (p_data->>'unitCost')::numeric,(p_data->>'markupPercent')::numeric,p_data->>'priceSource',p_data->>'sourceUrl',p_data->>'quantityBasis',p_data->>'notes',
        (p_data->>'verified')::boolean,case when (p_data->>'verified')::boolean then p_user_id end,
        case when (p_data->>'verified')::boolean then now() end,case when (p_data->>'verified')::boolean then now() end,next_sort,p_user_id,p_user_id);
    else
      select * into l from public.action_case_cost_lines where id=(p_data->>'id')::uuid and action_case_item_id=p_item_id and org_id=p_org_id for update;
      if not found then raise exception 'ACTION_CASE_COST_LINE_NOT_FOUND'; end if;
      if l.pricing_method<>'direct' or l.selected_quote_id is not null or l.covered_by_quote_id is not null then raise exception 'ACTION_CASE_COST_LINE_DIRECT_REQUIRED'; end if;
      perform public.write_action_case_costs(p_org_id,p_case_id,p_item_id,p_user_id,'update',jsonb_build_array(p_data));
    end if;
  elsif p_operation='delete_line' then
    perform public.write_action_case_costs(p_org_id,p_case_id,p_item_id,p_user_id,'delete',jsonb_build_array(p_data));
  elsif p_operation='complete' then
    perform public.set_action_case_cost_complete(p_org_id,p_case_id,p_item_id,p_user_id,(p_data->>'id')::uuid,p_expected_updated_at,(p_data->>'complete')::boolean);
  elsif p_operation='work_part' then
    part:=public.write_action_case_work_part(p_org_id,p_case_id,p_item_id,p_user_id,p_data->>'operation',p_data||jsonb_build_object('expectedUpdatedAt',p_expected_updated_at));
  elsif p_operation='markup' then
    select * into l from public.action_case_cost_lines where id=(p_data->>'id')::uuid and action_case_item_id=p_item_id and org_id=p_org_id for update;
    if not found then raise exception 'ACTION_CASE_COST_LINE_NOT_FOUND'; end if;
    perform public.write_action_case_quote(p_org_id,p_case_id,p_item_id,l.id,p_user_id,'markup',p_data||jsonb_build_object('expectedLineUpdatedAt',l.updated_at));
  elsif p_operation='lump_sum' then
    update public.action_case_items set lump_sum=nullif(p_data->'lumpSum','null'::jsonb),updated_by=p_user_id,
      status=case when nullif(btrim(scope),'') is null then 'scope_needed'
        when p_data->'lumpSum'<>'null'::jsonb then case when (p_data#>>'{lumpSum,verified}')::boolean and p_data#>>'{lumpSum,customerPrice}' is not null then 'ready_for_quote' else 'pricing_needed' end
        when own_labor_ready and material_price_ready and waste_solution_ready and (not requires_subcontractor or subcontractor_price_ready) then 'ready_for_quote' else 'pricing_needed' end
      where id=p_item_id and org_id=p_org_id;
  else raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
  select * into i from public.action_case_items where id=p_item_id;
  -- Some old helper paths do not touch the parent; every acknowledged calculation gets a fresh version.
  if i.updated_at=p_expected_updated_at then
    update public.action_case_items set updated_by=p_user_id,updated_at=clock_timestamp() where id=i.id returning * into i;
  end if;
  insert into public.action_case_events(org_id,action_case_id,action_case_item_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,p_item_id,'calculation_saved','Kalkyl sparad.',p_user_id);
  answer:=jsonb_build_object('requestId',p_request_id,'updatedAt',i.updated_at,'expectedUpdatedAt',p_expected_updated_at,'partId',part->>'id');
  insert into public.action_case_calculation_requests(request_id,org_id,action_case_id,action_case_item_id,actor_id,operation,expected_updated_at,payload,result)
    values(p_request_id,p_org_id,p_case_id,p_item_id,p_user_id,p_operation,p_expected_updated_at,p_data,answer);
  return answer;
end $$;
revoke all on function public.save_action_case_calculation(uuid,uuid,uuid,uuid,uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_action_case_calculation(uuid,uuid,uuid,uuid,uuid,timestamptz,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
