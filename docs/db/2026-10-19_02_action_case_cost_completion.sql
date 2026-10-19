-- A dedicated completion write never replays stale price or quantity values.
begin;
create or replace function public.set_action_case_cost_complete(
  p_org_id uuid, p_case_id uuid, p_item_id uuid, p_user_id uuid,
  p_line_id uuid, p_expected_updated_at timestamptz, p_complete boolean
) returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare i public.action_case_items%rowtype; l public.action_case_cost_lines%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_complete is null or p_expected_updated_at is null then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
  if not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  select * into i from public.action_case_items where id=p_item_id and action_case_id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id and status in ('preparing','pricing','quote_ready') for update;
  if not found then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;
  if i.status not in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote') or i.lump_sum is not null then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;
  select * into l from public.action_case_cost_lines where id=p_line_id and action_case_item_id=i.id and action_case_id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'ACTION_CASE_COST_LINE_NOT_FOUND'; end if;
  if l.pricing_method <> 'direct' or l.selected_quote_id is not null or l.covered_by_quote_id is not null
    or exists(select 1 from public.action_case_quote_packages where anchor_line_id=l.id and state='active') then raise exception 'ACTION_CASE_COST_LINE_DIRECT_REQUIRED'; end if;
  -- Identical retries are harmless, including after an uncertain response.
  if l.is_verified=p_complete then return; end if;
  if i.updated_at<>p_expected_updated_at then raise exception 'ACTION_CASE_ITEM_STALE'; end if;
  if p_complete and (l.quantity is null or l.unit_cost is null) then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
  update public.action_case_cost_lines set is_verified=p_complete,
    verified_by=case when p_complete then p_user_id end, verified_at=case when p_complete then now() end,
    source_checked_at=case when p_complete then now() end, updated_by=p_user_id
    where id=l.id and org_id=p_org_id;
  insert into public.action_case_events(org_id,action_case_id,action_case_item_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,p_item_id,'cost_line_completion',
      (case when p_complete then 'Kalkylrad markerad klar: ' else 'Kalkylrad ateroppnad: ' end)||l.description||' ['||l.id::text||']',p_user_id);
end $$;
revoke all on function public.set_action_case_cost_complete(uuid,uuid,uuid,uuid,uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.set_action_case_cost_complete(uuid,uuid,uuid,uuid,uuid,timestamptz,boolean) to service_role;
commit;
