  -- TU internal manual invoicing. Run before the matching application release.
  -- Requires TU foundation, platform grants and organization module availability.
  -- No invoice/email/payment is created, and no investigation/report is changed.
  -- Existing investigations remain unmarked; safely repeatable.
  begin;
  set local lock_timeout = '5s';

  create table if not exists public.tu_investigation_billing (
    inspection_id uuid primary key references public.technical_investigation_details(inspection_id) on delete cascade,
    org_id uuid not null references public.organizations(id) on delete cascade,
    is_invoiced boolean not null default false,
    invoiced_at timestamptz,
    invoice_number text,
    revision integer not null default 1 check (revision > 0),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id) on delete set null,
    updated_by_name text,
    constraint tu_investigation_billing_date_check check (is_invoiced = (invoiced_at is not null)),
    constraint tu_investigation_billing_number_check check (invoice_number is null or
      (char_length(btrim(invoice_number)) between 1 and 100 and invoice_number !~ '[[:cntrl:]]'))
  );
  create index if not exists tu_investigation_billing_scope_idx
    on public.tu_investigation_billing(org_id, inspection_id);

  create table if not exists public.tu_investigation_billing_events (
    id uuid primary key default gen_random_uuid(),
    inspection_id uuid not null references public.technical_investigation_details(inspection_id) on delete cascade,
    org_id uuid not null references public.organizations(id) on delete cascade,
    revision integer not null check (revision > 0),
    previous_state jsonb not null,
    new_state jsonb not null,
    performed_at timestamptz not null default now(),
    performed_by uuid references public.profiles(id) on delete set null,
    performed_by_name text,
    unique (inspection_id, revision)
  );
  create index if not exists tu_investigation_billing_events_scope_idx
    on public.tu_investigation_billing_events(org_id, inspection_id, revision desc);

  alter table public.tu_investigation_billing enable row level security;
  alter table public.tu_investigation_billing_events enable row level security;
  revoke all on public.tu_investigation_billing, public.tu_investigation_billing_events
    from public, anon, authenticated, service_role;
  grant select on public.tu_investigation_billing, public.tu_investigation_billing_events to service_role;

  -- No existing TU SQL access predicate has the application request's semantics.
  -- Mirror requireTuContext + hasCurrentUserAccess + hasOrganizationTuAccess:
  -- active organization membership, explicit TU grant, managed-org entitlement,
  -- and only the existing narrow pre-managed legacy-admin fallback. In particular
  -- another module/org or revoked managed grants must never resurrect TU access.
  -- TU currently shares investigations among authorized organization members;
  -- inspector_profile_id/property.owner are not new invoicing ownership rules.
  create or replace function public.tu_billing_actor_has_access(p_org uuid,p_actor uuid)
  returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
  declare v_enabled boolean; v_managed boolean;
  begin
    if p_actor is null or p_org is null or not exists(select 1 from public.org_members
      where org_id=p_org and profile_id=p_actor and is_active) then return false; end if;
    select is_active into v_enabled from public.organization_enabled_modules
      where org_id=p_org and module_key='technical_investigations';
    v_managed:=found;
    if v_managed and not coalesce(v_enabled,false) then return false; end if;

    if exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard'
      where a.profile_id=p_actor and a.is_active and (a.expires_at is null or a.expires_at>now())) then
      return exists(select 1 from public.platform_access_assignments a
        join public.platform_products p on p.id=a.product_id and p.key='dashboard'
        join public.platform_modules m on m.id=a.module_id and m.product_id=p.id and m.key='technical_investigations'
        where a.profile_id=p_actor and a.is_active and (a.expires_at is null or a.expires_at>now())
          and ((a.scope_type='organization' and a.scope_id=p_org::text)
            or (not v_managed and a.scope_type='global')));
    end if;
    if exists(select 1 from public.platform_access_assignments a
      join public.platform_products p on p.id=a.product_id and p.key='dashboard'
      where a.profile_id=p_actor and a.scope_type='organization'
        and a.source_system in ('organization_administration','organization_admin_migration')) then return false; end if;
    return exists(select 1 from public.profiles where id=p_actor and coalesce(is_admin,false));
  end $$;
  revoke all on function public.tu_billing_actor_has_access(uuid,uuid) from public,anon,authenticated,service_role;

  create or replace function public.tu_set_investigation_billing(
    p_org_id uuid, p_inspection_id uuid, p_actor uuid,
    p_is_invoiced boolean, p_invoice_number text, p_expected_revision integer
  ) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
  declare
    v_current public.tu_investigation_billing%rowtype;
    v_number text:=nullif(btrim(p_invoice_number),'');
    v_actor_name text; v_now timestamptz; v_previous jsonb;
  begin
    if p_is_invoiced is null or p_expected_revision is null or p_expected_revision<0
      or (v_number is not null and (char_length(v_number)>100 or v_number~'[[:cntrl:]]')) then
      raise exception 'TU_BILLING_INPUT_INVALID' using errcode='22023'; end if;
    if not public.tu_billing_actor_has_access(p_org_id,p_actor) then
      raise exception 'TU_BILLING_ACTOR_FORBIDDEN' using errcode='42501'; end if;
    -- The existing detail row serializes first insert as well as later updates.
    -- SELECT FOR UPDATE does not mutate any locked report or inspection row.
    perform d.inspection_id from public.technical_investigation_details d
      join public.inspections i on i.id=d.inspection_id
      where d.org_id=p_org_id and d.inspection_id=p_inspection_id
        and (i.inspection_family='TU' or (i.inspection_family is null and i.type='TU'))
      for update of d,i;
    if not found then raise exception 'TU_INVESTIGATION_NOT_FOUND' using errcode='P0002'; end if;
    if not public.tu_billing_actor_has_access(p_org_id,p_actor) then
      raise exception 'TU_BILLING_ACTOR_FORBIDDEN' using errcode='42501'; end if;
    select * into v_current from public.tu_investigation_billing
      where inspection_id=p_inspection_id for update;
    if found and v_current.org_id<>p_org_id then
      raise exception 'TU_INVESTIGATION_NOT_FOUND' using errcode='42501'; end if;
    if coalesce(v_current.revision,0)<>p_expected_revision then
      raise exception 'TU_BILLING_CONFLICT' using errcode='40001'; end if;
    if coalesce(v_current.is_invoiced,false)<>p_is_invoiced or v_current.invoice_number is distinct from v_number then
      if coalesce(v_current.revision,0)=2147483647 then
        raise exception 'TU_BILLING_UNAVAILABLE' using errcode='55000'; end if;
      v_now:=clock_timestamp();
      select coalesce(nullif(btrim(full_name),''),'Användare') into v_actor_name
        from public.profiles where id=p_actor;
      if not found then raise exception 'TU_BILLING_ACTOR_FORBIDDEN' using errcode='42501'; end if;
      v_previous:=jsonb_build_object('isInvoiced',coalesce(v_current.is_invoiced,false),
        'invoicedAt',v_current.invoiced_at,'invoiceNumber',v_current.invoice_number);
      insert into public.tu_investigation_billing as b
        (inspection_id,org_id,is_invoiced,invoiced_at,invoice_number,revision,updated_at,updated_by,updated_by_name)
      values(p_inspection_id,p_org_id,p_is_invoiced,
        case when p_is_invoiced then coalesce(v_current.invoiced_at,v_now) else null end,
        v_number,coalesce(v_current.revision,0)+1,v_now,p_actor,v_actor_name)
      on conflict(inspection_id) do update set is_invoiced=excluded.is_invoiced,
        invoiced_at=excluded.invoiced_at,invoice_number=excluded.invoice_number,revision=excluded.revision,
        updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name
      returning b.* into v_current;
      insert into public.tu_investigation_billing_events
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
  revoke all on function public.tu_set_investigation_billing(uuid,uuid,uuid,boolean,text,integer)
    from public,anon,authenticated,service_role;
  grant execute on function public.tu_set_investigation_billing(uuid,uuid,uuid,boolean,text,integer) to service_role;

  do $$ begin
    if has_table_privilege('anon','public.tu_investigation_billing','SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated','public.tu_investigation_billing','SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('anon','public.tu_investigation_billing_events','SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated','public.tu_investigation_billing_events','SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('service_role','public.tu_investigation_billing','INSERT,UPDATE,DELETE')
      or has_table_privilege('service_role','public.tu_investigation_billing_events','INSERT,UPDATE,DELETE')
      or has_function_privilege('anon','public.tu_billing_actor_has_access(uuid,uuid)','EXECUTE')
      or has_function_privilege('authenticated','public.tu_billing_actor_has_access(uuid,uuid)','EXECUTE')
      or has_function_privilege('service_role','public.tu_billing_actor_has_access(uuid,uuid)','EXECUTE')
      or has_function_privilege('anon','public.tu_set_investigation_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE')
      or has_function_privilege('authenticated','public.tu_set_investigation_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE')
      or not has_function_privilege('service_role','public.tu_set_investigation_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE') then
      raise exception 'TU_BILLING_INHERITED_ACCESS_REVIEW_REQUIRED'; end if;
  end $$;
  notify pgrst,'reload schema';
  commit;
