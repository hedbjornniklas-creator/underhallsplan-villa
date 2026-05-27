-- Technical investigations object fields
-- Date: 2026-05-27
-- Scope:
-- 1) Store whether a TU object is a villa or apartment
-- 2) Store apartment-specific BRF and apartment-number details for TU reports

alter table public.technical_investigation_details
  add column if not exists property_object_type text not null default 'villa',
  add column if not exists brf_name text,
  add column if not exists apartment_number text,
  add column if not exists apartment_holder_name text;

alter table public.technical_investigation_details
  drop constraint if exists technical_investigation_details_object_type_check;

alter table public.technical_investigation_details
  add constraint technical_investigation_details_object_type_check
  check (property_object_type in ('villa', 'apartment'));

update public.technical_investigation_details
set property_object_type = 'apartment'
where coalesce(nullif(btrim(brf_name), ''), nullif(btrim(apartment_number), '')) is not null;
