-- Requires the project completion and project supplier-invoice migrations from 2026-11-07.
-- Additive billing workspace only. No backfill; no updates to contracts, prices,
-- calculations, customer choices or payment plans. Activation is an explicit manager action.
begin;

create table if not exists public.action_case_billing_flows (
  org_id uuid not null references public.organizations(id),
  action_case_id uuid primary key references public.action_cases(id),
  revision integer not null check(revision>0),
  body jsonb not null check(jsonb_typeof(body)='object' and body->>'version'='1'),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.action_case_billing_events (
  id uuid primary key, org_id uuid not null references public.organizations(id),
  action_case_id uuid not null references public.action_cases(id), revision integer not null,
  actor_id uuid not null references public.profiles(id), actor_name text not null,
  operation text not null, request jsonb not null, snapshot jsonb not null,
  created_at timestamptz not null default now(), unique(action_case_id,revision)
);
create table if not exists public.action_case_billing_supplier_claims (
  org_id uuid not null references public.organizations(id), invoice_id uuid not null references public.supplier_invoices(id),
  allocation_id uuid not null, action_case_id uuid not null references public.action_cases(id),
  cost_id uuid not null, protected boolean not null default false, snapshot jsonb not null,
  primary key(org_id,invoice_id,allocation_id), unique(action_case_id,cost_id)
);
alter table public.action_case_billing_flows enable row level security;
alter table public.action_case_billing_events enable row level security;
alter table public.action_case_billing_supplier_claims enable row level security;
revoke all on public.action_case_billing_flows,public.action_case_billing_events,public.action_case_billing_supplier_claims from public,anon,authenticated;
grant select,insert,update on public.action_case_billing_flows,public.action_case_billing_supplier_claims to service_role;
grant select,insert on public.action_case_billing_events to service_role;
create index if not exists action_case_billing_events_project_idx on public.action_case_billing_events(org_id,action_case_id,revision desc);

create or replace function public.project_billing_source_context(p_org uuid,p_case uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare project public.action_cases%rowtype; frozen jsonb; draft jsonb; choices jsonb; prices jsonb; invoices jsonb; items jsonb;
  sender jsonb; customer jsonb; legacy jsonb; questions integer; result jsonb;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_actor and is_active)
    then raise exception 'BILLING_FORBIDDEN'; end if;
  select * into project from public.action_cases where id=p_case and org_id=p_org;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;
  select jsonb_build_object('id',id,'version',version,'snapshot',snapshot,'kind','contract') into frozen
    from public.action_case_contract_signing_documents where org_id=p_org and action_case_id=p_case and released_at is null order by version desc limit 1;
  if frozen is null then
    select jsonb_build_object('id',id,'version',version,'snapshot',snapshot,'kind','offer') into frozen
      from public.action_case_customer_offers where org_id=p_org and action_case_id=p_case and status='accepted' order by version desc limit 1;
  end if;
  select body into draft from public.action_case_customer_contract_drafts where org_id=p_org and action_case_id=p_case;
  select coalesce(p.items,'[]') into choices from public.action_case_customer_planning p where p.org_id=p_org and p.action_case_id=p_case;
  select coalesce(jsonb_agg(jsonb_build_object('id',item_id,'revision',revision,'terms',terms) order by item_id),'[]') into prices
    from public.action_case_customer_prices where org_id=p_org and action_case_id=p_case;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title) order by sort_order,id),'[]') into items
    from public.action_case_items where org_id=p_org and action_case_id=p_case;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'revision',i.revision,'body',i.body,
    'hasOriginal',exists(select 1 from public.supplier_invoice_attachments a where a.org_id=p_org and a.invoice_id=i.id),
    'legacyAllocations',(select coalesce(jsonb_agg(s.allocation_id order by s.allocation_id),'[]') from public.supplier_invoice_basis_sources s where s.org_id=p_org and s.invoice_id=i.id)) order by i.id),'[]')
    into invoices from public.supplier_invoices i where i.org_id=p_org and exists(select 1 from jsonb_array_elements(i.body->'allocations') a where a->>'caseId'=p_case::text);
  select snapshot into sender from public.action_case_contract_senders where org_id=p_org and action_case_id=p_case;
  select jsonb_build_object('id',c.id,'name',c.name,'address',c.address,'postalCode',c.postal_code,'city',c.city,
    'invoiceSame',c.invoice_same_as_customer,'invoiceName',c.invoice_name,'invoiceAddress',c.invoice_address,'invoicePostalCode',c.invoice_postal_code,'invoiceCity',c.invoice_city)
    into customer from public.action_case_billing b join public.organization_customers c on c.id=b.customer_id and c.org_id=p_org
    where b.org_id=p_org and b.action_case_id=p_case;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'body',body) order by id),'[]') into legacy
    from public.action_case_invoice_basis where org_id=p_org and action_case_id=p_case;
  if project.manager_profile_id=p_actor then
    select count(*) into questions from public.action_case_questions where org_id=p_org and action_case_id=p_case and body->>'status' is distinct from 'closed';
  end if;
  result:=jsonb_build_object('caseId',p_case,'title',project.title,'status',project.status,'manager',project.manager_profile_id,
    'customerName',project.customer_name,'frozen',frozen,'draft',draft,'choices',coalesce(choices,'[]'),'prices',prices,'items',items,
    'invoices',invoices,'sender',sender,'customer',customer,'legacy',legacy,'openQuestions',questions);
  return result;
end $$;

create or replace function public.read_project_billing_flow(p_org uuid,p_case uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare source jsonb; ledger public.action_case_billing_flows%rowtype; events jsonb;
begin
  source:=public.project_billing_source_context(p_org,p_case,p_actor);
  select * into ledger from public.action_case_billing_flows where org_id=p_org and action_case_id=p_case;
  select coalesce(jsonb_agg(e.body order by e.revision desc),'[]') into events from (
    select revision,jsonb_build_object('id',id,'operation',operation,'actor',actor_name,'at',created_at) body
    from public.action_case_billing_events where org_id=p_org and action_case_id=p_case order by revision desc limit 100) e;
  return jsonb_build_object('source',source,'contextHash',md5(source::text),'body',ledger.body,'revision',coalesce(ledger.revision,0),'history',events);
end $$;

create or replace function public.write_project_billing_flow(p_org uuid,p_case uuid,p_actor uuid,p_revision integer,p_request_id uuid,p_context_hash text,p_request jsonb,p_body jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare project public.action_cases%rowtype; previous public.action_case_billing_flows%rowtype; event public.action_case_billing_events%rowtype;
  source jsonb; oldrow jsonb; newrow jsonb; a jsonb; supplier jsonb; allocation jsonb; origin record; protected boolean; name text; key text;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_actor and is_active)
    then raise exception 'BILLING_FORBIDDEN'; end if;
  -- Matches the existing supplier writer's lock order; imports cannot race legacy basis creation.
  perform pg_advisory_xact_lock(hashtextextended('supplier-invoice-org:'||p_org::text,0));
  select * into project from public.action_cases where id=p_case and org_id=p_org for update;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;
  if project.manager_profile_id is distinct from p_actor or project.status='cancelled' then raise exception 'BILLING_FORBIDDEN'; end if;
  select * into event from public.action_case_billing_events where id=p_request_id;
  if found then
    if event.org_id=p_org and event.action_case_id=p_case and event.actor_id=p_actor and event.request=p_request
      then return jsonb_build_object('revision',event.revision); end if;
    raise exception 'BILLING_STALE';
  end if;
  source:=public.project_billing_source_context(p_org,p_case,p_actor);
  if p_context_hash is distinct from md5(source::text) then raise exception 'BILLING_SOURCE_CHANGED'; end if;
  select * into previous from public.action_case_billing_flows where action_case_id=p_case for update;
  if p_revision is distinct from coalesce(previous.revision,0) or p_request_id is null then raise exception 'BILLING_STALE'; end if;
  if p_body is null or p_body->>'version' is distinct from '1' or jsonb_typeof(p_body->'legacyConfirmed') is distinct from 'boolean'
    or jsonb_typeof(p_body->'economyClosed') is distinct from 'boolean' or octet_length(p_body::text)>2500000 then raise exception 'BILLING_INVALID'; end if;
  foreach key in array array['agreements','costs','entries','bases','invoices','reviews','releases'] loop
    if jsonb_typeof(p_body->key) is distinct from 'array' or jsonb_array_length(p_body->key)>2000 then raise exception 'BILLING_INVALID'; end if;
  end loop;
  -- Earlier agreements and real invoice registrations are append-only.
  foreach key in array array['agreements','invoices','reviews','releases'] loop
    for oldrow in select value from jsonb_array_elements(coalesce(previous.body->key,'[]')) loop
      if key in ('reviews','releases') then
        if not (p_body->key @> jsonb_build_array(oldrow)) then raise exception 'BILLING_IMMUTABLE'; end if;
      else
        select x into newrow from jsonb_array_elements(p_body->key) x where x->>'id'=oldrow->>'id';
        if newrow is distinct from oldrow then raise exception 'BILLING_IMMUTABLE'; end if;
      end if;
    end loop;
  end loop;
  for oldrow in select value from jsonb_array_elements(coalesce(previous.body->'bases','[]')) loop
    select x into newrow from jsonb_array_elements(p_body->'bases') x where x->>'id'=oldrow->>'id';
    if newrow is null or (newrow-array['status','exportedAt','cancellationReason']) is distinct from (oldrow-array['status','exportedAt','cancellationReason'])
      or (oldrow->>'status'='cancelled' and newrow<>oldrow) then raise exception 'BILLING_IMMUTABLE'; end if;
  end loop;
  for oldrow in select value from jsonb_array_elements(coalesce(previous.body->'entries','[]')) loop
    select x into newrow from jsonb_array_elements(p_body->'entries') x where x->>'id'=oldrow->>'id';
    if newrow is null or (newrow-array['waivedOre','adjustedOre','superseded']) is distinct from (oldrow-array['waivedOre','adjustedOre','superseded']) then raise exception 'BILLING_IMMUTABLE'; end if;
  end loop;
  -- Validate the real invoice allocation, not a client-provided copy of its amount.
  for a in select value from jsonb_array_elements(p_body->'costs') where value->'supplier' <> 'null'::jsonb loop
    supplier:=a->'supplier';
    select x into oldrow from jsonb_array_elements(coalesce(previous.body->'costs','[]')) x where x->>'id'=a->>'id';
    select * into origin from public.supplier_invoices where org_id=p_org and id=(supplier->>'invoiceId')::uuid;
    if not found then raise exception 'BILLING_SOURCE_CHANGED'; end if;
    select x into allocation from jsonb_array_elements(origin.body->'allocations') x where x->>'id'=supplier->>'allocationId' and x->>'caseId'=p_case::text;
    if allocation is null or exists(select 1 from public.supplier_invoice_basis_sources where org_id=p_org and invoice_id=origin.id and allocation_id=(supplier->>'allocationId')::uuid)
      then raise exception 'BILLING_SOURCE_IN_USE'; end if;
    if oldrow->'supplier' is distinct from supplier or oldrow->>'reviewed' is distinct from a->>'reviewed' then
      if (supplier->>'revision')::integer<>origin.revision or (supplier->>'netOre')::bigint<>(allocation->>'amountOre')::bigint * (case when origin.body->>'documentKind'='credit' then -1 else 1 end)
        then raise exception 'BILLING_SOURCE_CHANGED'; end if;
    end if;
    if exists(select 1 from public.action_case_billing_supplier_claims c where c.org_id=p_org and c.invoice_id=origin.id and c.allocation_id=(supplier->>'allocationId')::uuid
      and (c.action_case_id<>p_case or c.cost_id<>(a->>'id')::uuid)) then raise exception 'BILLING_SOURCE_IN_USE'; end if;
    protected:=exists(select 1 from jsonb_array_elements(p_body->'bases') b,lateral jsonb_array_elements(b->'lines') l,
      lateral jsonb_array_elements(p_body->'entries') e where b->>'status'<>'cancelled' and l->>'entryId'=e->>'id' and e->>'costId'=a->>'id');
    insert into public.action_case_billing_supplier_claims(org_id,invoice_id,allocation_id,action_case_id,cost_id,protected,snapshot)
      values(p_org,origin.id,(supplier->>'allocationId')::uuid,p_case,(a->>'id')::uuid,protected,jsonb_build_object('allocation',allocation,'body',origin.body-array['notes','sourceText','allocations','paymentStatus','paidOn']))
      on conflict(org_id,invoice_id,allocation_id) do update set protected=excluded.protected,snapshot=excluded.snapshot;
  end loop;
  insert into public.action_case_billing_flows(org_id,action_case_id,revision,body,updated_by)
    values(p_org,p_case,p_revision+1,p_body,p_actor) on conflict(action_case_id) do update set revision=excluded.revision,body=excluded.body,updated_by=excluded.updated_by,updated_at=now();
  select coalesce(nullif(full_name,''),email,'Medarbetare') into name from public.profiles where id=p_actor;
  insert into public.action_case_billing_events(id,org_id,action_case_id,revision,actor_id,actor_name,operation,request,snapshot)
    values(p_request_id,p_org,p_case,p_revision+1,p_actor,coalesce(name,'Medarbetare'),p_request->>'operation',p_request,p_body);
  return jsonb_build_object('revision',p_revision+1);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'BILLING_INVALID';
end $$;

create or replace function public.guard_project_billing_supplier() returns trigger language plpgsql set search_path=public,pg_catalog as $$
declare c record; allocation jsonb; final_body jsonb;
begin
  -- The existing writer temporarily strips allocation identities, then restores
  -- them in the same transaction. Validate its final state, never an intermediate one.
  select body into final_body from public.supplier_invoices where id=old.id and org_id=old.org_id;
  for c in select * from public.action_case_billing_supplier_claims where invoice_id=old.id and protected loop
    if final_body is null then raise exception 'INVOICE_SOURCE_IN_USE'; end if;
    select a into allocation from jsonb_array_elements(final_body->'allocations') a where a->>'id'=c.allocation_id::text;
    if allocation is distinct from c.snapshot->'allocation' or (final_body-array['notes','sourceText','allocations','paymentStatus','paidOn']) is distinct from c.snapshot->'body'
      then raise exception 'INVOICE_SOURCE_IN_USE'; end if;
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists project_billing_supplier_guard on public.supplier_invoices;
create constraint trigger project_billing_supplier_guard after update or delete on public.supplier_invoices deferrable initially deferred for each row execute function public.guard_project_billing_supplier();

create or replace function public.guard_project_billing_legacy() returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if tg_table_name='supplier_invoice_basis_sources' then
    if exists(select 1 from public.action_case_billing_supplier_claims where org_id=new.org_id and invoice_id=new.invoice_id and allocation_id=new.allocation_id)
      then raise exception 'INVOICE_SOURCE_IN_USE'; end if;
  elsif exists(select 1 from public.action_case_billing_flows where action_case_id=new.action_case_id and org_id=new.org_id)
    then raise exception 'BILLING_USE_FLOW';
  end if;
  return new;
end $$;
drop trigger if exists project_billing_legacy_basis_guard on public.action_case_invoice_basis;
create trigger project_billing_legacy_basis_guard before insert or update on public.action_case_invoice_basis for each row execute function public.guard_project_billing_legacy();
drop trigger if exists project_billing_legacy_source_guard on public.supplier_invoice_basis_sources;
create trigger project_billing_legacy_source_guard before insert on public.supplier_invoice_basis_sources for each row execute function public.guard_project_billing_legacy();

create or replace function public.guard_project_billing_completion() returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if new.status='completed' and old.status is distinct from 'completed' and exists(select 1 from public.action_case_billing_flows where action_case_id=new.id and body->>'economyClosed' is distinct from 'true')
    then raise exception 'BILLING_INCOMPLETE'; end if;
  return new;
end $$;
drop trigger if exists project_billing_completion_guard on public.action_cases;
create trigger project_billing_completion_guard before update of status on public.action_cases for each row execute function public.guard_project_billing_completion();
create or replace function public.guard_project_billing_event() returns trigger language plpgsql as $$begin raise exception 'BILLING_IMMUTABLE'; end $$;
drop trigger if exists project_billing_event_guard on public.action_case_billing_events;
create trigger project_billing_event_guard before update or delete on public.action_case_billing_events for each row execute function public.guard_project_billing_event();

revoke all on function public.project_billing_source_context(uuid,uuid,uuid),public.read_project_billing_flow(uuid,uuid,uuid),public.write_project_billing_flow(uuid,uuid,uuid,integer,uuid,text,jsonb,jsonb),public.guard_project_billing_supplier(),public.guard_project_billing_legacy(),public.guard_project_billing_completion(),public.guard_project_billing_event() from public,anon,authenticated;
grant execute on function public.project_billing_source_context(uuid,uuid,uuid),public.read_project_billing_flow(uuid,uuid,uuid),public.write_project_billing_flow(uuid,uuid,uuid,integer,uuid,text,jsonb,jsonb) to service_role;
commit;
