-- OB snapshot backfill (idempotent, non-destructive)
-- Date: 2026-02-18
-- Prerequisite: 2026-02-18_ob_snapshot_and_locks.sql has been applied

begin;

insert into public.ob_property_snapshot (
  inspection_id,
  source_property_id,
  source_property_owner,
  source_property_created_at,
  imported_at,
  snapshot_version,
  name,
  address,
  postal_code,
  city,
  municipality,
  cadastral_id,
  owner_name,
  client_name,
  contact_person,
  tenure_type,
  dwelling_type,
  property_type,
  plot_area_m2,
  area_m2,
  area_sqm,
  tax_value,
  planning_status,
  type_code,
  heating,
  ventilation,
  roof_type,
  year_built,
  cover_path,
  status,
  last_inspected,
  last_inspection_at
)
select
  i.id as inspection_id,
  p.id as source_property_id,
  p.owner as source_property_owner,
  p.created_at as source_property_created_at,
  now() as imported_at,
  1 as snapshot_version,
  p.name,
  p.address,
  p.postal_code,
  p.city,
  p.municipality,
  p.cadastral_id,
  p.owner_name,
  p.client_name,
  p.contact_person,
  p.tenure_type,
  p.dwelling_type,
  p.property_type,
  p.plot_area_m2,
  p.area_m2,
  p.area_sqm,
  p.tax_value,
  p.planning_status,
  p.type_code,
  p.heating,
  p.ventilation,
  p.roof_type,
  p.year_built,
  p.cover_path,
  p.status,
  p.last_inspected,
  p.last_inspection_at
from public.inspections i
join public.properties p
  on p.id = i.property_id
where (i.type is null or upper(i.type) = 'OB')
on conflict (inspection_id) do nothing;

commit;

-- ---------------------------------------------------------------------
-- Verification queries (run manually after backfill)
-- ---------------------------------------------------------------------
-- 1) Count OB inspections
-- select count(*) as ob_inspections
-- from public.inspections
-- where (type is null or upper(type) = 'OB');

-- 2) Count snapshots
-- select count(*) as ob_snapshots
-- from public.ob_property_snapshot;

-- 3) OB inspections missing snapshot
-- select i.id, i.property_id, i.created_at
-- from public.inspections i
-- left join public.ob_property_snapshot s on s.inspection_id = i.id
-- where (i.type is null or upper(i.type) = 'OB')
--   and s.inspection_id is null
-- order by i.created_at desc;
