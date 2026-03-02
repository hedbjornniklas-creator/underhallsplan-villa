-- Insida defaults guard (forward only, no mutation of existing inspections)
-- Date: 2026-02-25
-- Prerequisites:
--  - 2026-02-18_ob_snapshot_and_locks.sql

-- This migration intentionally does NOT:
-- - normalize/update existing rows
-- - dedupe/delete existing rows
-- - backfill all old inspections
-- - add unique indexes that may fail due to existing duplicates
--
-- It only ensures behavior for NEW inspections via trigger + function.

create or replace function public.ensure_inspection_default_other_room_and_points(
  p_inspection_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_other_label text;
begin
  if p_inspection_id is null then
    return;
  end if;

  -- Serialize per inspection id for this function path.
  perform pg_advisory_xact_lock(hashtext('insida_default_other_room'), hashtext(p_inspection_id::text));

  select r.id
    into v_room_id
  from public.inspection_interior_rooms r
  where r.inspection_id = p_inspection_id
    and lower(btrim(r.room_type_key)) in ('ovrigt', U&'\00F6vrigt')
    and lower(btrim(r.floor_label)) in ('ovrigt', U&'\00F6vrigt')
  order by r.created_at asc, r.id asc
  limit 1;

  if v_room_id is null then
    select rt.label
      into v_other_label
    from public.settings_interior_room_types rt
    where rt.is_active = true
      and lower(btrim(rt.key)) in ('ovrigt', U&'\00F6vrigt')
    order by rt.sort_order asc, rt.created_at asc, rt.id asc
    limit 1;

    if v_other_label is null or btrim(v_other_label) = '' then
      v_other_label := U&'Allm\00E4nt';
    end if;

    insert into public.inspection_interior_rooms (
      inspection_id,
      floor_label,
      order_index,
      room_type_key,
      room_label,
      values,
      note
    ) values (
      p_inspection_id,
      'ovrigt',
      0,
      'ovrigt',
      v_other_label,
      '{}'::jsonb,
      null
    )
    returning id into v_room_id;

    if v_room_id is null then
      select r.id
        into v_room_id
      from public.inspection_interior_rooms r
      where r.inspection_id = p_inspection_id
        and lower(btrim(r.room_type_key)) in ('ovrigt', U&'\00F6vrigt')
        and lower(btrim(r.floor_label)) in ('ovrigt', U&'\00F6vrigt')
      order by r.created_at asc, r.id asc
      limit 1;
    end if;
  end if;

  if v_room_id is null then
    return;
  end if;

  insert into public.inspection_control_items (
    inspection_id,
    interior_room_id,
    control_point_id,
    title,
    status,
    note,
    sort_order,
    selected_outcome_id
  )
  select
    p_inspection_id,
    v_room_id,
    cp.id,
    coalesce(nullif(cp.title, ''), cp.label, cp.key),
    null,
    null,
    base.max_sort +
      (row_number() over (order by coalesce(cp.sort_order, 1000000), cp.key) * 10),
    null
  from public.settings_control_points cp
  cross join lateral (
    select coalesce(max(ci.sort_order), 0) as max_sort
    from public.inspection_control_items ci
    where ci.interior_room_id = v_room_id
  ) as base
  where cp.scope = 'interior'
    and cp.is_active = true
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(cp.trigger_room_types, '[]'::jsonb)) as rt(v)
      where lower(btrim(rt.v)) in ('ovrigt', U&'\00F6vrigt')
    )
    and not exists (
      select 1
      from public.inspection_control_items ci
      where ci.interior_room_id = v_room_id
        and ci.control_point_id = cp.id
    );
end;
$$;

create or replace function public.trg_inspections_ensure_default_other_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_inspection_default_other_room_and_points(new.id);
  return new;
end;
$$;

drop trigger if exists trg_inspections_ensure_default_other_room on public.inspections;
create trigger trg_inspections_ensure_default_other_room
after insert on public.inspections
for each row execute function public.trg_inspections_ensure_default_other_room();
