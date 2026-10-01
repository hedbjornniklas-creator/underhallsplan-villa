-- Explicit manual package price, independent of detailed calculation lines.
-- Existing calculations remain intact; no automatic conversion of old projects.
begin;
alter table public.action_case_items add column if not exists lump_sum jsonb;
create or replace function public.valid_action_case_lump_sum(value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare amount numeric; field text;
begin
  if value is null then return true; end if;
  if jsonb_typeof(value) <> 'object'
    or not (value ?& array['internalCost', 'customerPrice', 'vatRate', 'verified'])
    or jsonb_typeof(value->'verified') <> 'boolean'
    or jsonb_typeof(value->'vatRate') <> 'number'
    or (value->>'vatRate')::numeric not in (0,6,12,25) then return false; end if;
  foreach field in array array['internalCost', 'customerPrice'] loop
    if value->field <> 'null'::jsonb then
      if jsonb_typeof(value->field) <> 'number' then return false; end if;
      amount := (value->>field)::numeric;
      if amount < 0 or amount > 1000000000 or round(amount,2) <> amount then return false; end if;
    end if;
  end loop;
  return not ((value->>'verified')::boolean and value->'customerPrice' = 'null'::jsonb);
exception when others then return false;
end;
$$;
alter table public.action_case_items drop constraint if exists action_case_items_lump_sum_check;
alter table public.action_case_items add constraint action_case_items_lump_sum_check
  check (public.valid_action_case_lump_sum(lump_sum));
comment on column public.action_case_items.lump_sum is
  'Optional manual total price in SEK excluding VAT. When set, detailed lines are retained as supporting data but are not added to this total.';
commit;
