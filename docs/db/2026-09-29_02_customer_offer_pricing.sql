-- Gizmo: itemized fixed prices and mutually exclusive optional alternatives.
-- Requires 2026-09-29_01_action_case_customer_offers.sql.
-- No existing drafts, published offers, selections or accepted totals are changed.
begin;

create or replace function public.assert_customer_offer_pricing(
  p_body jsonb, p_selection jsonb default null, p_complete boolean default false
) returns bigint language plpgsql set search_path = public, pg_catalog as $$
declare
  v_mode text := coalesce(p_body->>'pricingMode', 'total');
  v_item jsonb;
  v_value numeric;
  v_base bigint;
  v_total bigint;
  v_sum bigint := 0;
  v_included integer := 0;
  v_missing boolean := false;
  v_id text;
  v_group text;
  v_groups text[] := '{}';
begin
  if v_mode not in ('total', 'itemized')
    or jsonb_typeof(p_body->'items') is distinct from 'array'
    or jsonb_array_length(p_body->'items') > 200 then
    raise exception 'CUSTOMER_OFFER_INVALID';
  end if;
  for v_item in select value from jsonb_array_elements(p_body->'items') loop
    if coalesce(v_item->>'kind', '') not in ('included', 'option', 'excluded') then
      raise exception 'CUSTOMER_OFFER_INVALID';
    end if;
    if v_item->'optionGroup' is not null and v_item->'optionGroup' <> 'null'::jsonb then
      if jsonb_typeof(v_item->'optionGroup') <> 'string'
        or length(v_item->>'optionGroup') > 100
        or v_item->>'kind' <> 'option' then
        raise exception 'CUSTOMER_OFFER_INVALID';
      end if;
    end if;
    v_value := null;
    if v_item->'amountOre' is not null and v_item->'amountOre' <> 'null'::jsonb then
      if jsonb_typeof(v_item->'amountOre') <> 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      v_value := (v_item->>'amountOre')::numeric;
      if v_value <> trunc(v_value) or v_value < 0 or v_value > 100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end if;
    if v_item->>'kind' = 'included' then
      v_included := v_included + 1;
      v_missing := v_missing or v_value is null;
      v_sum := v_sum + coalesce(v_value::bigint, 0);
    elsif p_complete and v_item->>'kind' = 'option' and v_value is null then
      raise exception 'CUSTOMER_OFFER_INCOMPLETE';
    end if;
  end loop;
  if v_mode = 'itemized' then
    v_base := case when v_missing or v_included = 0 then null else v_sum end;
    if p_body->'baseAmountOre' is distinct from coalesce(to_jsonb(v_base), 'null'::jsonb) then
      raise exception 'CUSTOMER_OFFER_INVALID';
    end if;
  elsif p_body->'baseAmountOre' is not null and p_body->'baseAmountOre' <> 'null'::jsonb then
    if jsonb_typeof(p_body->'baseAmountOre') <> 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    v_value := (p_body->>'baseAmountOre')::numeric;
    if v_value <> trunc(v_value) or v_value < 0 or v_value > 100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    v_base := v_value::bigint;
  end if;
  if p_complete then
    if v_base is null or v_included = 0 then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    if exists (
      select 1 from jsonb_array_elements(p_body->'items') i
      where i->>'kind' = 'option' and nullif(btrim(i->>'optionGroup'), '') is not null
      group by btrim(i->>'optionGroup') having count(*) < 2
    ) then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  end if;
  v_total := v_base;
  if p_selection is not null then
    if jsonb_typeof(p_selection) is distinct from 'array'
      or jsonb_array_length(p_selection) > 200
      or (select count(distinct value) from jsonb_array_elements(p_selection)) <> jsonb_array_length(p_selection)
      or exists(select 1 from jsonb_array_elements(p_selection) s where jsonb_typeof(s) <> 'string') then
      raise exception 'CUSTOMER_OFFER_INVALID';
    end if;
    for v_id in select value from jsonb_array_elements_text(p_selection) loop
      select value into v_item from jsonb_array_elements(p_body->'items')
        where value->>'id' = v_id and value->>'kind' = 'option';
      if not found or jsonb_typeof(v_item->'amountOre') is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      v_group := nullif(btrim(v_item->>'optionGroup'), '');
      if v_group is not null then
        if v_group = any(v_groups) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
        v_groups := array_append(v_groups, v_group);
      end if;
      v_total := v_total + (v_item->>'amountOre')::bigint;
    end loop;
  end if;
  return v_total;
end $$;

create or replace function public.guard_customer_offer_pricing()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
declare v_body jsonb; v_total bigint;
begin
  if tg_table_name = 'action_case_customer_offer_drafts' then
    perform public.assert_customer_offer_pricing(new.body);
  elsif tg_table_name = 'action_case_customer_offers' then
    if tg_op = 'INSERT' then
      perform public.assert_customer_offer_pricing(new.snapshot, null, true);
    elsif new.status = 'accepted' and old.status <> 'accepted' then
      v_total := public.assert_customer_offer_pricing(new.snapshot, new.accepted_option_ids, true);
      if new.accepted_total_ore is distinct from v_total then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end if;
  else
    select snapshot into v_body from public.action_case_customer_offers where id = new.offer_id;
    if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
    perform public.assert_customer_offer_pricing(v_body, new.selection, true);
  end if;
  return new;
end $$;

drop trigger if exists customer_offer_draft_pricing on public.action_case_customer_offer_drafts;
create trigger customer_offer_draft_pricing before insert or update of body
  on public.action_case_customer_offer_drafts for each row execute function public.guard_customer_offer_pricing();
drop trigger if exists customer_offer_snapshot_pricing on public.action_case_customer_offers;
create trigger customer_offer_snapshot_pricing before insert or update of status, accepted_total_ore, accepted_option_ids
  on public.action_case_customer_offers for each row execute function public.guard_customer_offer_pricing();
drop trigger if exists customer_offer_selection_pricing on public.action_case_customer_offer_challenges;
create trigger customer_offer_selection_pricing before insert or update of selection, offer_id
  on public.action_case_customer_offer_challenges for each row execute function public.guard_customer_offer_pricing();

revoke all on function public.assert_customer_offer_pricing(jsonb,jsonb,boolean), public.guard_customer_offer_pricing() from public, anon, authenticated;
grant execute on function public.assert_customer_offer_pricing(jsonb,jsonb,boolean), public.guard_customer_offer_pricing() to service_role;
commit;
