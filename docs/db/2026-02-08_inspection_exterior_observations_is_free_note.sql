-- Add explicit free-note flag and enforce single main observation per component
-- 1) Add column
alter table inspection_exterior_observations
  add column if not exists is_free_note boolean;

-- 2) Backfill from JSON values
update inspection_exterior_observations
set is_free_note = coalesce((values->>'_free_note')::boolean, false)
where is_free_note is null;

-- 3) Set defaults
alter table inspection_exterior_observations
  alter column is_free_note set default false;

alter table inspection_exterior_observations
  alter column is_free_note set not null;

-- 4) Merge duplicate main observations (keep earliest, move control items)
with duplicates as (
  select
    inspection_id,
    exterior_item_id,
    (array_agg(id order by created_at asc))[1] as keep_id,
    array_agg(id order by created_at asc) as all_ids
  from inspection_exterior_observations
  where is_free_note = false
  group by inspection_id, exterior_item_id
  having count(*) > 1
)
update inspection_control_items ci
set exterior_observation_id = d.keep_id
from duplicates d
where ci.exterior_observation_id = any(d.all_ids)
  and ci.exterior_observation_id <> d.keep_id;

with duplicates as (
  select
    inspection_id,
    exterior_item_id,
    (array_agg(id order by created_at asc))[1] as keep_id,
    array_agg(id order by created_at asc) as all_ids
  from inspection_exterior_observations
  where is_free_note = false
  group by inspection_id, exterior_item_id
  having count(*) > 1
)
update inspection_images img
set exterior_observation_id = d.keep_id
from duplicates d
where img.exterior_observation_id = any(d.all_ids)
  and img.exterior_observation_id <> d.keep_id;

with duplicates as (
  select
    inspection_id,
    exterior_item_id,
    (array_agg(id order by created_at asc))[1] as keep_id,
    array_agg(id order by created_at asc) as all_ids
  from inspection_exterior_observations
  where is_free_note = false
  group by inspection_id, exterior_item_id
  having count(*) > 1
)
delete from inspection_exterior_observations o
using duplicates d
where o.id = any(d.all_ids)
  and o.id <> d.keep_id;

-- 5) Enforce one main observation per component per inspection
create unique index if not exists inspection_exterior_observations_unique_main
  on inspection_exterior_observations (inspection_id, exterior_item_id)
  where is_free_note = false;
