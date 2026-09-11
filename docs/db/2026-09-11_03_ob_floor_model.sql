-- OB levels v2. Requires 2026-09-11_01_ob_round_mutations.sql.
-- No backfill. Rollout stays OFF until the compatible application is deployed.
begin;

create table if not exists public.ob_floor_rollout (
  id boolean primary key default true check (id), enabled boolean not null default false
);
insert into public.ob_floor_rollout(id) values(true) on conflict do nothing;
alter table public.ob_floor_rollout enable row level security;
revoke all on public.ob_floor_rollout from public, anon, authenticated;
grant all on public.ob_floor_rollout to service_role;

create or replace function public.ob_valid_floor_levels(v jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare r jsonb; seen integer[] := '{}'; n integer;
begin
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) not between 1 and 64 then return false; end if;
  for r in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(r->'level') is distinct from 'number' or (r->>'level') !~ '^-?[0-9]+$'
      or jsonb_typeof(r->'name') is distinct from 'string' or length(r->>'name') > 80 then return false; end if;
    n := (r->>'level')::integer;
    if n < -99 or n > 199 or n = any(seen) then return false; end if;
    seen := array_append(seen, n);
  end loop;
  return 0 = any(seen);
exception when others then return false;
end $$;

create table if not exists public.inspection_floor_models (
  inspection_id uuid primary key references public.inspections(id) on delete cascade,
  levels jsonb not null default '[{"level":0,"name":"Entr\u00e9plan"}]',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_floor_models_valid check (public.ob_valid_floor_levels(levels))
);
alter table public.inspection_floor_models enable row level security;
revoke all on public.inspection_floor_models from public, anon, authenticated;
grant select on public.inspection_floor_models to authenticated;
grant all on public.inspection_floor_models to service_role;
drop policy if exists inspection_floor_models_read on public.inspection_floor_models;
create policy inspection_floor_models_read on public.inspection_floor_models for select to authenticated
  using (exists(select 1 from public.inspections i where i.id = inspection_id));

create table if not exists public.ob_floor_changes (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  before_data jsonb not null, after_data jsonb not null, created_at timestamptz not null default now()
);
create table if not exists public.ob_auto_rooms (
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  rule_key text not null,
  room_id uuid references public.inspection_interior_rooms(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(inspection_id, rule_key)
);
alter table public.ob_floor_changes enable row level security;
alter table public.ob_auto_rooms enable row level security;
revoke all on public.ob_floor_changes, public.ob_auto_rooms from public, anon, authenticated;
grant all on public.ob_floor_changes, public.ob_auto_rooms to service_role;

create or replace function public.ob_init_floor_model()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if coalesce(new.inspection_family, new.type) = 'OB' and
    exists(select 1 from public.ob_floor_rollout where enabled) then
    insert into public.inspection_floor_models(inspection_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_ob_init_floor_model on public.inspections;
create trigger trg_ob_init_floor_model after insert on public.inspections
  for each row execute function public.ob_init_floor_model();

-- Only new/changed placements are checked. Historical IDs and provenance are never rewritten.
create or replace function public.ob_guard_floor_key()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_key text; v_levels jsonb;
begin
  v_key := to_jsonb(new)->>tg_argv[0];
  if tg_op = 'UPDATE' and v_key is not distinct from (to_jsonb(old)->>tg_argv[0])
    and old.inspection_id = new.inspection_id then return new; end if;
  perform 1 from public.inspections where id = new.inspection_id for update;
  select levels into v_levels from public.inspection_floor_models where inspection_id = new.inspection_id;
  if v_levels is null or v_key is null or v_key in ('ovrigt', U&'\00F6vrigt') then return new; end if;
  if not exists(select 1 from jsonb_array_elements(v_levels) r where 'plan' || (r->>'level') = v_key) then
    raise exception 'OB_FLOOR_UNKNOWN';
  end if;
  return new;
end $$;
drop trigger if exists trg_ob_guard_floor_key on public.inspection_interior_rooms;
create trigger trg_ob_guard_floor_key before insert or update on public.inspection_interior_rooms
  for each row execute function public.ob_guard_floor_key('floor_label');
drop trigger if exists trg_ob_guard_floor_key on public.inspection_overview_selections;
create trigger trg_ob_guard_floor_key before insert or update on public.inspection_overview_selections
  for each row execute function public.ob_guard_floor_key('floor_key');
drop trigger if exists trg_ob_guard_floor_key on public.inspection_images;
create trigger trg_ob_guard_floor_key before insert or update on public.inspection_images
  for each row execute function public.ob_guard_floor_key('origin_floor_label');

create or replace function public.ob_save_floor_model(
  p_inspection_id uuid, p_org_id uuid, p_actor uuid, p_revision integer, p_levels jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare m public.inspection_floor_models; v_removed text[]; v_result jsonb;
begin
  -- Reuse the owner/org checks, assignment-then-inspection lock order and workflow guards.
  perform public.ob_round_mutate(p_inspection_id, p_org_id, p_actor, 'floor-context', '{}');
  select * into m from public.inspection_floor_models where inspection_id = p_inspection_id for update;
  if not found then raise exception 'OB_FLOOR_LEGACY'; end if;
  if not public.ob_valid_floor_levels(p_levels) then raise exception 'OB_ROUND_INVALID'; end if;
  if m.revision is distinct from p_revision then raise exception 'OB_ROUND_STALE'; end if;
  select array_agg('plan' || (r->>'level')) into v_removed from jsonb_array_elements(m.levels) r
    where not exists(select 1 from jsonb_array_elements(p_levels) n where n->'level' = r->'level');
  if exists(select 1 from public.inspection_interior_rooms where inspection_id = m.inspection_id and floor_label = any(v_removed))
    or exists(select 1 from public.inspection_overview_selections where inspection_id = m.inspection_id and floor_key = any(v_removed))
    or exists(select 1 from public.inspection_images where inspection_id = m.inspection_id and origin_floor_label = any(v_removed)) then
    raise exception 'OB_FLOOR_IN_USE';
  end if;
  update public.inspection_floor_models set levels = p_levels, revision = revision + 1, updated_at = now()
    where inspection_id = m.inspection_id returning to_jsonb(inspection_floor_models.*) into v_result;
  insert into public.ob_floor_changes(inspection_id, actor_id, before_data, after_data)
    values(m.inspection_id, p_actor, to_jsonb(m), v_result);
  return v_result;
end $$;
revoke all on function public.ob_save_floor_model(uuid,uuid,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.ob_save_floor_model(uuid,uuid,uuid,integer,jsonb) to service_role;

insert into public.settings_interior_room_types(key,label,sort_order,is_active)
  select 'kallare', U&'K\00E4llare', coalesce(max(sort_order),0) + 10, true
  from public.settings_interior_room_types
  on conflict (key) do nothing;

create or replace function public.ob_ensure_basement_room()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_room uuid; i public.inspections;
begin
  if not exists(select 1 from public.inspection_floor_models where inspection_id = new.inspection_id)
    or exists(select 1 from public.ob_auto_rooms where inspection_id = new.inspection_id and rule_key = 'basement') then return new; end if;
  select * into i from public.inspections where id = new.inspection_id for update;
  if i.locked_at is not null or lower(coalesce(i.status,'')) in ('completed','klar','done')
    or coalesce((public.ob_assignment_workflow_state(i.id)->>'paused')::boolean,false) then return new; end if;
  if not exists (
    select 1 from public.inspection_overview_selections s
    join public.settings_overview_items it on it.id = s.overview_item_id and it.key = 'building_type'
    join public.settings_overview_groups g on g.overview_item_id = it.id and g.key in ('basement','kallare',U&'k\00E4llare')
    join public.settings_overview_options o on o.group_id = g.id and o.value = s.values->>g.key
    where s.inspection_id = i.id and lower(btrim(o.system_value)) in ('ja','yes','true')
      and s.set_index = (select min(s2.set_index) from public.inspection_overview_selections s2
        where s2.inspection_id = i.id and s2.overview_item_id = it.id)
  ) then return new; end if;
  -- The marker survives a user's move, rename or deletion of the auto-created room.
  insert into public.ob_auto_rooms(inspection_id,rule_key) values(i.id,'basement') on conflict do nothing;
  if not found then return new; end if;
  select id into v_room from public.inspection_interior_rooms where inspection_id = i.id
    and floor_label = 'ovrigt' and (room_type_key = 'kallare' or lower(btrim(room_label)) = U&'k\00E4llare')
    order by order_index, id limit 1;
  if v_room is null then
    insert into public.inspection_interior_rooms(inspection_id,floor_label,room_type_key,room_label,order_index,values)
    select i.id,'ovrigt','kallare',U&'K\00E4llare',coalesce(max(order_index),0) + 10,'{}'::jsonb
    from public.inspection_interior_rooms where inspection_id = i.id and floor_label = 'ovrigt'
    returning id into v_room;
  end if;
  update public.ob_auto_rooms set room_id = v_room where inspection_id = i.id and rule_key = 'basement';
  return new;
end $$;
drop trigger if exists trg_ob_ensure_basement_room on public.inspection_overview_selections;
create trigger trg_ob_ensure_basement_room after insert or update on public.inspection_overview_selections
  for each row execute function public.ob_ensure_basement_room();
commit;
