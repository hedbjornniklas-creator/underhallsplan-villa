-- Shared CUSTOMER terms per project moment. Internal calculation is not a source.
-- Requires contract/work + offer/work scope links and 2026-11-03_01 budget.
-- No backfill; adoption is explicit. Frozen snapshots are never updated.
begin;

create table if not exists public.action_case_customer_prices (
  org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id) on delete cascade,
  item_id uuid primary key references public.action_case_items(id) on delete cascade,
  revision integer not null check(revision>0), terms jsonb not null,
  updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create table if not exists public.action_case_customer_price_requests (
  org_id uuid not null references public.organizations(id), request_id uuid not null,
  request jsonb not null, response jsonb not null, primary key(org_id,request_id)
);
create index if not exists action_case_customer_prices_project_idx on public.action_case_customer_prices(org_id,action_case_id);
alter table public.action_case_customer_prices enable row level security;
alter table public.action_case_customer_price_requests enable row level security;
revoke all on public.action_case_customer_prices, public.action_case_customer_price_requests from public,anon,authenticated;
grant all on public.action_case_customer_prices, public.action_case_customer_price_requests to service_role;

create or replace function public.customer_price_parts(t jsonb)
returns table(part text, label text, charge jsonb) language sql immutable set search_path=public,pg_catalog as $$
  select k, l, t->k from (values ('combined',''),('labour','Arbete'),('material','Material')) p(k,l)
  where (t->>'split'='combined' and k='combined') or (t->>'split'='separate' and k<>'combined')
$$;
create or replace function public.assert_project_customer_price(t jsonb, complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare c jsonb; k text; n numeric; p record;
begin
  if jsonb_typeof(t) is distinct from 'object' or t->'version' is distinct from '1'::jsonb
    or coalesce(t->>'split','') not in ('combined','separate') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach k in array array['assumptions','reviewTerms'] loop
    if jsonb_typeof(t->k) is distinct from 'string' or length(t->>k)>6000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  for c in select t->key from unnest(array['combined','labour','material']) key loop
    if jsonb_typeof(c) is distinct from 'object' or coalesce(c->>'mode','') not in ('fixed','running','budget') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    foreach k in array array['fixedOre','budgetOre','hourlyOre','markupPercent'] loop
      if not c ? k then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      if c->k<>'null'::jsonb then
        if jsonb_typeof(c->k) is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
        n:=(c->>k)::numeric;
        if n<0 or (k='markupPercent' and (n>1000 or n*100<>trunc(n*100)))
          or (k<>'markupPercent' and (n>100000000000 or n<>trunc(n))) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      end if;
    end loop;
  end loop;
  foreach k in array array['fixedOre','budgetOre'] loop
    if (select sum(coalesce((charge->>k)::numeric,0)) from public.customer_price_parts(t))>100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  if complete then
    for p in select * from public.customer_price_parts(t) loop
      c:=p.charge;
      if (c->>'mode'='fixed' and c->'fixedOre'='null'::jsonb)
        or (c->>'mode'<>'fixed' and p.part<>'material' and coalesce((c->>'hourlyOre')::bigint,0)<=0)
        or (c->>'mode'<>'fixed' and p.part<>'labour' and c->'markupPercent'='null'::jsonb)
        or (c->>'mode'='budget' and (c->'budgetOre'='null'::jsonb or nullif(btrim(t->>'assumptions'),'') is null or nullif(btrim(t->>'reviewTerms'),'') is null))
        then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    end loop;
  end if;
end $$;

-- An adapter for the established document validator. Only active customer
-- components are expanded; this representation is never persisted or frozen.
create or replace function public.project_price_validation_body(b jsonb)
returns jsonb language plpgsql set search_path=public,pg_catalog as $$
declare p jsonb:=b->'contractPricing'; r jsonb; q record; rows jsonb:='[]'; id text; total bigint:=0; missing boolean:=false; fixed integer:=0; running integer:=0;
begin
  for r in select value from jsonb_array_elements(p->'rows') loop
    if r ? 'projectPricing' then
      if not r ? 'sourceItemId' or jsonb_typeof(r#>'{projectPricing,revision}') is distinct from 'number'
        or (r#>>'{projectPricing,revision}')::numeric<1 or (r#>>'{projectPricing,revision}')::numeric<>trunc((r#>>'{projectPricing,revision}')::numeric) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      perform public.assert_project_customer_price(r#>'{projectPricing,terms}',false);
      for q in select * from public.customer_price_parts(r#>'{projectPricing,terms}') loop
        id:=md5((r->>'id')||':'||q.part)::uuid::text;
        rows:=rows||jsonb_build_array(jsonb_build_object('id',id,'title',left(r->>'title',230)||case when q.label='' then '' else ' - '||q.label end,
          'kind',case when q.charge->>'mode'='fixed' then 'fixed' else 'running' end,
          'amountOre',case when q.charge->>'mode'='fixed' then q.charge->'fixedOre' else 'null'::jsonb end,'labourOre',null,'materialOre',null));
      end loop;
    else rows:=rows||jsonb_build_array(r); end if;
  end loop;
  for r in select value from jsonb_array_elements(rows) loop
    if r->>'kind'='fixed' then fixed:=fixed+1; total:=total+coalesce((r->>'amountOre')::bigint,0); missing:=missing or r->'amountOre'='null'::jsonb;
    else running:=running+1; end if;
  end loop;
  p:=p||jsonb_build_object('rows',rows,'mode',case when fixed=0 then 'running' when running=0 then 'fixed' else 'mixed' end,
    'basis','rows','split','combined','totalOre',null,'labourOre',null,'materialOre',null);
  -- The original legacy budget has already been validated on the stored rows.
  p:=p-'budget';
  return b||jsonb_build_object('contractPricing',p,'baseAmountOre',case when fixed=0 or missing then null else total end,'pricingMode','total');
end $$;

do $migration$
begin
  if to_regprocedure('public.assert_contract_pricing_before_project(jsonb,boolean)') is null then
    alter function public.assert_contract_pricing(jsonb,boolean) rename to assert_contract_pricing_before_project;
  end if;
end $migration$;
create or replace function public.assert_contract_pricing(p_body jsonb,p_complete boolean default false)
returns bigint language plpgsql set search_path=public,pg_catalog as $$
declare p jsonb:=p_body->'contractPricing'; r jsonb; v jsonb; base bigint; ids text[]:='{}'; sources text[]:='{}'; budget_total numeric:=0;
begin
  if not exists(select 1 from jsonb_array_elements(p->'rows') x where x ? 'projectPricing') then return public.assert_contract_pricing_before_project(p_body,p_complete); end if;
  if p->>'basis'<>'rows' or p->>'split'<>'combined' or jsonb_array_length(p->'rows')>200 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  perform public.assert_contract_budget(p_body,false);
  -- Validate the persisted identity and inactive money fields before expanding.
  for r in select value from jsonb_array_elements(p->'rows') loop
    if coalesce(r->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or lower(r->>'id')=any(ids) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    ids:=array_append(ids,lower(r->>'id'));
    perform public.assert_contract_pricing_before_project(p_body||jsonb_build_object('contractPricing',
      (p-'budget')||jsonb_build_object('mode',r->'kind','rows',jsonb_build_array(r-'projectPricing')),
      'baseAmountOre',case when r->>'kind'='fixed' then r->'amountOre' else 'null'::jsonb end),false);
    if r ? 'sourceItemId' then
      if coalesce(r->>'sourceItemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or lower(r->>'sourceItemId')=any(sources) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      sources:=array_append(sources,lower(r->>'sourceItemId'));
    end if;
    if r ? 'projectPricing' then
      perform public.assert_project_customer_price(r#>'{projectPricing,terms}',p_complete);
      budget_total:=budget_total+coalesce((select sum((charge->>'budgetOre')::numeric) from public.customer_price_parts(r#>'{projectPricing,terms}') where charge->>'mode'='budget'),0);
      if exists(select 1 from public.customer_price_parts(r#>'{projectPricing,terms}') where charge->>'mode'='budget') and p#>'{running,approximateOre}'<>'null'::jsonb then raise exception 'PROJECT_PRICE_APPROXIMATE'; end if;
    end if;
  end loop;
  budget_total:=budget_total+coalesce((select sum((x->>'amountOre')::numeric) from jsonb_array_elements(coalesce(p#>'{budget,rows}','[]')) x
    where exists(select 1 from jsonb_array_elements(p->'rows') budget_price(value) where budget_price.value->'id'=x->'id' and budget_price.value->>'kind'='running')),0);
  if budget_total>100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  v:=public.project_price_validation_body(p_body);
  -- The adapter can have two rows per moment (at most 400). Validate in chunks,
  -- then validate the aggregate separately rather than raising the persisted cap.
  if jsonb_array_length(v#>'{contractPricing,rows}')>200 then
    for r in select value from jsonb_array_elements(v#>'{contractPricing,rows}') loop
      perform public.assert_contract_pricing_before_project(jsonb_set(jsonb_set(v,'{contractPricing,rows}',jsonb_build_array(r)),'{baseAmountOre}',case when r->>'kind'='fixed' then r->'amountOre' else 'null'::jsonb end),false);
    end loop;
    base:=(v->>'baseAmountOre')::bigint;
    if base>100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  else base:=public.assert_contract_pricing_before_project(v,false); end if;
  if p->>'mode' is distinct from v#>>'{contractPricing,mode}' or p_body->'baseAmountOre' is distinct from v->'baseAmountOre' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  if p_complete then
    if not exists(select 1 from jsonb_array_elements(p_body->'items') i where i->>'kind'='included')
      or exists(select 1 from jsonb_array_elements(p_body->'items') i where i->>'kind'='option')
      or (p->>'mode'<>'running' and base is null)
      or exists(select 1 from jsonb_array_elements(p->'rows') x where nullif(btrim(x->>'title'),'') is null)
      then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    if exists(select 1 from jsonb_array_elements(p->'rows') x where not x ? 'projectPricing' and x->>'kind'='running') then
      if coalesce((p#>>'{running,hourlyOre}')::bigint,0)<=0 or p#>'{running,markupPercent}'='null'::jsonb
        or (p#>>'{running,managementOre}')::bigint<=0 or (p#>>'{running,approximateOre}')::bigint<=0 then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
      perform public.assert_contract_budget(jsonb_set(p_body,'{contractPricing,rows}',
        coalesce((select jsonb_agg(x) from jsonb_array_elements(p->'rows') x where not x ? 'projectPricing'),'[]')),true);
    end if;
  end if;
  return base;
end $$;

create or replace function public.project_price_document(b jsonb, org uuid, project uuid)
returns jsonb language plpgsql set search_path=public,pg_catalog as $$
declare p jsonb:=b->'contractPricing'; rows jsonb:='[]'; r jsonb; cp public.action_case_customer_prices%rowtype; t jsonb; amount bigint; active boolean:=false; view_body jsonb;
begin
  if not exists(select 1 from public.action_case_customer_prices c where c.org_id=org and c.action_case_id=project
    and (public.contract_work_references(b,c.item_id))) then return b; end if;
  if p is null then
    if b->>'pricingMode'<>'itemized' and b->'baseAmountOre'<>'null'::jsonb then raise exception 'PROJECT_PRICE_MANUAL_TOTAL'; end if;
    p:=jsonb_build_object('version',1,'mode','fixed','display',case when b->>'pricingMode'='itemized' then 'priced' else 'unpriced' end,'split','combined','basis','rows',
      'rows',coalesce((select jsonb_agg(jsonb_build_object('id',x->'id','sourceItemId',coalesce(x->'sourceItemId',x->'id'),'title',x->'title','kind','fixed','amountOre',x->'amountOre','labourOre',null,'materialOre',null)) from jsonb_array_elements(b->'items') x where x->>'kind'='included'),'[]'),
      'totalOre',null,'labourOre',null,'materialOre',null,'running',jsonb_build_object('hourlyOre',null,'managementOre',null,'markupPercent',null,'approximateOre',null));
  end if;
  if p->>'basis'='total' and p->>'mode'<>'running' then raise exception 'PROJECT_PRICE_MANUAL_TOTAL'; end if;
  -- Included scope creates the link, not a title match or an internal calculation.
  for r in select value from jsonb_array_elements(p->'rows') loop
    select * into cp from public.action_case_customer_prices c where c.org_id=org and c.action_case_id=project and c.item_id::text=lower(coalesce(r->>'sourceItemId',r->>'id'));
    if found then
      t:=jsonb_build_object('revision',cp.revision,'terms',cp.terms);
      amount:=(select case when count(*) filter(where charge->>'mode'='fixed')=count(*) and count(*) filter(where charge->'fixedOre'='null'::jsonb)=0 then sum((charge->>'fixedOre')::bigint) else null end from public.customer_price_parts(cp.terms));
      r:=r||jsonb_build_object('sourceItemId',cp.item_id,'projectPricing',t,'amountOre',amount,'labourOre',null,'materialOre',null,
        'kind',case when exists(select 1 from public.customer_price_parts(cp.terms) where charge->>'mode'<>'fixed') then 'running' else 'fixed' end);
      active:=true;
    else
      amount:=case when p->>'split'='combined' then (r->>'amountOre')::bigint else (r->>'labourOre')::bigint+(r->>'materialOre')::bigint end;
      r:=r||jsonb_build_object('amountOre',amount,'labourOre',null,'materialOre',null,'kind',case when p->>'mode'='running' then 'running' when p->>'mode'='fixed' then 'fixed' else r->>'kind' end);
    end if;
    rows:=rows||jsonb_build_array(r);
  end loop;
  for r in select value from jsonb_array_elements(b->'items') where value->>'kind'='included' loop
    select * into cp from public.action_case_customer_prices c where c.org_id=org and c.action_case_id=project and c.item_id::text=lower(coalesce(r->>'sourceItemId',r->>'id'));
    if found and not exists(select 1 from jsonb_array_elements(rows) x where public.contract_work_ref(x,cp.item_id)) then
      rows:=rows||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'sourceItemId',cp.item_id,'title',r->'title','kind','running','amountOre',null,'labourOre',null,'materialOre',null,'projectPricing',jsonb_build_object('revision',cp.revision,'terms',cp.terms)));
      active:=true;
    end if;
  end loop;
  if not active then return b; end if;
  p:=p||jsonb_build_object('rows',rows,'basis','rows','split','combined','totalOre',null,'labourOre',null,'materialOre',null);
  if p ? 'budget' and p->'budget'<>'null'::jsonb then
    p:=jsonb_set(p,'{budget,rows}',coalesce((select jsonb_agg(x) from jsonb_array_elements(p#>'{budget,rows}') x where not exists(select 1 from jsonb_array_elements(rows) linked_price(value) where linked_price.value->'id'=x->'id' and linked_price.value ? 'projectPricing')),'[]'));
    if jsonb_array_length(p#>'{budget,rows}')=0 then p:=p||jsonb_build_object('budget',null); end if;
  end if;
  view_body:=public.project_price_validation_body(b||jsonb_build_object('contractPricing',p));
  if view_body#>>'{contractPricing,mode}'<>'fixed' and b->'offerHourEstimate' is not null and b->'offerHourEstimate'<>'null'::jsonb
    and (b#>'{offerHourEstimate,minHours}'<>'null'::jsonb or b#>'{offerHourEstimate,maxHours}'<>'null'::jsonb) then raise exception 'PROJECT_PRICE_HOURS'; end if;
  p:=p||jsonb_build_object('mode',view_body#>'{contractPricing,mode}');
  return b||jsonb_build_object('contractPricing',p,'pricingMode','total','baseAmountOre',view_body->'baseAmountOre');
end $$;

create or replace function public.guard_project_price_document()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare r jsonb; cp public.action_case_customer_prices%rowtype; previous jsonb;
begin
  -- Serialise document writes with price adoption and signing.
  perform 1 from public.action_cases where org_id=new.org_id and id=new.action_case_id for update;
  for r in select value from jsonb_array_elements(coalesce(new.body#>'{contractPricing,rows}','[]')) loop
    if r ? 'projectPricing' then
      select * into cp from public.action_case_customer_prices c where c.org_id=new.org_id and c.action_case_id=new.action_case_id and c.item_id::text=lower(r->>'sourceItemId');
      if not found or r->'projectPricing'<>jsonb_build_object('revision',cp.revision,'terms',cp.terms) then raise exception 'PROJECT_PRICE_STALE'; end if;
    end if;
  end loop;
  if tg_op='UPDATE' then previous:=old.body;
  elsif tg_table_name='action_case_customer_offer_drafts' then select body into previous from public.action_case_customer_offer_drafts where org_id=new.org_id and action_case_id=new.action_case_id;
  else select body into previous from public.action_case_customer_contract_drafts where org_id=new.org_id and action_case_id=new.action_case_id; end if;
  if previous is not null then
    for r in select value from jsonb_array_elements(coalesce(previous#>'{contractPricing,rows}','[]')) where value ? 'projectPricing' loop
      if exists(select 1 from jsonb_array_elements(coalesce(new.body#>'{contractPricing,rows}','[]')) x where x->'id'=r->'id' and not x ? 'projectPricing') then raise exception 'PROJECT_PRICE_READ_ONLY'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(new.body#>'{contractPricing,rows}','[]')) x where x->'id'=r->'id' and x->'projectPricing'=r->'projectPricing'
        and (x-array['title','projectPricing'])<>(r-array['title','projectPricing'])) then raise exception 'PROJECT_PRICE_READ_ONLY'; end if;
    end loop;
  end if;
  new.body:=public.project_price_document(new.body,new.org_id,new.action_case_id);
  return new;
end $$;
drop trigger if exists ab_project_price on public.action_case_customer_offer_drafts;
create trigger ab_project_price before insert or update of body on public.action_case_customer_offer_drafts for each row execute function public.guard_project_price_document();
drop trigger if exists ab_project_price on public.action_case_customer_contract_drafts;
create trigger ab_project_price before insert or update of body on public.action_case_customer_contract_drafts for each row execute function public.guard_project_price_document();

create or replace function public.legacy_project_price(b jsonb, item uuid)
returns jsonb language plpgsql set search_path=public,pg_catalog as $$
declare p jsonb:=b->'contractPricing'; r jsonb; t jsonb; c jsonb; k text; m text;
begin
  if p is null or p->>'basis'<>'rows' then return null; end if;
  select value into r from jsonb_array_elements(p->'rows') where public.contract_work_ref(value,item);
  if r is null or r ? 'projectPricing' then return null; end if;
  t:=jsonb_build_object('version',1,'split',p->'split','assumptions',coalesce(p#>>'{budget,assumptions}',''),'reviewTerms',coalesce(p#>>'{budget,reviewTerms}',''));
  m:=case when p->>'mode'='running' or (p->>'mode'='mixed' and r->>'kind'='running') then case when p->'budget' is not null and p->'budget'<>'null'::jsonb then 'budget' else 'running' end else 'fixed' end;
  foreach k in array array['combined','labour','material'] loop
    c:=jsonb_build_object('mode',m,'fixedOre',case k when 'combined' then r->'amountOre' when 'labour' then r->'labourOre' else r->'materialOre' end,
      'budgetOre',null,'hourlyOre',p#>'{running,hourlyOre}','markupPercent',p#>'{running,markupPercent}');
    -- A combined legacy budget cannot be guessed into separate components.
    if m='budget' and p->>'split'='separate' then return null; end if;
    if m='budget' and k='combined' then c:=c||jsonb_build_object('budgetOre',(select x->'amountOre' from jsonb_array_elements(p#>'{budget,rows}') x where x->'id'=r->'id')); end if;
    t:=t||jsonb_build_object(k,c);
  end loop;
  return t;
end $$;

do $migration$
begin
  if to_regprocedure('public.get_contract_work_links_before_project(uuid,uuid,uuid)') is null then
    alter function public.get_contract_work_links(uuid,uuid,uuid) rename to get_contract_work_links_before_project;
  end if;
end $migration$;
create or replace function public.get_contract_work_links(p_org_id uuid,p_user_id uuid,p_case_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare result jsonb; i record; cp public.action_case_customer_prices%rowtype; offer_body jsonb; contract_body jsonb; orev integer; crev integer; candidates jsonb; t jsonb; link jsonb;
begin
  result:=public.get_contract_work_links_before_project(p_org_id,p_user_id,p_case_id);
  for i in select x.id,x.action_case_id from public.action_case_items x where x.org_id=p_org_id and (p_case_id is null or x.action_case_id=p_case_id) loop
    select body,revision into offer_body,orev from public.action_case_customer_offer_drafts where org_id=p_org_id and action_case_id=i.action_case_id;
    select body,revision into contract_body,crev from public.action_case_customer_contract_drafts where org_id=p_org_id and action_case_id=i.action_case_id;
    select * into cp from public.action_case_customer_prices where org_id=p_org_id and item_id=i.id;
    candidates:='[]';
    t:=public.legacy_project_price(offer_body,i.id); if t is not null then candidates:=candidates||jsonb_build_array(jsonb_build_object('source','offer','terms',t)); end if;
    t:=public.legacy_project_price(contract_body,i.id); if t is not null then candidates:=candidates||jsonb_build_array(jsonb_build_object('source','contract','terms',t)); end if;
    link:=coalesce(result#>array['links',i.id::text],jsonb_build_object('revision',coalesce(crev,0),'locked',public.contract_work_locked(p_org_id,i.action_case_id,i.id),'version',null,'documentId',null,'differences','[]'::jsonb,
      'price',jsonb_build_object('editable',false,'split','combined','amountOre',null,'labourOre',null,'materialOre',null)));
    link:=link||jsonb_build_object('customerPricing',jsonb_build_object('revision',coalesce(cp.revision,0),'terms',cp.terms,'candidates',candidates,'documentRevisions',jsonb_build_object('offer',orev,'contract',crev)));
    result:=jsonb_set(result,array['links',i.id::text],link,true);
  end loop;
  return result;
end $$;

create or replace function public.write_project_customer_price(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_item_id uuid,p_revision integer,p_terms jsonb,p_documents jsonb,p_adopt boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare cp public.action_case_customer_prices%rowtype; d record; request jsonb; cached record; result jsonb; next_body jsonb; locked boolean;
begin
  if not exists(select 1 from public.org_members where org_id=p_org_id and profile_id=p_user_id and is_active) then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  perform 1 from public.action_cases where id=p_case_id and org_id=p_org_id for update;
  if not found or not exists(select 1 from public.action_case_items where id=p_item_id and org_id=p_org_id and action_case_id=p_case_id) then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  if public.contract_work_locked(p_org_id,p_case_id,p_item_id) then raise exception 'ACTION_CASE_CONTRACT_LOCKED'; end if;
  perform public.assert_project_customer_price(p_terms,false);
  request:=jsonb_build_object('user',p_user_id,'case',p_case_id,'item',p_item_id,'revision',p_revision,'terms',p_terms,'documents',p_documents,'adopt',p_adopt);
  select * into cached from public.action_case_customer_price_requests where org_id=p_org_id and request_id=p_request_id;
  if found then
    if cached.request<>request then raise exception 'PROJECT_PRICE_REQUEST_CONFLICT'; end if;
    return cached.response;
  end if;
  select * into cp from public.action_case_customer_prices where item_id=p_item_id and org_id=p_org_id for update;
  if coalesce(cp.revision,0)<>p_revision then raise exception 'PROJECT_PRICE_STALE'; end if;
  if cp.revision is null and not coalesce(p_adopt,false) then raise exception 'PROJECT_PRICE_ADOPT_REQUIRED'; end if;
  -- Adoption replaces only explicitly reviewed linked customer terms, never a
  -- manual aggregate or an unseen concurrently edited document.
  if cp.revision is null then
    for d in select 'offer' as kind,revision,body from public.action_case_customer_offer_drafts where org_id=p_org_id and action_case_id=p_case_id
      union all select 'contract',revision,body from public.action_case_customer_contract_drafts where org_id=p_org_id and action_case_id=p_case_id loop
      if coalesce((p_documents->>d.kind)::integer,-1)<>d.revision then raise exception 'PROJECT_PRICE_STALE'; end if;
    end loop;
  end if;
  insert into public.action_case_customer_prices(org_id,action_case_id,item_id,revision,terms,updated_by)
    values(p_org_id,p_case_id,p_item_id,p_revision+1,p_terms,p_user_id)
    on conflict(item_id) do update set terms=excluded.terms,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=clock_timestamp();
  for d in select 'offer' as kind,body from public.action_case_customer_offer_drafts where org_id=p_org_id and action_case_id=p_case_id
    union all select 'contract',body from public.action_case_customer_contract_drafts where org_id=p_org_id and action_case_id=p_case_id loop
    if not public.contract_work_references(d.body,p_item_id) then continue; end if;
    -- A frozen contract's entire draft is out of bounds, including other moments.
    locked:=d.kind='contract' and exists(select 1 from public.action_case_items x where x.org_id=p_org_id and x.action_case_id=p_case_id and public.contract_work_locked(p_org_id,p_case_id,x.id) and public.contract_work_references(d.body,x.id));
    if locked then continue; end if;
    next_body:=public.project_price_document(d.body,p_org_id,p_case_id);
    perform public.assert_contract_pricing(next_body,false);
    if d.kind='offer' then update public.action_case_customer_offer_drafts set body=next_body,revision=revision+1,updated_by=p_user_id,updated_at=clock_timestamp() where org_id=p_org_id and action_case_id=p_case_id;
    else update public.action_case_customer_contract_drafts set body=next_body,revision=revision+1,updated_by=p_user_id,updated_at=clock_timestamp() where org_id=p_org_id and action_case_id=p_case_id; end if;
  end loop;
  result:=jsonb_build_object('requestId',p_request_id,'itemId',p_item_id,'previousRevision',p_revision,'revision',p_revision+1,'terms',p_terms);
  insert into public.action_case_customer_price_requests values(p_org_id,p_request_id,request,result);
  return result;
end $$;

do $migration$
begin
  if to_regprocedure('public.write_contract_work_price_before_project(uuid,uuid,uuid,uuid,integer,jsonb)') is null then
    alter function public.write_contract_work_price(uuid,uuid,uuid,uuid,integer,jsonb) rename to write_contract_work_price_before_project;
  end if;
end $migration$;
create or replace function public.write_contract_work_price(p_org_id uuid,p_case_id uuid,p_user_id uuid,p_item_id uuid,p_revision integer,p_price jsonb)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if exists(select 1 from public.action_case_customer_prices where org_id=p_org_id and item_id=p_item_id) then raise exception 'PROJECT_PRICE_READ_ONLY'; end if;
  perform public.write_contract_work_price_before_project(p_org_id,p_case_id,p_user_id,p_item_id,p_revision,p_price);
end $$;
revoke all on function public.write_contract_work_price(uuid,uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.write_contract_work_price(uuid,uuid,uuid,uuid,integer,jsonb) to service_role;

-- All writes use the membership, CAS and lock checks in the service RPC.
revoke all on function public.customer_price_parts(jsonb),public.assert_project_customer_price(jsonb,boolean),public.project_price_validation_body(jsonb),public.assert_contract_pricing(jsonb,boolean),public.project_price_document(jsonb,uuid,uuid),public.guard_project_price_document(),public.legacy_project_price(jsonb,uuid),public.get_contract_work_links(uuid,uuid,uuid),public.write_project_customer_price(uuid,uuid,uuid,uuid,integer,jsonb,jsonb,boolean,uuid) from public,anon,authenticated;
grant execute on function public.customer_price_parts(jsonb),public.assert_project_customer_price(jsonb,boolean),public.project_price_validation_body(jsonb),public.assert_contract_pricing(jsonb,boolean),public.project_price_document(jsonb,uuid,uuid),public.guard_project_price_document(),public.legacy_project_price(jsonb,uuid),public.get_contract_work_links(uuid,uuid,uuid),public.write_project_customer_price(uuid,uuid,uuid,uuid,integer,jsonb,jsonb,boolean,uuid) to service_role;
commit;
