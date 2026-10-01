-- Gizmo: sign the main agreement separately from later choices.
-- Requires customer offer migrations 2026-09-29_01 through _04.
-- No existing draft, shared plan or published agreement is rewritten here.
begin;

alter table public.action_case_customer_planning
  add column if not exists internal_costing jsonb not null default '{}'
  check (jsonb_typeof(internal_costing) = 'object');

create or replace function public.save_customer_planning_costing(
  p_org_id uuid, p_case_id uuid, p_user_id uuid, p_data jsonb
) returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if jsonb_typeof(p_data->'costing') is distinct from 'object'
    or octet_length((p_data->'costing')::text)>1048576 then
    raise exception 'CUSTOMER_OFFER_INVALID';
  end if;
  perform public.write_customer_planning(p_org_id,p_case_id,p_user_id,'save',p_data);
  update public.action_case_customer_planning set internal_costing=p_data->'costing'
    where action_case_id=p_case_id and org_id=p_org_id;
end $$;

-- Explicit, atomic move. Shared copies and previously issued documents stay intact.
create or replace function public.separate_customer_choices(
  p_org_id uuid, p_case_id uuid, p_user_id uuid, p_revision integer, p_planning_revision integer
) returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  d public.action_case_customer_offer_drafts%rowtype;
  p public.action_case_customer_planning%rowtype;
  choices jsonb; remaining jsonb; costs jsonb; remaining_costs jsonb;
begin
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into d from public.action_case_customer_offer_drafts
    where action_case_id=p_case_id and org_id=p_org_id for update;
  select * into p from public.action_case_customer_planning
    where action_case_id=p_case_id and org_id=p_org_id for update;
  if d.revision is distinct from p_revision or d.action_case_id is null
    or coalesce(p.revision,0) is distinct from p_planning_revision then
    raise exception 'CUSTOMER_OFFER_STALE';
  end if;
  if exists(select 1 from public.action_case_customer_offers
    where action_case_id=p_case_id and org_id=p_org_id and status in ('published','accepted')) then
    raise exception 'CUSTOMER_OFFER_WITHDRAW_FIRST';
  end if;
  if exists(select 1 from jsonb_array_elements(d.body->'items') i
    join jsonb_array_elements(coalesce(p.items,'[]')) j on i->>'id'=j->>'id'
    where i->>'kind'='option') then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i->>'id','title',i->>'title','scope',i->>'scope','status','planned',
    'budgetOre',i->'amountOre','decisionBy','','optionGroup',coalesce(i->>'optionGroup','')
  ) order by n),'[]') into choices
    from jsonb_array_elements(d.body->'items') with ordinality a(i,n) where i->>'kind'='option';
  if jsonb_array_length(choices)=0 then return; end if;
  select coalesce(jsonb_agg(i order by n),'[]') into remaining
    from jsonb_array_elements(d.body->'items') with ordinality a(i,n) where i->>'kind'<>'option';
  select coalesce(jsonb_object_agg(key,value),'{}') into costs from jsonb_each(d.internal_costing)
    where exists(select 1 from jsonb_array_elements(choices) i where i->>'id'=key);
  select coalesce(jsonb_object_agg(key,value),'{}') into remaining_costs from jsonb_each(d.internal_costing)
    where exists(select 1 from jsonb_array_elements(remaining) i where i->>'id'=key);
  perform public.save_customer_offer_costing(p_org_id,p_case_id,p_user_id,
    jsonb_build_object('revision',p_revision,'body',jsonb_set(d.body,'{items}',remaining),'costing',remaining_costs));
  perform public.save_customer_planning_costing(p_org_id,p_case_id,p_user_id,
    jsonb_build_object('revision',p_planning_revision,'items',coalesce(p.items,'[]')||choices,
      'costing',coalesce(p.internal_costing,'{}')||costs));
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'customer_choices_separated','Val flyttade från avtalsutkast till separat planering',p_user_id);
end $$;

-- New publications cannot bundle optional choices into main-contract signing.
-- Old published/accepted snapshots and their original approval rules are preserved.
create or replace function public.guard_customer_base_agreement()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if exists(select 1 from jsonb_array_elements(new.snapshot->'items') i where i->>'kind'='option') then
    raise exception 'CUSTOMER_OFFER_SEPARATE_CHOICES';
  end if;
  return new;
end $$;
drop trigger if exists customer_offer_base_publication on public.action_case_customer_offers;
create trigger customer_offer_base_publication before insert on public.action_case_customer_offers
  for each row execute function public.guard_customer_base_agreement();

revoke all on function public.save_customer_planning_costing(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.separate_customer_choices(uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.save_customer_planning_costing(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.separate_customer_choices(uuid,uuid,uuid,integer,integer) to service_role;
notify pgrst, 'reload schema';
commit;
