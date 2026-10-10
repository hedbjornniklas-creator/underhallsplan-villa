-- Gizmo: independent fixed, running and mixed contract prices.
-- Run after 2026-10-08_01, _02 and _03. No saved prices or signed snapshots are rewritten.
begin;

create or replace function public.assert_contract_pricing(p_body jsonb,p_complete boolean default false)
returns bigint language plpgsql set search_path=public,pg_catalog as $$
declare
  p jsonb := p_body->'contractPricing'; r jsonb; row jsonb; entry jsonb; key text;
  val numeric; base bigint; row_amount bigint; sum_amount bigint := 0;
  missing boolean := false; fixed_count integer := 0; running_count integer := 0;
  ids text[] := '{}'; sources text[] := '{}';
begin
  if jsonb_typeof(p) is distinct from 'object' or p->'version' is distinct from '1'::jsonb
    or coalesce(p->>'mode','') not in ('fixed','running','mixed')
    or coalesce(p->>'display','') not in ('priced','unpriced','total')
    or coalesce(p->>'split','') not in ('combined','separate')
    or coalesce(p->>'basis','') not in ('rows','total')
    or p_body->>'pricingMode' is distinct from 'total'
    or jsonb_typeof(p->'running') is distinct from 'object'
    or jsonb_typeof(p->'rows') is distinct from 'array'
    or jsonb_typeof(p_body->'items') is distinct from 'array' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if jsonb_array_length(p->'rows') > 200 or jsonb_array_length(p_body->'items') > 200 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  r := p->'running';
  -- Validate inactive fields too: switching modes must never reveal malformed prices.
  for entry in select value from jsonb_array_elements(jsonb_build_array(p,r) || (p->'rows')) loop
    foreach key in array case when entry=r then array['hourlyOre','managementOre','approximateOre']
      when entry=p then array['totalOre','labourOre','materialOre'] else array['amountOre','labourOre','materialOre'] end loop
      if not entry ? key then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      if entry->key <> 'null'::jsonb then
        if jsonb_typeof(entry->key) is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
        val := (entry->>key)::numeric;
        if val <> trunc(val) or val < 0 or val > 100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      end if;
    end loop;
  end loop;
  if not r ? 'markupPercent' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if r->'markupPercent' <> 'null'::jsonb then
    if jsonb_typeof(r->'markupPercent') is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    val := (r->>'markupPercent')::numeric;
    if val < 0 or val > 1000 or val*100 <> trunc(val*100) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end if;
  for row in select value from jsonb_array_elements(p->'rows') loop
    if jsonb_typeof(row) is distinct from 'object' or jsonb_typeof(row->'id') is distinct from 'string'
      or coalesce(row->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or lower(row->>'id')=any(ids) or jsonb_typeof(row->'title') is distinct from 'string' or length(row->>'title') > 250
      or coalesce(row->>'kind','') not in ('fixed','running') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    ids := array_append(ids,lower(row->>'id'));
    if row ? 'sourceItemId' then
      if jsonb_typeof(row->'sourceItemId') is distinct from 'string'
        or coalesce(row->>'sourceItemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or lower(row->>'sourceItemId')=any(sources) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      sources := array_append(sources,lower(row->>'sourceItemId'));
    end if;
    if p_complete and nullif(btrim(row->>'title'),'') is null then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    if p->>'mode' <> 'mixed' or row->>'kind'='fixed' then
      fixed_count := fixed_count+1;
      row_amount := case when p->>'split'='combined' then (row->>'amountOre')::bigint else (row->>'labourOre')::bigint+(row->>'materialOre')::bigint end;
      missing := missing or row_amount is null;
      sum_amount := sum_amount+coalesce(row_amount,0);
    else running_count := running_count+1; end if;
  end loop;
  for row in select value from jsonb_array_elements(p_body->'items') loop
    if coalesce(row->>'kind','') not in ('included','option','excluded') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_complete and row->>'kind'='option' then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    if row->'amountOre' is not null and row->'amountOre' <> 'null'::jsonb then
      if jsonb_typeof(row->'amountOre') is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      val := (row->>'amountOre')::numeric;
      if val <> trunc(val) or val < 0 or val > 100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end if;
  end loop;
  if p->>'mode' <> 'running' then
    base := case when p->>'basis'='total' then
      case when p->>'split'='combined' then (p->>'totalOre')::bigint else (p->>'labourOre')::bigint+(p->>'materialOre')::bigint end
      when missing or fixed_count=0 then null else sum_amount end;
  end if;
  if base > 100000000000 or p_body->'baseAmountOre' is distinct from coalesce(to_jsonb(base),'null'::jsonb) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_complete then
    if not exists(select 1 from jsonb_array_elements(p_body->'items') i where i->>'kind'='included')
      or (p->>'mode'<>'running' and base is null)
      or (p->>'mode'='mixed' and (fixed_count=0 or running_count=0))
      or (p->>'mode'<>'running' and p->>'basis'='total' and p->>'display'='priced') then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    if p->>'mode'<>'fixed' and ((r->>'hourlyOre')::bigint is null or (r->>'hourlyOre')::bigint <= 0
      or (r->>'managementOre')::bigint <= 0 or r->'markupPercent'='null'::jsonb
      or (r->>'approximateOre')::bigint <= 0) then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  end if;
  return base;
end $$;

-- Extend the existing guards without altering the legacy fixed-price branch.
do $migration$
declare definition text; original text; replacement text;
begin
  definition := replace(pg_get_functiondef('public.assert_customer_offer_pricing(jsonb,jsonb,boolean)'::regprocedure),E'\r\n',E'\n');
  if position('public.assert_contract_pricing(p_body' in definition)=0 then
    original := E'begin\n  if v_mode not in';
    replacement := E'begin\n  if p_body ? ''contractPricing'' then\n    if p_selection is not null and p_selection <> ''[]''::jsonb then raise exception ''CUSTOMER_OFFER_INVALID''; end if;\n    return public.assert_contract_pricing(p_body,p_complete);\n  end if;\n  if v_mode not in';
    if position(original in definition)=0 then raise exception 'CONTRACT_PRICING_MIGRATION_SOURCE_MISMATCH'; end if;
    execute replace(definition,original,replacement);
  end if;
  definition := replace(pg_get_functiondef('public.write_customer_contract(uuid,uuid,uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n');
  original := E'if jsonb_typeof(d.body->''baseAmountOre'') is distinct from ''number'' or (d.body->>''baseAmountOre'')::bigint < 0\n      or (d.body->>''validUntil'')::date < (now() at time zone ''Europe/Stockholm'')::date then raise exception ''CUSTOMER_OFFER_INVALID''; end if;';
  replacement := E'perform public.assert_customer_offer_pricing(d.body,null,true);\n    if (d.body->>''validUntil'')::date < (now() at time zone ''Europe/Stockholm'')::date then raise exception ''CUSTOMER_OFFER_INVALID''; end if;';
  if position(original in definition)>0 then execute replace(definition,original,replacement);
  elsif position(replacement in definition)=0 then raise exception 'CONTRACT_PRICING_MIGRATION_SOURCE_MISMATCH'; end if;
end $migration$;

create or replace function public.guard_contract_pricing_format()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if old.body ? 'contractPricing' and not new.body ? 'contractPricing' then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  return new;
end $$;
drop trigger if exists independent_contract_pricing_format on public.action_case_customer_contract_drafts;
create trigger independent_contract_pricing_format before update of body on public.action_case_customer_contract_drafts
  for each row execute function public.guard_contract_pricing_format();
revoke all on function public.assert_contract_pricing(jsonb,boolean),public.guard_contract_pricing_format() from public,anon,authenticated;
grant execute on function public.assert_contract_pricing(jsonb,boolean),public.guard_contract_pricing_format() to service_role;
commit;
