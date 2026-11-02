-- Run after 2026-10-29_01_contract_work_link.sql.
-- Shared work text only: no backfill, price synchronization or document changes.
begin;

create or replace function public.prepare_offer_work_scope() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare i record; part jsonb; prior jsonb; pair text[]; parts jsonb; previous_body jsonb;
begin
  perform 1 from public.action_cases where id=new.action_case_id and org_id=new.org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  -- The existing writer uses INSERT ON CONFLICT, which runs INSERT triggers
  -- even for an existing offer. Compare with that row before checking locks.
  if tg_op='UPDATE' then previous_body:=old.body;
  else select body into previous_body from public.action_case_customer_offer_drafts where org_id=new.org_id and action_case_id=new.action_case_id; end if;
  for i in select * from public.action_case_items where org_id=new.org_id and action_case_id=new.action_case_id order by id loop
    part:=public.contract_work_part(new.body,i.id);
    if part is null then continue; end if;
    prior:=public.contract_work_part(previous_body,i.id);
    -- A first import from an older client must not erase optional source text
    -- merely because that client did not send the field.
    if prior is null then
      foreach pair slice 1 in array array[['scopeConditions','scope_conditions'],['scopeExclusions','scope_exclusions'],['scopeAdvice','scope_advice']] loop
        if not part ? pair[1] then part:=part||jsonb_build_object(pair[1],coalesce(to_jsonb(i)->>pair[2],'')); end if;
      end loop;
    else
      foreach pair slice 1 in array array[['scopeConditions','scope_conditions'],['scopeExclusions','scope_exclusions'],['scopeAdvice','scope_advice']] loop
        if not part ? pair[1] and prior ? pair[1] then part:=part||jsonb_build_object(pair[1],prior->pair[1]); end if;
      end loop;
    end if;
    if public.contract_work_locked(new.org_id,new.action_case_id,i.id) then
      foreach pair slice 1 in array array[['title','title'],['scope','scope'],['scopeConditions','scope_conditions'],['scopeExclusions','scope_exclusions'],['scopeAdvice','scope_advice']] loop
        if (prior is null or coalesce(part->>pair[1],'') is distinct from coalesce(prior->>pair[1],''))
          and coalesce(part->>pair[1],'') is distinct from coalesce(to_jsonb(i)->>pair[2],'') then
          raise exception 'ACTION_CASE_CONTRACT_LOCKED';
        end if;
      end loop;
    end if;
    select jsonb_agg(case when value->>'kind'<>'option' and public.contract_work_ref(value,i.id) then part else value end order by ord)
      into parts from jsonb_array_elements(new.body->'items') with ordinality a(value,ord);
    new.body:=jsonb_set(new.body,'{items}',parts);
  end loop;
  return new;
end $$;

create or replace function public.sync_offer_work_to_item() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare i record; part jsonb; prior jsonb; patch jsonb; pair text[];
begin
  for i in select * from public.action_case_items where org_id=new.org_id and action_case_id=new.action_case_id order by id loop
    part:=public.contract_work_part(new.body,i.id);
    if part is null then continue; end if;
    prior:=case when tg_op='UPDATE' then public.contract_work_part(old.body,i.id) end;
    patch:=to_jsonb(i);
    foreach pair slice 1 in array array[['title','title'],['scope','scope'],['scopeConditions','scope_conditions'],['scopeExclusions','scope_exclusions'],['scopeAdvice','scope_advice']] loop
      if part ? pair[1] and (prior is null or not prior ? pair[1] or coalesce(part->>pair[1],'') is distinct from coalesce(prior->>pair[1],'')) then
        patch:=jsonb_set(patch,array[pair[2]],to_jsonb(coalesce(part->>pair[1],'')));
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

create or replace function public.sync_offer_work_from_item() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare d public.action_case_customer_offer_drafts%rowtype; v_body jsonb; parts jsonb; prices jsonb;
  part jsonb; patch jsonb:='{}'; pair text[]; key text; changed boolean:=false;
begin
  foreach pair slice 1 in array array[['title','title'],['scope','scope'],['scopeConditions','scope_conditions'],['scopeExclusions','scope_exclusions'],['scopeAdvice','scope_advice']] loop
    if coalesce(to_jsonb(new)->>pair[2],'') is distinct from coalesce(to_jsonb(old)->>pair[2],'') then
      patch:=patch||jsonb_build_object(pair[1],coalesce(to_jsonb(new)->>pair[2],''));
    end if;
  end loop;
  if patch='{}'::jsonb then return new; end if;
  select * into d from public.action_case_customer_offer_drafts
    where org_id=new.org_id and action_case_id=new.action_case_id for update;
  if not found then return new; end if;
  part:=public.contract_work_part(d.body,new.id);
  if part is null then return new; end if;
  for key in select jsonb_object_keys(patch) loop
    if coalesce(part->>key,'') is distinct from coalesce(patch->>key,'') then changed:=true; exit; end if;
  end loop;
  -- A write originating in this offer already has the new text. Do not echo
  -- that update back into its row or advance its revision a second time.
  if not changed then return new; end if;
  v_body:=d.body;
  select jsonb_agg(case when value->>'kind'<>'option' and public.contract_work_ref(value,new.id) then value||patch else value end order by ord)
    into parts from jsonb_array_elements(v_body->'items') with ordinality a(value,ord);
  v_body:=jsonb_set(v_body,'{items}',parts);
  if patch ? 'title' and jsonb_typeof(v_body#>'{contractPricing,rows}')='array' then
    select coalesce(jsonb_agg(case when public.contract_work_ref(value,new.id) then value||jsonb_build_object('title',new.title) else value end order by ord),'[]'::jsonb)
      into prices from jsonb_array_elements(v_body#>'{contractPricing,rows}') with ordinality a(value,ord);
    v_body:=jsonb_set(v_body,'{contractPricing,rows}',prices);
  end if;
  update public.action_case_customer_offer_drafts set body=v_body,revision=revision+1,updated_by=new.updated_by,updated_at=clock_timestamp()
    where org_id=new.org_id and action_case_id=new.action_case_id;
  return new;
end $$;

drop trigger if exists aa_offer_work_scope on public.action_case_customer_offer_drafts;
create trigger aa_offer_work_scope before insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.prepare_offer_work_scope();
drop trigger if exists zz_offer_work_scope on public.action_case_customer_offer_drafts;
create trigger zz_offer_work_scope after insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.sync_offer_work_to_item();
drop trigger if exists zzz_offer_work_scope on public.action_case_items;
create trigger zzz_offer_work_scope after update on public.action_case_items
  for each row execute function public.sync_offer_work_from_item();

revoke all on function public.prepare_offer_work_scope(),public.sync_offer_work_from_item(),public.sync_offer_work_to_item() from public,anon,authenticated;
grant execute on function public.prepare_offer_work_scope(),public.sync_offer_work_from_item(),public.sync_offer_work_to_item() to service_role;
commit;
