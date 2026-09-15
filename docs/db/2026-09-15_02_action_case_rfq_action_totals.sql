-- RFQs: all cost categories, a total per action, or separately priced lines.
-- Requires action-case migrations through 2026-09-09_08 (RFQ delivery links).
-- Existing requests, prices, recipient links and send retries retain their snapshots.
-- Reapply safely; no sent requests or historical prices are rewritten.
begin;

alter table public.action_case_quote_requests
  drop constraint if exists action_case_quote_requests_price_presentation_check;
alter table public.action_case_quote_requests
  add constraint action_case_quote_requests_price_presentation_check
    check(price_presentation in ('grouped','itemized','action_total','line_items'));
alter table public.action_case_quote_requests alter column price_presentation set default 'action_total';

create or replace function public.action_case_request_group_key(p_source jsonb,p_presentation text)
returns text language sql immutable set search_path=pg_catalog,public as $$
  select (p_source->>'itemId')||':'||case p_presentation
    when 'action_total' then ''
    when 'line_items' then p_source->>'costLineId'
    else coalesce(p_source->>'workPartId','') end;
$$;

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
    or i.status in ('cancelled','declined','completed') then return false; end if;
  if p_source ? 'category' then
    if l.category is distinct from p_source->>'category'
      or not (p_source ?& array['quantity','unit','quantityBasis'])
      or jsonb_typeof(p_source->'quantity') not in ('number','null')
      or l.quantity is distinct from (p_source->>'quantity')::numeric
      or l.unit is distinct from p_source->>'unit'
      or l.quantity_basis is distinct from p_source->>'quantityBasis' then return false; end if;
  elsif l.category not in ('own_labor','subcontractor') then return false; end if;
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

-- Retain the existing lock order, lease, payload freezing and idempotent retries.
create or replace function public.write_action_case_request_pre_packages(
  p_org_id uuid,p_case_id uuid,p_request_id uuid,p_user_id uuid,p_operation text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.action_case_quote_requests%rowtype; s jsonb; v_ids uuid[]; v_lease uuid;
begin
  if not exists(select 1 from public.action_cases where id=p_case_id and org_id=p_org_id) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  -- Use the same item-before-cost-row lock order as existing costing writes.
  perform id from public.action_case_items where action_case_id=p_case_id and org_id=p_org_id order by id for update;
  select * into r from public.action_case_quote_requests where id=p_request_id for update;
  if found and (r.org_id<>p_org_id or r.action_case_id<>p_case_id) then raise exception 'ACTION_CASE_NOT_FOUND'; end if;
  if p_operation='save' then
    if r.id is not null and p_data->>'expectedUpdatedAt' is null then return jsonb_build_object('id',r.id); end if;
    if r.id is not null and r.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    if r.first_attempt_at is not null then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
    if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 30 then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    if (select count(distinct entry->>'costLineId') from jsonb_array_elements(p_data->'lines') entry) <> jsonb_array_length(p_data->'lines') then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    for s in select * from jsonb_array_elements(p_data->'lines') loop
      if not exists(select 1 from public.action_case_cost_lines l join public.action_case_items i on i.id=l.action_case_item_id
        where l.id=(s->>'costLineId')::uuid and i.id=(s->>'itemId')::uuid and l.org_id=p_org_id and i.org_id=p_org_id and l.action_case_id=p_case_id and i.action_case_id=p_case_id
        and l.category in ('own_labor','subcontractor','material','waste','transport','other') and i.status not in ('cancelled','declined','completed')
        and l.description=s->>'description' and i.title=s->>'itemTitle' and coalesce(i.scope,'')=s->>'scope') then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    end loop;
    v_ids:=array(select distinct value::uuid from jsonb_array_elements_text(p_data->'attachmentIds') order by value::uuid);
    if exists(select 1 from unnest(v_ids) requested(file_id) where not exists(select 1 from public.action_case_attachments a where a.id=requested.file_id and a.org_id=p_org_id and a.action_case_id=p_case_id)) then raise exception 'ACTION_CASE_FILE_NOT_FOUND'; end if;
    if exists(select 1 from public.action_case_work_quotes where org_id=p_org_id and document_id=any(v_ids))
      or exists(select 1 from public.action_case_quote_requests where org_id=p_org_id and response_document_id=any(v_ids)) then raise exception 'ACTION_CASE_QUOTE_PRIVATE_DOCUMENT'; end if;
    if p_data->>'supplementsId' is not null and not exists(select 1 from public.action_case_quote_requests where id=(p_data->>'supplementsId')::uuid and org_id=p_org_id and action_case_id=p_case_id and first_attempt_at is not null and supplier_email=p_data->>'supplierEmail') then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    insert into public.action_case_quote_requests(id,org_id,action_case_id,supplier_name,supplier_email,subject,message,requirements,other_requirements,lines,attachment_ids,body,supplements_id,created_by)
    values(p_request_id,p_org_id,p_case_id,p_data->>'supplierName',p_data->>'supplierEmail',p_data->>'subject',p_data->>'message',p_data->'requirements',p_data->>'otherRequirements',p_data->'lines',v_ids,p_data->>'body',(p_data->>'supplementsId')::uuid,p_user_id)
    on conflict(id) do update set supplier_name=excluded.supplier_name,supplier_email=excluded.supplier_email,subject=excluded.subject,message=excluded.message,
      requirements=excluded.requirements,other_requirements=excluded.other_requirements,lines=excluded.lines,attachment_ids=excluded.attachment_ids,body=excluded.body,supplements_id=excluded.supplements_id,updated_at=clock_timestamp();
  else
    if r.id is null then raise exception 'ACTION_CASE_REQUEST_NOT_FOUND'; end if;
    if p_operation not in ('claim_send','finish_send') and r.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
    if p_operation='delete' then
      if r.first_attempt_at is not null then raise exception 'ACTION_CASE_QUOTE_SENT_IMMUTABLE'; end if;
      delete from public.action_case_quote_requests where id=r.id;
    elsif p_operation='response' then
      if r.sent_at is null then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
      if p_data->>'responseMode' not in ('pending','itemized','package') then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
      if p_data->>'responseDocumentId' is not null and not exists(select 1 from public.action_case_attachments where id=(p_data->>'responseDocumentId')::uuid and org_id=p_org_id and action_case_id=p_case_id and attachment_type='document') then raise exception 'ACTION_CASE_FILE_NOT_FOUND'; end if;
      if p_data->>'responseMode'<>'itemized' then
        update public.action_case_cost_lines l set selected_quote_id=null,updated_by=p_user_id
        where selected_quote_id in (select id from public.action_case_work_quotes where request_id=r.id);
      end if;
      update public.action_case_quote_requests set response_mode=p_data->>'responseMode',package_amount=(p_data->>'packageAmount')::numeric,
        response_notes=p_data->>'responseNotes',response_document_id=(p_data->>'responseDocumentId')::uuid,updated_at=clock_timestamp() where id=r.id;
    elsif p_operation='claim_send' then
      if r.sent_at is not null then return jsonb_build_object('alreadySent',true); end if;
      if r.first_attempt_at<now()-interval '23 hours' then raise exception 'ACTION_CASE_QUOTE_SEND_UNKNOWN'; end if;
      if r.delivery_status='sending' and r.last_attempt_at>now()-interval '2 minutes' then raise exception 'ACTION_CASE_QUOTE_SEND_BUSY'; end if;
      if r.first_attempt_at is null then
      for s in select * from jsonb_array_elements(r.lines) loop
        if not exists(select 1 from public.action_case_cost_lines l join public.action_case_items i on i.id=l.action_case_item_id
          where l.id=(s->>'costLineId')::uuid and i.id=(s->>'itemId')::uuid and l.org_id=p_org_id and i.action_case_id=p_case_id
          and l.category in ('own_labor','subcontractor','material','waste','transport','other') and i.status not in ('cancelled','declined','completed')
          and l.description=s->>'description' and i.title=s->>'itemTitle' and coalesce(i.scope,'')=s->>'scope') then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
      end loop;
      end if;
      if r.email_payload is null and (coalesce(jsonb_typeof(p_data->'emailPayload'),'null')<>'object' or r.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz) then raise exception 'ACTION_CASE_QUOTE_STALE'; end if;
      v_lease:=gen_random_uuid();
      update public.action_case_quote_requests set email_payload=coalesce(email_payload,p_data->'emailPayload'),first_attempt_at=coalesce(first_attempt_at,now()),last_attempt_at=now(),
        lease_id=v_lease,delivery_status='sending',response_mode=case when price_presentation in ('grouped','itemized') and jsonb_array_length(lines)=1 then 'itemized' else response_mode end,updated_at=clock_timestamp() where id=r.id returning * into r;
      if r.price_presentation in ('grouped','itemized') then
      for s in select * from jsonb_array_elements(r.lines) loop
        insert into public.action_case_work_quotes(id,org_id,action_case_id,action_case_item_id,cost_line_id,request_id,supplier_name,supplier_email,
          scope_snapshot,description_snapshot,request_subject,request_body,request_attachment_ids,first_attempt_at,delivery_status,created_by)
        values(gen_random_uuid(),p_org_id,p_case_id,(s->>'itemId')::uuid,(s->>'costLineId')::uuid,r.id,r.supplier_name,r.supplier_email,
          s->>'scope',s->>'description',r.subject,r.body,r.attachment_ids,r.first_attempt_at,'sending',p_user_id)
        on conflict(request_id,cost_line_id) where request_id is not null do nothing;
      end loop;
      end if;
      return jsonb_build_object('leaseId',v_lease,'payload',r.email_payload);
    elsif p_operation='finish_send' then
      if r.lease_id is distinct from (p_data->>'leaseId')::uuid then return jsonb_build_object('ignored',true); end if;
      update public.action_case_quote_requests set delivery_status=case when (p_data->>'success')::boolean then 'sent' else 'unknown' end,
        sent_at=case when (p_data->>'success')::boolean then now() end,provider_message_id=p_data->>'providerMessageId',updated_at=clock_timestamp() where id=r.id returning * into r;
      update public.action_case_work_quotes set delivery_status=r.delivery_status,sent_at=r.sent_at,updated_at=clock_timestamp() where request_id=r.id;
    else raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
  end if;
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'request_'||p_operation,'Samlad offertförfrågan uppdaterad.',p_user_id);
  return jsonb_build_object('id',p_request_id);
end $$;

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
    presentation:=coalesce(p_data->>'pricePresentation',r.price_presentation,'action_total');
    if presentation not in ('grouped','itemized','action_total','line_items') or jsonb_typeof(p_data->'lines') is distinct from 'array' then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
    perform id from public.action_case_cost_lines where action_case_id=p_case_id and org_id=p_org_id order by id for update;
    for s in select * from jsonb_array_elements(p_data->'lines') loop
      if presentation in ('action_total','line_items') and not (s ?& array['category','quantity','unit','quantityBasis','workPartId']) then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
      if presentation in ('grouped','itemized') and s ? 'category' then raise exception 'ACTION_CASE_REQUEST_INVALID'; end if;
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

-- Non-labor anchors retain their category. Only a package-derived quote may
-- price these rows; direct, standalone work quotes remain work-only.
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
    if new.category not in ('own_labor','subcontractor') and not exists(
      select 1 from public.action_case_work_quotes pq where pq.id=new.selected_quote_id
        and pq.cost_line_id=new.id and pq.org_id=new.org_id and pq.package_request_id is not null
    ) then raise exception 'ACTION_CASE_QUOTE_WORK_REQUIRED'; end if;
    if tg_op = 'UPDATE' and old.pricing_method = 'direct' then new.direct_pricing := to_jsonb(old); end if;
    if new.category in ('own_labor','subcontractor') then new.category := 'subcontractor'; end if;
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

create or replace function public.guard_action_case_package_scope()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare active boolean;
begin
  if tg_table_name='action_case_items' then
    select exists(select 1 from public.action_case_quote_packages where action_case_item_id=old.id and state='active') into active;
  else
    select exists(select 1 from public.action_case_quote_packages p where p.state='active'
      and (p.work_part_id=old.id or exists(select 1 from public.action_case_cost_lines c
        where c.org_id=p.org_id and c.action_case_item_id=p.action_case_item_id
          and to_jsonb(c)->>'work_part_id'=old.id::text
          and (c.id=p.anchor_line_id or c.id=any(p.covered_line_ids))))) into active;
  end if;
  if active and exists(select 1 from public.action_cases where id=old.action_case_id) then
    if tg_op='DELETE' then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
    if (to_jsonb(new)->'title',to_jsonb(new)->'scope',to_jsonb(new)->'org_id',to_jsonb(new)->'action_case_id',to_jsonb(new)->'action_case_item_id') is distinct from
      (to_jsonb(old)->'title',to_jsonb(old)->'scope',to_jsonb(old)->'org_id',to_jsonb(old)->'action_case_id',to_jsonb(old)->'action_case_item_id') then raise exception 'ACTION_CASE_PACKAGE_REMOVE_FIRST'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- Reuse transactional coverage and complete original-row restoration.
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
    where public.action_case_request_group_key(entry,r.price_presentation)=v_group_key;
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
    select count(distinct public.action_case_request_group_key(entry,r.price_presentation)) into group_count from jsonb_array_elements(r.lines) entry;
    if group_count>1 and p_data->'separateGroupPriceConfirmed' is distinct from 'true'::jsonb then raise exception 'ACTION_CASE_PACKAGE_ALLOCATION_REQUIRED'; end if;
    if coalesce(p_data->>'amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
    amount:=(p_data->>'amount')::numeric;
    if amount>999999999999.99 then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
    -- Single-group whole-request responses have an authoritative saved total.
    if group_count=1 and r.response_mode='package' and r.package_amount is distinct from amount then raise exception 'ACTION_CASE_PACKAGE_AMOUNT_MISMATCH'; end if;
    item_id:=(sources->0->>'itemId')::uuid; part_id:=case when r.price_presentation='action_total' then null else (sources->0->>'workPartId')::uuid end;
    anchor:=(sources->0->>'costLineId')::uuid;
    if jsonb_typeof(coalesce(p_data->'coveredLineIds','[]')) is distinct from 'array'
      or jsonb_array_length(coalesce(p_data->'coveredLineIds','[]'))>30 then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
    extras:=array(select value::uuid from jsonb_array_elements_text(coalesce(p_data->'coveredLineIds','[]')));
    if r.price_presentation in ('action_total','line_items') and cardinality(extras)>0 then raise exception 'ACTION_CASE_PACKAGE_INVALID'; end if;
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
        or (r.price_presentation<>'action_total' and (to_jsonb(l)->>'work_part_id')::uuid is distinct from part_id
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

revoke all on function public.action_case_request_group_key(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.action_case_request_source_matches(uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.write_action_case_request_pre_packages(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.write_action_case_request(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_action_case_request(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.write_action_case_quote_package(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_action_case_quote_package(uuid,uuid,uuid,uuid,text,jsonb) to service_role;

commit;
