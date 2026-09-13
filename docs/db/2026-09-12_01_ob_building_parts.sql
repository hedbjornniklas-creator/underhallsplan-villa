-- OB building scope. Additive: NO backfill or activation of real inspections.
-- Requires OB migrations through 2026-09-11_07. Install commands and compatible
-- application before the separately approved index cutover and rollout.
begin;
create table if not exists public.ob_building_rollout (
  id boolean primary key default true check(id), enabled boolean not null default false
);
insert into public.ob_building_rollout(id) values(true) on conflict do nothing;
alter table public.ob_building_rollout enable row level security;
revoke all on public.ob_building_rollout from public, anon, authenticated;
grant all on public.ob_building_rollout to service_role;

create table if not exists public.settings_ob_building_categories (
  key text primary key, label text not null, sort_order integer not null, is_active boolean not null default true
);
insert into public.settings_ob_building_categories(key,label,sort_order) values
  ('main','Huvudbyggnad',0),('attefall','Attefallshus',100),('friggebod','Friggebod',200),
  ('guesthouse',U&'G\00E4sthus',300),('garage','Garage',400),('complement','Komplementbyggnad',500)
  on conflict do nothing;
alter table public.settings_ob_building_categories enable row level security;
grant select on public.settings_ob_building_categories to authenticated;
drop policy if exists ob_building_categories_read on public.settings_ob_building_categories;
create policy ob_building_categories_read on public.settings_ob_building_categories for select to authenticated using(true);

create table if not exists public.ob_inspection_buildings (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete restrict,
  building_id uuid not null references public.buildings(id) on delete restrict,
  name text not null check(length(btrim(name)) between 1 and 100),
  category_key text not null references public.settings_ob_building_categories(key) on delete restrict,
  cover_path text, scope_note text, sort_order integer not null default 100,
  revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,inspection_id), unique(inspection_id,building_id)
);
create table if not exists public.ob_inspection_structure (
  inspection_id uuid primary key references public.inspections(id) on delete restrict,
  primary_part_id uuid not null,
  revision bigint not null default 1, activated_by uuid not null references public.profiles(id),
  activated_at timestamptz not null default now(),
  foreign key(primary_part_id,inspection_id) references public.ob_inspection_buildings(id,inspection_id) on delete restrict
);
create table if not exists public.ob_building_floor_models (
  building_part_id uuid primary key, inspection_id uuid not null,
  levels jsonb, revision integer not null default 1,
  foreign key(building_part_id,inspection_id) references public.ob_inspection_buildings(id,inspection_id) on delete restrict,
  check(levels is null or public.ob_valid_floor_levels(levels))
);
-- Copy field shapes, NOT inspection-level unique indexes or data.
create table if not exists public.ob_building_conditions (like public.inspection_conditions including defaults including constraints);
alter table public.ob_building_conditions add column if not exists building_part_id uuid,
  add column if not exists ob_revision integer not null default 1;
alter table public.ob_building_conditions alter column building_part_id set not null;
create unique index if not exists ob_building_conditions_id_idx on public.ob_building_conditions(id);
create unique index if not exists ob_building_conditions_part_idx on public.ob_building_conditions(building_part_id);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='ob_building_conditions_part_fk') then
    alter table public.ob_building_conditions add constraint ob_building_conditions_part_fk
      foreign key(building_part_id,inspection_id) references public.ob_inspection_buildings(id,inspection_id) on delete restrict;
  end if;
end $$;
create table if not exists public.ob_building_auto_rooms (
  building_part_id uuid not null references public.ob_inspection_buildings(id) on delete restrict,
  rule_key text not null, room_id uuid references public.inspection_interior_rooms(id) on delete set null,
  primary key(building_part_id,rule_key)
);
create table if not exists public.ob_building_events (
  id uuid primary key default gen_random_uuid(), inspection_id uuid not null references public.inspections(id) on delete restrict,
  request_id uuid not null, actor_id uuid not null references public.profiles(id),
  operation text not null, request jsonb not null, before_data jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), unique(inspection_id,request_id)
);
do $$ declare t text; begin
  foreach t in array array['inspection_interior_rooms','inspection_exterior_observations','inspection_control_items',
    'inspection_overview_selections','inspection_images','inspection_round_quick_notes'] loop
    execute format('alter table public.%I add column if not exists building_part_id uuid, add column if not exists ob_revision integer not null default 1',t);
    if not exists(select 1 from pg_constraint where conname=t || '_ob_part_fk') then
      execute format('alter table public.%I add constraint %I foreign key(building_part_id,inspection_id) references public.ob_inspection_buildings(id,inspection_id) on delete restrict',t,t || '_ob_part_fk');
    end if;
    execute format('create index if not exists %I on public.%I(inspection_id,building_part_id)',t || '_ob_part_idx',t);
  end loop;
end $$;
alter table public.inspection_images add column if not exists origin_building_part_id uuid references public.ob_inspection_buildings(id) on delete restrict;
do $$ declare t text; begin
  foreach t in array array['ob_inspection_structure','ob_inspection_buildings','ob_building_floor_models','ob_building_conditions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('drop policy if exists ob_building_owner_read on public.%I',t);
    execute format('create policy ob_building_owner_read on public.%I for select to authenticated using
      (exists(select 1 from public.inspections i join public.properties p on p.id=i.property_id where i.id=inspection_id and p.owner=auth.uid()))',t);
  end loop;
end $$;
alter table public.ob_building_events enable row level security;
alter table public.ob_building_auto_rooms enable row level security;
revoke all on public.ob_building_events,public.ob_building_auto_rooms from public,anon,authenticated;
grant all on public.ob_building_events,public.ob_building_auto_rooms to service_role;

create or replace function public.ob_building_guard_row()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb; b jsonb; v_inspection uuid; v_part uuid; v_parent uuid; v_levels jsonb; v_floor text; v_key text;
begin
  r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  b := case when tg_op='UPDATE' then to_jsonb(old) else r end;
  v_inspection := (r->>'inspection_id')::uuid;
  if not exists(select 1 from public.ob_inspection_structure where inspection_id=v_inspection)
    and not exists(select 1 from public.ob_inspection_structure where inspection_id=(b->>'inspection_id')::uuid) then
    if r->>'building_part_id' is not null then raise exception 'OB_BUILDING_NOT_ACTIVE'; end if;
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if coalesce(current_setting('ob.building_command',true),'') <> v_inspection::text
    or coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
      nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' then raise exception 'OB_BUILDING_CLIENT_REQUIRED'; end if;
  perform public.raise_if_inspection_locked(v_inspection,tg_table_name);
  if coalesce((public.ob_assignment_workflow_state(v_inspection)->>'paused')::boolean,false) then raise exception 'OB_ROUND_PAUSED'; end if;
  if (b->>'inspection_id')::uuid <> v_inspection then raise exception 'OB_ROUND_FOREIGN'; end if;
  if tg_op='DELETE' then
    update public.ob_inspection_structure set revision=revision+1 where inspection_id=v_inspection;
    return old;
  end if;
  v_part := (r->>'building_part_id')::uuid;
  if v_part is null and tg_table_name <> 'inspection_images' then raise exception 'OB_BUILDING_REQUIRED'; end if;
  if v_part is not null and not exists(select 1 from public.ob_inspection_buildings where id=v_part and inspection_id=v_inspection) then raise exception 'OB_ROUND_FOREIGN'; end if;
  foreach v_key in array array['interior_room_id','exterior_observation_id','control_item_id'] loop
    if r->>v_key is not null then
      if v_key='interior_room_id' then select building_part_id into v_parent from public.inspection_interior_rooms where id=(r->>v_key)::uuid and inspection_id=v_inspection;
      elsif v_key='exterior_observation_id' then select building_part_id into v_parent from public.inspection_exterior_observations where id=(r->>v_key)::uuid and inspection_id=v_inspection;
      else select building_part_id into v_parent from public.inspection_control_items where id=(r->>v_key)::uuid and inspection_id=v_inspection; end if;
      if not found or v_parent is distinct from v_part then raise exception 'OB_ROUND_FOREIGN'; end if;
    end if;
  end loop;
  if r->>'interior_room_id' is not null and r->>'exterior_observation_id' is not null then raise exception 'OB_ROUND_FOREIGN'; end if;
  if tg_table_name='inspection_images' then
    if tg_op='UPDATE' and current_setting('ob.building_activation',true) is distinct from 'true' and
      (r->>'origin_building_part_id' is distinct from b->>'origin_building_part_id' or r->>'file_path' is distinct from b->>'file_path') then raise exception 'OB_ROUND_STALE'; end if;
    if r->>'origin_building_part_id' is not null and not exists(select 1 from public.ob_inspection_buildings
      where id=(r->>'origin_building_part_id')::uuid and inspection_id=v_inspection) then raise exception 'OB_ROUND_FOREIGN'; end if;
  end if;
  v_floor := case when tg_table_name='inspection_interior_rooms' then r->>'floor_label'
    when tg_table_name='inspection_overview_selections' then r->>'floor_key' end;
  select levels into v_levels from public.ob_building_floor_models where building_part_id=v_part;
  if v_floor is not null and v_floor not in ('ovrigt',U&'\00F6vrigt') and v_levels is not null
    and not exists(select 1 from jsonb_array_elements(v_levels) x where 'plan' || (x->>'level')=v_floor) then raise exception 'OB_FLOOR_UNKNOWN'; end if;
  new.ob_revision := case when tg_op='UPDATE' then old.ob_revision+1 else 1 end;
  update public.ob_inspection_structure set revision=revision+1 where inspection_id=v_inspection;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['inspection_interior_rooms','inspection_exterior_observations','inspection_control_items',
    'inspection_overview_selections','inspection_images','inspection_round_quick_notes','ob_building_conditions'] loop
    execute format('drop trigger if exists zz_ob_building_guard on public.%I',t);
    execute format('create trigger zz_ob_building_guard before insert or update or delete on public.%I for each row execute function public.ob_building_guard_row()',t);
  end loop;
end $$;
commit;
