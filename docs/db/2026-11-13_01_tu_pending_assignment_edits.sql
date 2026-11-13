begin;

-- Requires TU early start (2026-10-15_02) and customer/pricing (2026-11-11_01).
-- No backfill or changes to existing links, approvals or reports.
create table if not exists public.tu_assignment_edits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  assignment_id uuid not null references public.assignments(id),
  revision bigint not null,
  before_data jsonb not null,
  after_data jsonb not null,
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.tu_assignment_edits enable row level security;
revoke all on public.tu_assignment_edits from public, anon, authenticated, service_role;
grant select on public.tu_assignment_edits to service_role;
create index if not exists tu_assignment_edits_assignment_idx on public.tu_assignment_edits(assignment_id, created_at);

create or replace function public.tu_edit_pending_assignment(
  p_assignment_id uuid, p_org_id uuid, p_actor uuid, p_expected_updated_at timestamptz, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare a public.assignments; v public.assignments; revision bigint; issued boolean;
begin
  select * into a from public.assignments where id=p_assignment_id and org_id=p_org_id for update;
  if not found or a.assignment_type <> 'TU' then raise exception 'TU_ASSIGNMENT_NOT_FOUND'; end if;
  perform public.tu_assert_assignment_actor(a.id, a.org_id, p_actor);
  if a.status not in ('draft','sent','expired') or a.accepted_at is not null or a.booked_at is not null or a.archived_at is not null
    or exists(select 1 from public.assignment_acceptances where assignment_id=a.id) then
    raise exception 'TU_ASSIGNMENT_EDIT_LOCKED';
  end if;
  if p_expected_updated_at is null or p_expected_updated_at <> a.updated_at then raise exception 'ASSIGNMENT_VERSION_CONFLICT'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'TU_ASSIGNMENT_EDIT_INVALID'; end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where k not in (
    'customer_name','customer_email','customer_phone','customer_address','customer_postal_code','customer_city',
    'property_address','property_postal_code','property_city','property_municipality','property_owner_name','cadastral_id',
    'brf_name','apartment_number','apartment_holder_name','scope_description','price_amount',
    'invoice_name','invoice_email','invoice_address','personal_identity_number','notes_internal','assignment_details'
  )) then raise exception 'TU_ASSIGNMENT_EDIT_INVALID'; end if;
  v := jsonb_populate_record(a, p_patch);
  if jsonb_typeof(coalesce(v.assignment_details,'{}'::jsonb)) <> 'object'
    or (coalesce(v.assignment_details,'{}'::jsonb)-array['tuCustomer','tuPricing','objectType','customerType','tuEditRevision'])
      is distinct from (coalesce(a.assignment_details,'{}'::jsonb)-array['tuCustomer','tuPricing','objectType','customerType','tuEditRevision']) then
    raise exception 'TU_ASSIGNMENT_EDIT_INVALID';
  end if;
  issued := a.last_sent_at is not null or a.status <> 'draft';
  if issued and (
    lower(btrim(v.customer_email)) is distinct from lower(btrim(a.customer_email))
    or regexp_replace(coalesce(v.personal_identity_number,''),'[^0-9]','','g') is distinct from regexp_replace(coalesce(a.personal_identity_number,''),'[^0-9]','','g')
    or coalesce(v.assignment_details->'tuCustomer'->>'kind', case when v.assignment_details->>'customerType'='business' then 'business' else 'consumer' end)
       is distinct from coalesce(a.assignment_details->'tuCustomer'->>'kind', case when a.assignment_details->>'customerType'='business' then 'business' else 'consumer' end)
    or regexp_replace(coalesce(v.assignment_details->'tuCustomer'->>'identityNumber',v.personal_identity_number,''),'[^0-9]','','g')
       is distinct from regexp_replace(coalesce(a.assignment_details->'tuCustomer'->>'identityNumber',a.personal_identity_number,''),'[^0-9]','','g')
  ) then raise exception 'TU_ASSIGNMENT_RECIPIENT_LOCKED'; end if;
  if issued and (nullif(btrim(v.customer_name),'') is null or nullif(btrim(v.customer_email),'') is null
    or nullif(btrim(v.scope_description),'') is null or v.price_amount is null or v.price_amount < 0) then
    raise exception 'TU_ASSIGNMENT_EDIT_INCOMPLETE';
  end if;
  -- Only this function owns the revision. Ignore any revision echoed in the patch.
  v.assignment_details := jsonb_set(coalesce(v.assignment_details,'{}'::jsonb), '{tuEditRevision}',
    to_jsonb(coalesce((a.assignment_details->>'tuEditRevision')::bigint,0)));
  if (to_jsonb(v)-'assignment_details') = (to_jsonb(a)-'assignment_details')
    and (v.assignment_details-'tuEditRevision') = (coalesce(a.assignment_details,'{}'::jsonb)-'tuEditRevision') then return to_jsonb(a); end if;
  revision := coalesce((a.assignment_details->>'tuEditRevision')::bigint,0);
  if (to_jsonb(v)-array['notes_internal','assignment_details']) is distinct from (to_jsonb(a)-array['notes_internal','assignment_details'])
    or (v.assignment_details-'tuEditRevision') is distinct from (coalesce(a.assignment_details,'{}'::jsonb)-'tuEditRevision') then revision := revision+1; end if;
  v.assignment_details := jsonb_set(v.assignment_details,'{tuEditRevision}',to_jsonb(revision));
  update public.assignments set
    customer_name=v.customer_name, customer_email=v.customer_email, customer_phone=v.customer_phone,
    customer_address=v.customer_address, customer_postal_code=v.customer_postal_code, customer_city=v.customer_city,
    property_address=v.property_address, property_postal_code=v.property_postal_code, property_city=v.property_city,
    property_municipality=v.property_municipality, property_owner_name=v.property_owner_name, cadastral_id=v.cadastral_id,
    brf_name=v.brf_name, apartment_number=v.apartment_number, apartment_holder_name=v.apartment_holder_name,
    scope_description=v.scope_description, price_amount=v.price_amount, invoice_name=v.invoice_name,
    invoice_email=v.invoice_email, invoice_address=v.invoice_address, personal_identity_number=v.personal_identity_number,
    notes_internal=v.notes_internal, assignment_details=v.assignment_details, updated_by=p_actor, updated_at=clock_timestamp()
  where id=a.id returning * into v;
  insert into public.tu_assignment_edits(org_id,assignment_id,revision,before_data,after_data,changed_by)
    values(a.org_id,a.id,revision,to_jsonb(a),to_jsonb(v),p_actor);
  return to_jsonb(v);
end;
$$;

-- The existing token consumer holds the assignment row lock. Raising here rolls
-- back both the acceptance and its preceding customer/link updates atomically.
create or replace function public.tu_check_accepted_edit_revision()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare a public.assignments; revision text;
begin
  select * into a from public.assignments where id=new.assignment_id and org_id=new.org_id for update;
  if a.assignment_type is distinct from 'TU' then return new; end if;
  revision := coalesce(a.assignment_details->>'tuEditRevision','0');
  if coalesce(new.payload->>'tu_edit_revision','0') is distinct from revision then
    raise exception 'TU_ASSIGNMENT_CONTENT_CHANGED';
  end if;
  return new;
end;
$$;
-- Run before tu_accept_customer_details so a concurrent price change produces
-- the reload message instead of a downstream pricing validation error.
drop trigger if exists tu_00_check_accepted_edit_revision on public.assignment_acceptances;
create trigger tu_00_check_accepted_edit_revision before insert on public.assignment_acceptances
  for each row execute function public.tu_check_accepted_edit_revision();
revoke all on function public.tu_edit_pending_assignment(uuid,uuid,uuid,timestamptz,jsonb),
  public.tu_check_accepted_edit_revision() from public,anon,authenticated;
grant execute on function public.tu_edit_pending_assignment(uuid,uuid,uuid,timestamptz,jsonb) to service_role;

commit;
