-- SEPARATE RELEASE GATE: run only after the compatible application is deployed
-- and installed indexes/grants/triggers have been reviewed. No activation here.
-- Never rerun historic dedupe migrations to prepare this cutover.
begin;
lock table public.inspection_overview_selections,public.inspection_exterior_observations in share row exclusive mode;
create unique index if not exists ob_overview_legacy_unique on public.inspection_overview_selections
  (inspection_id,overview_item_id,floor_key,set_index) nulls not distinct where building_part_id is null;
create unique index if not exists ob_overview_part_unique on public.inspection_overview_selections
  (building_part_id,overview_item_id,floor_key,set_index) nulls not distinct where building_part_id is not null;
create unique index if not exists ob_exterior_legacy_unique on public.inspection_exterior_observations
  (inspection_id,exterior_item_id) where building_part_id is null and is_free_note=false;
create unique index if not exists ob_exterior_part_unique on public.inspection_exterior_observations
  (building_part_id,exterior_item_id) where building_part_id is not null and is_free_note=false;
drop index if exists public.inspection_overview_selections_logical_unique_idx;
drop index if exists public.inspection_exterior_observations_unique_main;

create or replace function public.ob_building_guard_shared()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; r jsonb; b jsonb; k text;
begin
  r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  b := case when tg_op='UPDATE' then to_jsonb(old) else '{}' end;
  v_id := (case when tg_table_name='inspections' then r->>'id' else r->>'inspection_id' end)::uuid;
  if exists(select 1 from public.ob_inspection_structure where inspection_id=v_id) then
    if tg_table_name='inspection_conditions' then
      foreach k in array array['furnishing_level','building_type','building_year','building_form','building_subtype',
        'foundation','frame','joists','facade','windows','roof','heating','ventilation','water','sewer'] loop
        if tg_op<>'UPDATE' or r->k is distinct from b->k then raise exception 'OB_BUILDING_CLIENT_REQUIRED'; end if;
      end loop;
    elsif tg_table_name='inspection_floor_models' or tg_table_name in ('inspection_control_answers','inspection_control_point_answers','inspection_exterior_selections','inspection_interior_observations') then
      raise exception 'OB_BUILDING_CLIENT_REQUIRED';
    elsif tg_table_name='inspections' and r->>'cover_path' is distinct from b->>'cover_path' then
      raise exception 'OB_BUILDING_CLIENT_REQUIRED';
    end if;
    perform 1 from public.inspections where id=v_id for update;
    update public.ob_inspection_structure set revision=revision+1 where inspection_id=v_id;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
do $$ declare t text; begin
  foreach t in array array['inspections','inspection_conditions','inspection_floor_models','inspection_documents','inspection_disclosures',
    'inspection_control_answers','inspection_control_point_answers','inspection_exterior_selections','inspection_interior_observations',
    'ob_property_snapshot','inspection_addon_selections','inspection_area_measurements','inspection_area_measurement_rows','inspection_moisture_controls','inspection_moisture_control_rows','inspection_moisture_control_images'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists zz_ob_building_shared on public.%I',t);
      execute format('create trigger zz_ob_building_shared before insert or update or delete on public.%I for each row execute function public.ob_building_guard_shared()',t);
    end if;
  end loop;
end $$;
create or replace function public.ob_building_guard_identity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_table_name='buildings' then
    if old.property_id<>new.property_id and exists(select 1 from public.ob_inspection_buildings where building_id=new.id) then raise exception 'OB_ROUND_FOREIGN'; end if;
  else
    if not exists(select 1 from public.inspections i join public.buildings b on b.property_id=i.property_id where i.id=new.inspection_id and b.id=new.building_id) then raise exception 'OB_ROUND_FOREIGN'; end if;
  end if;
  return new;
end $$;
drop trigger if exists ob_building_guard_identity on public.buildings;
create trigger ob_building_guard_identity before update on public.buildings for each row execute function public.ob_building_guard_identity();
drop trigger if exists ob_building_guard_identity on public.ob_inspection_buildings;
create trigger ob_building_guard_identity before insert or update on public.ob_inspection_buildings for each row execute function public.ob_building_guard_identity();

-- Freeze only a coherent snapshot. Old render/delivery clients cannot silently
-- publish only the main building of an activated inspection.
create or replace function public.ob_building_guard_report()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_revision bigint; begin
  perform 1 from public.inspections where id=new.inspection_id for update;
  select revision into v_revision from public.ob_inspection_structure where inspection_id=new.inspection_id;
  if v_revision is not null and (new.snapshot_payload->'reportData'->>'obBuildingRevision')::bigint is distinct from v_revision then raise exception 'OB_BUILDING_REPORT_STALE'; end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.inspection_report_links') is not null then
    drop trigger if exists ob_building_guard_report on public.inspection_report_links;
    create trigger ob_building_guard_report before insert on public.inspection_report_links for each row execute function public.ob_building_guard_report();
  end if;
end $$;
notify pgrst,'reload schema';
commit;
-- Rollout remains OFF. Enabling ob_building_rollout is a separately approved
-- operation AFTER staging + report/PDF acceptance and backup verification.
