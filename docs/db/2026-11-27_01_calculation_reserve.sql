-- Separate calculation reserve. No recalculation/backfill of existing prices or contracts.
-- Requires 2026-11-02_01_action_case_calculation_autosave.sql.
begin;
alter table public.action_case_cost_lines add column if not exists reserve_percent numeric not null default 0
  check (reserve_percent >= 0 and reserve_percent <= 1000);

create or replace function public.action_case_item_cost_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer; v_known boolean; v_verified boolean; v_work_count integer; v_own boolean; v_sub boolean; v_has_sub boolean; v_material boolean; v_other boolean;
begin
  with effective as (
    select l.*, case when l.pricing_method='quotes' and (q.id is null or not q.checked
      or q.scope_snapshot <> coalesce(new.scope,'') or q.description_snapshot <> l.description
      or (q.valid_until is not null and q.valid_until < (now() at time zone 'Europe/Stockholm')::date))
      then false else l.is_verified end as valid
    from public.action_case_cost_lines l left join public.action_case_work_quotes q on q.id=l.selected_quote_id and q.cost_line_id=l.id
    where l.action_case_item_id=new.id and l.org_id=new.org_id and l.covered_by_quote_id is null
  ) select count(*), bool_and(quantity is not null and unit_cost is not null and (pricing_method <> 'quotes' or valid)), bool_and(valid),
    round(sum(quantity*unit_cost),2), round(sum(quantity*unit_cost*(1+reserve_percent/100)*(1+markup_percent/100)),2),
    count(*) filter (where category in ('own_labor','subcontractor')),
    bool_and(valid) filter (where category='own_labor'), bool_and(valid) filter (where category='subcontractor'),
    bool_or(category='subcontractor'), bool_and(valid) filter (where category='material'),
    bool_and(valid) filter (where category in ('waste','transport','other'))
  into v_count,v_known,v_verified,new.estimated_cost,new.customer_price,v_work_count,v_own,v_sub,v_has_sub,v_material,v_other from effective;
  if v_count=0 or not v_known then new.estimated_cost:=null; new.customer_price:=null; end if;
  if v_work_count>0 then
    new.own_labor_ready:=coalesce(v_own,true); new.subcontractor_price_ready:=coalesce(v_sub,true); new.requires_subcontractor:=v_has_sub;
  end if;
  if exists(select 1 from public.action_case_cost_lines where action_case_item_id=new.id and category='material') then new.material_price_ready:=coalesce(v_material,true); end if;
  if exists(select 1 from public.action_case_cost_lines where action_case_item_id=new.id and category in ('waste','transport','other')) then new.waste_solution_ready:=coalesce(v_other,true); end if;
  if old.status in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote') then
    new.status:=case when btrim(coalesce(new.scope,''))='' then 'scope_needed'
      when new.own_labor_ready and new.material_price_ready and new.waste_solution_ready and (not new.requires_subcontractor or new.subcontractor_price_ready)
        and (v_count=0 or (v_known and v_verified)) then 'ready_for_quote'
      when new.requires_subcontractor and not new.subcontractor_price_ready then 'waiting_subcontractor' else 'pricing_needed' end;
  else new.status:=old.status; end if;
  return new;
end $$;
revoke all on function public.action_case_item_cost_state() from public,anon,authenticated;
grant execute on function public.action_case_item_cost_state() to service_role;

-- Reuse the existing versioned writer, locks, quote rules, contract guards and audit.
-- A distinct RPC prevents a new client silently writing through an older installation.
create or replace function public.save_action_case_calculation_with_reserve(
  p_org_id uuid,p_case_id uuid,p_item_id uuid,p_user_id uuid,p_request_id uuid,
  p_expected_updated_at timestamptz,p_operation text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare prior public.action_case_calculation_requests%rowtype; answer jsonb; reserve numeric; actual_updated_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_request_id is null or p_expected_updated_at is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
  if p_operation is null or p_operation not in ('line','delete_line','complete','work_part','markup','lump_sum') then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  perform 1 from public.action_case_items where id=p_item_id and action_case_id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  select * into prior from public.action_case_calculation_requests where request_id=p_request_id;
  if found then
    if prior.org_id<>p_org_id or prior.action_case_id<>p_case_id or prior.action_case_item_id<>p_item_id or prior.actor_id<>p_user_id
      or prior.operation<>p_operation or prior.expected_updated_at<>p_expected_updated_at or prior.payload<>p_data then raise exception 'ACTION_CASE_CALCULATION_REQUEST_CONFLICT'; end if;
    return prior.result;
  end if;
  if p_data ? 'reservePercent' then
    if p_operation not in ('line','markup') or jsonb_typeof(p_data->'reservePercent') not in ('number','string') then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
    begin reserve:=(p_data->>'reservePercent')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end;
    if reserve is null or reserve<0 or reserve>1000 then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
  end if;
  answer:=public.save_action_case_calculation(p_org_id,p_case_id,p_item_id,p_user_id,p_request_id,p_expected_updated_at,p_operation,p_data);
  if p_data ? 'reservePercent' then
    update public.action_case_cost_lines set reserve_percent=reserve,updated_by=p_user_id
      where id=(p_data->>'id')::uuid and action_case_item_id=p_item_id and org_id=p_org_id and reserve_percent is distinct from reserve;
    -- The reserve update recalculates the parent through the existing triggers.
    -- Store its final acknowledgement so an identical retry never writes twice.
    select updated_at into actual_updated_at from public.action_case_items where id=p_item_id and org_id=p_org_id;
    answer:=jsonb_set(answer,'{updatedAt}',to_jsonb(actual_updated_at));
    update public.action_case_calculation_requests set result=answer where request_id=p_request_id;
  end if;
  return answer;
end $$;
revoke all on function public.save_action_case_calculation_with_reserve(uuid,uuid,uuid,uuid,uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_action_case_calculation_with_reserve(uuid,uuid,uuid,uuid,uuid,timestamptz,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
