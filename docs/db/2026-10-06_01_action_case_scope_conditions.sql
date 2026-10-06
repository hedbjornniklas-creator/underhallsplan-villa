-- Optional work-item conditions, copied explicitly into versioned customer offers.
-- No existing drafts, published offers or accepted agreements are rewritten.
begin;

alter table public.action_case_items
  add column if not exists scope_conditions text not null default '';
alter table public.action_case_items drop constraint if exists action_case_scope_conditions_length;
alter table public.action_case_items add constraint action_case_scope_conditions_length
  check (length(scope_conditions) <= 6000);
comment on column public.action_case_items.scope_conditions is
  'Optional prerequisites or assumptions for this work item. Explicitly copied to an offer draft.';

create or replace function public.assert_customer_offer_scope_conditions(p_body jsonb)
returns void language plpgsql set search_path = public, pg_catalog as $$
declare item jsonb;
begin
  for item in select value from jsonb_array_elements(p_body->'items') loop
    if item ? 'scopeConditions' and (
      jsonb_typeof(item->'scopeConditions') is distinct from 'string'
      or length(item->>'scopeConditions') > 6000
    ) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
end $$;
revoke all on function public.assert_customer_offer_scope_conditions(jsonb) from public, anon, authenticated;
grant execute on function public.assert_customer_offer_scope_conditions(jsonb) to service_role;

create or replace function public.guard_customer_offer_scope_conditions()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_table_name = 'action_case_customer_offer_drafts' then
    -- Explicit empty text clears conditions; older clients must not drop them.
    if tg_op = 'UPDATE' and exists (
      select 1 from jsonb_array_elements(old.body->'items') previous
      join jsonb_array_elements(new.body->'items') incoming on lower(incoming->>'id') = lower(previous->>'id')
      where previous ? 'scopeConditions' and not incoming ? 'scopeConditions'
    ) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    perform public.assert_customer_offer_scope_conditions(new.body);
  else
    perform public.assert_customer_offer_scope_conditions(new.snapshot);
  end if;
  return new;
end $$;
revoke all on function public.guard_customer_offer_scope_conditions() from public, anon, authenticated;

drop trigger if exists customer_offer_scope_conditions_draft on public.action_case_customer_offer_drafts;
create trigger customer_offer_scope_conditions_draft before insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.guard_customer_offer_scope_conditions();
drop trigger if exists customer_offer_scope_conditions_publication on public.action_case_customer_offers;
create trigger customer_offer_scope_conditions_publication before insert on public.action_case_customer_offers
  for each row execute function public.guard_customer_offer_scope_conditions();

notify pgrst, 'reload schema';
commit;
