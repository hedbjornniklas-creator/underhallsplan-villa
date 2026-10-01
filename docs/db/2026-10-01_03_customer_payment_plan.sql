-- Gizmo: versioned payment plans within the existing main-agreement snapshot.
-- No old drafts, offers or accepted agreements are rewritten.
-- Requires customer offer migrations 2026-09-29_01 through _04 and 2026-10-01_02.
begin;

create or replace function public.assert_customer_payment_plan(p_body jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare p jsonb; r jsonb; total numeric := 0; base numeric; n numeric;
begin
  if not p_body ? 'paymentPlan' or p_body->'paymentPlan'='null'::jsonb then return; end if;
  p := p_body->'paymentPlan';
  if jsonb_typeof(p) is distinct from 'object' or p->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p->'installments') is distinct from 'array' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if jsonb_array_length(p->'installments')>60 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  for r in select value from jsonb_array_elements(p->'installments') loop
    if jsonb_typeof(r) is distinct from 'object'
      or jsonb_typeof(r->'id') is distinct from 'string'
      or (r->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(r->'title') is distinct from 'string' or length(r->>'title')>250
      or jsonb_typeof(r->'condition') is distinct from 'string' or length(r->>'condition')>6000
      or jsonb_typeof(r->'plannedDate') is distinct from 'string'
      or coalesce(jsonb_typeof(r->'amountOre'),'') not in ('number','null') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if r->>'plannedDate'<>'' then
      begin
        if (r->>'plannedDate') !~ '^\d{4}-\d{2}-\d{2}$'
          or to_char((r->>'plannedDate')::date,'YYYY-MM-DD') is distinct from r->>'plannedDate' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      exception when others then raise exception 'CUSTOMER_OFFER_INVALID'; end;
    end if;
    n := (r->>'amountOre')::numeric;
    if n<0 or n>100000000000 or trunc(n)<>n then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    total := total+coalesce(n,0);
    if p_complete and (btrim(r->>'title')='' or btrim(r->>'condition')='' or n is null or n<=0) then
      raise exception 'CUSTOMER_OFFER_INCOMPLETE';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p->'installments') entry group by lower(entry->>'id') having count(*)>1) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_complete then
    if p_body->>'pricingMode'='itemized' then
      if exists(select 1 from jsonb_array_elements(p_body->'items') i where i->>'kind'='included' and jsonb_typeof(i->'amountOre') is distinct from 'number') then
        raise exception 'CUSTOMER_OFFER_INCOMPLETE';
      end if;
      select sum((i->>'amountOre')::numeric) into base from jsonb_array_elements(p_body->'items') i where i->>'kind'='included';
    else base := (p_body->>'baseAmountOre')::numeric;
    end if;
    if jsonb_array_length(p->'installments')=0 or base is null or total<>base then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  end if;
end $$;
revoke all on function public.assert_customer_payment_plan(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.assert_customer_payment_plan(jsonb,boolean) to service_role;

create or replace function public.guard_customer_payment_plan()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if tg_table_name='action_case_customer_offer_drafts' then
    -- An older client must not silently drop a plan. Explicit null is removal.
    if tg_op='UPDATE' and old.body ? 'paymentPlan' and not new.body ? 'paymentPlan' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    perform public.assert_customer_payment_plan(new.body,false);
  else
    perform public.assert_customer_payment_plan(new.snapshot,true);
  end if;
  return new;
end $$;
drop trigger if exists customer_payment_plan_draft on public.action_case_customer_offer_drafts;
create trigger customer_payment_plan_draft before insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.guard_customer_payment_plan();
drop trigger if exists customer_payment_plan_publication on public.action_case_customer_offers;
create trigger customer_payment_plan_publication before insert on public.action_case_customer_offers
  for each row execute function public.guard_customer_payment_plan();
notify pgrst, 'reload schema';
commit;
