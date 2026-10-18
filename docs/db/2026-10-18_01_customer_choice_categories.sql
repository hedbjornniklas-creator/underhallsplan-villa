-- Independent, non-binding selections. No agreement, offer or payment data is written.
-- Requires customer planning and internal costing migrations from 2026-09-29/10-01.
begin;

alter table public.action_case_customer_planning
  add column if not exists categories jsonb,
  add column if not exists shared_categories jsonb,
  add column if not exists shared_category_versions jsonb not null default '{}',
  add column if not exists shared_revision integer not null default 0;

create table if not exists public.action_case_customer_choices (
  org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id) on delete restrict,
  participant_id uuid not null references public.action_case_participants(id) on delete restrict,
  category_id uuid not null,
  category_version uuid not null,
  option_id uuid,
  revision integer not null check (revision > 0),
  selected_at timestamptz not null,
  primary key (action_case_id, participant_id, category_id)
);
create table if not exists public.action_case_customer_choice_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id) on delete restrict,
  participant_id uuid not null references public.action_case_participants(id) on delete restrict,
  category_id uuid not null,
  category_version uuid not null,
  option_id uuid,
  revision integer not null check (revision > 0),
  access_link_id uuid not null references public.action_case_access_links(id) on delete restrict,
  selected_at timestamptz not null,
  unique(action_case_id, participant_id, category_id, revision)
);
create index if not exists customer_choice_history_link_time on public.action_case_customer_choice_history(access_link_id,selected_at desc);
alter table public.action_case_customer_choices enable row level security;
alter table public.action_case_customer_choice_history enable row level security;
revoke all on public.action_case_customer_choices, public.action_case_customer_choice_history from public, anon, authenticated;
grant all on public.action_case_customer_choices, public.action_case_customer_choice_history to service_role;

create or replace function public.assert_customer_choice_categories(p_categories jsonb,p_items jsonb,p_complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare c jsonb; i jsonb; k text; seen text[] := '{}'; assigned text[] := '{}'; option_id text;
begin
  if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_categories)>200 or jsonb_array_length(p_items)>200
    or octet_length(p_categories::text)+octet_length(p_items::text)>4194304 then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
  for i in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(i) is distinct from 'object' or coalesce(i->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or exists(select 1 from jsonb_object_keys(i) x where x not in ('id','title','scope','status','budgetOre','decisionBy','optionGroup'))
      or coalesce(i->>'status','') not in ('planned','pricing','deferred','external') then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    foreach k in array array['title','scope','decisionBy'] loop
      if jsonb_typeof(i->k) is distinct from 'string' or length(i->>k)>(case k when 'title' then 250 when 'scope' then 12000 else 10 end) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    end loop;
    if i ? 'optionGroup' and (jsonb_typeof(i->'optionGroup') is distinct from 'string' or length(i->>'optionGroup')>100) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    if jsonb_typeof(i->'budgetOre') is distinct from 'null' then
      if jsonb_typeof(i->'budgetOre') is distinct from 'number' then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
      if (i->>'budgetOre')::numeric<0 or (i->>'budgetOre')::numeric>100000000000 or trunc((i->>'budgetOre')::numeric)<>(i->>'budgetOre')::numeric then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    end if;
    if not (i ? 'budgetOre') or (p_complete and (btrim(i->>'title')='' or btrim(i->>'scope')='')) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    if i->>'decisionBy'<>'' then
      begin
        if (i->>'decisionBy') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((i->>'decisionBy')::date,'YYYY-MM-DD')<>i->>'decisionBy' then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
      exception when others then raise exception 'CUSTOMER_CHOICE_INVALID'; end;
    end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
  for c in select value from jsonb_array_elements(p_categories) loop
    if jsonb_typeof(c) is distinct from 'object' or coalesce(c->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or c->>'id'=any(seen) or exists(select 1 from jsonb_object_keys(c) x where x not in ('id','title','specification','decisionBy','optionIds')) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    seen := array_append(seen,c->>'id');
    foreach k in array array['title','specification','decisionBy'] loop
      if jsonb_typeof(c->k) is distinct from 'string' or length(c->>k)>(case k when 'title' then 250 when 'specification' then 12000 else 10 end) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    end loop;
    if c->>'decisionBy'<>'' then
      begin
        if (c->>'decisionBy') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((c->>'decisionBy')::date,'YYYY-MM-DD')<>c->>'decisionBy' then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
      exception when others then raise exception 'CUSTOMER_CHOICE_INVALID'; end;
    end if;
    if jsonb_typeof(c->'optionIds') is distinct from 'array' or jsonb_array_length(c->'optionIds')>200 then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    if p_complete and (btrim(c->>'title')='' or jsonb_array_length(c->'optionIds')=0) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
    for i in select value from jsonb_array_elements(c->'optionIds') loop
      option_id := i #>> '{}';
      if jsonb_typeof(i)<>'string' or option_id=any(assigned) or not exists(select 1 from jsonb_array_elements(p_items) x where x->>'id'=option_id) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
      assigned := array_append(assigned,option_id);
    end loop;
  end loop;
  if cardinality(assigned)<>jsonb_array_length(p_items) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
end $$;

-- Legacy transfer from Offert may append rows, but cannot rewrite structured categories.
create or replace function public.append_customer_choice_categories(p_categories jsonb,p_old jsonb,p_items jsonb)
returns jsonb language plpgsql set search_path=public,pg_catalog as $$
declare result jsonb := p_categories; item jsonb; old_item jsonb; pos integer; group_name text;
begin
  for old_item in select value from jsonb_array_elements(p_old) loop
    if not exists(select 1 from jsonb_array_elements(p_items) i where i=old_item) then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_items) loop
    if exists(select 1 from jsonb_array_elements(p_old) i where i->>'id'=item->>'id') then continue; end if;
    group_name := nullif(btrim(item->>'optionGroup'),''); pos := null;
    if group_name is not null then
      select n::integer-1 into pos from jsonb_array_elements(result) with ordinality t(c,n)
        where c->>'title'=group_name limit 1;
    end if;
    if pos is null then result := result || jsonb_build_array(jsonb_build_object('id',item->>'id','title',coalesce(group_name,item->>'title'),'specification','','decisionBy',item->>'decisionBy','optionIds',jsonb_build_array(item->>'id')));
    else result := jsonb_set(result,array[pos::text,'optionIds'],(result->pos->'optionIds')||jsonb_build_array(item->>'id')); end if;
  end loop;
  perform public.assert_customer_choice_categories(result,p_items,false);
  return result;
end $$;

create or replace function public.guard_customer_choice_planning() returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if tg_op='UPDATE' and old.categories is not null and new.categories is null then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
  if new.categories is not null then perform public.assert_customer_choice_categories(new.categories,new.items,false); end if;
  if new.participant_id is null or new.shared_items='[]'::jsonb then
    new.shared_categories := null; new.shared_category_versions := '{}';
  end if;
  if new.shared_categories is not null then
    perform public.assert_customer_choice_categories(new.shared_categories,new.shared_items,true);
    if jsonb_typeof(new.shared_category_versions) is distinct from 'object' or exists(select 1 from jsonb_array_elements(new.shared_categories) c
      where coalesce(new.shared_category_versions->>(c->>'id'),'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
  end if;
  if tg_op='UPDATE' and (new.shared_items is distinct from old.shared_items or new.shared_categories is distinct from old.shared_categories
    or new.shared_category_versions is distinct from old.shared_category_versions or new.participant_id is distinct from old.participant_id) then
    new.shared_revision := old.shared_revision+1;
  end if;
  return new;
end $$;
drop trigger if exists customer_choice_planning_guard on public.action_case_customer_planning;
create trigger customer_choice_planning_guard before insert or update on public.action_case_customer_planning
  for each row execute function public.guard_customer_choice_planning();

create or replace function public.write_customer_planning(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_operation text,p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare current_row public.action_case_customer_planning%rowtype; recipient uuid; cats jsonb; versions jsonb := '{}'; c jsonb; old_options jsonb; new_options jsonb; version_id text;
begin
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into current_row from public.action_case_customer_planning where action_case_id=p_case_id and org_id=p_org_id for update;
  if coalesce(current_row.revision,0) is distinct from (p_data->>'revision')::integer then raise exception 'CUSTOMER_OFFER_STALE'; end if;
  if p_operation is null or p_operation not in ('save','share','unshare') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  cats := case when p_data ? 'categories' then p_data->'categories' else current_row.categories end;
  if p_operation<>'unshare' and cats is not null then
    if not (p_data ? 'categories') and p_data->'items' is distinct from current_row.items then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
    perform public.assert_customer_choice_categories(cats,p_data->'items',p_operation='share');
  end if;
  if p_operation='save' then
    if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')>200 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    insert into public.action_case_customer_planning(action_case_id,org_id,revision,items,categories,updated_by)
      values(p_case_id,p_org_id,1,p_data->'items',cats,p_user_id)
      on conflict(action_case_id) do update set items=excluded.items,categories=excluded.categories,
        revision=action_case_customer_planning.revision+1,updated_by=p_user_id,updated_at=clock_timestamp();
  else
    if current_row.action_case_id is null then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    if p_operation='share' then
      if cats is not null and current_row.categories is null then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
      if p_data->>'confirmed' is distinct from 'true' or p_data->'items' is distinct from current_row.items
        or (current_row.categories is not null and cats is distinct from current_row.categories) then raise exception 'CUSTOMER_OFFER_CONFIRM'; end if;
      if current_row.categories is not null and not (p_data ? 'categories') then raise exception 'CUSTOMER_CHOICE_SCHEMA'; end if;
      select id into recipient from public.action_case_participants where action_case_id=p_case_id and org_id=p_org_id and role='customer';
      if recipient is null then raise exception 'CUSTOMER_OFFER_RECIPIENT'; end if;
      if cats is not null then for c in select value from jsonb_array_elements(cats) loop
        version_id := null;
        select coalesce(jsonb_agg(i order by n),'[]') into old_options from jsonb_array_elements_text(c->'optionIds') with ordinality selected(option_id,n)
          join jsonb_array_elements(current_row.shared_items) i on i->>'id'=option_id;
        select coalesce(jsonb_agg(i order by n),'[]') into new_options from jsonb_array_elements_text(c->'optionIds') with ordinality selected(option_id,n)
          join jsonb_array_elements(current_row.items) i on i->>'id'=option_id;
        if current_row.participant_id=recipient and old_options=new_options and exists(select 1 from jsonb_array_elements(coalesce(current_row.shared_categories,'[]')) old_c where old_c=c) then
          version_id := current_row.shared_category_versions->>(c->>'id');
        end if;
        versions := versions || jsonb_build_object(c->>'id',coalesce(version_id,gen_random_uuid()::text));
      end loop; end if;
    end if;
    update public.action_case_customer_planning set
      categories=case when p_operation='share' then cats else categories end,
      shared_items=case when p_operation='share' then items else '[]'::jsonb end,
      shared_categories=case when p_operation='share' then cats else null end,
      shared_category_versions=versions,participant_id=recipient,revision=revision+1,updated_by=p_user_id,updated_at=clock_timestamp()
      where action_case_id=p_case_id and org_id=p_org_id;
  end if;
  insert into public.action_case_events(org_id,action_case_id,event_type,message,performed_by)
    values(p_org_id,p_case_id,'customer_planning_'||p_operation,'Planerade tillval uppdaterade (inte beställning)',p_user_id);
end $$;

create or replace function public.save_customer_planning_costing(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare current_row public.action_case_customer_planning%rowtype; data jsonb := p_data;
begin
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  select * into current_row from public.action_case_customer_planning where action_case_id=p_case_id and org_id=p_org_id for update;
  if jsonb_typeof(data->'costing') is distinct from 'object' or octet_length((data->'costing')::text)>1048576 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if current_row.categories is not null and not (data ? 'categories') then
    data := data || jsonb_build_object('categories',public.append_customer_choice_categories(current_row.categories,current_row.items,data->'items'));
  end if;
  perform public.write_customer_planning(p_org_id,p_case_id,p_user_id,'save',data);
  update public.action_case_customer_planning set internal_costing=data->'costing' where action_case_id=p_case_id and org_id=p_org_id;
end $$;

create or replace function public.customer_choices_snapshot(p_org_id uuid,p_case_id uuid,p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare p public.action_case_customer_planning%rowtype; chosen jsonb;
begin
  select * into p from public.action_case_customer_planning where org_id=p_org_id and action_case_id=p_case_id and participant_id=p_participant_id;
  if p.shared_categories is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('categoryId',c.category_id,'categoryVersion',c.category_version,'optionId',c.option_id,'revision',c.revision,'selectedAt',c.selected_at) order by c.category_id),'[]') into chosen
    from public.action_case_customer_choices c where c.org_id=p_org_id and c.action_case_id=p_case_id and c.participant_id=p_participant_id
      and exists(select 1 from jsonb_array_elements(p.shared_categories) cat where cat->>'id'=c.category_id::text);
  return jsonb_build_object('revision',p.shared_revision,'categories',p.shared_categories,'items',p.shared_items,'versions',p.shared_category_versions,'choices',chosen);
end $$;

create or replace function public.read_customer_choices(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare l public.action_case_access_links%rowtype;
begin
  select a.* into l from public.action_case_access_links a join public.action_case_participants c on c.id=a.participant_id and c.org_id=a.org_id and c.action_case_id=a.action_case_id and c.role='customer'
    where a.token_hash=p_token_hash and a.revoked_at is null and a.expires_at>clock_timestamp();
  if l.id is null then raise exception 'CUSTOMER_CHOICE_CLOSED'; end if;
  return public.customer_choices_snapshot(l.org_id,l.action_case_id,l.participant_id);
end $$;

create or replace function public.record_customer_choice(p_token_hash text,p_category_id uuid,p_category_version uuid,p_option_id uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare l public.action_case_access_links%rowtype; p public.action_case_customer_planning%rowtype; c jsonb;
  previous public.action_case_customer_choices%rowtype; stamp timestamptz; next_revision integer;
begin
  select * into l from public.action_case_access_links where token_hash=p_token_hash;
  if l.id is null then raise exception 'CUSTOMER_CHOICE_CLOSED'; end if;
  perform 1 from public.action_cases where id=l.action_case_id and org_id=l.org_id for update;
  select a.* into l from public.action_case_access_links a join public.action_case_participants customer on customer.id=a.participant_id and customer.org_id=a.org_id and customer.action_case_id=a.action_case_id and customer.role='customer'
    where a.token_hash=p_token_hash and a.revoked_at is null and a.expires_at>clock_timestamp() for share of a;
  if l.id is null then raise exception 'CUSTOMER_CHOICE_CLOSED'; end if;
  select * into p from public.action_case_customer_planning where org_id=l.org_id and action_case_id=l.action_case_id and participant_id=l.participant_id for update;
  if p.shared_categories is null then raise exception 'CUSTOMER_CHOICE_NOT_SHARED'; end if;
  select value into c from jsonb_array_elements(p.shared_categories) where value->>'id'=p_category_id::text;
  if c is null or p.shared_category_versions->>(p_category_id::text) is distinct from p_category_version::text then raise exception 'CUSTOMER_CHOICE_STALE'; end if;
  if p_option_id is not null and not (c->'optionIds' ? p_option_id::text) then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
  if p_revision is null or p_revision<0 then raise exception 'CUSTOMER_CHOICE_INVALID'; end if;
  select * into previous from public.action_case_customer_choices where org_id=l.org_id and action_case_id=l.action_case_id and participant_id=l.participant_id and category_id=p_category_id for update;
  if previous.category_version=p_category_version and previous.option_id is not distinct from p_option_id then return public.customer_choices_snapshot(l.org_id,l.action_case_id,l.participant_id); end if;
  if coalesce(previous.revision,0)<>p_revision then raise exception 'CUSTOMER_CHOICE_STALE'; end if;
  if (select count(*) from public.action_case_customer_choice_history where access_link_id=l.id and selected_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'CUSTOMER_CHOICE_RATE_LIMIT'; end if;
  stamp := clock_timestamp(); next_revision := coalesce(previous.revision,0)+1;
  insert into public.action_case_customer_choices(org_id,action_case_id,participant_id,category_id,category_version,option_id,revision,selected_at)
    values(l.org_id,l.action_case_id,l.participant_id,p_category_id,p_category_version,p_option_id,next_revision,stamp)
    on conflict(action_case_id,participant_id,category_id) do update set category_version=excluded.category_version,option_id=excluded.option_id,revision=excluded.revision,selected_at=excluded.selected_at;
  insert into public.action_case_customer_choice_history(org_id,action_case_id,participant_id,category_id,category_version,option_id,revision,access_link_id,selected_at)
    values(l.org_id,l.action_case_id,l.participant_id,p_category_id,p_category_version,p_option_id,next_revision,l.id,stamp);
  return public.customer_choices_snapshot(l.org_id,l.action_case_id,l.participant_id);
end $$;

revoke all on function public.assert_customer_choice_categories(jsonb,jsonb,boolean), public.append_customer_choice_categories(jsonb,jsonb,jsonb), public.guard_customer_choice_planning(),
  public.customer_choices_snapshot(uuid,uuid,uuid), public.read_customer_choices(text), public.record_customer_choice(text,uuid,uuid,uuid,integer),
  public.write_customer_planning(uuid,uuid,uuid,text,jsonb), public.save_customer_planning_costing(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.assert_customer_choice_categories(jsonb,jsonb,boolean), public.append_customer_choice_categories(jsonb,jsonb,jsonb),
  public.customer_choices_snapshot(uuid,uuid,uuid), public.read_customer_choices(text), public.record_customer_choice(text,uuid,uuid,uuid,integer),
  public.write_customer_planning(uuid,uuid,uuid,text,jsonb), public.save_customer_planning_costing(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
