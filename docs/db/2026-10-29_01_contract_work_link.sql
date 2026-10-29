-- Shared linked work before locking; frozen contracts are never rewritten.
-- Run after the contract, work-part, completion and project-manager migrations.
begin;

create or replace function public.contract_work_ref(p_row jsonb,p_item_id uuid) returns boolean
language sql immutable set search_path=public,pg_catalog as $$
  select lower(coalesce(p_row->>'sourceItemId',p_row->>'id',''))=p_item_id::text
$$;
create or replace function public.contract_work_references(p_body jsonb,p_item_id uuid) returns boolean
language sql immutable set search_path=public,pg_catalog as $$
  select exists(select 1 from jsonb_array_elements(coalesce(p_body->'items','[]')) r
    where r->>'kind'<>'option' and public.contract_work_ref(r,p_item_id))
    or exists(select 1 from jsonb_array_elements(coalesce(p_body#>'{contractPricing,rows}','[]')) r
      where public.contract_work_ref(r,p_item_id))
$$;
create or replace function public.contract_work_part(p_body jsonb,p_item_id uuid) returns jsonb
language plpgsql immutable set search_path=public,pg_catalog as $$
declare result jsonb; n integer;
begin
  select count(*),jsonb_agg(r)->0 into n,result from jsonb_array_elements(coalesce(p_body->'items','[]')) r
    where r->>'kind'<>'option' and public.contract_work_ref(r,p_item_id);
  if n>1 then raise exception 'CUSTOMER_OFFER_LINK_CONFLICT'; end if;
  return result;
end $$;
create or replace function public.contract_work_price(p_body jsonb,p_item_id uuid) returns jsonb
language plpgsql immutable set search_path=public,pg_catalog as $$
declare r jsonb; p jsonb:=p_body->'contractPricing'; editable boolean:=false; split text:='combined'; amount bigint;
begin
  if p is not null then
    split:=p->>'split';
    select value into r from jsonb_array_elements(p->'rows') where public.contract_work_ref(value,p_item_id);
    editable:=r is not null and p->>'basis'='rows' and p->>'mode'<>'running' and (p->>'mode'<>'mixed' or r->>'kind'='fixed');
  else
    r:=public.contract_work_part(p_body,p_item_id);
    editable:=r is not null and r->>'kind'='included' and p_body->>'pricingMode'='itemized';
  end if;
  if editable then amount:=case when split='separate' then (r->>'labourOre')::bigint+(r->>'materialOre')::bigint else (r->>'amountOre')::bigint end; end if;
  return jsonb_build_object('editable',coalesce(editable,false),'split',coalesce(split,'combined'),'amountOre',amount,
    'labourOre',case when editable and split='separate' then (r->>'labourOre')::bigint end,
    'materialOre',case when editable and split='separate' then (r->>'materialOre')::bigint end);
end $$;

-- VOLATILE reads are intentional: re-read after acquiring the case lock so an
-- edit racing with freeze cannot use a snapshot from before the lock was taken.
create or replace function public.contract_work_locked(p_org_id uuid,p_case_id uuid,p_item_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  return exists(select 1 from public.action_case_contract_signing_documents s
    where s.org_id=p_org_id and s.action_case_id=p_case_id and
      (s.released_at is null or exists(select 1 from public.action_case_contract_signing_delivery d where d.document_id=s.id and d.signed_copy is not null))
      and public.contract_work_references(s.snapshot,p_item_id))
    or exists(select 1 from public.action_case_customer_offers s where s.org_id=p_org_id and s.action_case_id=p_case_id
      and s.status in ('published','accepted') and public.contract_work_references(s.snapshot,p_item_id));
end $$;
create or replace function public.guard_contract_work_mutation() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare entry jsonb; item record;
begin
  for entry in select value from jsonb_array_elements(jsonb_build_array(to_jsonb(old),to_jsonb(new))) where jsonb_typeof(value)='object' loop
    if tg_table_name='action_case_items' then
      perform 1 from public.action_cases where id=(entry->>'action_case_id')::uuid and org_id=(entry->>'org_id')::uuid for update;
      if public.contract_work_locked((entry->>'org_id')::uuid,(entry->>'action_case_id')::uuid,(entry->>'id')::uuid) then raise exception 'ACTION_CASE_CONTRACT_LOCKED'; end if;
    end if;
    for item in select i.id,i.org_id,i.action_case_id from public.action_case_items i
      where i.org_id=(entry->>'org_id')::uuid and (
        (tg_table_name='action_case_items' and i.id=(entry->>'id')::uuid)
        or i.id=(entry->>'action_case_item_id')::uuid
        or (tg_table_name='action_case_attachments' and coalesce(i.scope_attachment_ids,'{}'::uuid[]) @> array[(entry->>'id')::uuid])
        or (tg_table_name='action_case_quote_requests' and exists(select 1 from jsonb_array_elements(coalesce(entry->'lines','[]')) l where lower(l->>'itemId')=i.id::text))) loop
      perform 1 from public.action_cases where id=item.action_case_id and org_id=item.org_id for update;
      if public.contract_work_locked(item.org_id,item.action_case_id,item.id) then raise exception 'ACTION_CASE_CONTRACT_LOCKED'; end if;
    end loop;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
do $guards$
declare name text;
begin
  foreach name in array array['action_case_items','action_case_cost_lines','action_case_work_parts','action_case_work_quotes','action_case_quote_requests','action_case_quote_packages','action_case_cost_suggestions','action_case_attachments'] loop
    execute format('drop trigger if exists aa_contract_work_lock on public.%I',name);
    execute format('create trigger aa_contract_work_lock before insert or update or delete on public.%I for each row execute function public.guard_contract_work_mutation()',name);
  end loop;
end $guards$;

-- A linked work title and its price-row title are one value. Reject competing
-- edits instead of picking one silently. Non-linked/manual rows stay separate.
create or replace function public.prepare_contract_work_titles() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare i record; part jsonb; prior jsonb; price jsonb; prior_price jsonb; title text; parts jsonb; prices jsonb; previous_body jsonb;
begin
  if new.body->'contractPricing' is null then return new; end if;
  if tg_op='UPDATE' then previous_body:=old.body;
  else select c.body into previous_body from public.action_case_customer_contract_drafts c where c.org_id=new.org_id and c.action_case_id=new.action_case_id; end if;
  for i in select id from public.action_case_items where org_id=new.org_id and action_case_id=new.action_case_id loop
    part:=public.contract_work_part(new.body,i.id);
    select value into price from jsonb_array_elements(new.body#>'{contractPricing,rows}') where public.contract_work_ref(value,i.id);
    if part is null or price is null or part->>'title'=price->>'title' then continue; end if;
    prior:=public.contract_work_part(previous_body,i.id);
    prior_price:=null;
    select value into prior_price from jsonb_array_elements(coalesce(previous_body#>'{contractPricing,rows}','[]')) where public.contract_work_ref(value,i.id);
    if prior is not null and part->>'title'=prior->>'title' and price->>'title' is distinct from prior_price->>'title' then title:=price->>'title';
    elsif prior_price is not null and price->>'title'=prior_price->>'title' and part->>'title' is distinct from prior->>'title' then title:=part->>'title';
    else raise exception 'CUSTOMER_OFFER_LINK_CONFLICT'; end if;
    select jsonb_agg(case when public.contract_work_ref(value,i.id) then jsonb_set(value,'{title}',to_jsonb(title)) else value end order by ord)
      into parts from jsonb_array_elements(new.body->'items') with ordinality a(value,ord);
    select jsonb_agg(case when public.contract_work_ref(value,i.id) then jsonb_set(value,'{title}',to_jsonb(title)) else value end order by ord)
      into prices from jsonb_array_elements(new.body#>'{contractPricing,rows}') with ordinality a(value,ord);
    new.body:=jsonb_set(jsonb_set(new.body,'{items}',parts),'{contractPricing,rows}',prices);
  end loop;
  return new;
end $$;
drop trigger if exists aa_contract_work_titles on public.action_case_customer_contract_drafts;
create trigger aa_contract_work_titles before insert or update of body on public.action_case_customer_contract_drafts
  for each row execute function public.prepare_contract_work_titles();

create or replace function public.sync_contract_work_from_draft() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare i record; part jsonb; prior jsonb; patch jsonb; pair text[]; value text;
begin
  for i in select * from public.action_case_items where org_id=new.org_id and action_case_id=new.action_case_id order by id loop
    part:=public.contract_work_part(new.body,i.id);
    if part is null then continue; end if;
    prior:=case when tg_op='UPDATE' then public.contract_work_part(old.body,i.id) end;
    patch:=to_jsonb(i);
    foreach pair slice 1 in array array[['title','title'],['scope','scope'],['scopeConditions','scope_conditions'],['scopeExclusions','scope_exclusions'],['scopeAdvice','scope_advice']] loop
      if prior is null or coalesce(part->>pair[1],'') is distinct from coalesce(prior->>pair[1],'') then
        value:=coalesce(part->>pair[1],''); patch:=jsonb_set(patch,array[pair[2]],to_jsonb(value));
      end if;
    end loop;
    if (coalesce(i.title,''),coalesce(i.scope,''),coalesce(i.scope_conditions,''),coalesce(i.scope_exclusions,''),coalesce(i.scope_advice,'')) is distinct from
      (patch->>'title',patch->>'scope',patch->>'scope_conditions',patch->>'scope_exclusions',patch->>'scope_advice') then
      update public.action_case_items set title=patch->>'title',scope=patch->>'scope',scope_conditions=patch->>'scope_conditions',
        scope_exclusions=patch->>'scope_exclusions',scope_advice=patch->>'scope_advice',updated_by=new.updated_by,updated_at=clock_timestamp() where id=i.id;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists zz_contract_work_sync on public.action_case_customer_contract_drafts;
create trigger zz_contract_work_sync after insert or update of body on public.action_case_customer_contract_drafts
  for each row execute function public.sync_contract_work_from_draft();

create or replace function public.sync_contract_work_from_item() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare d public.action_case_customer_contract_drafts%rowtype; v_body jsonb; parts jsonb; prices jsonb; patch jsonb:='{}'; pair text[];
begin
  foreach pair slice 1 in array array[['title','title'],['scope','scope'],['scopeConditions','scope_conditions'],['scopeExclusions','scope_exclusions'],['scopeAdvice','scope_advice']] loop
    if coalesce(to_jsonb(new)->>pair[2],'') is distinct from coalesce(to_jsonb(old)->>pair[2],'') then patch:=patch||jsonb_build_object(pair[1],coalesce(to_jsonb(new)->>pair[2],'')); end if;
  end loop;
  if patch='{}'::jsonb then return new; end if;
  select * into d from public.action_case_customer_contract_drafts where org_id=new.org_id and action_case_id=new.action_case_id for update;
  if not found or not public.contract_work_references(d.body,new.id) then return new; end if;
  v_body:=d.body;
  select coalesce(jsonb_agg(case when value->>'kind'<>'option' and public.contract_work_ref(value,new.id) then value||patch else value end order by ord),'[]')
    into parts from jsonb_array_elements(v_body->'items') with ordinality a(value,ord);
  v_body:=jsonb_set(v_body,'{items}',parts);
  if patch ? 'title' and v_body->'contractPricing' is not null then
    select coalesce(jsonb_agg(case when public.contract_work_ref(value,new.id) then value||jsonb_build_object('title',new.title) else value end order by ord),'[]')
      into prices from jsonb_array_elements(v_body#>'{contractPricing,rows}') with ordinality a(value,ord);
    v_body:=jsonb_set(v_body,'{contractPricing,rows}',prices);
  end if;
  if v_body is distinct from d.body then
    update public.action_case_customer_contract_drafts set body=v_body,revision=revision+1,updated_by=new.updated_by,updated_at=clock_timestamp()
      where action_case_id=new.action_case_id and org_id=new.org_id;
  end if;
  return new;
end $$;
drop trigger if exists zz_contract_work_sync on public.action_case_items;
create trigger zz_contract_work_sync after update on public.action_case_items for each row execute function public.sync_contract_work_from_item();

create or replace function public.get_contract_work_links(p_org_id uuid,p_user_id uuid,p_case_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare i record; d record; frozen record; body jsonb; part jsonb; differences jsonb; pair text[]; links jsonb:='{}';
begin
  if not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active) then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  for i in select * from public.action_case_items where org_id=p_org_id and (p_case_id is null or action_case_id=p_case_id) loop
    select c.body,c.revision into d from public.action_case_customer_contract_drafts c where org_id=p_org_id and action_case_id=i.action_case_id;
    select * into frozen from (
      select s.snapshot,s.version,s.id,s.created_at from public.action_case_contract_signing_documents s where s.org_id=p_org_id and s.action_case_id=i.action_case_id
        and (s.released_at is null or exists(select 1 from public.action_case_contract_signing_delivery x where x.document_id=s.id and x.signed_copy is not null))
        and public.contract_work_references(s.snapshot,i.id)
      union all select s.snapshot,s.version,null::uuid,s.published_at from public.action_case_customer_offers s where s.org_id=p_org_id and s.action_case_id=i.action_case_id
        and s.status in ('published','accepted') and public.contract_work_references(s.snapshot,i.id)
    ) f order by created_at desc limit 1;
    body:=coalesce(frozen.snapshot,d.body);
    if body is null or not public.contract_work_references(body,i.id) then continue; end if;
    part:=public.contract_work_part(body,i.id); differences:='[]';
    if part is not null then
      foreach pair slice 1 in array array[['title','title'],['scope','scope'],['scopeConditions','scope_conditions'],['scopeExclusions','scope_exclusions'],['scopeAdvice','scope_advice']] loop
        if btrim(coalesce(part->>pair[1],'')) is distinct from btrim(coalesce(to_jsonb(i)->>pair[2],'')) then differences:=differences||to_jsonb(pair[1]); end if;
      end loop;
    end if;
    links:=links||jsonb_build_object(i.id::text,jsonb_build_object('revision',coalesce(d.revision,0),'locked',frozen.snapshot is not null,
      'version',frozen.version,'documentId',frozen.id,'price',public.contract_work_price(body,i.id),'differences',differences));
  end loop;
  return jsonb_build_object('available',true,'links',links);
end $$;

create or replace function public.write_contract_work_price(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_item_id uuid,p_revision integer,p_price jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare d public.action_case_customer_contract_drafts%rowtype; body jsonb; price jsonb; rows jsonb; entry jsonb; key text; total bigint; missing boolean:=false; amount bigint;
begin
  if not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active) then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  perform 1 from public.action_cases where org_id=p_org_id and id=p_case_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  perform 1 from public.action_case_items where org_id=p_org_id and action_case_id=p_case_id and id=p_item_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if public.contract_work_locked(p_org_id,p_case_id,p_item_id) then raise exception 'ACTION_CASE_CONTRACT_LOCKED'; end if;
  select * into d from public.action_case_customer_contract_drafts where org_id=p_org_id and action_case_id=p_case_id for update;
  if d.revision is distinct from p_revision then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  price:=public.contract_work_price(d.body,p_item_id);
  if price->>'editable'<>'true' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_price is null or jsonb_typeof(p_price)<>'object' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach key in array array['amountOre','labourOre','materialOre'] loop
    if not p_price ? key then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_price->key<>'null'::jsonb then
      if jsonb_typeof(p_price->key)<>'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      if (p_price->>key)::numeric<>trunc((p_price->>key)::numeric) or (p_price->>key)::numeric not between 0 and 100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    end if;
  end loop;
  body:=d.body;
  if body->'contractPricing' is not null then
    select jsonb_agg(case when public.contract_work_ref(value,p_item_id) then value||case when price->>'split'='separate'
      then jsonb_build_object('labourOre',p_price->'labourOre','materialOre',p_price->'materialOre') else jsonb_build_object('amountOre',p_price->'amountOre') end else value end order by ord)
      into rows from jsonb_array_elements(body#>'{contractPricing,rows}') with ordinality a(value,ord);
    body:=jsonb_set(body,'{contractPricing,rows}',rows); total:=0;
    for entry in select value from jsonb_array_elements(rows) where body#>>'{contractPricing,mode}'<>'mixed' or value->>'kind'='fixed' loop
      amount:=case when price->>'split'='separate' then (entry->>'labourOre')::bigint+(entry->>'materialOre')::bigint else (entry->>'amountOre')::bigint end;
      missing:=missing or amount is null; total:=total+coalesce(amount,0);
    end loop;
  else
    select jsonb_agg(case when public.contract_work_ref(value,p_item_id) then value||jsonb_build_object('amountOre',p_price->'amountOre') else value end order by ord)
      into rows from jsonb_array_elements(body->'items') with ordinality a(value,ord);
    body:=jsonb_set(body,'{items}',rows);
    select sum((value->>'amountOre')::bigint),bool_or(value->'amountOre'='null'::jsonb) into total,missing from jsonb_array_elements(rows) where value->>'kind'='included';
  end if;
  body:=jsonb_set(body,'{baseAmountOre}',case when missing then 'null'::jsonb else coalesce(to_jsonb(total),'null'::jsonb) end);
  return public.write_customer_contract(p_org_id,p_case_id,p_user_id,'save',jsonb_build_object('revision',p_revision,'body',body));
end $$;

revoke all on function public.contract_work_ref(jsonb,uuid),public.contract_work_references(jsonb,uuid),public.contract_work_part(jsonb,uuid),public.contract_work_price(jsonb,uuid),
  public.contract_work_locked(uuid,uuid,uuid),public.guard_contract_work_mutation(),public.prepare_contract_work_titles(),public.sync_contract_work_from_draft(),public.sync_contract_work_from_item(),
  public.get_contract_work_links(uuid,uuid,uuid),public.write_contract_work_price(uuid,uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.contract_work_ref(jsonb,uuid),public.contract_work_references(jsonb,uuid),public.contract_work_part(jsonb,uuid),public.contract_work_price(jsonb,uuid),
  public.contract_work_locked(uuid,uuid,uuid),public.guard_contract_work_mutation(),public.prepare_contract_work_titles(),public.sync_contract_work_from_draft(),public.sync_contract_work_from_item(),
  public.get_contract_work_links(uuid,uuid,uuid),public.write_contract_work_price(uuid,uuid,uuid,uuid,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
