-- Uppdrag: hours or alternative subcontractor quotes per work cost line.
-- Prerequisites: action case migrations 01, 02, 03 and 04.
-- Existing costs remain direct-priced. Switching methods preserves their basis.
begin;
alter table public.action_case_cost_lines
  add column if not exists pricing_method text not null default 'direct' check (pricing_method in ('direct','quotes')),
  add column if not exists direct_pricing jsonb,
  add column if not exists selected_quote_id uuid,
  add column if not exists covered_by_quote_id uuid;

create table if not exists public.action_case_work_quotes (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  action_case_item_id uuid not null references public.action_case_items(id) on delete cascade,
  cost_line_id uuid not null references public.action_case_cost_lines(id) on delete cascade,
  supplier_name text not null check (btrim(supplier_name) <> ''), supplier_email text,
  amount numeric(14,2) check (amount >= 0), offered_scope text not null default '', exclusions text not null default '',
  valid_until date, available_from date,
  materials text not null default 'unspecified' check (materials in ('included','excluded','unspecified')),
  travel text not null default 'unspecified' check (travel in ('included','excluded','unspecified')),
  waste text not null default 'unspecified' check (waste in ('included','excluded','unspecified')),
  covered_line_ids uuid[] not null default '{}',
  document_id uuid references public.action_case_attachments(id) on delete set null,
  checked boolean not null default false check (not checked or (amount is not null and btrim(offered_scope) <> '')),
  scope_snapshot text not null, description_snapshot text not null,
  request_subject text not null default '', request_body text not null default '', request_attachment_ids uuid[] not null default '{}',
  delivery_status text not null default 'draft' check (delivery_status in ('draft','sending','sent','failed','unknown')),
  email_payload jsonb, first_attempt_at timestamptz, last_attempt_at timestamptz, lease_id uuid,
  sent_at timestamptz, provider_message_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists action_case_work_quotes_line_idx on public.action_case_work_quotes(cost_line_id,created_at);
alter table public.action_case_work_quotes enable row level security;
revoke all on public.action_case_work_quotes from public, anon, authenticated;
grant all on public.action_case_work_quotes to service_role;
alter table public.action_case_cost_lines
  drop constraint if exists action_case_selected_quote_fk,
  drop constraint if exists action_case_covered_quote_fk;
alter table public.action_case_cost_lines
  add constraint action_case_selected_quote_fk foreign key(selected_quote_id) references public.action_case_work_quotes(id) on delete set null,
  add constraint action_case_covered_quote_fk foreign key(covered_by_quote_id) references public.action_case_work_quotes(id) on delete set null;

-- A quote-mode row is always derived from exactly one checked, matching offer.
create or replace function public.action_case_quote_price_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare q public.action_case_work_quotes%rowtype; d jsonb; v_scope text;
begin
  if tg_op = 'DELETE' then
    if old.covered_by_quote_id is not null and exists(select 1 from public.action_case_items where id=old.action_case_item_id) then
      raise exception 'ACTION_CASE_QUOTE_COVERAGE';
    end if;
    if exists(select 1 from public.action_case_items where id=old.action_case_item_id)
      and exists(select 1 from public.action_case_work_quotes where cost_line_id=old.id and first_attempt_at is not null) then
      raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE';
    end if;
    return old;
  end if;
  if new.covered_by_quote_id is not null and not exists (
    select 1 from public.action_case_work_quotes cq join public.action_case_cost_lines cl on cl.selected_quote_id=cq.id and cl.pricing_method='quotes'
    where cq.id=new.covered_by_quote_id and cq.org_id=new.org_id and cq.action_case_item_id=new.action_case_item_id and new.id=any(cq.covered_line_ids)
  ) then raise exception 'ACTION_CASE_QUOTE_COVERAGE'; end if;
  if tg_op='UPDATE' and old.covered_by_quote_id is not null and new.covered_by_quote_id=old.covered_by_quote_id
    and (new.category,new.description,new.quantity,new.unit,new.unit_cost,new.markup_percent) is distinct from
      (old.category,old.description,old.quantity,old.unit,old.unit_cost,old.markup_percent) then
    raise exception 'ACTION_CASE_QUOTE_COVERAGE';
  end if;
  if tg_op = 'UPDATE' and (new.org_id,new.action_case_id,new.action_case_item_id) is distinct from (old.org_id,old.action_case_id,old.action_case_item_id) then
    raise exception 'ACTION_CASE_COST_LINE_INVALID';
  end if;
  if new.pricing_method = 'quotes' then
    if new.category not in ('own_labor','subcontractor') then raise exception 'ACTION_CASE_QUOTE_WORK_REQUIRED'; end if;
    if tg_op = 'UPDATE' and old.pricing_method = 'direct' then new.direct_pricing := to_jsonb(old); end if;
    new.category := 'subcontractor';
    if new.selected_quote_id is not null then
      select * into q from public.action_case_work_quotes where id=new.selected_quote_id and cost_line_id=new.id and org_id=new.org_id;
      if not found then raise exception 'ACTION_CASE_QUOTE_NOT_FOUND'; end if;
      select coalesce(scope,'') into v_scope from public.action_case_items where id=new.action_case_item_id;
      if q.scope_snapshot <> v_scope or q.description_snapshot <> new.description or not q.checked
        or (q.valid_until is not null and q.valid_until < (now() at time zone 'Europe/Stockholm')::date) then
        new.selected_quote_id := null;
      end if;
    end if;
    new.quantity := 1; new.unit := 'uppdrag'; new.quantity_basis := 'provided'; new.price_source := 'subcontractor';
    new.unit_cost := case when new.selected_quote_id is not null then q.amount end;
    new.is_verified := new.selected_quote_id is not null;
    new.verified_by := case when new.is_verified then new.updated_by end;
    new.verified_at := case when new.is_verified then now() end;
    new.source_checked_at := new.verified_at;
    new.source_url := null;
  elsif tg_op = 'UPDATE' and old.pricing_method = 'quotes' then
    d := coalesce(old.direct_pricing, jsonb_build_object('category','own_labor','unit','tim','quantity_basis','unknown','price_source','manual','is_verified',false));
    new.category := d->>'category'; new.quantity := (d->>'quantity')::numeric; new.unit := d->>'unit';
    new.unit_cost := (d->>'unit_cost')::numeric; new.quantity_basis := d->>'quantity_basis';
    new.markup_percent := coalesce((d->>'markup_percent')::numeric,old.markup_percent);
    new.price_source := d->>'price_source'; new.source_url := d->>'source_url';
    new.is_verified := coalesce((d->>'is_verified')::boolean,false);
    new.verified_by := (d->>'verified_by')::uuid; new.verified_at := (d->>'verified_at')::timestamptz;
    new.source_checked_at := (d->>'source_checked_at')::timestamptz;
    new.selected_quote_id := null;
  end if;
  if tg_op = 'UPDATE' and old.selected_quote_id is not null and old.selected_quote_id is distinct from new.selected_quote_id then
    update public.action_case_cost_lines set covered_by_quote_id=null where covered_by_quote_id=old.selected_quote_id and org_id=new.org_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_action_case_quote_price_guard on public.action_case_cost_lines;
create trigger trg_action_case_quote_price_guard before insert or update or delete on public.action_case_cost_lines
for each row execute function public.action_case_quote_price_guard();

create or replace function public.action_case_item_cost_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer; v_known boolean; v_verified boolean; v_work_count integer; v_own boolean; v_sub boolean; v_has_sub boolean; v_material boolean; v_other boolean;
begin
  with effective as (
    select l.*, case when l.pricing_method='quotes' and (q.id is null or not q.checked
      or q.scope_snapshot <> coalesce(new.scope,'') or q.description_snapshot <> l.description
      or (q.valid_until is not null and q.valid_until < (now() at time zone 'Europe/Stockholm')::date))
      then false else l.is_verified end as valid
    from public.action_case_cost_lines l left join public.action_case_work_quotes q on q.id=l.selected_quote_id and q.cost_line_id=l.id
    where l.action_case_item_id=new.id and l.org_id=new.org_id and l.covered_by_quote_id is null
  ) select count(*), bool_and(quantity is not null and unit_cost is not null and (pricing_method <> 'quotes' or valid)), bool_and(valid),
    round(sum(quantity*unit_cost),2), round(sum(quantity*unit_cost*(1+markup_percent/100)),2),
    count(*) filter (where category in ('own_labor','subcontractor')),
    bool_and(valid) filter (where category='own_labor'), bool_and(valid) filter (where category='subcontractor'),
    bool_or(category='subcontractor'), bool_and(valid) filter (where category='material'),
    bool_and(valid) filter (where category in ('waste','transport','other'))
  into v_count,v_known,v_verified,new.estimated_cost,new.customer_price,v_work_count,v_own,v_sub,v_has_sub,v_material,v_other from effective;
  if v_count=0 or not v_known then new.estimated_cost:=null; new.customer_price:=null; end if;
  if v_work_count>0 then
    new.own_labor_ready:=coalesce(v_own,true); new.subcontractor_price_ready:=coalesce(v_sub,true); new.requires_subcontractor:=v_has_sub;
  end if;
  if exists(select 1 from public.action_case_cost_lines where action_case_item_id=new.id and category='material') then new.material_price_ready:=coalesce(v_material,true); end if;
  if exists(select 1 from public.action_case_cost_lines where action_case_item_id=new.id and category in ('waste','transport','other')) then new.waste_solution_ready:=coalesce(v_other,true); end if;
  if old.status in ('scope_needed','pricing_needed','waiting_subcontractor','ready_for_quote') then
    new.status:=case when btrim(coalesce(new.scope,''))='' then 'scope_needed'
      when new.own_labor_ready and new.material_price_ready and new.waste_solution_ready and (not new.requires_subcontractor or new.subcontractor_price_ready)
        and (v_count=0 or (v_known and v_verified)) then 'ready_for_quote'
      when new.requires_subcontractor and not new.subcontractor_price_ready then 'waiting_subcontractor' else 'pricing_needed' end;
  else new.status:=old.status; end if;
  return new;
end $$;

create or replace function public.write_action_case_quote(
  p_org_id uuid,p_case_id uuid,p_item_id uuid,p_line_id uuid,p_user_id uuid,p_operation text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i public.action_case_items%rowtype; l public.action_case_cost_lines%rowtype; q public.action_case_work_quotes%rowtype;
  v_id uuid:=(p_data->>'id')::uuid; v_ids uuid[]; v_request_ids uuid[]; v_lease uuid;
begin
  select * into i from public.action_case_items where id=p_item_id and action_case_id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_operation='create_work' then
    insert into public.action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,unit,pricing_method,markup_percent,created_by,updated_by,sort_order)
    values(p_line_id,p_org_id,p_case_id,p_item_id,'own_labor',p_data->>'description','tim','quotes',coalesce((p_data->>'markupPercent')::numeric,0),p_user_id,p_user_id,
      (select coalesce(max(sort_order),0)+100 from public.action_case_cost_lines where action_case_item_id=p_item_id)) on conflict(id) do nothing;
    if not exists(select 1 from public.action_case_cost_lines where id=p_line_id and org_id=p_org_id and action_case_item_id=p_item_id) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
    return jsonb_build_object('id',p_line_id);
  end if;
  select * into l from public.action_case_cost_lines where id=p_line_id and action_case_item_id=p_item_id and org_id=p_org_id for update;
  if not found or l.category not in ('own_labor','subcontractor') then raise exception 'ACTION_CASE_QUOTE_WORK_REQUIRED'; end if;
  if p_data->>'expectedLineUpdatedAt' is not null and l.updated_at<>(p_data->>'expectedLineUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
  if p_operation='method' then
    if p_data->>'method' not in ('direct','quotes') then raise exception 'ACTION_CASE_QUOTE_INVALID'; end if;
    update public.action_case_cost_lines set pricing_method=p_data->>'method', updated_by=p_user_id where id=l.id;
  elsif p_operation='markup' then
    update public.action_case_cost_lines set markup_percent=(p_data->>'markupPercent')::numeric, updated_by=p_user_id where id=l.id;
  elsif p_operation='save' then
    select * into q from public.action_case_work_quotes where id=v_id;
    if found and (q.org_id <> p_org_id or q.cost_line_id <> l.id) then raise exception 'ACTION_CASE_QUOTE_NOT_FOUND'; end if;
    if q.id is not null and p_data->>'expectedUpdatedAt' is null then return jsonb_build_object('id',q.id); end if;
    if q.id is not null and q.updated_at <> (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    v_ids:=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_data->'coveredLineIds','[]')) order by value::uuid);
    v_request_ids:=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_data->'requestAttachmentIds','[]')) order by value::uuid);
    if exists(select 1 from unnest(v_ids) id where not exists(select 1 from public.action_case_cost_lines c where c.id=id and c.action_case_item_id=i.id and c.org_id=p_org_id and c.category in ('material','waste','transport','other'))) then raise exception 'ACTION_CASE_QUOTE_INVALID'; end if;
    if exists(select 1 from public.action_case_cost_lines c where c.id=any(v_ids) and
      ((c.category='material' and p_data->>'materials'<>'included') or (c.category='transport' and p_data->>'travel'<>'included') or (c.category='waste' and p_data->>'waste'<>'included'))) then raise exception 'ACTION_CASE_QUOTE_COVERAGE'; end if;
    if p_data->>'documentId' is not null and not exists(select 1 from public.action_case_attachments where id=(p_data->>'documentId')::uuid and org_id=p_org_id and action_case_id=p_case_id and attachment_type='document') then raise exception 'ACTION_CASE_FILE_NOT_FOUND'; end if;
    if exists(select 1 from unnest(v_request_ids) id where not exists(select 1 from public.action_case_attachments a where a.id=id and a.org_id=p_org_id and a.action_case_id=p_case_id)) then raise exception 'ACTION_CASE_FILE_NOT_FOUND'; end if;
    if q.first_attempt_at is not null and (q.supplier_email,q.request_subject,q.request_body,q.request_attachment_ids) is distinct from
      (p_data->>'supplierEmail',p_data->>'requestSubject',p_data->>'requestBody',v_request_ids) then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
    if l.selected_quote_id=v_id then update public.action_case_cost_lines set selected_quote_id=null,updated_by=p_user_id where id=l.id; end if;
    insert into public.action_case_work_quotes(id,org_id,action_case_id,action_case_item_id,cost_line_id,supplier_name,supplier_email,amount,offered_scope,exclusions,
      valid_until,available_from,materials,travel,waste,covered_line_ids,document_id,checked,scope_snapshot,description_snapshot,request_subject,request_body,request_attachment_ids,created_by)
    values(v_id,p_org_id,p_case_id,p_item_id,p_line_id,p_data->>'supplierName',p_data->>'supplierEmail',(p_data->>'amount')::numeric,p_data->>'offeredScope',p_data->>'exclusions',
      (p_data->>'validUntil')::date,(p_data->>'availableFrom')::date,p_data->>'materials',p_data->>'travel',p_data->>'waste',v_ids,(p_data->>'documentId')::uuid,(p_data->>'checked')::boolean,
      coalesce(i.scope,''),l.description,p_data->>'requestSubject',p_data->>'requestBody',v_request_ids,p_user_id)
    on conflict(id) do update set supplier_name=excluded.supplier_name,supplier_email=excluded.supplier_email,amount=excluded.amount,offered_scope=excluded.offered_scope,
      exclusions=excluded.exclusions,valid_until=excluded.valid_until,available_from=excluded.available_from,materials=excluded.materials,travel=excluded.travel,waste=excluded.waste,
      covered_line_ids=excluded.covered_line_ids,document_id=excluded.document_id,checked=excluded.checked,request_subject=excluded.request_subject,
      request_body=excluded.request_body,request_attachment_ids=excluded.request_attachment_ids,updated_at=clock_timestamp();
  else
    select * into q from public.action_case_work_quotes where id=v_id and cost_line_id=l.id and org_id=p_org_id for update;
    if not found then raise exception 'ACTION_CASE_QUOTE_NOT_FOUND'; end if;
    if p_data->>'expectedQuoteUpdatedAt' is not null and q.updated_at<>(p_data->>'expectedQuoteUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    if p_operation='select' then
      if not q.checked or q.amount is null then raise exception 'ACTION_CASE_QUOTE_UNCHECKED'; end if;
      if q.scope_snapshot<>coalesce(i.scope,'') or q.description_snapshot<>l.description or (q.valid_until is not null and q.valid_until<(now() at time zone 'Europe/Stockholm')::date) then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
      if exists(select 1 from unnest(q.covered_line_ids) id where not exists(select 1 from public.action_case_cost_lines c where c.id=id and c.action_case_item_id=i.id and c.org_id=p_org_id and c.category in ('material','waste','transport','other'))) then raise exception 'ACTION_CASE_QUOTE_COVERAGE'; end if;
      if exists(select 1 from public.action_case_cost_lines where id=any(q.covered_line_ids) and covered_by_quote_id is not null and covered_by_quote_id<>q.id and covered_by_quote_id is distinct from l.selected_quote_id) then raise exception 'ACTION_CASE_QUOTE_COVERAGE'; end if;
      update public.action_case_cost_lines set pricing_method='quotes',selected_quote_id=q.id,updated_by=p_user_id where id=l.id;
      update public.action_case_cost_lines set covered_by_quote_id=q.id where id=any(q.covered_line_ids) and org_id=p_org_id;
    elsif p_operation='unselect' then
      update public.action_case_cost_lines set selected_quote_id=null,updated_by=p_user_id where id=l.id and selected_quote_id=q.id;
    elsif p_operation='delete' then
      if q.first_attempt_at is not null then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
      update public.action_case_cost_lines set selected_quote_id=null,updated_by=p_user_id where id=l.id and selected_quote_id=q.id;
      delete from public.action_case_work_quotes where id=q.id;
    elsif p_operation='claim_send' then
      if q.sent_at is not null then return jsonb_build_object('alreadySent',true); end if;
      if q.first_attempt_at < now()-interval '23 hours' then raise exception 'ACTION_CASE_QUOTE_SEND_UNKNOWN'; end if;
      if q.delivery_status='sending' and q.last_attempt_at>now()-interval '2 minutes' then raise exception 'ACTION_CASE_QUOTE_SEND_BUSY'; end if;
      if q.scope_snapshot<>coalesce(i.scope,'') or q.description_snapshot<>l.description then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
      if q.email_payload is null and (p_data->'emailPayload' is null or q.updated_at<>(p_data->>'expectedUpdatedAt')::timestamptz) then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
      v_lease:=gen_random_uuid();
      update public.action_case_work_quotes set email_payload=coalesce(email_payload,p_data->'emailPayload'),first_attempt_at=coalesce(first_attempt_at,now()),
        last_attempt_at=now(),lease_id=v_lease,delivery_status='sending',updated_at=clock_timestamp() where id=q.id
        returning * into q;
      return jsonb_build_object('leaseId',v_lease,'payload',q.email_payload);
    elsif p_operation='finish_send' then
      update public.action_case_work_quotes set delivery_status=case when (p_data->>'success')::boolean then 'sent' else 'unknown' end,
        sent_at=case when (p_data->>'success')::boolean then now() end,provider_message_id=p_data->>'providerMessageId',updated_at=clock_timestamp()
        where id=q.id and lease_id=(p_data->>'leaseId')::uuid;
    else raise exception 'ACTION_CASE_QUOTE_INVALID'; end if;
  end if;
  update public.action_case_items set updated_by=p_user_id where id=i.id;
  insert into public.action_case_events(org_id,action_case_id,action_case_item_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,p_item_id,'quote_'||p_operation,'Offertunderlag uppdaterat.',p_user_id);
  return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.write_action_case_quote(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_action_case_quote(uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
