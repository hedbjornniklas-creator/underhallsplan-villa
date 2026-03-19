-- OB settings: role-based filtering for interior control points and documents
-- Date: 2026-03-19
-- Prerequisites:
--  - settings_control_points table exists
--  - document_types table exists

alter table public.settings_control_points
  add column if not exists applies_to text[];

alter table public.settings_control_points
  drop constraint if exists settings_control_points_applies_to_check;

alter table public.settings_control_points
  add constraint settings_control_points_applies_to_check
    check (
      applies_to is null
      or applies_to <@ array['buyer', 'seller', 'apartment']::text[]
    );

update public.settings_control_points
set applies_to = array['buyer', 'seller', 'apartment']::text[]
where applies_to is null
   or cardinality(applies_to) = 0;

comment on column public.settings_control_points.applies_to is
  'Optional inspection-side filter. Null/empty = shown for all. Allowed values: buyer, seller, apartment.';

-- document_types already has applies_to (text). Set safe default for existing rows.
update public.document_types
set applies_to = 'all'
where applies_to is null
   or btrim(applies_to) = '';

comment on column public.document_types.applies_to is
  'Optional inspection-side filter for OB handlingar. Supported values: all, buyer, seller, apartment, or comma-separated list.';
