-- Independent offers and new contract drafts: running prices with separate planning budgets.
-- Requires 2026-10-08_04_contract_pricing.sql. No saved data or signed snapshots are rewritten.
begin;

create or replace function public.assert_contract_budget(p_body jsonb, p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare
  p jsonb:=p_body->'contractPricing'; b jsonb:=p->'budget'; entry jsonb; part jsonb;
  ids text[]:='{}'; val numeric; total numeric:=0; running_count integer:=0;
begin
  if not coalesce(p ? 'budget',false) or b='null'::jsonb then return; end if;
  if jsonb_typeof(b) is distinct from 'object' or b->'version' is distinct from '1'::jsonb
    or jsonb_typeof(b->'rows') is distinct from 'array' or jsonb_array_length(b->'rows')>200
    or jsonb_typeof(b->'assumptions') is distinct from 'string' or length(b->>'assumptions')>6000
    or jsonb_typeof(b->'reviewTerms') is distinct from 'string' or length(b->>'reviewTerms')>6000
    or coalesce(p->>'mode','') not in ('running','mixed') or p#>'{running,approximateOre}' is distinct from 'null'::jsonb
    or jsonb_typeof(p->'rows') is distinct from 'array' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  for entry in select value from jsonb_array_elements(b->'rows') loop
    if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'id') is distinct from 'string'
      or coalesce(entry->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or lower(entry->>'id')=any(ids) or not entry ? 'amountOre'
      or not exists(select 1 from jsonb_array_elements(p->'rows') r where lower(r->>'id')=lower(entry->>'id')) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    ids:=array_append(ids,lower(entry->>'id'));
    if entry->'amountOre'<>'null'::jsonb then
      if jsonb_typeof(entry->'amountOre') is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      val:=(entry->>'amountOre')::numeric;
      if val<0 or val>100000000000 or val<>trunc(val) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end if;
  end loop;
  for part in select value from jsonb_array_elements(p->'rows') where p->>'mode'='running' or value->>'kind'='running' loop
    running_count:=running_count+1;
    select value into entry from jsonb_array_elements(b->'rows') where lower(value->>'id')=lower(part->>'id');
    if p_complete and (entry is null or entry->'amountOre'='null'::jsonb) then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    total:=total+coalesce((entry->>'amountOre')::numeric,0);
  end loop;
  if p->>'mode'='mixed' then total:=total+coalesce((p_body->>'baseAmountOre')::numeric,0); end if;
  if total>100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_complete and (running_count=0 or nullif(btrim(b->>'assumptions'),'') is null or nullif(btrim(b->>'reviewTerms'),'') is null) then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
end $$;

create or replace function public.guard_contract_budget()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  -- Explicit null clears a budget. Older clients may not silently drop the new key.
  if tg_op='UPDATE' and coalesce((old.body->'contractPricing') ? 'budget',false)
    and not coalesce((new.body->'contractPricing') ? 'budget',false) then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  perform public.assert_contract_budget(new.body,false);
  return new;
end $$;

do $migration$
declare definition text; original text:=E'begin\n  if jsonb_typeof(p)'; replacement text:=E'begin\n  perform public.assert_contract_budget(p_body,p_complete);\n  if jsonb_typeof(p)';
begin
  definition:=replace(pg_get_functiondef('public.assert_contract_pricing(jsonb,boolean)'::regprocedure),E'\r\n',E'\n');
  if position('perform public.assert_contract_budget(p_body,p_complete)' in definition)=0 then
    if position(original in definition)=0 then raise exception 'CONTRACT_BUDGET_MIGRATION_SOURCE_MISMATCH'; end if;
    execute replace(definition,original,replacement);
  end if;
end $migration$;

drop trigger if exists customer_offer_budget on public.action_case_customer_offer_drafts;
create trigger customer_offer_budget before insert or update of body on public.action_case_customer_offer_drafts
for each row execute function public.guard_contract_budget();
drop trigger if exists customer_contract_budget on public.action_case_customer_contract_drafts;
create trigger customer_contract_budget before insert or update of body on public.action_case_customer_contract_drafts
for each row execute function public.guard_contract_budget();
revoke all on function public.assert_contract_budget(jsonb,boolean),public.guard_contract_budget() from public,anon,authenticated;
grant execute on function public.assert_contract_budget(jsonb,boolean),public.guard_contract_budget() to service_role;
commit;
