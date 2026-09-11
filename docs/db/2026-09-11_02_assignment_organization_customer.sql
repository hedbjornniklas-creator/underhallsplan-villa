-- Assignments: reusable organization customer link
-- Date: 2026-09-11
-- Scope:
-- 1) Link an assignment to at most one reusable customer in the same organization
-- 2) Keep the link server-managed while preserving existing assignment RLS
-- 3) Atomically link an existing customer or create one from the assignment snapshot
--
-- Prerequisites:
-- - 2026-02-20_02_assignments_core.sql
-- - 2026-02-21_01_assignments_accept_form_fields.sql
-- - 2026-03-18_05_assignments_customer_postal_city.sql
-- - 2026-08-04_01_tu_assignment_invoice_email.sql
-- - 2026-08-22_03_eb_assignment_confirmations.sql
-- - 2026-09-10_05_organization_customers.sql

begin;
set local lock_timeout = '10s';

alter table public.assignments
  add column if not exists organization_customer_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assignments'::regclass
      and conname = 'assignments_organization_customer_fk'
  ) then
    alter table public.assignments
      add constraint assignments_organization_customer_fk
      foreign key (org_id, organization_customer_id)
      references public.organization_customers (org_id, id);
  end if;
end;
$$;

create index if not exists assignments_org_customer_idx
  on public.assignments (org_id, organization_customer_id)
  where organization_customer_id is not null;

comment on column public.assignments.organization_customer_id is
  'Optional reusable HusHub customer. The composite foreign key guarantees that assignment and customer belong to the same organization.';

-- assignments has legacy browser UPDATE privileges. Keep only this new relation
-- server-managed without changing the existing policies for other assignment fields.
create or replace function public.assignments_protect_organization_customer_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.organization_customer_id is not null then
      raise exception 'organization_customer_id is server-managed'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE'
      and new.organization_customer_id is distinct from old.organization_customer_id then
      raise exception 'organization_customer_id is server-managed'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assignments_protect_organization_customer_id
  on public.assignments;

create trigger trg_assignments_protect_organization_customer_id
before insert or update of organization_customer_id on public.assignments
for each row
execute function public.assignments_protect_organization_customer_id();

-- Enforce that a newly selected customer is active at link time. Existing
-- assignments remain linked when a customer is later soft-deactivated.
create or replace function public.assignments_validate_organization_customer_id()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.organization_customer_id is null
    or (
      tg_op = 'UPDATE'
      and new.organization_customer_id is not distinct from old.organization_customer_id
      and new.org_id is not distinct from old.org_id
    ) then
    return new;
  end if;

  perform 1
  from public.organization_customers as customer
  where customer.org_id = new.org_id
    and customer.id = new.organization_customer_id
    and customer.is_active = true
  for share;

  if not found then
    raise exception 'assignment customer is missing, inactive or belongs to another organization'
      using errcode = '23514',
            constraint = 'assignments_organization_customer_active_check';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assignments_validate_organization_customer_id
  on public.assignments;

create trigger trg_assignments_validate_organization_customer_id
before insert or update of org_id, organization_customer_id on public.assignments
for each row
execute function public.assignments_validate_organization_customer_id();

create or replace function public.assign_organization_customer(
  p_org_id uuid,
  p_assignment_id uuid,
  p_expected_assignment_updated_at timestamptz,
  p_mode text,
  p_customer_id uuid,
  p_expected_customer_version bigint,
  p_customer_type text,
  p_identity_number text,
  p_actor_profile_id uuid
)
returns table (
  result_code text,
  assignment_id uuid,
  organization_customer_id uuid,
  assignment_updated_at timestamptz,
  customer_number bigint,
  customer_version bigint,
  customer_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_assignment public.assignments%rowtype;
  current_customer public.organization_customers%rowtype;
  normalized_name text;
  normalized_email text;
  normalized_phone text;
  normalized_address text;
  normalized_postal_code text;
  normalized_city text;
  normalized_invoice_name text;
  normalized_invoice_email text;
  normalized_invoice_address text;
  has_invoice_override boolean;
  violated_constraint text;
begin
  result_code := null;
  assignment_id := null;
  organization_customer_id := null;
  assignment_updated_at := null;
  customer_number := null;
  customer_version := null;
  customer_created := null;

  if p_org_id is null
    or p_assignment_id is null
    or p_expected_assignment_updated_at is null
    or p_actor_profile_id is null
    or p_mode is null
    or p_mode not in ('existing', 'create')
    or (
      p_mode = 'existing'
      and (
        p_customer_id is null
        or p_expected_customer_version is null
        or p_expected_customer_version <= 0
        or p_customer_type is not null
        or p_identity_number is not null
      )
    )
    or (
      p_mode = 'create'
      and (
        p_customer_id is not null
        or p_expected_customer_version is not null
        or p_customer_type is null
        or p_customer_type not in ('business', 'private')
        or (
          p_customer_type = 'business'
          and (
            p_identity_number is null
            or p_identity_number <> btrim(p_identity_number)
            or not public.is_valid_swedish_organization_number(p_identity_number)
          )
        )
        or (
          p_customer_type = 'private'
          and p_identity_number is not null
          and (
            p_identity_number <> btrim(p_identity_number)
            or p_identity_number !~ '^[0-9]{6}-[0-9]{4}$'
          )
        )
      )
    ) then
    result_code := 'INVALID_REQUEST';
    return next;
    return;
  end if;

  if not exists (
    select 1
    from public.org_members as member
    where member.org_id = p_org_id
      and member.profile_id = p_actor_profile_id
      and member.is_active = true
  ) then
    result_code := 'MEMBER_REQUIRED';
    return next;
    return;
  end if;

  -- This lock serializes create retries before any customer row is inserted.
  select assignment.*
  into current_assignment
  from public.assignments as assignment
  where assignment.org_id = p_org_id
    and assignment.id = p_assignment_id
  for update;

  if not found then
    result_code := 'ASSIGNMENT_NOT_FOUND';
    return next;
    return;
  end if;

  if current_assignment.organization_customer_id is not null then
    if p_mode = 'existing'
      and current_assignment.organization_customer_id <> p_customer_id then
      result_code := 'LINK_CONFLICT';
      return next;
      return;
    end if;

    select customer.*
    into current_customer
    from public.organization_customers as customer
    where customer.org_id = p_org_id
      and customer.id = current_assignment.organization_customer_id;

    result_code := 'ALREADY_LINKED';
    assignment_id := current_assignment.id;
    organization_customer_id := current_assignment.organization_customer_id;
    assignment_updated_at := current_assignment.updated_at;
    customer_number := current_customer.customer_number;
    customer_version := current_customer.version;
    customer_created := false;
    return next;
    return;
  end if;

  if current_assignment.updated_at <> p_expected_assignment_updated_at then
    result_code := 'ASSIGNMENT_VERSION_CONFLICT';
    return next;
    return;
  end if;

  if p_mode = 'existing' then
    select customer.*
    into current_customer
    from public.organization_customers as customer
    where customer.org_id = p_org_id
      and customer.id = p_customer_id
    for share;

    if not found then
      result_code := 'CUSTOMER_NOT_FOUND';
      return next;
      return;
    end if;

    if not current_customer.is_active then
      result_code := 'CUSTOMER_INACTIVE';
      return next;
      return;
    end if;

    if current_customer.version <> p_expected_customer_version then
      result_code := 'CUSTOMER_VERSION_CONFLICT';
      return next;
      return;
    end if;

    if nullif(btrim(current_customer.email), '') is null then
      result_code := 'CUSTOMER_EMAIL_REQUIRED';
      return next;
      return;
    end if;
  else
    normalized_name := nullif(btrim(current_assignment.customer_name), '');
    normalized_email := nullif(lower(btrim(current_assignment.customer_email)), '');
    normalized_phone := nullif(btrim(current_assignment.customer_phone), '');
    normalized_address := nullif(btrim(current_assignment.customer_address), '');
    normalized_postal_code := nullif(btrim(current_assignment.customer_postal_code), '');
    normalized_city := nullif(btrim(current_assignment.customer_city), '');
    normalized_invoice_name := nullif(btrim(current_assignment.invoice_name), '');
    normalized_invoice_email := nullif(lower(btrim(current_assignment.invoice_email)), '');
    normalized_invoice_address := nullif(btrim(current_assignment.invoice_address), '');

    has_invoice_override :=
      (normalized_invoice_name is not null and normalized_invoice_name <> normalized_name)
      or (
        normalized_invoice_email is not null
        and normalized_invoice_email is distinct from normalized_email
      )
      or (
        normalized_invoice_address is not null
        and normalized_invoice_address is distinct from normalized_address
      );

    if normalized_name is null
      or normalized_email is null
      or char_length(normalized_name) > 200
      or char_length(coalesce(normalized_email, '')) > 254
      or char_length(coalesce(normalized_phone, '')) > 50
      or char_length(coalesce(normalized_address, '')) > 255
      or char_length(coalesce(normalized_postal_code, '')) > 32
      or char_length(coalesce(normalized_city, '')) > 120
      or char_length(coalesce(normalized_invoice_name, '')) > 200
      or char_length(coalesce(normalized_invoice_email, '')) > 254
      or char_length(coalesce(normalized_invoice_address, '')) > 255
      or normalized_name ~ '[[:cntrl:]]'
      or normalized_email ~ '[[:cntrl:]]'
      or coalesce(normalized_phone, '') ~ '[[:cntrl:]]'
      or coalesce(normalized_address, '') ~ '[[:cntrl:]]'
      or coalesce(normalized_postal_code, '') ~ '[[:cntrl:]]'
      or coalesce(normalized_city, '') ~ '[[:cntrl:]]'
      or coalesce(normalized_invoice_name, '') ~ '[[:cntrl:]]'
      or coalesce(normalized_invoice_email, '') ~ '[[:cntrl:]]'
      or coalesce(normalized_invoice_address, '') ~ '[[:cntrl:]]'
      or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or (
        normalized_invoice_email is not null
        and normalized_invoice_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      ) then
      result_code := 'CUSTOMER_SNAPSHOT_INCOMPLETE';
      return next;
      return;
    end if;

    begin
      insert into public.organization_customers (
        org_id,
        customer_type,
        name,
        organization_number,
        personal_identity_number,
        email,
        phone,
        address,
        postal_code,
        city,
        country_code,
        invoice_same_as_customer,
        invoice_name,
        invoice_email,
        invoice_address,
        invoice_country_code,
        created_by_profile_id,
        updated_by_profile_id
      ) values (
        p_org_id,
        p_customer_type,
        normalized_name,
        case when p_customer_type = 'business' then p_identity_number else null end,
        case when p_customer_type = 'private' then p_identity_number else null end,
        normalized_email,
        normalized_phone,
        normalized_address,
        normalized_postal_code,
        normalized_city,
        'SE',
        not has_invoice_override,
        case when has_invoice_override then coalesce(normalized_invoice_name, normalized_name) else null end,
        case when has_invoice_override then normalized_invoice_email else null end,
        case when has_invoice_override then normalized_invoice_address else null end,
        case when has_invoice_override then 'SE' else null end,
        p_actor_profile_id,
        p_actor_profile_id
      )
      returning * into current_customer;
    exception
      when unique_violation then
        get stacked diagnostics violated_constraint = constraint_name;
        if violated_constraint in (
          'organization_customers_organization_number_uidx',
          'organization_customers_personal_identity_number_uidx'
        ) then
          result_code := 'CUSTOMER_IDENTITY_CONFLICT';
          return next;
          return;
        end if;
        raise;
    end;
  end if;

  if p_mode = 'existing' then
    update public.assignments as assignment
    set organization_customer_id = current_customer.id,
        customer_name = current_customer.name,
        customer_email = lower(btrim(current_customer.email)),
        customer_phone = current_customer.phone,
        customer_address = current_customer.address,
        customer_postal_code = current_customer.postal_code,
        customer_city = current_customer.city,
        invoice_name = case
          when current_customer.invoice_same_as_customer then null
          else current_customer.invoice_name
        end,
        invoice_email = case
          when current_customer.invoice_same_as_customer then null
          else current_customer.invoice_email
        end,
        invoice_address = case
          when current_customer.invoice_same_as_customer then null
          else current_customer.invoice_address
        end,
        assignment_details = jsonb_set(
          coalesce(assignment.assignment_details, '{}'::jsonb),
          '{customerType}',
          to_jsonb(
            case
              when current_customer.customer_type = 'private' then 'consumer'
              else 'business'
            end
          ),
          true
        ),
        updated_by = p_actor_profile_id
    where assignment.org_id = p_org_id
      and assignment.id = p_assignment_id
      and assignment.organization_customer_id is null
    returning assignment.updated_at into assignment_updated_at;
  else
    update public.assignments as assignment
    set organization_customer_id = current_customer.id,
        assignment_details = jsonb_set(
          coalesce(assignment.assignment_details, '{}'::jsonb),
          '{customerType}',
          to_jsonb(case when p_customer_type = 'private' then 'consumer' else 'business' end),
          true
        ),
        updated_by = p_actor_profile_id
    where assignment.org_id = p_org_id
      and assignment.id = p_assignment_id
      and assignment.organization_customer_id is null
    returning assignment.updated_at into assignment_updated_at;
  end if;

  if not found then
    raise exception 'assignment customer link changed while locked'
      using errcode = '40001';
  end if;

  result_code := case
    when p_mode = 'create' then 'CREATED_AND_LINKED'
    else 'LINKED'
  end;
  assignment_id := current_assignment.id;
  organization_customer_id := current_customer.id;
  customer_number := current_customer.customer_number;
  customer_version := current_customer.version;
  customer_created := p_mode = 'create';
  return next;
end;
$$;

comment on function public.assign_organization_customer(
  uuid,
  uuid,
  timestamptz,
  text,
  uuid,
  bigint,
  text,
  text,
  uuid
) is
  'Service-only, optimistic and idempotent assignment customer selection. Create mode snapshots customer/contact/billing fields from the locked assignment.';

revoke all on function public.assign_organization_customer(
  uuid,
  uuid,
  timestamptz,
  text,
  uuid,
  bigint,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.assign_organization_customer(
  uuid,
  uuid,
  timestamptz,
  text,
  uuid,
  bigint,
  text,
  text,
  uuid
) to service_role;

commit;
