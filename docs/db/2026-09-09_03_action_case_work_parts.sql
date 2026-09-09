-- Optional internal work scopes and atomic multi-selection costing.
-- Apply after action case costing/AI (03/04), work quotes (05), grouped requests
-- (09), and 2026-09-09_02_action_case_scope_attachments.sql. No default parts.
-- Does not alter request snapshots, email payloads, quotes or package acceptance.
begin;

create unique index if not exists action_cases_id_org_work_parts_idx
  on public.action_cases(id, org_id);
create unique index if not exists action_case_items_id_case_org_work_parts_idx
  on public.action_case_items(id, action_case_id, org_id);

create table if not exists public.action_case_work_parts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  action_case_id uuid not null,
  action_case_item_id uuid not null,
  title text not null check (btrim(title) <> '' and char_length(title) <= 300),
  scope text check (char_length(scope) <= 12000),
  sort_order integer not null default 100 check (sort_order between 1 and 2147483547),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_case_work_parts_case_fk foreign key(action_case_id, org_id)
    references public.action_cases(id, org_id) on delete cascade,
  constraint action_case_work_parts_item_fk foreign key(action_case_item_id, action_case_id, org_id)
    references public.action_case_items(id, action_case_id, org_id) on delete cascade,
  constraint action_case_work_parts_scope_key unique(id, org_id, action_case_id, action_case_item_id)
);
create index if not exists action_case_work_parts_item_sort_idx
  on public.action_case_work_parts(action_case_item_id, sort_order, created_at, id);
alter table public.action_case_work_parts enable row level security;
revoke all on public.action_case_work_parts from public, anon, authenticated;
grant all on public.action_case_work_parts to service_role;

alter table public.action_case_cost_lines add column if not exists work_part_id uuid;
alter table public.action_case_cost_lines drop constraint if exists action_case_cost_lines_work_part_fk;
alter table public.action_case_cost_lines add constraint action_case_cost_lines_work_part_fk
  foreign key(work_part_id, org_id, action_case_id, action_case_item_id)
  references public.action_case_work_parts(id, org_id, action_case_id, action_case_item_id)
  on delete set null (work_part_id);
create index if not exists action_case_cost_lines_work_part_idx
  on public.action_case_cost_lines(work_part_id) where work_part_id is not null;
comment on column public.action_case_cost_lines.work_part_id is
  'Optional internal grouping within the same organization/case/item. NULL means ungrouped; no default part is created.';

drop trigger if exists trg_action_case_work_parts_updated_at on public.action_case_work_parts;
create trigger trg_action_case_work_parts_updated_at before update on public.action_case_work_parts
  for each row execute function public.operational_tasks_set_updated_at();

-- Quote staleness historically compares only the parent item scope. Do not let
-- an internal scope edit silently retain an accepted price, including raw SQL.
create or replace function public.guard_action_case_work_part_write()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare i public.action_case_items%rowtype; v_status text;
begin
  if tg_op = 'UPDATE' and (new.id, new.org_id, new.action_case_id, new.action_case_item_id) is distinct from
    (old.id, old.org_id, old.action_case_id, old.action_case_item_id) then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
  select * into i from public.action_case_items where id = coalesce(new.action_case_item_id, old.action_case_item_id)
    and org_id = coalesce(new.org_id, old.org_id) and action_case_id = coalesce(new.action_case_id, old.action_case_id) for update;
  if not found then return coalesce(new, old); end if;
  select status into v_status from public.action_cases where id = i.action_case_id and org_id = i.org_id for update;
  if not found then return coalesce(new, old); end if;
  if i.status not in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote')
    or v_status not in ('preparing','pricing','quote_ready') then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;
  if tg_op = 'UPDATE' and (new.title, new.scope) is distinct from (old.title, old.scope) then
    if exists(select 1 from public.action_case_cost_lines where work_part_id = old.id and org_id = old.org_id
      and action_case_id = old.action_case_id and action_case_item_id = old.action_case_item_id
      and (selected_quote_id is not null or covered_by_quote_id is not null)) then raise exception 'ACTION_CASE_QUOTE_COVERAGE'; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_aa_action_case_work_part_write on public.action_case_work_parts;
create trigger trg_aa_action_case_work_part_write before insert or update or delete on public.action_case_work_parts
  for each row execute function public.guard_action_case_work_part_write();

-- Reuse the item version used by scope edits, AI proposals and the costing UI.
create or replace function public.action_case_work_part_changed()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.action_case_items set updated_at = clock_timestamp(),
    updated_by = coalesce(new.updated_by, old.updated_by)
    where id = coalesce(new.action_case_item_id, old.action_case_item_id)
      and org_id = coalesce(new.org_id, old.org_id);
  return null;
end $$;
drop trigger if exists trg_action_case_work_part_changed on public.action_case_work_parts;
create trigger trg_action_case_work_part_changed after insert or update or delete on public.action_case_work_parts
  for each row execute function public.action_case_work_part_changed();

-- Existing cost lines are client-writable. Protect the new membership column even
-- on direct writes; the composite FK also enforces the scope for service-role SQL.
create or replace function public.guard_action_case_work_part_membership()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare i public.action_case_items%rowtype; v_status text;
begin
  if tg_op = 'UPDATE' then
    if new.work_part_id is not distinct from old.work_part_id then return new; end if;
  elsif new.work_part_id is null then return new;
  end if;
  select * into i from public.action_case_items where id = new.action_case_item_id
    and org_id = new.org_id and action_case_id = new.action_case_id for update;
  -- Parent cascades must remain possible.
  if not found then return new; end if;
  select status into v_status from public.action_cases where id = i.action_case_id and org_id = i.org_id for update;
  if not found then return new; end if;
  if i.status not in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote')
    or v_status not in ('preparing','pricing','quote_ready') then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;
  if new.covered_by_quote_id is not null then raise exception 'ACTION_CASE_QUOTE_COVERAGE'; end if;
  if new.pricing_method <> 'direct' or new.selected_quote_id is not null then raise exception 'ACTION_CASE_COST_LINE_DIRECT_REQUIRED'; end if;
  if tg_op = 'UPDATE' then
    if old.covered_by_quote_id is not null then raise exception 'ACTION_CASE_QUOTE_COVERAGE'; end if;
    if old.pricing_method <> 'direct' or old.selected_quote_id is not null then raise exception 'ACTION_CASE_COST_LINE_DIRECT_REQUIRED'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_aa_action_case_work_part_membership on public.action_case_cost_lines;
create trigger trg_aa_action_case_work_part_membership before insert or update on public.action_case_cost_lines
  for each row execute function public.guard_action_case_work_part_membership();

create or replace function public.write_action_case_work_part(
  p_org_id uuid, p_case_id uuid, p_item_id uuid, p_user_id uuid, p_operation text, p_data jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  i public.action_case_items%rowtype; v_status text; v_part public.action_case_work_parts%rowtype;
  v_id uuid; v_ids uuid[]; v_count integer; v_sort bigint; v_field text; v_number numeric;
begin
  if p_user_id is null or p_operation is null or p_operation not in ('save','delete','move_lines','bulk_update')
    or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
  -- Same item-first ordering as write_action_case_costs/quote/request. Holding the
  -- case lock also serializes customer-status transitions until this write ends.
  select * into i from public.action_case_items
    where id = p_item_id and action_case_id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  select status into v_status from public.action_cases where id = p_case_id and org_id = p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if i.status not in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote')
    or v_status not in ('preparing','pricing','quote_ready') then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;
  if jsonb_typeof(p_data->'expectedUpdatedAt') is distinct from 'string'
    or i.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_ITEM_STALE'; end if;

  if p_operation in ('save','delete','move_lines') then
    v_id := (p_data->>'partId')::uuid;
    if p_operation = 'delete' and v_id is null then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
    if p_operation = 'move_lines' and not p_data ? 'partId' then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
    if v_id is not null then
      select * into v_part from public.action_case_work_parts where id = v_id
        and org_id = p_org_id and action_case_id = p_case_id and action_case_item_id = p_item_id for update;
      if not found then raise exception 'ACTION_CASE_WORK_PART_NOT_FOUND'; end if;
    end if;
  end if;

  if p_operation = 'save' then
    if jsonb_typeof(p_data->'title') is distinct from 'string' or btrim(p_data->>'title') = ''
      or char_length(p_data->>'title') > 300 then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
    if p_data ? 'scope' and (jsonb_typeof(p_data->'scope') not in ('string','null')
      or char_length(p_data->>'scope') > 12000) then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
    if p_data ? 'sortOrder' then
      if jsonb_typeof(p_data->'sortOrder') is distinct from 'number' then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
      v_number := (p_data->>'sortOrder')::numeric;
      if v_number <> trunc(v_number) or v_number not between 1 and 2147483547 then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
      v_sort := v_number;
    else
      select coalesce(v_part.sort_order, coalesce(max(sort_order)::bigint, 0) + 100) into v_sort
        from public.action_case_work_parts where action_case_item_id = p_item_id;
    end if;
    if v_sort > 2147483547 then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
    if v_id is null then
      insert into public.action_case_work_parts(org_id, action_case_id, action_case_item_id, title, scope, sort_order, created_by, updated_by)
        values(p_org_id, p_case_id, p_item_id, btrim(p_data->>'title'), nullif(btrim(p_data->>'scope'),''), v_sort, p_user_id, p_user_id)
        returning id into v_id;
    else
      update public.action_case_work_parts set title = btrim(p_data->>'title'),
        scope = case when p_data ? 'scope' then nullif(btrim(p_data->>'scope'),'') else scope end,
        sort_order = v_sort, updated_by = p_user_id where id = v_id;
    end if;
  else
    if p_operation = 'delete' then
      select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_ids from public.action_case_cost_lines
        where work_part_id = v_id and org_id = p_org_id and action_case_item_id = p_item_id and action_case_id = p_case_id;
    else
      if jsonb_typeof(p_data->'costLineIds') is distinct from 'array' then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
      if jsonb_array_length(p_data->'costLineIds') not between 1 and 100
        or exists(select 1 from jsonb_array_elements(p_data->'costLineIds') e where jsonb_typeof(e) <> 'string') then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
      v_ids := array(select value::uuid from jsonb_array_elements_text(p_data->'costLineIds'));
      if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then raise exception 'ACTION_CASE_WORK_PART_INVALID'; end if;
    end if;
    perform id from public.action_case_cost_lines where id = any(v_ids) and org_id = p_org_id
      and action_case_id = p_case_id and action_case_item_id = p_item_id order by id for update;
    get diagnostics v_count = row_count;
    if v_count <> cardinality(v_ids) then raise exception 'ACTION_CASE_COST_LINE_NOT_FOUND'; end if;
    if exists(select 1 from public.action_case_cost_lines where id = any(v_ids) and covered_by_quote_id is not null) then raise exception 'ACTION_CASE_QUOTE_COVERAGE'; end if;
    if exists(select 1 from public.action_case_cost_lines where id = any(v_ids) and (pricing_method <> 'direct' or selected_quote_id is not null)) then raise exception 'ACTION_CASE_COST_LINE_DIRECT_REQUIRED'; end if;

    if p_operation = 'bulk_update' then
      if not p_data ?| array['quantity','unit','unitCost','markupPercent'] then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
      foreach v_field in array array['quantity','unitCost','markupPercent'] loop
        if not p_data ? v_field then continue; end if;
        if jsonb_typeof(p_data->v_field) = 'null' and v_field <> 'markupPercent' then continue; end if;
        if jsonb_typeof(p_data->v_field) is distinct from 'number' then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
        v_number := (p_data->>v_field)::numeric;
        if (v_field = 'quantity' and v_number not between 0.001 and 99999999999.999)
          or (v_field = 'unitCost' and v_number not between 0 and 999999999999.99)
          or (v_field = 'markupPercent' and v_number not between -100 and 1000) then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
      end loop;
      if p_data ? 'unit' and (jsonb_typeof(p_data->'unit') is distinct from 'string'
        or btrim(p_data->>'unit') = '' or char_length(p_data->>'unit') > 30) then raise exception 'ACTION_CASE_COST_LINE_INVALID'; end if;
      update public.action_case_cost_lines set
        quantity = case when p_data ? 'quantity' then (p_data->>'quantity')::numeric else quantity end,
        unit = case when p_data ? 'unit' then btrim(p_data->>'unit') else unit end,
        unit_cost = case when p_data ? 'unitCost' then (p_data->>'unitCost')::numeric else unit_cost end,
        price_source = case when p_data ? 'unitCost' then 'manual' else price_source end,
        source_url = case when p_data ? 'unitCost' then null else source_url end,
        markup_percent = case when p_data ? 'markupPercent' then (p_data->>'markupPercent')::numeric else markup_percent end,
        quantity_basis = case when p_data ? 'quantity' or p_data ? 'unit' then
          case when (case when p_data ? 'quantity' then (p_data->>'quantity')::numeric else quantity end) is null then 'unknown' else 'provided' end
          else quantity_basis end,
        is_verified = false, verified_by = null, verified_at = null, source_checked_at = null, updated_by = p_user_id
        where id = any(v_ids) and org_id = p_org_id and action_case_id = p_case_id and action_case_item_id = p_item_id;
    else
      update public.action_case_cost_lines set work_part_id = case when p_operation = 'delete' then null else v_id end,
        updated_by = p_user_id where id = any(v_ids) and org_id = p_org_id and action_case_item_id = p_item_id and action_case_id = p_case_id;
      if p_operation = 'delete' then delete from public.action_case_work_parts where id = v_id; end if;
    end if;
  end if;
  insert into public.action_case_events(org_id, action_case_id, action_case_item_id, event_type, message, performed_by)
    values(p_org_id, p_case_id, p_item_id, 'work_part_' || p_operation, 'Work scope or selected costs updated.', p_user_id);
  return case when p_operation = 'save' then jsonb_build_object('id', v_id) else '{}'::jsonb end;
exception
  when numeric_value_out_of_range then
    raise exception 'ACTION_CASE_COST_LINE_INVALID' using errcode = '22023';
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'ACTION_CASE_WORK_PART_INVALID' using errcode = '22023';
end $$;

revoke all on function public.action_case_work_part_changed() from public, anon, authenticated;
revoke all on function public.guard_action_case_work_part_write() from public, anon, authenticated;
revoke all on function public.guard_action_case_work_part_membership() from public, anon, authenticated;
revoke all on function public.write_action_case_work_part(uuid,uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.write_action_case_work_part(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
