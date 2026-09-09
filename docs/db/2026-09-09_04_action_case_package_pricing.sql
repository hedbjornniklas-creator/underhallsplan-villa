-- Requires 2026-09-08 action-case migrations 01, 03, 04, 05 and 09.
-- Optional work parts: action_case_work_parts(id,org_id,action_case_id,
-- action_case_item_id,title,scope), cost_lines.work_part_id. Apply after work parts
-- when installed, or rerun this migration to install its optional scope guard.
-- No mail, production data rewrites, or automatic package allocations.
begin;

-- ADD COLUMN backfills legacy rows; changing the default affects new rows only.
alter table public.action_case_quote_requests
  add column if not exists price_presentation text not null default 'itemized'
    check (price_presentation in ('grouped','itemized'));
alter table public.action_case_quote_requests alter column price_presentation set default 'grouped';
alter table public.action_case_work_quotes add column if not exists package_request_id uuid
  references public.action_case_quote_requests(id) on delete cascade;

create table if not exists public.action_case_quote_packages (
  request_id uuid not null references public.action_case_quote_requests(id) on delete cascade,
  group_key text not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  action_case_item_id uuid not null references public.action_case_items(id) on delete cascade,
  work_part_id uuid,
  quote_id uuid not null unique,
  anchor_line_id uuid not null,
  covered_line_ids uuid[] not null,
  amount numeric(14,2) not null check(amount>=0),
  separate_group_price_confirmed boolean not null default false,
  original_lines jsonb not null check(jsonb_typeof(original_lines)='array'),
  state text not null check(state in ('applying','active','removing','removed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(request_id,group_key)
);
create index if not exists action_case_quote_packages_item_idx on public.action_case_quote_packages(org_id,action_case_item_id);
alter table public.action_case_quote_packages enable row level security;
revoke all on public.action_case_quote_packages from public,anon,authenticated;
grant all on public.action_case_quote_packages to service_role;

-- Resolves optional work parts without depending on their migration being installed.
create or replace function public.action_case_request_source_matches(
  p_org_id uuid,p_case_id uuid,p_source jsonb,p_strict_part boolean
) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare l public.action_case_cost_lines%rowtype; i public.action_case_items%rowtype; part jsonb; part_id uuid;
begin
  select * into l from public.action_case_cost_lines where id=(p_source->>'costLineId')::uuid
    and org_id=p_org_id and action_case_id=p_case_id;
  if not found then return false; end if;
  select * into i from public.action_case_items where id=l.action_case_item_id and org_id=p_org_id and action_case_id=p_case_id;
  if not found or i.id is distinct from (p_source->>'itemId')::uuid or i.title is distinct from p_source->>'itemTitle'
    or coalesce(i.scope,'') is distinct from p_source->>'scope' or l.description is distinct from p_source->>'description'
    or i.status in ('cancelled','declined','completed') or l.category not in ('own_labor','subcontractor') then return false; end if;
  if not p_strict_part then return true; end if;
  part_id:=(to_jsonb(l)->>'work_part_id')::uuid;
  if part_id is distinct from (p_source->>'workPartId')::uuid then return false; end if;
  if part_id is null then
    return coalesce(p_source->>'workPartTitle','')='' and coalesce(p_source->>'workPartScope','')='';
  end if;
  if to_regclass('public.action_case_work_parts') is null then return false; end if;
  execute 'select to_jsonb(w) from public.action_case_work_parts w where id=$1 and org_id=$2 and action_case_id=$3 and action_case_item_id=$4 for share'
    into part using part_id,p_org_id,p_case_id,i.id;
  return part is not null and part->>'title' is not distinct from p_source->>'workPartTitle'
    and coalesce(part->>'scope','') is not distinct from p_source->>'workPartScope';
end $$;

-- Independently priced responses must still match the sent work-part snapshot.
create or replace function public.guard_action_case_grouped_price_selection()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.action_case_quote_requests%rowtype; source jsonb;
begin
  select req.* into r from public.action_case_work_quotes q join public.action_case_quote_requests req on req.id=q.request_id
    where q.id=new.selected_quote_id;
  if found then
    if r.response_mode<>'itemized' or r.sent_at is null then raise exception 'ACTION_CASE_REQUEST_PACKAGE_PRICE'; end if;
    select s into source from jsonb_array_elements(r.lines) s where (s->>'costLineId')::uuid=new.id;
    if source is null or not public.action_case_request_source_matches(new.org_id,new.action_case_id,source,true)
      or (to_jsonb(new)->>'work_part_id') is distinct from (source->>'workPartId') then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
  end if;
  return new;
end $$;

-- Preserve the established send lease/idempotency implementation, with extra
-- validation outside it in the same transaction. Reapplication never renames the wrapper.
do $$ begin
  if to_regprocedure('public.write_action_case_request_pre_packages(uuid,uuid,uuid,uuid,text,jsonb)') is null then
    alter function public.write_action_case_request(uuid,uuid,uuid,uuid,text,jsonb) rename to write_action_case_request_pre_packages;
  end if;
end $$;
revoke all on function public.write_action_case_request_pre_packages(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.write_action_case_request(
  p_org_id uuid,p_case_id uuid,p_request_id uuid,p_user_id uuid,p_operation text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.action_case_quote_requests%rowtype; s jsonb; result jsonb; presentation text;
begin
  if not exists(select 1 from public.action_cases where id=p_case_id and org_id=p_org_id) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  perform id from public.action_case_items where action_case_id=p_case_id and org_id=p_org_id order by id for update;
  select * into r from public.action_case_quote_requests where id=p_request_id for update;
  if found and (r.org_id<>p_org_id or r.action_case_id<>p_case_id) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_operation='save' then
    if r.id is not null and p_data->>'expectedUpdatedAt' is null then return jsonb_build_object('id',r.id); end if;
    if r.first_attempt_at is not null then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
    presentation:=coalesce(p_data->>'pricePresentation',r.price_presentation,'grouped');
    if presentation not in ('grouped','itemized') or jsonb_typeof(p_data->'lines') is distinct from 'array' then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    perform id from public.action_case_cost_lines where action_case_id=p_case_id and org_id=p_org_id order by id for update;
    for s in select * from jsonb_array_elements(p_data->'lines') loop
      if not public.action_case_request_source_matches(p_org_id,p_case_id,s,true) then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    end loop;
  elsif p_operation='claim_send' and r.first_attempt_at is null then
    perform id from public.action_case_cost_lines where action_case_id=p_case_id and org_id=p_org_id order by id for update;
    for s in select * from jsonb_array_elements(r.lines) loop
      if not public.action_case_request_source_matches(p_org_id,p_case_id,s,s ? 'workPartId') then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    end loop;
  elsif p_operation='response' then
    if p_data->>'responseMode'='package' and (p_data->>'packageAmount' is null
      or (p_data->>'packageAmount')::numeric<0 or (p_data->>'packageAmount')::numeric>999999999999.99
      or (p_data->>'packageAmount')::numeric<>round((p_data->>'packageAmount')::numeric,2)) then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    if exists(select 1 from public.action_case_quote_packages where request_id=p_request_id and state='active') then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
  end if;
  result:=public.write_action_case_request_pre_packages(p_org_id,p_case_id,p_request_id,p_user_id,p_operation,p_data);
  if p_operation='save' then
    update public.action_case_quote_requests set price_presentation=presentation where id=p_request_id and price_presentation is distinct from presentation;
  end if;
  return result;
end $$;

create or replace function public.guard_action_case_package_request()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if old.first_attempt_at is not null and
    (new.org_id,new.action_case_id,new.supplier_name,new.supplier_email,new.subject,new.message,new.requirements,new.other_requirements,
     new.lines,new.attachment_ids,new.body,new.supplements_id,new.price_presentation,new.email_payload) is distinct from
    (old.org_id,old.action_case_id,old.supplier_name,old.supplier_email,old.subject,old.message,old.requirements,old.other_requirements,
     old.lines,old.attachment_ids,old.body,old.supplements_id,old.price_presentation,old.email_payload) then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
  if (new.response_mode,new.package_amount,new.response_notes,new.response_document_id) is distinct from
    (old.response_mode,old.package_amount,old.response_notes,old.response_document_id)
    and exists(select 1 from public.action_case_quote_packages where request_id=old.id and state='active') then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
  return new;
end $$;
drop trigger if exists trg_action_case_package_request on public.action_case_quote_requests;
create trigger trg_action_case_package_request before update on public.action_case_quote_requests for each row execute function public.guard_action_case_package_request();

create or replace function public.guard_action_case_package_quote()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' then
    if old.package_request_id is not null and exists(select 1 from public.action_cases where id=old.action_case_id) then raise exception 'ACTION_CASE_PACKAGE_USE_RPC'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and (old.package_request_id is not null or new.package_request_id is distinct from old.package_request_id) then raise exception 'ACTION_CASE_PACKAGE_USE_RPC'; end if;
  if new.package_request_id is not null and not exists(select 1 from public.action_case_quote_packages p
    where p.request_id=new.package_request_id and p.quote_id=new.id and p.anchor_line_id=new.cost_line_id
    and p.org_id=new.org_id and p.action_case_id=new.action_case_id and p.action_case_item_id=new.action_case_item_id and p.state='applying') then raise exception 'ACTION_CASE_PACKAGE_USE_RPC'; end if;
  return new;
end $$;
drop trigger if exists trg_action_case_package_quote on public.action_case_work_quotes;
create trigger trg_action_case_package_quote before insert or update or delete on public.action_case_work_quotes for each row execute function public.guard_action_case_package_quote();

-- Runs after existing price derivation. During removal, restore the complete
-- original row (including future work-part fields), preserving a fresh version.
create or replace function public.guard_action_case_package_line()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.action_case_quote_packages%rowtype; basis jsonb;
begin
  select x.* into p from public.action_case_quote_packages x
    where x.org_id=old.org_id and x.state in ('active','removing') and (x.anchor_line_id=old.id or old.id=any(x.covered_line_ids)) limit 1;
  if tg_op='DELETE' then
    if p.request_id is not null and exists(select 1 from public.action_cases where id=old.action_case_id) then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
    return old;
  end if;
  if p.state='active' then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
  if p.state='removing' then
    select value into basis from jsonb_array_elements(p.original_lines) where value->>'id'=old.id::text;
    new:=jsonb_populate_record(new,basis || jsonb_build_object('updated_at',new.updated_at,'updated_by',new.updated_by));
  end if;
  if exists(select 1 from public.action_case_work_quotes q where q.id=new.selected_quote_id and q.package_request_id is not null
    and not exists(select 1 from public.action_case_quote_packages x where x.request_id=q.package_request_id and x.quote_id=q.id
      and x.anchor_line_id=new.id and x.org_id=new.org_id and x.state in ('applying','active'))) then raise exception 'ACTION_CASE_PACKAGE_USE_RPC'; end if;
  return new;
end $$;
drop trigger if exists trg_zzzz_action_case_package_line on public.action_case_cost_lines;
create trigger trg_zzzz_action_case_package_line before insert or update or delete on public.action_case_cost_lines for each row execute function public.guard_action_case_package_line();

create or replace function public.guard_action_case_package_scope()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare active boolean;
begin
  if tg_table_name='action_case_items' then
    select exists(select 1 from public.action_case_quote_packages where action_case_item_id=old.id and state='active') into active;
  else
    select exists(select 1 from public.action_case_quote_packages where work_part_id=old.id and state='active') into active;
  end if;
  if active and exists(select 1 from public.action_cases where id=old.action_case_id) then
    if tg_op='DELETE' then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
    if (to_jsonb(new)->'title',to_jsonb(new)->'scope',to_jsonb(new)->'org_id',to_jsonb(new)->'action_case_id',to_jsonb(new)->'action_case_item_id') is distinct from
      (to_jsonb(old)->'title',to_jsonb(old)->'scope',to_jsonb(old)->'org_id',to_jsonb(old)->'action_case_id',to_jsonb(old)->'action_case_item_id') then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_action_case_package_scope on public.action_case_items;
create trigger trg_action_case_package_scope before update or delete on public.action_case_items for each row execute function public.guard_action_case_package_scope();
do $$ begin
  if to_regclass('public.action_case_work_parts') is not null then
    execute 'drop trigger if exists trg_action_case_package_scope on public.action_case_work_parts';
    execute 'create trigger trg_action_case_package_scope before update or delete on public.action_case_work_parts for each row execute function public.guard_action_case_package_scope()';
  end if;
end $$;

create or replace function public.write_action_case_quote_package(
  p_org_id uuid,p_case_id uuid,p_request_id uuid,p_user_id uuid,p_operation text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  r public.action_case_quote_requests%rowtype; p public.action_case_quote_packages%rowtype;
  l public.action_case_cost_lines%rowtype; s jsonb; v_ids uuid[]; extras uuid[]; anchor uuid; item_id uuid; part_id uuid;
  quote_id uuid; originals jsonb; request_version timestamptz; deadline date;
  v_group_key text:=p_data->>'groupKey'; sources jsonb; group_count integer; amount numeric; case_status text;
begin
  if p_operation not in ('accept','remove') or p_operation is null or p_user_id is null or p_data->>'expectedUpdatedAt' is null or v_group_key is null then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
  if not exists(select 1 from public.action_cases where id=p_case_id and org_id=p_org_id) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  -- Shared lock order with costing, work quotes, and grouped requests. All locks
  -- live until commit; stale versions are checked only after acquiring them.
  perform id from public.action_case_items where action_case_id=p_case_id and org_id=p_org_id order by id for update;
  select status into case_status from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if case_status not in ('preparing','pricing','quote_ready') then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;
  select * into r from public.action_case_quote_requests where id=p_request_id and org_id=p_org_id and action_case_id=p_case_id for update;
  if not found then raise exception 'ACTION_CASE_REQUEST_NOT_FOUND'; end if;
  if r.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
  select * into p from public.action_case_quote_packages x where x.request_id=r.id and x.group_key=v_group_key for update;
  select jsonb_agg(entry order by position) into sources from jsonb_array_elements(r.lines) with ordinality entries(entry,position)
    where (entry->>'itemId')||':'||coalesce(entry->>'workPartId','')=v_group_key;
  if sources is null then raise exception 'ACTION_CASE_PACKAGE_GROUP_NOT_FOUND'; end if;
  item_id:=(sources->0->>'itemId')::uuid;
  if not exists(select 1 from public.action_case_items where id=item_id and org_id=p_org_id and action_case_id=p_case_id
    and status in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote')) then raise exception 'ACTION_CASE_ITEM_LOCKED'; end if;
  if p_operation='remove' then
    if p.state is distinct from 'active' then raise exception 'ACTION_CASE_PACKAGE_NOT_ACCEPTED'; end if;
    v_ids:=array_prepend(p.anchor_line_id,p.covered_line_ids);
    perform id from public.action_case_cost_lines where id=any(v_ids) and org_id=p_org_id and action_case_id=p_case_id order by id for update;
    if (select count(*) from public.action_case_cost_lines where id=any(v_ids) and org_id=p_org_id and action_case_id=p_case_id)<>cardinality(v_ids) then raise exception 'ACTION_CASE_PACKAGE_STALE'; end if;
    update public.action_case_quote_packages x set state='removing' where x.request_id=r.id and x.group_key=p.group_key;
    -- Clear covered flags before the anchor: its legacy trigger also releases coverage.
    update public.action_case_cost_lines set covered_by_quote_id=null,updated_by=p_user_id where id=any(p.covered_line_ids);
    update public.action_case_cost_lines set selected_quote_id=null,pricing_method='direct',updated_by=p_user_id where id=p.anchor_line_id;
    update public.action_case_quote_packages x set state='removed',updated_at=clock_timestamp() where x.request_id=r.id and x.group_key=p.group_key;
    quote_id:=p.quote_id;
  else
    if p.state='active' then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
    if r.sent_at is null then raise exception 'ACTION_CASE_PACKAGE_RESPONSE_REQUIRED'; end if;
    if p_data->'checked' is distinct from 'true'::jsonb or coalesce(btrim(p_data->>'offeredScope'),'')='' or length(p_data->>'offeredScope')>4000 then raise exception 'ACTION_CASE_PACKAGE_UNCHECKED'; end if;
    deadline:=(p_data->>'validUntil')::date;
    if deadline<(now() at time zone 'Europe/Stockholm')::date then raise exception 'ACTION_CASE_PACKAGE_STALE'; end if;
    select count(distinct (entry->>'itemId',entry->>'workPartId')) into group_count from jsonb_array_elements(r.lines) entry;
    if group_count>1 and p_data->'separateGroupPriceConfirmed' is distinct from 'true'::jsonb then raise exception 'ACTION_CASE_PACKAGE_ALLOCATION_REQUIRED'; end if;
    if coalesce(p_data->>'amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
    amount:=(p_data->>'amount')::numeric;
    if amount>999999999999.99 then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
    -- Single-group whole-request responses have an authoritative saved total.
    if group_count=1 and r.response_mode='package' and r.package_amount is distinct from amount then raise exception 'ACTION_CASE_PACKAGE_AMOUNT_MISMATCH'; end if;
    item_id:=(sources->0->>'itemId')::uuid; part_id:=(sources->0->>'workPartId')::uuid;
    anchor:=(sources->0->>'costLineId')::uuid;
    if jsonb_typeof(coalesce(p_data->'coveredLineIds','[]')) is distinct from 'array'
      or jsonb_array_length(coalesce(p_data->'coveredLineIds','[]'))>30 then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
    extras:=array(select value::uuid from jsonb_array_elements_text(coalesce(p_data->'coveredLineIds','[]')));
    v_ids:=array(select (value->>'costLineId')::uuid from jsonb_array_elements(sources)) || extras;
    if cardinality(v_ids)<>(select count(distinct id) from unnest(v_ids) id) then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
    perform id from public.action_case_cost_lines where id=any(v_ids) and org_id=p_org_id and action_case_id=p_case_id order by id for update;
    if jsonb_typeof(p_data->'expectedLines') is distinct from 'array' or jsonb_array_length(p_data->'expectedLines')<>cardinality(v_ids)
      or (select count(distinct e->>'costLineId') from jsonb_array_elements(p_data->'expectedLines') e)<>cardinality(v_ids) then raise exception 'ACTION_CASE_PACKAGE_STALE'; end if;
    for s in select * from jsonb_array_elements(sources) loop
      if not public.action_case_request_source_matches(p_org_id,p_case_id,s,true) then raise exception 'ACTION_CASE_PACKAGE_STALE'; end if;
    end loop;
    for s in select * from jsonb_array_elements(p_data->'expectedLines') loop
      select * into l from public.action_case_cost_lines where id=(s->>'costLineId')::uuid and id=any(v_ids)
        and org_id=p_org_id and action_case_id=p_case_id and action_case_item_id=item_id;
      if not found or l.updated_at is distinct from (s->>'updatedAt')::timestamptz
        or ((to_jsonb(l)->>'work_part_id')::uuid is distinct from part_id
          and not (l.id=any(extras) and to_jsonb(l)->>'work_part_id' is null)) then raise exception 'ACTION_CASE_PACKAGE_STALE'; end if;
      if l.selected_quote_id is not null or l.covered_by_quote_id is not null then raise exception 'ACTION_CASE_PACKAGE_CONFLICT'; end if;
      if l.id=any(extras) and l.category not in ('material','waste','transport','other') then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
    end loop;
    if exists(select 1 from public.action_case_quote_packages x where x.state='active' and
      (x.anchor_line_id=any(v_ids) or x.covered_line_ids && v_ids)) then raise exception 'ACTION_CASE_PACKAGE_CONFLICT'; end if;
    select jsonb_agg(to_jsonb(c) order by c.id) into originals from public.action_case_cost_lines c where c.id=any(v_ids);
    quote_id:=gen_random_uuid();
    insert into public.action_case_quote_packages(request_id,group_key,org_id,action_case_id,action_case_item_id,work_part_id,quote_id,anchor_line_id,covered_line_ids,amount,separate_group_price_confirmed,original_lines,state,created_by)
    values(r.id,v_group_key,p_org_id,p_case_id,item_id,part_id,quote_id,anchor,array_remove(v_ids,anchor),amount,coalesce((p_data->>'separateGroupPriceConfirmed')::boolean,false),originals,'applying',p_user_id)
    on conflict on constraint action_case_quote_packages_pkey do update set quote_id=excluded.quote_id,anchor_line_id=excluded.anchor_line_id,covered_line_ids=excluded.covered_line_ids,
      amount=excluded.amount,separate_group_price_confirmed=excluded.separate_group_price_confirmed,original_lines=excluded.original_lines,state='applying',updated_at=clock_timestamp();
    -- A derived package quote is not an independent response or a sendable RFQ.
    -- Its separate marker lets existing loaders price the anchor without treating
    -- the request's total as an independently orderable price on every work row.
    insert into public.action_case_work_quotes(id,org_id,action_case_id,action_case_item_id,cost_line_id,package_request_id,
      supplier_name,supplier_email,amount,offered_scope,valid_until,covered_line_ids,document_id,checked,scope_snapshot,description_snapshot,
      request_subject,request_body,request_attachment_ids,created_by)
    values(quote_id,p_org_id,p_case_id,item_id,anchor,r.id,r.supplier_name,r.supplier_email,amount,p_data->>'offeredScope',deadline,
      array_remove(v_ids,anchor),r.response_document_id,true,sources->0->>'scope',sources->0->>'description',r.subject,r.body,r.attachment_ids,p_user_id);
    update public.action_case_cost_lines set pricing_method='quotes',selected_quote_id=quote_id,updated_by=p_user_id where id=anchor;
    update public.action_case_cost_lines set pricing_method='direct',covered_by_quote_id=quote_id,updated_by=p_user_id where id=any(array_remove(v_ids,anchor));
    update public.action_case_quote_packages x set state='active',updated_at=clock_timestamp() where x.request_id=r.id and x.group_key=v_group_key;
  end if;
  update public.action_case_quote_requests set updated_at=clock_timestamp() where id=r.id returning updated_at into request_version;
  insert into public.action_case_events(org_id,action_case_id,action_case_item_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,coalesce(item_id,p.action_case_item_id),'package_'||p_operation,'Offertpaket uppdaterat.',p_user_id);
  return jsonb_build_object('requestId',r.id,'groupKey',v_group_key,'quoteId',quote_id,'state',case when p_operation='accept' then 'active' else 'removed' end,'updatedAt',request_version);
end $$;

revoke all on function public.action_case_request_source_matches(uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.guard_action_case_package_request() from public,anon,authenticated,service_role;
revoke all on function public.guard_action_case_package_quote() from public,anon,authenticated,service_role;
revoke all on function public.guard_action_case_package_line() from public,anon,authenticated,service_role;
revoke all on function public.guard_action_case_package_scope() from public,anon,authenticated,service_role;
revoke all on function public.write_action_case_request(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_action_case_request(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.write_action_case_quote_package(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_action_case_quote_package(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
