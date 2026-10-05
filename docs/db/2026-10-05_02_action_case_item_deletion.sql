-- Delete uncommitted project work only; preserve project files and audit history.
-- Requires action-case quotes, customer offers and schedule migrations.
begin;
alter table public.action_case_events drop constraint if exists action_case_events_action_case_item_id_fkey;
alter table public.action_case_events add constraint action_case_events_action_case_item_id_fkey
  foreign key (action_case_item_id) references public.action_case_items(id) on delete set null;

create or replace function public.guard_action_case_item_deletion()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  -- Do not interfere with an explicit deletion of the entire parent project.
  perform 1 from public.action_cases where id = old.action_case_id and org_id = old.org_id for update;
  if not found then return old; end if;
  if old.status not in ('scope_needed', 'pricing_needed', 'waiting_subcontractor', 'ready_for_quote') then
    raise exception 'ACTION_CASE_ITEM_DELETE_LOCKED';
  end if;
  if exists (select 1 from public.action_case_work_quotes where action_case_item_id = old.id)
    or exists (select 1 from public.action_case_quote_requests q, jsonb_array_elements(q.lines) line
      where q.action_case_id = old.action_case_id and q.org_id = old.org_id
      and lower(line->>'itemId') = old.id::text) then
    raise exception 'ACTION_CASE_ITEM_DELETE_QUOTES';
  end if;
  if exists (select 1 from public.action_case_customer_offer_drafts d, jsonb_array_elements(d.body->'items') item
      where d.action_case_id = old.action_case_id and d.org_id = old.org_id and lower(item->>'id') = old.id::text)
    or exists (select 1 from public.action_case_customer_offers o, jsonb_array_elements(o.snapshot->'items') item
      where o.action_case_id = old.action_case_id and o.org_id = old.org_id and lower(item->>'id') = old.id::text) then
    raise exception 'ACTION_CASE_ITEM_DELETE_OFFER';
  end if;
  if exists (select 1 from public.action_case_schedules s, jsonb_array_elements(s.rows || s.shared_rows) item
      where s.action_case_id = old.action_case_id and s.org_id = old.org_id and lower(item->>'sourceItemId') = old.id::text) then
    raise exception 'ACTION_CASE_ITEM_DELETE_SCHEDULE';
  end if;
  return old;
end $$;
revoke all on function public.guard_action_case_item_deletion() from public, anon, authenticated;
drop trigger if exists trg_action_case_item_deletion on public.action_case_items;
create trigger trg_action_case_item_deletion before delete on public.action_case_items
  for each row execute function public.guard_action_case_item_deletion();

create or replace function public.delete_action_case_item(
  p_org_id uuid, p_case_id uuid, p_item_id uuid, p_user_id uuid, p_expected_updated_at timestamptz
) returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare item public.action_case_items;
begin
  if p_user_id is null or p_expected_updated_at is null then raise exception 'ACTION_CASE_ITEM_STALE'; end if;
  perform 1 from public.action_cases where id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  select * into item from public.action_case_items where id = p_item_id and action_case_id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if item.updated_at <> p_expected_updated_at then raise exception 'ACTION_CASE_ITEM_STALE'; end if;
  delete from public.action_case_items where id = item.id and org_id = p_org_id;
  insert into public.action_case_events(org_id, action_case_id, event_type, message, performed_by)
    values (p_org_id, p_case_id, 'item_deleted', format('Åtgärden %s togs bort (%s).', item.title, item.id), p_user_id);
  update public.action_cases set status = case
    when not exists (select 1 from public.action_case_items where action_case_id = p_case_id) then 'preparing'
    when not exists (select 1 from public.action_case_items where action_case_id = p_case_id and status <> 'ready_for_quote') then 'quote_ready'
    else 'pricing' end, updated_by = p_user_id
    where id = p_case_id and org_id = p_org_id and status in ('preparing', 'pricing', 'quote_ready');
end $$;
revoke delete on public.action_case_items from authenticated;
revoke all on function public.delete_action_case_item(uuid,uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.delete_action_case_item(uuid,uuid,uuid,uuid,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
