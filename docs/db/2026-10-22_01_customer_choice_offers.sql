-- Independent customer price/time terms for Val och tillval. No contract writes.
-- Requires 2026-10-18_01/02 and 2026-10-08_04_contract_pricing.sql.
begin;

create or replace function public.assert_customer_choice_offer(p_offer jsonb)
returns bigint language plpgsql set search_path=public,pg_catalog as $$
declare p jsonb := p_offer->'pricing'; t jsonb := p_offer->'time'; r jsonb; amount bigint; base bigint; missing boolean := false; n integer := 0; k text;
begin
  if jsonb_typeof(p_offer) is distinct from 'object' or p_offer->'version' is distinct from '1'::jsonb
    or coalesce(p_offer->>'kind','') not in ('selection','option','change')
    or jsonb_typeof(p_offer->'priceNeutral') is distinct from 'boolean'
    or coalesce(p_offer->>'priceSource','') not in ('manual','calculation')
    or exists(select 1 from jsonb_object_keys(p_offer) x where x not in ('version','kind','conditions','exclusions','priceNeutral','priceSource','pricing','time'))
    or jsonb_typeof(t) is distinct from 'object' or coalesce(t->>'status','') not in ('unassessed','none','extension')
    or exists(select 1 from jsonb_object_keys(t) x where x not in ('status','workingDays','explanation'))
    or jsonb_typeof(t->'explanation') is distinct from 'string' or length(t->>'explanation')>3000
    or not (t ? 'workingDays') then raise exception 'CUSTOMER_CHOICE_OFFER_INVALID'; end if;
  if t->'workingDays'<>'null'::jsonb then
    if jsonb_typeof(t->'workingDays') is distinct from 'number' then raise exception 'CUSTOMER_CHOICE_OFFER_INVALID'; end if;
    if (t->>'workingDays')::numeric<0 or (t->>'workingDays')::numeric>3650 or trunc((t->>'workingDays')::numeric)<>(t->>'workingDays')::numeric then raise exception 'CUSTOMER_CHOICE_OFFER_INVALID'; end if;
  end if;
  foreach k in array array['conditions','exclusions'] loop
    if jsonb_typeof(p_offer->k) is distinct from 'string' or length(p_offer->>k)>6000 then raise exception 'CUSTOMER_CHOICE_OFFER_INVALID'; end if;
  end loop;
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'rows') is distinct from 'array' then raise exception 'CUSTOMER_CHOICE_OFFER_INVALID'; end if;
  if p->>'mode'<>'running' then
    if p->>'basis'='total' then
      base := case when p->>'split'='combined' then (p->>'totalOre')::bigint else (p->>'labourOre')::bigint+(p->>'materialOre')::bigint end;
    else
      base := 0;
      for r in select value from jsonb_array_elements(p->'rows') loop
        if p->>'mode'='mixed' and r->>'kind'='running' then continue; end if;
        n := n+1;
        amount := case when p->>'split'='combined' then (r->>'amountOre')::bigint else (r->>'labourOre')::bigint+(r->>'materialOre')::bigint end;
        missing := missing or amount is null; base := base+coalesce(amount,0);
      end loop;
      if missing or n=0 then base := null; end if;
    end if;
  end if;
  -- Reuse the pure validator, not any agreement writer or agreement data.
  perform public.assert_contract_pricing(jsonb_build_object('contractPricing',p,'pricingMode','total','items','[]'::jsonb,'baseAmountOre',base),false);
  return case when p_offer->>'priceNeutral'='true' then 0 when p->>'mode'='fixed' then base else null end;
exception when others then raise exception 'CUSTOMER_CHOICE_OFFER_INVALID';
end $$;

-- Preserve the existing category validation while allowing the one new public field.
do $$ begin
  if to_regprocedure('public.assert_customer_choice_categories_base(jsonb,jsonb,boolean)') is null then
    alter function public.assert_customer_choice_categories(jsonb,jsonb,boolean) rename to assert_customer_choice_categories_base;
  end if;
end $$;
create or replace function public.assert_customer_choice_categories(p_categories jsonb,p_items jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare item jsonb; stripped jsonb; amount bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if item ? 'offer' then
      amount := public.assert_customer_choice_offer(item->'offer');
      if item->'budgetOre' is distinct from coalesce(to_jsonb(amount),'null'::jsonb) then raise exception 'CUSTOMER_CHOICE_OFFER_INVALID'; end if;
    end if;
  end loop;
  select coalesce(jsonb_agg(value-'offer' order by n),'[]'::jsonb) into stripped from jsonb_array_elements(p_items) with ordinality a(value,n);
  perform public.assert_customer_choice_categories_base(p_categories,stripped,p_complete);
end $$;

create or replace function public.guard_customer_choice_offer_format()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
declare item jsonb; next_item jsonb;
begin
  for item in select value from jsonb_array_elements(new.items) loop
    if item ? 'offer' then perform public.assert_customer_choice_offer(item->'offer'); end if;
  end loop;
  if tg_op='UPDATE' then
    for item in select value from jsonb_array_elements(old.items) loop
      select value into next_item from jsonb_array_elements(new.items) where value->>'id'=item->>'id';
      if next_item is null then continue; end if; -- Explicit deletion remains possible.
      if item ? 'offer' and not (next_item ? 'offer') then raise exception 'CUSTOMER_CHOICE_OFFER_STALE'; end if;
      if old.internal_costing->(item->>'id')->'version'='3'::jsonb and new.internal_costing->(item->>'id')->'version' is distinct from '3'::jsonb then raise exception 'CUSTOMER_CHOICE_OFFER_STALE'; end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists customer_choice_offer_format on public.action_case_customer_planning;
create trigger customer_choice_offer_format before insert or update on public.action_case_customer_planning for each row execute function public.guard_customer_choice_offer_format();

create or replace function public.customer_choice_offer_schema() returns integer language sql immutable set search_path=public,pg_catalog as $$ select 1 $$;
revoke all on function public.assert_customer_choice_offer(jsonb),public.assert_customer_choice_categories_base(jsonb,jsonb,boolean),public.assert_customer_choice_categories(jsonb,jsonb,boolean),public.guard_customer_choice_offer_format(),public.customer_choice_offer_schema() from public,anon,authenticated;
grant execute on function public.assert_customer_choice_offer(jsonb),public.assert_customer_choice_categories_base(jsonb,jsonb,boolean),public.assert_customer_choice_categories(jsonb,jsonb,boolean),public.guard_customer_choice_offer_format(),public.customer_choice_offer_schema() to service_role;
commit;
