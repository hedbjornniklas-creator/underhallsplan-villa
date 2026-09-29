-- Non-binding customer planning, separate from immutable customer agreements.
-- Date: 2026-09-29
-- No existing drafts, prices or agreements are rewritten.
begin;
create table if not exists public.action_case_customer_planning (
  action_case_id uuid primary key references public.action_cases(id) on delete restrict,
  org_id uuid not null references public.organizations(id),
  revision integer not null default 0 check (revision >= 0),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  shared_items jsonb not null default '[]' check (jsonb_typeof(shared_items) = 'array'),
  participant_id uuid references public.action_case_participants(id) on delete restrict,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.action_case_customer_planning enable row level security;
revoke all on public.action_case_customer_planning from public, anon, authenticated;
grant all on public.action_case_customer_planning to service_role;

create or replace function public.write_customer_planning(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_operation text,p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  current_row public.action_case_customer_planning%rowtype;
  recipient uuid;
begin
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into current_row from public.action_case_customer_planning where action_case_id=p_case_id and org_id=p_org_id for update;
  if coalesce(current_row.revision,0) is distinct from (p_data->>'revision')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if p_operation is null or p_operation not in ('save','share','unshare') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_operation='save' then
    if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')>200 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    insert into public.action_case_customer_planning(action_case_id,org_id,revision,items,updated_by)
      values(p_case_id,p_org_id,1,p_data->'items',p_user_id)
      on conflict(action_case_id) do update set items=excluded.items,revision=action_case_customer_planning.revision+1,updated_by=p_user_id,updated_at=clock_timestamp();
  else
    if current_row.action_case_id is null then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_operation='share' then
      if p_data->>'confirmed' is distinct from 'true' or p_data->'items' is distinct from current_row.items then raise exception 'CUSTOMER_OFFER_CONFIRM'; end if;
      select id into recipient from public.action_case_participants where action_case_id=p_case_id and org_id=p_org_id and role='customer';
      if recipient is null then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
    end if;
    update public.action_case_customer_planning set
      shared_items=case when p_operation='share' then items else '[]'::jsonb end,
      participant_id=recipient,revision=revision+1,updated_by=p_user_id,updated_at=clock_timestamp()
      where action_case_id=p_case_id and org_id=p_org_id;
  end if;
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'customer_planning_'||p_operation,'Planerade tillval uppdaterade (inte beställning)',p_user_id);
end $$;
revoke all on function public.write_customer_planning(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.write_customer_planning(uuid,uuid,uuid,text,jsonb) to service_role;

-- Contract details are opt-in for existing drafts, mandatory once introduced.
-- The original standard contract remains an attachment, not rewritten boilerplate.
create or replace function public.assert_customer_contract(p_body jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare d jsonb; a jsonb; e jsonb; k text;
begin
  if not p_body ? 'contractDetails' then return; end if;
  d := p_body->'contractDetails'; a := d->'advice';
  if jsonb_typeof(d) is distinct from 'object' or d->'version' is distinct from '1'::jsonb
    or jsonb_typeof(d->'fields') is distinct from 'object' or jsonb_typeof(a) is distinct from 'object'
    or coalesce(a->>'status','') not in ('unreviewed','none','given') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach k in array array['work','reason','communicatedAt','customerResponse'] loop
    if jsonb_typeof(a->k) is distinct from 'string' or length(a->>k)>6000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  if a->>'communicatedAt'<>'' then
    begin
      if (a->>'communicatedAt') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((a->>'communicatedAt')::date,'YYYY-MM-DD') is distinct from a->>'communicatedAt' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    exception when others then raise exception 'CUSTOMER_OFFER_INVALID'; end;
  end if;
  if p_complete then
    if a->>'status'='unreviewed' then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    foreach k in array array['work','reason','communicatedAt','customerResponse'] loop
      if (a->>'status'='given' and btrim(a->>k)='') or (a->>'status'='none' and btrim(a->>k)<>'') then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    end loop;
  end if;
  foreach k in array array['parties','property','documents','controls','workEnvironment','customerWork','changes','delay','inspection','insurance','completionProtection','security'] loop
    e := d->'fields'->k;
    if jsonb_typeof(e) is distinct from 'object' or coalesce(e->>'status','') not in ('unreviewed','specified','document','not_applicable')
      or jsonb_typeof(e->'text') is distinct from 'string' or length(e->>'text')>6000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_complete and (e->>'status'='unreviewed' or btrim(e->>'text')='') then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
  end loop;
end $$;
revoke all on function public.assert_customer_contract(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.assert_customer_contract(jsonb,boolean) to service_role;

create or replace function public.guard_customer_contract() returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if tg_table_name='action_case_customer_offer_drafts' then
    if tg_op='UPDATE' and (old.body ? 'contractDetails') and not (new.body ? 'contractDetails') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    perform public.assert_customer_contract(new.body,false);
  else
    perform public.assert_customer_contract(new.snapshot,true);
  end if;
  return new;
end $$;
drop trigger if exists customer_offer_contract_draft on public.action_case_customer_offer_drafts;
create trigger customer_offer_contract_draft before insert or update of body on public.action_case_customer_offer_drafts
  for each row execute function public.guard_customer_contract();
drop trigger if exists customer_offer_contract_publication on public.action_case_customer_offers;
create trigger customer_offer_contract_publication before insert on public.action_case_customer_offers
  for each row execute function public.guard_customer_contract();
commit;
