-- Per-action exclusions and advice; copied explicitly into versioned offer items.
-- Existing items, drafts and published/accepted agreements are not rewritten.
begin;
alter table public.action_case_items
  add column if not exists scope_exclusions text not null default '',
  add column if not exists scope_advice text not null default '';

alter table public.action_case_items drop constraint if exists action_case_scope_notes_length;
alter table public.action_case_items add constraint action_case_scope_notes_length
  check (length(scope_exclusions) <= 6000 and length(scope_advice) <= 6000);

comment on column public.action_case_items.scope_exclusions is
  'Optional exclusions from this work item. Explicitly copied to a customer offer draft.';
comment on column public.action_case_items.scope_advice is
  'Optional advice text. Does not establish that advice was communicated or accepted.';

create or replace function public.assert_customer_offer_scope_notes(p_body jsonb, p_complete boolean default false)
returns void language plpgsql set search_path = public, pg_catalog as $$
declare item jsonb; field text;
begin
  for item in select value from jsonb_array_elements(p_body->'items') loop
    foreach field in array array['scopeExclusions', 'scopeAdvice'] loop
      if item ? field and (jsonb_typeof(item->field) is distinct from 'string' or length(item->>field) > 6000) then
        raise exception 'CUSTOMER_OFFER_INVALID';
      end if;
    end loop;
    if p_complete and btrim(coalesce(item->>'scopeAdvice', '')) <> ''
      and p_body#>>'{contractDetails,advice,status}' is distinct from 'given' then
      raise exception 'CUSTOMER_OFFER_INCOMPLETE';
    end if;
  end loop;
end $$;
revoke all on function public.assert_customer_offer_scope_notes(jsonb,boolean) from public, anon, authenticated;
grant execute on function public.assert_customer_offer_scope_notes(jsonb,boolean) to service_role;

create or replace function public.guard_customer_offer_scope_notes()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_table_name = 'action_case_customer_offer_drafts' then
    -- Older clients must not silently erase new fields on an existing row.
    -- An explicit empty string clears a note; deleting a whole row remains allowed.
    if tg_op = 'UPDATE' and exists (
      select 1 from jsonb_array_elements(old.body->'items') previous
      join jsonb_array_elements(new.body->'items') incoming on lower(incoming->>'id') = lower(previous->>'id')
      where (previous ? 'scopeExclusions' and not incoming ? 'scopeExclusions')
         or (previous ? 'scopeAdvice' and not incoming ? 'scopeAdvice')
    ) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    perform public.assert_customer_offer_scope_notes(new.body, false);
  else
    perform public.assert_customer_offer_scope_notes(new.snapshot, true);
  end if;
  return new;
end $$;
revoke all on function public.guard_customer_offer_scope_notes() from public, anon, authenticated;

drop trigger if exists customer_offer_scope_notes_draft on public.action_case_customer_offer_drafts;
create trigger customer_offer_scope_notes_draft before insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.guard_customer_offer_scope_notes();
drop trigger if exists customer_offer_scope_notes_publication on public.action_case_customer_offers;
create trigger customer_offer_scope_notes_publication before insert on public.action_case_customer_offers
  for each row execute function public.guard_customer_offer_scope_notes();
notify pgrst, 'reload schema';
commit;
