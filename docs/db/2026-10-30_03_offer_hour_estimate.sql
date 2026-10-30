-- Optional hour ranges in the independent offer draft. No contract or project data is rewritten.
begin;

create or replace function public.assert_offer_hour_estimate(p_body jsonb, p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare e jsonb := p_body->'offerHourEstimate'; key text; hours numeric; rate numeric;
begin
  if not p_body ? 'offerHourEstimate' or e = 'null'::jsonb then return; end if;
  if jsonb_typeof(e) is distinct from 'object' or e->'version' is distinct from '1'::jsonb then
    raise exception 'CUSTOMER_OFFER_INVALID';
  end if;
  foreach key in array array['minHours','maxHours'] loop
    if not e ? key then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if e->key <> 'null'::jsonb then
      if jsonb_typeof(e->key) is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      hours := (e->>key)::numeric;
      if hours < 0 or hours > 100000 or hours*100 <> trunc(hours*100) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end if;
  end loop;
  if p_complete and p_body->'contractPricing'->>'mode' in ('running','mixed') then
    if e->'minHours'='null'::jsonb or e->'maxHours'='null'::jsonb or
      (e->>'minHours')::numeric > (e->>'maxHours')::numeric then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    rate := (p_body->'contractPricing'->'running'->>'hourlyOre')::numeric;
    if round((e->>'maxHours')::numeric*rate) > 100000000000 then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  end if;
end $$;

create or replace function public.guard_offer_hour_estimate()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  -- Old clients must not silently discard a new format. Explicit null disables the range.
  if tg_op='UPDATE' then
    if (old.body ? 'contractPricing' and not new.body ? 'contractPricing') or
      (old.body ? 'offerHourEstimate' and not new.body ? 'offerHourEstimate') then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  end if;
  perform public.assert_offer_hour_estimate(new.body,false);
  return new;
end $$;

drop trigger if exists customer_offer_hour_estimate on public.action_case_customer_offer_drafts;
create trigger customer_offer_hour_estimate before insert or update of body on public.action_case_customer_offer_drafts
for each row execute function public.guard_offer_hour_estimate();
revoke all on function public.assert_offer_hour_estimate(jsonb,boolean), public.guard_offer_hour_estimate() from public,anon,authenticated;
grant execute on function public.assert_offer_hour_estimate(jsonb,boolean), public.guard_offer_hour_estimate() to service_role;
commit;
