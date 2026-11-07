-- Project invoice allocations and explicitly reviewed customer invoice bases.
-- Requires 2026-11-05_01_supplier_invoices and 2026-11-07_01_project_completion_and_invoice_basis.
-- No backfill and no writes to contracts, calculations, customer prices or payment plans.
begin;

create table if not exists public.supplier_invoice_basis_sources (
  org_id uuid not null references public.organizations(id),
  invoice_id uuid not null references public.supplier_invoices(id),
  allocation_id uuid not null,
  action_case_id uuid not null references public.action_cases(id),
  basis_id uuid not null references public.action_case_invoice_basis(id),
  line_id uuid not null,
  customer_net_ore bigint not null,
  agreement text not null,
  snapshot jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(org_id,invoice_id,allocation_id), unique(basis_id,line_id)
);
alter table public.supplier_invoice_basis_sources enable row level security;
revoke all on public.supplier_invoice_basis_sources from public,anon,authenticated;
grant select,insert on public.supplier_invoice_basis_sources to service_role;
create index if not exists supplier_invoice_basis_sources_project_idx on public.supplier_invoice_basis_sources(org_id,action_case_id);

-- Read customer terms only. Once locked, never fall back to live project pricing.
create or replace function public.supplier_invoice_target(p_org uuid,p_case uuid,p_item uuid,p_change uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare s jsonb; r jsonb; t jsonb; charge jsonb; frozen boolean:=false;
begin
  if p_change is not null then
    select x->'offer'->'pricing' into s from public.action_case_customer_planning p,
      lateral jsonb_array_elements(p.items) x where p.org_id=p_org and p.action_case_id=p_case and x->>'id'=p_change::text and x#>>'{offer,kind}'='change';
    if not found then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
    return jsonb_build_object('mode',coalesce(case when s->>'mode'='mixed' then 'unknown' else s->>'mode' end,'unknown'),
      'markupPercent',s#>'{running,markupPercent}');
  end if;
  if p_item is null or not exists(select 1 from public.action_case_items where id=p_item and org_id=p_org and action_case_id=p_case) then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
  select snapshot into s from public.action_case_contract_signing_documents
    where org_id=p_org and action_case_id=p_case and released_at is null order by version desc limit 1;
  frozen:=found;
  if not frozen then
    select snapshot into s from public.action_case_customer_offers where org_id=p_org and action_case_id=p_case
      and status in ('accepted','published') order by version desc limit 1;
    frozen:=found;
  end if;
  if frozen then
    select x into r from jsonb_array_elements(coalesce(s#>'{contractPricing,rows}','[]')) x where x->>'sourceItemId'=p_item::text;
    t:=r#>'{projectPricing,terms}';
    if t is null then return jsonb_build_object('mode',coalesce(r->>'kind',case when s#>>'{contractPricing,mode}'='fixed' then 'fixed' else 'unknown' end),'markupPercent',s#>'{contractPricing,running,markupPercent}'); end if;
  else
    select terms into t from public.action_case_customer_prices where org_id=p_org and action_case_id=p_case and item_id=p_item;
  end if;
  if t->>'split'='separate' then
    return jsonb_build_object('mode',case when t#>>'{labour,mode}'='fixed' and t#>>'{material,mode}'='fixed' then 'fixed' else 'unknown' end,'markupPercent',null,
      'parts',jsonb_build_array(jsonb_build_object('key','labour','mode',t#>>'{labour,mode}','markupPercent',t#>'{labour,markupPercent}'),
        jsonb_build_object('key','material','mode',t#>>'{material,mode}','markupPercent',t#>'{material,markupPercent}')));
  end if;
  charge:=t->'combined';
  return jsonb_build_object('mode',coalesce(charge->>'mode','unknown'),'markupPercent',charge->'markupPercent');
end $$;

-- Keep v1 validation/credit/duplicate behavior; v2 owns the additive allocation fields.
do $$ begin
  if to_regprocedure('public.write_supplier_invoice_v1(uuid,uuid,uuid,integer,jsonb)') is null then
    alter function public.write_supplier_invoice(uuid,uuid,uuid,integer,jsonb) rename to write_supplier_invoice_v1;
  end if;
end $$;
create or replace function public.write_supplier_invoice(p_org_id uuid,p_user_id uuid,p_invoice_id uuid,p_expected_revision integer,p_body jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare previous public.supplier_invoices%rowtype; a jsonb; stripped jsonb; rows jsonb:='[]'; ids uuid[]:='{}'; aid uuid; result jsonb; link record;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active)
    then raise exception 'INVOICE_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('supplier-invoice-org:'||p_org_id::text,0));
  select * into previous from public.supplier_invoices where id=p_invoice_id for update;
  if found and previous.org_id<>p_org_id then raise exception 'INVOICE_NOT_FOUND'; end if;
  if previous.revision=p_expected_revision+1 and previous.body=p_body then return jsonb_build_object('id',p_invoice_id,'revision',previous.revision); end if;
  if p_body is null or jsonb_typeof(p_body->'allocations') is distinct from 'array' then raise exception 'INVOICE_INVALID'; end if;
  for a in select value from jsonb_array_elements(p_body->'allocations') loop
    if a?'id' then
      aid:=(a->>'id')::uuid;
      if aid is null or aid=any(ids) then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
      ids:=array_append(ids,aid);
    elsif exists(select 1 from jsonb_array_elements(coalesce(previous.body->'allocations','[]')) old where old?'id') then
      raise exception 'INVOICE_STALE';
    end if;
    if a->>'changeId' is not null then
      if not a?'id' or a->>'itemId' is not null or not exists(select 1 from public.action_case_customer_planning p,
        lateral jsonb_array_elements(p.items) x where p.org_id=p_org_id and p.action_case_id=(a->>'caseId')::uuid
        and x->>'id'=a->>'changeId' and x#>>'{offer,kind}'='change') then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
    end if;
    rows:=rows||jsonb_build_array(a-array['id','changeId']);
  end loop;
  -- A source already used in a basis is immutable, including credits and VAT.
  for link in select * from public.supplier_invoice_basis_sources where org_id=p_org_id and invoice_id=p_invoice_id loop
    select x into a from jsonb_array_elements(p_body->'allocations') x where x->>'id'=link.allocation_id::text;
    if a is distinct from link.snapshot->'allocation' or
      (p_body-array['notes','sourceText','allocations']) is distinct from (previous.body-array['notes','sourceText','allocations']) then
      raise exception 'INVOICE_SOURCE_IN_USE';
    end if;
  end loop;
  stripped:=jsonb_set(p_body,'{allocations}',rows);
  if stripped->>'dueDate'='' then stripped:=jsonb_set(stripped,'{dueDate}',stripped->'invoiceDate'); end if;
  result:=public.write_supplier_invoice_v1(p_org_id,p_user_id,p_invoice_id,p_expected_revision,stripped);
  update public.supplier_invoices set body=p_body where id=p_invoice_id;
  update public.supplier_invoice_events set snapshot=p_body where invoice_id=p_invoice_id and revision=(result->>'revision')::integer and event_type in ('created','updated');
  return result;
exception when invalid_text_representation then raise exception 'INVOICE_ALLOCATION_INVALID';
end $$;
revoke all on function public.write_supplier_invoice_v1(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;

-- Source rows stay attached to their basis; metadata and unrelated manual rows remain editable.
create or replace function public.guard_supplier_invoice_basis() returns trigger language plpgsql set search_path=public,pg_catalog as $$
declare source record; oldline jsonb; newline jsonb;
begin
  for source in select * from public.supplier_invoice_basis_sources where basis_id=old.id loop
    if tg_op='DELETE' then raise exception 'INVOICE_SOURCE_IN_USE'; end if;
    select x into oldline from jsonb_array_elements(old.body->'lines') x where x->>'id'=source.line_id::text;
    select x into newline from jsonb_array_elements(new.body->'lines') x where x->>'id'=source.line_id::text;
    if newline is distinct from oldline then raise exception 'INVOICE_SOURCE_IN_USE'; end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.project_supplier_invoice_context(p_org uuid,p_case uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare state text; targets jsonb; changes jsonb;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_actor and is_active) then raise exception 'INVOICE_FORBIDDEN'; end if;
  select status into state from public.action_cases where id=p_case and org_id=p_org;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind','item','title',title)||public.supplier_invoice_target(p_org,p_case,id,null) order by sort_order,id),'[]')
    into targets from public.action_case_items where org_id=p_org and action_case_id=p_case;
  select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','kind','change','title',x->>'title')||public.supplier_invoice_target(p_org,p_case,null,(x->>'id')::uuid)),'[]')
    into changes from public.action_case_customer_planning p,lateral jsonb_array_elements(p.items) x where p.org_id=p_org and p.action_case_id=p_case and x#>>'{offer,kind}'='change';
  return jsonb_build_object('userId',p_actor,'status',state,'targets',targets||changes);
end $$;
drop trigger if exists supplier_invoice_basis_guard on public.action_case_invoice_basis;
create trigger supplier_invoice_basis_guard before update or delete on public.action_case_invoice_basis for each row execute function public.guard_supplier_invoice_basis();

create or replace function public.create_supplier_invoice_basis(p_org uuid,p_case uuid,p_actor uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare project public.action_cases%rowtype; inv public.supplier_invoices%rowtype; entry jsonb; a jsonb; target jsonb; basis jsonb:=p_request->'body';
  bid uuid:=(p_request->>'id')::uuid; lid uuid; rid uuid:=(p_request->>'requestId')::uuid; result jsonb; line jsonb; amount bigint; markup numeric; seen text[]:='{}'; k text;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_actor and is_active) then raise exception 'INVOICE_FORBIDDEN'; end if;
  -- Same lock order as invoice writes; basis creation and cost edits cannot race.
  perform pg_advisory_xact_lock(hashtextextended('supplier-invoice-org:'||p_org::text,0));
  select * into project from public.action_cases where id=p_case and org_id=p_org for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if project.status in ('completed','cancelled') then raise exception 'INVOICE_PROJECT_CLOSED'; end if;
  select e.result into result from public.action_case_administration_events e where e.id=rid and e.org_id=p_org and e.action_case_id=p_case and e.actor_id=p_actor
    and e.request->'supplierRequest'=p_request;
  if found then return result; end if;
  if p_request->>'confirmed' is distinct from 'true' or bid is null or rid is null or exists(select 1 from public.action_case_invoice_basis where id=bid)
    or jsonb_typeof(p_request->'sources') is distinct from 'array' or jsonb_array_length(p_request->'sources') not between 1 and 100 then raise exception 'INVOICE_INVALID'; end if;
  basis:=jsonb_set(basis,'{lines}','[]');
  perform public.validate_action_case_invoice_basis(basis);
  for entry in select value from jsonb_array_elements(p_request->'sources') loop
    select * into inv from public.supplier_invoices where org_id=p_org and id=(entry->>'invoiceId')::uuid for update;
    if not found or inv.revision<>(entry->>'revision')::integer or inv.body->>'approvalStatus' in ('void','disputed')
      or not exists(select 1 from public.supplier_invoice_attachments where org_id=p_org and invoice_id=inv.id) then raise exception 'INVOICE_STALE'; end if;
    select x into a from jsonb_array_elements(inv.body->'allocations') x where x->>'id'=entry->>'allocationId' and x->>'caseId'=p_case::text;
    if a is null or (a->>'itemId' is null and a->>'changeId' is null) then raise exception 'INVOICE_ALLOCATION_INVALID'; end if;
    k:=inv.id::text||':'||(a->>'id');
    if k=any(seen) or exists(select 1 from public.supplier_invoice_basis_sources where org_id=p_org and invoice_id=inv.id and allocation_id=(a->>'id')::uuid) then raise exception 'INVOICE_ALREADY_IN_BASIS'; end if;
    seen:=array_append(seen,k);
    target:=public.supplier_invoice_target(p_org,p_case,(a->>'itemId')::uuid,(a->>'changeId')::uuid);
    if target?'parts' then
      select x into target from jsonb_array_elements(target->'parts') x where x->>'key'=entry->>'part';
      if target is null then raise exception 'INVOICE_TERMS_CHANGED'; end if;
    end if;
    if target->>'mode'='fixed' then raise exception 'INVOICE_FIXED_COST'; end if;
    if length(btrim(coalesce(entry->>'agreement',''))) not between 1 and 1000 then raise exception 'INVOICE_AGREEMENT_REQUIRED'; end if;
    markup:=(entry->>'markupPercent')::numeric;
    if markup is null or markup<0 or markup>1000 or markup<>round(markup,2) or (target->>'markupPercent' is not null and markup<>(target->>'markupPercent')::numeric) then raise exception 'INVOICE_TERMS_CHANGED'; end if;
    amount:=round((a->>'amountOre')::numeric*(1+markup/100));
    if inv.body->>'documentKind'='credit' then amount:=-amount; end if;
    lid:=(entry->>'lineId')::uuid;
    if lid is null or length(btrim(coalesce(entry->>'description',''))) not between 1 and 1500 or (entry->>'vatRate')::numeric not in (0,6,12,25) or entry->>'vatRate' is null then raise exception 'INVOICE_INVALID'; end if;
    line:=jsonb_build_object('id',lid,'description',entry->>'description','quantity',1,'unit','st','unitPriceOre',amount,'vatRate',(entry->>'vatRate')::numeric);
    basis:=jsonb_set(basis,'{lines}',(basis->'lines')||jsonb_build_array(line));
  end loop;
  result:=public.write_project_administration(p_org,p_case,p_actor,jsonb_build_object('operation','save_basis','requestId',rid,'revision',0,'id',bid,'body',basis,'supplierRequest',p_request));
  for entry in select value from jsonb_array_elements(p_request->'sources') loop
    select * into inv from public.supplier_invoices where id=(entry->>'invoiceId')::uuid;
    select x into a from jsonb_array_elements(inv.body->'allocations') x where x->>'id'=entry->>'allocationId';
    select x into line from jsonb_array_elements(basis->'lines') x where x->>'id'=entry->>'lineId';
    insert into public.supplier_invoice_basis_sources(org_id,invoice_id,allocation_id,action_case_id,basis_id,line_id,customer_net_ore,agreement,snapshot,created_by)
      values(p_org,inv.id,(a->>'id')::uuid,p_case,bid,(entry->>'lineId')::uuid,(line->>'unitPriceOre')::bigint,entry->>'agreement',
        jsonb_build_object('allocation',a,'invoiceRevision',inv.revision,'review',entry,'terms',public.supplier_invoice_target(p_org,p_case,(a->>'itemId')::uuid,(a->>'changeId')::uuid)),p_actor);
  end loop;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVOICE_INVALID';
end $$;

revoke all on function public.project_supplier_invoice_context(uuid,uuid,uuid),public.supplier_invoice_target(uuid,uuid,uuid,uuid),public.guard_supplier_invoice_basis(),public.create_supplier_invoice_basis(uuid,uuid,uuid,jsonb),public.write_supplier_invoice(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.project_supplier_invoice_context(uuid,uuid,uuid),public.supplier_invoice_target(uuid,uuid,uuid,uuid),public.create_supplier_invoice_basis(uuid,uuid,uuid,jsonb),public.write_supplier_invoice(uuid,uuid,uuid,integer,jsonb) to service_role;
commit;
