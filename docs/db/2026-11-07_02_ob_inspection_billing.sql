-- Internal manual OB/STATUS invoicing marker, independent of the frozen report.
-- Requires SQL05 organization runtime and 2026-10-12_04_ob_member_visibility.sql.
-- Deploy before the matching app. No invoice, email, payment or inspection status
-- is created/changed. Existing completed inspections stay current until invoiced.
-- Repeatable; unknown overview function versions fail closed for manual review.
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.ob_organization_bindings') is null
    or to_regprocedure('public.ob_inspection_visibility_access(uuid,uuid,uuid,boolean)') is null then
    raise exception 'OB_BILLING_PREREQUISITES_REQUIRED';
  end if;
end $$;

create table if not exists public.ob_inspection_billing (
  inspection_id uuid primary key references public.ob_organization_bindings(inspection_id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  is_invoiced boolean not null default false,
  invoiced_at timestamptz,
  invoice_number text,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  constraint ob_inspection_billing_date_check check (is_invoiced = (invoiced_at is not null)),
  constraint ob_inspection_billing_number_check check (invoice_number is null or
    (char_length(btrim(invoice_number)) between 1 and 100 and invoice_number !~ '[[:cntrl:]]'))
);
create index if not exists ob_inspection_billing_scope_idx
  on public.ob_inspection_billing(org_id, inspection_id);

create table if not exists public.ob_inspection_billing_events (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.ob_organization_bindings(inspection_id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  revision integer not null check (revision > 0),
  previous_state jsonb not null,
  new_state jsonb not null,
  performed_at timestamptz not null default now(),
  performed_by uuid references public.profiles(id) on delete set null,
  performed_by_name text,
  unique (inspection_id, revision)
);
create index if not exists ob_inspection_billing_events_scope_idx
  on public.ob_inspection_billing_events(org_id, inspection_id, revision desc);

alter table public.ob_inspection_billing enable row level security;
alter table public.ob_inspection_billing_events enable row level security;
revoke all on public.ob_inspection_billing, public.ob_inspection_billing_events
  from public, anon, authenticated, service_role;
grant select on public.ob_inspection_billing, public.ob_inspection_billing_events to service_role;

create or replace function public.ob_set_inspection_billing(
  p_org_id uuid, p_inspection_id uuid, p_actor uuid,
  p_is_invoiced boolean, p_invoice_number text, p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_current public.ob_inspection_billing%rowtype;
  v_number text := nullif(btrim(p_invoice_number), '');
  v_actor_name text;
  v_now timestamptz;
  v_previous jsonb;
begin
  if p_is_invoiced is null or p_expected_revision is null or p_expected_revision < 0
    or (v_number is not null and (char_length(v_number) > 100 or v_number ~ '[[:cntrl:]]')) then
    raise exception 'OB_BILLING_INPUT_INVALID' using errcode = '22023';
  end if;
  if not coalesce(public.ob_inspection_visibility_access(p_inspection_id,p_org_id,p_actor,true),false) then
    raise exception 'OB_BILLING_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  -- Serialize first insert and subsequent writes without updating a locked
  -- inspection. Lock the immutable binding and owner relation as well.
  perform i.id from public.inspections i
  join public.ob_organization_bindings b on b.inspection_id=i.id
  join public.properties p on p.id=i.property_id
  where i.id=p_inspection_id and b.org_id=p_org_id and p.owner=p_actor
    and (i.inspection_family='OB' or (i.inspection_family is null and i.type in ('OB','STATUS')))
  for update of i,b,p;
  if not found or not coalesce(public.ob_inspection_visibility_access(p_inspection_id,p_org_id,p_actor,true),false) then
    raise exception 'OB_BILLING_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_current from public.ob_inspection_billing
    where inspection_id=p_inspection_id for update;
  if found and v_current.org_id<>p_org_id then
    raise exception 'OB_BILLING_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(v_current.revision,0)<>p_expected_revision then
    raise exception 'OB_BILLING_CONFLICT' using errcode = '40001';
  end if;

  if coalesce(v_current.is_invoiced,false)<>p_is_invoiced or v_current.invoice_number is distinct from v_number then
    if coalesce(v_current.revision,0)=2147483647 then
      raise exception 'OB_BILLING_UNAVAILABLE' using errcode = '55000';
    end if;
    v_now:=clock_timestamp();
    select coalesce(nullif(btrim(full_name),''),'Användare') into v_actor_name
      from public.profiles where id=p_actor;
    if not found then raise exception 'OB_BILLING_ACTOR_FORBIDDEN' using errcode = '42501'; end if;
    v_previous:=jsonb_build_object('isInvoiced',coalesce(v_current.is_invoiced,false),
      'invoicedAt',v_current.invoiced_at,'invoiceNumber',v_current.invoice_number);
    insert into public.ob_inspection_billing as b
      (inspection_id,org_id,is_invoiced,invoiced_at,invoice_number,revision,updated_at,updated_by,updated_by_name)
    values(p_inspection_id,p_org_id,p_is_invoiced,
      case when p_is_invoiced then coalesce(v_current.invoiced_at,v_now) else null end,
      v_number,coalesce(v_current.revision,0)+1,v_now,p_actor,v_actor_name)
    on conflict(inspection_id) do update set is_invoiced=excluded.is_invoiced,
      invoiced_at=excluded.invoiced_at,invoice_number=excluded.invoice_number,revision=excluded.revision,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name
    returning b.* into v_current;
    insert into public.ob_inspection_billing_events
      (inspection_id,org_id,revision,previous_state,new_state,performed_at,performed_by,performed_by_name)
    values(p_inspection_id,p_org_id,v_current.revision,v_previous,
      jsonb_build_object('isInvoiced',v_current.is_invoiced,'invoicedAt',v_current.invoiced_at,
        'invoiceNumber',v_current.invoice_number),v_now,p_actor,v_actor_name);
  end if;
  return jsonb_build_object(
    'status',case when coalesce(v_current.is_invoiced,false) then 'invoiced' else 'not_invoiced' end,
    'invoicedAt',v_current.invoiced_at,'invoiceNumber',v_current.invoice_number,
    'updatedAt',v_current.updated_at,'updatedByName',v_current.updated_by_name,'revision',coalesce(v_current.revision,0));
end $$;
revoke all on function public.ob_set_inspection_billing(uuid,uuid,uuid,boolean,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.ob_set_inspection_billing(uuid,uuid,uuid,boolean,text,integer) to service_role;

-- Modify only billing/filter expressions inside the exact reviewed latest
-- visibility body. Reverse our own additions first to make re-running safe.
-- The existing SECURITY DEFINER, search_path, row/colleague guards and ACL stay.
-- Every overview reader sees status ONLY. Invoice number, revision and audit
-- metadata remain in the owner-authorized private billing endpoint, not here.
do $migration$
declare f record; source text; rewritten text; pair record;
begin
  select p.oid,p.prosrc,p.prosecdef into f from pg_proc p
    where p.oid=to_regprocedure('public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)');
  if not found or not f.prosecdef then raise exception 'OB_BILLING_OVERVIEW_REVIEW_REQUIRED'; end if;
  source:=replace(f.prosrc,chr(13),'');
  for pair in select * from (values
    ($old$p_filter not in ('all', 'active', 'closed')$old$,
     $new$p_filter not in ('all', 'active', 'closed', 'to-invoice')$new$),
    ($old$p_attention_only := coalesce(p_attention_only, false);$old$,
     $new$p_attention_only := coalesce(p_attention_only, false) and p_filter <> 'to-invoice';$new$),
    ($old$select g.*,$old$,
     $new$select g.*,
      case when g.inspection_id is not null then jsonb_build_object(
        'status',case when coalesce(b.is_invoiced,false) then 'invoiced' else 'not_invoiced' end) end as billing,
      coalesce(lower(btrim(g.inspection->>'status')) in ('completed','done','klar'),false)
        and not coalesce(b.is_invoiced,false) as to_invoice,$new$),
    ($old$coalesce(lower(btrim(inspection->>'status')) in ('completed', 'done', 'klar', 'archived', 'arkiverad'), false)$old$,
     $new$(coalesce(lower(btrim(inspection->>'status')) in ('archived','arkiverad'),false)
          or (coalesce(lower(btrim(inspection->>'status')) in ('completed','done','klar'),false) and coalesce(b.is_invoiced,false)))$new$),
    ($old$from graph_rows g$old$,
     $new$from graph_rows g left join (select * from public.ob_inspection_billing
      where org_id=p_org_id) b using(inspection_id)$new$),
    ($old$count(*) filter (where closed) as closed_count$old$,
     $new$count(*) filter (where closed) as closed_count,
      (select count(*) from candidates where to_invoice) as to_invoice_count$new$),
    ($old$or (p_filter = 'active' and not closed) or (p_filter = 'closed' and closed)$old$,
     $new$or (p_filter = 'active' and not closed) or (p_filter = 'closed' and closed)
      or (p_filter = 'to-invoice' and to_invoice)$new$),
    ($old$'inspection', p.inspection,$old$,
     $new$'billing', p.billing, 'inspection', p.inspection,$new$),
    ($old$'all', all_count, 'active', active_count, 'closed', closed_count$old$,
     $new$'all', all_count, 'active', active_count, 'closed', closed_count, 'to-invoice', to_invoice_count$new$),
    ($old$'page', (select effective_page from page_bounds), 'pageSize', p_page_size$old$,
     $new$'billingAvailable', true, 'page', (select effective_page from page_bounds), 'pageSize', p_page_size$new$)
  ) changes(original,replacement) loop
    source:=replace(source,pair.replacement,pair.original);
  end loop;
  if md5(source)<>'15a0f78ea242cfbc516d34be0f772c5f' then
    raise exception 'OB_BILLING_OVERVIEW_REVIEW_REQUIRED';
  end if;
  rewritten:=source;
  -- Same pairs again; a verified exact body is the only allowed base.
  for pair in select * from (values
    ($old$p_filter not in ('all', 'active', 'closed')$old$,
     $new$p_filter not in ('all', 'active', 'closed', 'to-invoice')$new$),
    ($old$p_attention_only := coalesce(p_attention_only, false);$old$,
     $new$p_attention_only := coalesce(p_attention_only, false) and p_filter <> 'to-invoice';$new$),
    ($old$select g.*,$old$,
     $new$select g.*,
      case when g.inspection_id is not null then jsonb_build_object(
        'status',case when coalesce(b.is_invoiced,false) then 'invoiced' else 'not_invoiced' end) end as billing,
      coalesce(lower(btrim(g.inspection->>'status')) in ('completed','done','klar'),false)
        and not coalesce(b.is_invoiced,false) as to_invoice,$new$),
    ($old$coalesce(lower(btrim(inspection->>'status')) in ('completed', 'done', 'klar', 'archived', 'arkiverad'), false)$old$,
     $new$(coalesce(lower(btrim(inspection->>'status')) in ('archived','arkiverad'),false)
          or (coalesce(lower(btrim(inspection->>'status')) in ('completed','done','klar'),false) and coalesce(b.is_invoiced,false)))$new$),
    ($old$from graph_rows g$old$,
     $new$from graph_rows g left join (select * from public.ob_inspection_billing
      where org_id=p_org_id) b using(inspection_id)$new$),
    ($old$count(*) filter (where closed) as closed_count$old$,
     $new$count(*) filter (where closed) as closed_count,
      (select count(*) from candidates where to_invoice) as to_invoice_count$new$),
    ($old$or (p_filter = 'active' and not closed) or (p_filter = 'closed' and closed)$old$,
     $new$or (p_filter = 'active' and not closed) or (p_filter = 'closed' and closed)
      or (p_filter = 'to-invoice' and to_invoice)$new$),
    ($old$'inspection', p.inspection,$old$,
     $new$'billing', p.billing, 'inspection', p.inspection,$new$),
    ($old$'all', all_count, 'active', active_count, 'closed', closed_count$old$,
     $new$'all', all_count, 'active', active_count, 'closed', closed_count, 'to-invoice', to_invoice_count$new$),
    ($old$'page', (select effective_page from page_bounds), 'pageSize', p_page_size$old$,
     $new$'billingAvailable', true, 'page', (select effective_page from page_bounds), 'pageSize', p_page_size$new$)
  ) changes(original,replacement) loop
    if (length(rewritten)-length(replace(rewritten,pair.original,'')))/length(pair.original)<>1 then
      raise exception 'OB_BILLING_OVERVIEW_REVIEW_REQUIRED';
    end if;
    rewritten:=replace(rewritten,pair.original,pair.replacement);
  end loop;
  execute replace(pg_get_functiondef(f.oid),f.prosrc,rewritten);
end $migration$;

-- Reject inherited grants rather than exposing the private marker or a writable
-- service table outside the audited RPC. The existing overview is client-only.
do $$ begin
  if has_table_privilege('anon','public.ob_inspection_billing','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.ob_inspection_billing','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon','public.ob_inspection_billing_events','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.ob_inspection_billing_events','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role','public.ob_inspection_billing','INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role','public.ob_inspection_billing_events','INSERT,UPDATE,DELETE')
    or has_function_privilege('anon','public.ob_set_inspection_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.ob_set_inspection_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE')
    or not has_function_privilege('service_role','public.ob_set_inspection_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE')
    or has_function_privilege('anon','public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)','EXECUTE')
    or has_function_privilege('service_role','public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)','EXECUTE')
    or not has_function_privilege('authenticated','public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)','EXECUTE') then
    raise exception 'OB_BILLING_INHERITED_ACCESS_REVIEW_REQUIRED';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
