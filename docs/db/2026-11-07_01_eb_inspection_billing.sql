-- Internal, manual EB invoicing marker. No invoice, payment, email or report is
-- created/changed. Run after the EB foundation and org_members migrations.
-- Existing inspections remain unmarked until explicitly updated. Repeatable.
begin;
set local lock_timeout = '5s';

create table if not exists public.eb_inspection_billing (
  inspection_id uuid primary key references public.eb_inspection_details(inspection_id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects(id) on delete cascade,
  is_invoiced boolean not null default false,
  invoiced_at timestamptz,
  invoice_number text,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  constraint eb_inspection_billing_date_check check (is_invoiced = (invoiced_at is not null)),
  constraint eb_inspection_billing_number_check check (invoice_number is null or
    (char_length(btrim(invoice_number)) between 1 and 100 and invoice_number !~ '[[:cntrl:]]'))
);
create index if not exists eb_inspection_billing_scope_idx
  on public.eb_inspection_billing(org_id, eb_project_id, inspection_id);

create table if not exists public.eb_inspection_billing_events (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.eb_inspection_details(inspection_id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects(id) on delete cascade,
  revision integer not null check (revision > 0),
  previous_state jsonb not null,
  new_state jsonb not null,
  performed_at timestamptz not null default now(),
  performed_by uuid references public.profiles(id) on delete set null,
  performed_by_name text,
  unique (inspection_id, revision)
);
create index if not exists eb_inspection_billing_events_scope_idx
  on public.eb_inspection_billing_events(org_id, eb_project_id, inspection_id, revision desc);

alter table public.eb_inspection_billing enable row level security;
alter table public.eb_inspection_billing_events enable row level security;
-- Only the server may read. Even service_role writes go through the audited RPC.
revoke all on public.eb_inspection_billing, public.eb_inspection_billing_events
  from public, anon, authenticated, service_role;
grant select on public.eb_inspection_billing, public.eb_inspection_billing_events to service_role;

create or replace function public.eb_set_inspection_billing(
  p_org_id uuid, p_project_id uuid, p_inspection_id uuid, p_actor uuid,
  p_is_invoiced boolean, p_invoice_number text, p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.eb_inspection_billing%rowtype;
  v_has_current boolean;
  v_number text := nullif(btrim(p_invoice_number), '');
  v_actor_name text;
  v_now timestamptz;
  v_previous jsonb;
  v_should_write boolean;
begin
  if p_is_invoiced is null or p_expected_revision is null or p_expected_revision < 0
    or (v_number is not null and (char_length(v_number) > 100 or v_number ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'EB_BILLING_INPUT_INVALID';
  end if;
  if p_actor is null or not exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.profile_id = p_actor and m.is_active = true
  ) then
    raise exception using errcode = '42501', message = 'EB_BILLING_ACTOR_FORBIDDEN';
  end if;

  -- This row lock serializes first creation as well as updates. Merely locking
  -- the row does not touch the report lock guard, status or public snapshots.
  perform d.inspection_id from public.eb_inspection_details d
  join public.eb_projects p on p.id = d.eb_project_id and p.org_id = d.org_id
  where d.org_id = p_org_id and d.eb_project_id = p_project_id and d.inspection_id = p_inspection_id
  for update of d;
  if not found then
    raise exception using errcode = 'P0002', message = 'EB_INSPECTION_NOT_FOUND';
  end if;

  select * into v_current from public.eb_inspection_billing
  where inspection_id = p_inspection_id for update;
  v_has_current := found;
  if v_has_current and (v_current.org_id <> p_org_id or v_current.eb_project_id <> p_project_id) then
    raise exception using errcode = '42501', message = 'EB_INSPECTION_NOT_FOUND';
  end if;
  if coalesce(v_current.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'EB_BILLING_CONFLICT';
  end if;

  v_should_write := coalesce(v_current.is_invoiced, false) <> p_is_invoiced
    or v_current.invoice_number is distinct from v_number;
  if v_should_write then
    -- Capture the write time after any wait for the inspection/revision lock.
    v_now := clock_timestamp();
    if coalesce(v_current.revision, 0) = 2147483647 then
      raise exception using errcode = '55000', message = 'EB_BILLING_UNAVAILABLE';
    end if;
    select coalesce(nullif(btrim(full_name), ''), 'Användare') into v_actor_name
    from public.profiles where id = p_actor;
    if not found then
      raise exception using errcode = '42501', message = 'EB_BILLING_ACTOR_FORBIDDEN';
    end if;
    v_previous := jsonb_build_object(
      'isInvoiced', coalesce(v_current.is_invoiced, false),
      'invoicedAt', v_current.invoiced_at, 'invoiceNumber', v_current.invoice_number
    );
    insert into public.eb_inspection_billing as b (
      inspection_id, org_id, eb_project_id, is_invoiced, invoiced_at,
      invoice_number, revision, updated_at, updated_by, updated_by_name
    ) values (
      p_inspection_id, p_org_id, p_project_id, p_is_invoiced,
      case when p_is_invoiced then coalesce(v_current.invoiced_at, v_now) else null end,
      v_number, coalesce(v_current.revision, 0) + 1, v_now, p_actor, v_actor_name
    ) on conflict (inspection_id) do update set
      is_invoiced = excluded.is_invoiced, invoiced_at = excluded.invoiced_at,
      invoice_number = excluded.invoice_number, revision = excluded.revision,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by,
      updated_by_name = excluded.updated_by_name
    returning b.* into v_current;

    insert into public.eb_inspection_billing_events (
      inspection_id, org_id, eb_project_id, revision, previous_state, new_state,
      performed_at, performed_by, performed_by_name
    ) values (
      p_inspection_id, p_org_id, p_project_id, v_current.revision, v_previous,
      jsonb_build_object('isInvoiced', v_current.is_invoiced,
        'invoicedAt', v_current.invoiced_at, 'invoiceNumber', v_current.invoice_number),
      v_now, p_actor, v_actor_name
    );
  end if;

  return jsonb_build_object(
    'status', case when coalesce(v_current.is_invoiced, false) then 'invoiced' else 'not_invoiced' end,
    'invoicedAt', v_current.invoiced_at, 'invoiceNumber', v_current.invoice_number,
    'updatedAt', v_current.updated_at, 'updatedByName', v_current.updated_by_name,
    'revision', coalesce(v_current.revision, 0)
  );
end;
$$;
revoke all on function public.eb_set_inspection_billing(uuid,uuid,uuid,uuid,boolean,text,integer)
  from public, anon, authenticated;
grant execute on function public.eb_set_inspection_billing(uuid,uuid,uuid,uuid,boolean,text,integer) to service_role;

notify pgrst, 'reload schema';
commit;
