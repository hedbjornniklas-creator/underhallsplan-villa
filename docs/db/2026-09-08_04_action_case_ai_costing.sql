-- Uppdrag: grouped costing and reviewed AI suggestions
-- Apply after 2026-09-08_03_action_case_costing.sql.
-- Existing prices, including explicit zero prices, are preserved.
begin;

alter table public.action_case_cost_lines
  alter column quantity drop not null,
  alter column quantity drop default,
  alter column unit_cost drop not null,
  alter column unit_cost drop default,
  add column if not exists quantity_basis text not null default 'provided',
  add column if not exists notes text;

alter table public.action_case_cost_lines
  drop constraint if exists action_case_cost_lines_quantity_basis_check,
  drop constraint if exists action_case_cost_lines_known_verified_check;
alter table public.action_case_cost_lines
  add constraint action_case_cost_lines_quantity_basis_check
    check (quantity_basis in ('provided', 'calculated', 'estimated', 'unknown')),
  add constraint action_case_cost_lines_known_verified_check
    check (not is_verified or (quantity is not null and unit_cost is not null));

create table if not exists public.action_case_cost_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  action_case_item_id uuid not null references public.action_case_items(id) on delete cascade,
  source_updated_at timestamptz not null,
  model text not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists action_case_cost_suggestions_latest_idx
  on public.action_case_cost_suggestions(action_case_item_id, created_at desc);
alter table public.action_case_cost_suggestions enable row level security;
-- Only the authenticated application server may create/apply AI proposals.
revoke all on public.action_case_cost_suggestions from anon, authenticated;
grant all on public.action_case_cost_suggestions to service_role;

create or replace function public.action_case_item_cost_state()
returns trigger language plpgsql set search_path = public as $$
declare
  v_count integer;
  v_known boolean;
  v_verified boolean;
begin
  select count(*), bool_and(quantity is not null and unit_cost is not null), bool_and(is_verified),
    round(sum(quantity * unit_cost), 2), round(sum(quantity * unit_cost * (1 + markup_percent / 100)), 2)
  into v_count, v_known, v_verified, new.estimated_cost, new.customer_price
  from public.action_case_cost_lines where action_case_item_id = new.id and org_id = new.org_id;
  if v_count = 0 or not v_known then
    new.estimated_cost := null;
    new.customer_price := null;
  end if;
  if exists(select 1 from public.action_case_cost_lines where action_case_item_id = new.id and category = 'own_labor') then
    select bool_and(is_verified) into new.own_labor_ready from public.action_case_cost_lines where action_case_item_id = new.id and category = 'own_labor';
  end if;
  if exists(select 1 from public.action_case_cost_lines where action_case_item_id = new.id and category = 'material') then
    select bool_and(is_verified) into new.material_price_ready from public.action_case_cost_lines where action_case_item_id = new.id and category = 'material';
  end if;
  if exists(select 1 from public.action_case_cost_lines where action_case_item_id = new.id and category = 'subcontractor') then
    new.requires_subcontractor := true;
    select bool_and(is_verified) into new.subcontractor_price_ready from public.action_case_cost_lines where action_case_item_id = new.id and category = 'subcontractor';
  end if;
  if exists(select 1 from public.action_case_cost_lines where action_case_item_id = new.id and category in ('waste','transport','other')) then
    select bool_and(is_verified) into new.waste_solution_ready from public.action_case_cost_lines where action_case_item_id = new.id and category in ('waste','transport','other');
  end if;
  -- Never regress work already offered, accepted or performed.
  if old.status in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote') then
    new.status := case
      when btrim(coalesce(new.scope,'')) = '' then 'scope_needed'
      when new.own_labor_ready and new.material_price_ready and new.waste_solution_ready
        and (not new.requires_subcontractor or new.subcontractor_price_ready)
        and (v_count = 0 or (v_known and v_verified)) then 'ready_for_quote'
      when new.requires_subcontractor and not new.subcontractor_price_ready then 'waiting_subcontractor'
      else 'pricing_needed' end;
  else
    new.status := old.status;
  end if;
  return new;
end $$;
drop trigger if exists trg_action_case_item_cost_state on public.action_case_items;
create trigger trg_action_case_item_cost_state before update on public.action_case_items
for each row execute function public.action_case_item_cost_state();

create or replace function public.action_case_cost_line_changed()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.action_case_items set updated_at = clock_timestamp()
    where id = coalesce(new.action_case_item_id, old.action_case_item_id)
      and org_id = coalesce(new.org_id, old.org_id);
  return null;
end $$;
drop trigger if exists trg_action_case_cost_line_changed on public.action_case_cost_lines;
create trigger trg_action_case_cost_line_changed after insert or update or delete on public.action_case_cost_lines
for each row execute function public.action_case_cost_line_changed();

create or replace function public.action_case_cost_case_state()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.action_cases set status = case when not exists (
    select 1 from public.action_case_items where action_case_id = new.action_case_id and status <> 'ready_for_quote'
  ) then 'quote_ready' else 'pricing' end
  where id = new.action_case_id and org_id = new.org_id and status in ('preparing','pricing','quote_ready');
  return null;
end $$;
drop trigger if exists trg_action_case_cost_case_state on public.action_case_items;
create trigger trg_action_case_cost_case_state after update on public.action_case_items
for each row execute function public.action_case_cost_case_state();

-- Serialize writes per item; applying selected suggestions is all-or-nothing and retry-safe.
create or replace function public.write_action_case_costs(
  p_org_id uuid, p_case_id uuid, p_item_id uuid, p_user_id uuid,
  p_operation text, p_lines jsonb, p_suggestion_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_item public.action_case_items%rowtype;
  v_suggestion public.action_case_cost_suggestions%rowtype;
  v_line jsonb;
  v_lines jsonb := p_lines;
  v_sort integer;
begin
  select * into v_item from public.action_case_items
    where id = p_item_id and action_case_id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_operation not in ('add','update','delete','apply') then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 30 then
    raise exception 'ACTION_CASE_COST_LINE_INVALID';
  end if;
  if p_operation = 'apply' then
    select * into v_suggestion from public.action_case_cost_suggestions
      where id = p_suggestion_id and org_id = p_org_id and action_case_item_id = p_item_id and action_case_id = p_case_id for update;
    if not found then raise exception 'ACTION_CASE_AI_NOT_FOUND'; end if;
    if v_suggestion.applied_at is not null then return; end if;
    if v_suggestion.source_updated_at <> v_item.updated_at then raise exception 'ACTION_CASE_AI_STALE'; end if;
    if exists(select 1 from jsonb_array_elements(p_lines) selected where not exists (
      select 1 from jsonb_array_elements(v_suggestion.lines) source where source->>'id' = selected->>'id'
    )) then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
    select jsonb_agg(source || jsonb_build_object('unitCost',null,'markupPercent',0,'verified',false,'priceSource','ai_suggestion'))
      into v_lines from jsonb_array_elements(v_suggestion.lines) source
      where exists(select 1 from jsonb_array_elements(p_lines) selected where selected->>'id' = source->>'id');
  end if;
  select coalesce(max(sort_order),0) into v_sort from public.action_case_cost_lines where action_case_item_id = p_item_id;
  for v_line in select * from jsonb_array_elements(v_lines) loop
    if p_operation in ('update','delete') then
      perform 1 from public.action_case_cost_lines where id = (v_line->>'id')::uuid
        and action_case_item_id = p_item_id and org_id = p_org_id;
      if not found then raise exception 'ACTION_CASE_COST_LINE_NOT_FOUND'; end if;
    end if;
    if p_operation = 'delete' then
      delete from public.action_case_cost_lines where id = (v_line->>'id')::uuid and action_case_item_id = p_item_id and org_id = p_org_id;
    elsif p_operation = 'update' then
      update public.action_case_cost_lines set
        category = v_line->>'category', description = v_line->>'description', quantity = (v_line->>'quantity')::numeric,
        unit = v_line->>'unit', unit_cost = (v_line->>'unitCost')::numeric, markup_percent = (v_line->>'markupPercent')::numeric,
        price_source = v_line->>'priceSource', source_url = v_line->>'sourceUrl', notes = v_line->>'notes', quantity_basis = v_line->>'quantityBasis',
        is_verified = (v_line->>'verified')::boolean,
        verified_by = case when (v_line->>'verified')::boolean then p_user_id end,
        verified_at = case when (v_line->>'verified')::boolean then now() end,
        source_checked_at = case when (v_line->>'verified')::boolean then now() end, updated_by = p_user_id
      where id = (v_line->>'id')::uuid and action_case_item_id = p_item_id and org_id = p_org_id;
    else
      v_sort := v_sort + 100;
      insert into public.action_case_cost_lines (
        org_id, action_case_id, action_case_item_id, category, description, quantity, unit, unit_cost, markup_percent,
        price_source, source_url, quantity_basis, notes, is_verified, verified_by, verified_at, source_checked_at,
        sort_order, created_by, updated_by
      ) values (
        p_org_id,p_case_id,p_item_id,v_line->>'category',v_line->>'description',(v_line->>'quantity')::numeric,
        v_line->>'unit',(v_line->>'unitCost')::numeric,(v_line->>'markupPercent')::numeric,
        v_line->>'priceSource',v_line->>'sourceUrl',v_line->>'quantityBasis',v_line->>'notes',(v_line->>'verified')::boolean,
        case when (v_line->>'verified')::boolean then p_user_id end,
        case when (v_line->>'verified')::boolean then now() end,
        case when (v_line->>'verified')::boolean then now() end,v_sort,p_user_id,p_user_id
      );
    end if;
  end loop;
  if p_operation = 'apply' then update public.action_case_cost_suggestions set applied_at = now() where id = p_suggestion_id; end if;
  insert into public.action_case_events(org_id,action_case_id,action_case_item_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,p_item_id,'cost_lines_' || p_operation,'Kalkyl uppdaterad.',p_user_id);
end $$;
revoke all on function public.write_action_case_costs(uuid,uuid,uuid,uuid,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.write_action_case_costs(uuid,uuid,uuid,uuid,text,jsonb,uuid) to service_role;
commit;
