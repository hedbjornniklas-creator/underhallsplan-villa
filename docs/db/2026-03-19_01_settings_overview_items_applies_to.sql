-- Settings overview: allow filtering items by inspection side (buyer/seller/apartment)
-- Date: 2026-03-19
-- Prerequisites:
--  - settings_overview_items table exists

alter table public.settings_overview_items
  add column if not exists applies_to text[];

alter table public.settings_overview_items
  drop constraint if exists settings_overview_items_applies_to_check;

alter table public.settings_overview_items
  add constraint settings_overview_items_applies_to_check
    check (
      applies_to is null
      or applies_to <@ array['buyer', 'seller', 'apartment']::text[]
    );

comment on column public.settings_overview_items.applies_to is
  'Optional inspection-side filter. Null/empty = shown for all. Allowed values: buyer, seller, apartment.';
