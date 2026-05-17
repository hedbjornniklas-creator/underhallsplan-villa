-- System value for overview options
-- Date: 2026-05-17
-- Scope:
-- 1) Add an admin-controlled semantic/system value for overview option logic
-- 2) Backfill basement options with ja/nej as a starting point

alter table if exists public.settings_overview_options
  add column if not exists system_value text;

comment on column public.settings_overview_options.system_value is
  'Admin-controlled semantic value used by application logic. Example: ja/nej for whether an option should trigger derived UI such as interior floors.';

with basement_groups as (
  select g.id
  from public.settings_overview_groups g
  join public.settings_overview_items i on i.id = g.overview_item_id
  where i.key = 'building_type'
    and g.key in ('basement', 'källare', 'kallare')
)
update public.settings_overview_options o
set system_value = case
  when lower(coalesce(o.value, '')) in ('nej', 'no', 'false')
    or lower(coalesce(o.label, '')) like '%utan källare%'
    or lower(coalesce(o.label, '')) like '%utan kallare%'
    or lower(coalesce(o.label, '')) like '%krypgrund%'
    then 'nej'
  when lower(coalesce(o.value, '')) in ('ja', 'yes', 'true', 'delvis', 'partial')
    or lower(coalesce(o.label, '')) like '%källare%'
    or lower(coalesce(o.label, '')) like '%kallare%'
    or lower(coalesce(o.label, '')) like '%suterräng%'
    or lower(coalesce(o.label, '')) like '%souterräng%'
    then 'ja'
  else o.system_value
end
from basement_groups bg
where o.group_id = bg.id
  and o.system_value is null;
