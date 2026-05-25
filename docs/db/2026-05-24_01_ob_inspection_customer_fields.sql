-- Structured customer/orderer fields on inspections.
--
-- Assignment customer fields are the legal source for the assignment confirmation.
-- Inspection customer fields are the current source for the inspection report and delivery.

alter table public.inspections
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists customer_address text,
  add column if not exists customer_postal_code text,
  add column if not exists customer_city text;

comment on column public.inspections.customer_name is
  'Current customer/orderer name used for the inspection report. Seeded from assignment confirmation, then editable on the inspection.';
comment on column public.inspections.customer_email is
  'Current customer/orderer email used for inspection report delivery.';
comment on column public.inspections.customer_phone is
  'Current customer/orderer phone used for the inspection report.';
comment on column public.inspections.customer_address is
  'Current customer/orderer street address used for the inspection report.';
comment on column public.inspections.customer_postal_code is
  'Current customer/orderer postal code used for the inspection report.';
comment on column public.inspections.customer_city is
  'Current customer/orderer city used for the inspection report.';

create index if not exists inspections_customer_email_idx
  on public.inspections (lower(customer_email))
  where customer_email is not null;

-- Backfill from linked assignment confirmations first.
-- Locked inspections are intentionally left untouched; their old client fields remain as fallback.
update public.inspections i
set
  customer_name = coalesce(nullif(btrim(i.customer_name), ''), nullif(btrim(a.customer_name), '')),
  customer_email = coalesce(nullif(lower(btrim(i.customer_email)), ''), nullif(lower(btrim(a.customer_email)), '')),
  customer_phone = coalesce(nullif(btrim(i.customer_phone), ''), nullif(btrim(a.customer_phone), '')),
  customer_address = coalesce(nullif(btrim(i.customer_address), ''), nullif(btrim(a.customer_address), '')),
  customer_postal_code = coalesce(nullif(btrim(i.customer_postal_code), ''), nullif(btrim(a.customer_postal_code), '')),
  customer_city = coalesce(nullif(btrim(i.customer_city), ''), nullif(btrim(a.customer_city), ''))
from public.assignments a
where a.inspection_id = i.id
  and i.locked_at is null;

-- Backfill old inspections created without assignment confirmations.
-- Locked inspections are intentionally left untouched; their old client fields remain as fallback.
with legacy_contact as (
  select
    id,
    nullif(btrim(client_name), '') as legacy_name,
    nullif(
      lower(
        substring(
          client_contact
          from '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}'
        )
      ),
      ''
    ) as legacy_email,
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            coalesce(client_contact, ''),
            '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',
            '',
            'gi'
          ),
          '\s*\|\s*',
          ' ',
          'g'
        )
      ),
      ''
    ) as legacy_phone
  from public.inspections
)
update public.inspections i
set
  customer_name = coalesce(nullif(btrim(i.customer_name), ''), legacy_contact.legacy_name),
  customer_email = coalesce(nullif(lower(btrim(i.customer_email)), ''), legacy_contact.legacy_email),
  customer_phone = coalesce(nullif(btrim(i.customer_phone), ''), legacy_contact.legacy_phone)
from legacy_contact
where legacy_contact.id = i.id
  and i.locked_at is null;
