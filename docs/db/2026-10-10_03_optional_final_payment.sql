-- Gizmo: allow the automatic final installment to be removed and restored.
-- Requires 2026-10-10_02. Run before app deployment. No saved bodies are rewritten.
begin;
create or replace function public.assert_payment_automation(p_body jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare c jsonb := p_body->'paymentConditions'; p jsonb := p_body->'paymentPlan'; a jsonb; r jsonb;
  base numeric; percent numeric; expected numeric; initial_count integer := 0; final_count integer := 0;
  final_enabled boolean;
begin
  if c is not null then
    if jsonb_typeof(c) is distinct from 'object' or c->'version' is distinct from '1'::jsonb
      or jsonb_typeof(c->'days') is distinct from 'number' or jsonb_typeof(c->'standardText') is distinct from 'string'
      or length(c->>'standardText')>6000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if (c->>'days')::numeric<>trunc((c->>'days')::numeric) or (c->>'days')::numeric not between 1 and 365 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_complete and p_body->>'contractForm'='abs18' and btrim(c->>'standardText')='' then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  end if;
  if p is null or p='null'::jsonb then return; end if;
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'installments') is distinct from 'array' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if not p ? 'automation' then
    if exists(select 1 from jsonb_array_elements(p->'installments') v where v ? 'kind') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    return;
  end if;
  a := p->'automation';
  if jsonb_typeof(a) is distinct from 'object' or a->'version' is distinct from '1'::jsonb
    or jsonb_typeof(a->'initialEnabled') is distinct from 'boolean'
    or (a ? 'finalEnabled' and jsonb_typeof(a->'finalEnabled') is distinct from 'boolean')
    or coalesce(jsonb_typeof(a->'initialPercent'),'') not in ('number','null')
    or coalesce(jsonb_typeof(a->'allocationBaseOre'),'') not in ('number','null') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  final_enabled := coalesce((a->>'finalEnabled')::boolean,true);
  percent := (a->>'initialPercent')::numeric;
  if percent<0 or percent>90 or percent*100<>trunc(percent*100) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if (a->>'allocationBaseOre')::numeric<0 or (a->>'allocationBaseOre')::numeric>100000000000
    or (a->>'allocationBaseOre')::numeric<>trunc((a->>'allocationBaseOre')::numeric) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_body ? 'contractPricing' then base := public.assert_contract_pricing(p_body,false);
  elsif p_body->>'pricingMode'='itemized' then
    if not exists(select 1 from jsonb_array_elements(p_body->'items') v where v->>'kind'='included' and v->'amountOre'='null'::jsonb) then
      select sum((v->>'amountOre')::numeric) into base from jsonb_array_elements(p_body->'items') v where v->>'kind'='included';
    end if;
  else base := (p_body->>'baseAmountOre')::numeric; end if;
  for r in select value from jsonb_array_elements(p->'installments') loop
    if r ? 'kind' then
      if r->>'kind'='initial' then
        initial_count := initial_count+1; expected := round(base*percent/100);
      elsif r->>'kind'='final' then
        final_count := final_count+1; expected := round(base/10);
      else raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      if r->'amountOre' is distinct from coalesce(to_jsonb(expected),'null'::jsonb) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end if;
  end loop;
  if final_count<>(case when final_enabled then 1 else 0 end)
    or (final_enabled and p->'installments'->(-1)->>'kind' is distinct from 'final')
    or initial_count<>(case when (a->>'initialEnabled')::boolean then 1 else 0 end)
    or ((a->>'initialEnabled')::boolean and p->'installments'->0->>'kind' is distinct from 'initial') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_complete and (base is null or (a->>'allocationBaseOre')::numeric is distinct from base
    or ((a->>'initialEnabled')::boolean and (percent is null or percent<=0))
    or ((final_enabled or (a->>'initialEnabled')::boolean) and p_body ? 'contractPricing' and p_body#>>'{contractPricing,mode}'<>'fixed')) then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
end $$;

create or replace function public.guard_payment_automation_format() returns trigger
language plpgsql set search_path=public,pg_catalog as $$
begin
  if tg_op='UPDATE' and ((old.body ? 'paymentConditions' and not new.body ? 'paymentConditions')
    or (old.body#>'{paymentPlan,automation}' is not null and (not new.body ? 'paymentPlan'
      or (new.body->'paymentPlan'<>'null'::jsonb and new.body#>'{paymentPlan,automation}' is null)))
    or (old.body#>'{paymentPlan,automation}' ? 'finalEnabled'
      and new.body->'paymentPlan'<>'null'::jsonb
      and not coalesce(new.body#>'{paymentPlan,automation}' ? 'finalEnabled',false))) then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  perform public.assert_payment_automation(new.body,false);
  return new;
end $$;
revoke all on function public.assert_payment_automation(jsonb,boolean),public.guard_payment_automation_format() from public,anon,authenticated;
grant execute on function public.assert_payment_automation(jsonb,boolean),public.guard_payment_automation_format() to service_role;
notify pgrst, 'reload schema';
commit;
