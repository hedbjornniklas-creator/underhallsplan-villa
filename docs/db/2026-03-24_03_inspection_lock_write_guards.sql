-- Inspection lock write guards (DB-level enforcement)
-- Date: 2026-03-24
-- Additive only / rollback-safe:
--  - Prevents writes to inspection payload tables when inspection is locked
--  - Prevents mutation/deletion of locked inspection rows (except lock metadata)

create or replace function public.raise_if_inspection_locked(
  p_inspection_id uuid,
  p_table_name text
)
returns void
language plpgsql
as $$
declare
  v_locked_at timestamptz;
begin
  if p_inspection_id is null then
    return;
  end if;

  select i.locked_at
  into v_locked_at
  from public.inspections i
  where i.id = p_inspection_id;

  if v_locked_at is not null then
    raise exception using
      errcode = '55000',
      message = 'Besiktningen är låst och kan inte ändras.',
      detail = format('table=%s inspection_id=%s', coalesce(p_table_name, '?'), p_inspection_id::text);
  end if;
end;
$$;

create or replace function public.guard_locked_inspection_child_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.raise_if_inspection_locked(new.inspection_id, tg_table_name);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    perform public.raise_if_inspection_locked(old.inspection_id, tg_table_name);
    perform public.raise_if_inspection_locked(new.inspection_id, tg_table_name);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.raise_if_inspection_locked(old.inspection_id, tg_table_name);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.guard_locked_inspections_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then
      raise exception using
        errcode = '55000',
        message = 'Låst besiktning kan inte raderas.',
        detail = format('inspection_id=%s', old.id::text);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.locked_at is not null then
      if (to_jsonb(new) - array['locked_at', 'locked_by', 'updated_at'])
        <> (to_jsonb(old) - array['locked_at', 'locked_by', 'updated_at']) then
        raise exception using
          errcode = '55000',
          message = 'Låst besiktning kan inte ändras.',
          detail = format('inspection_id=%s', old.id::text);
      end if;
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_locked_inspections_write on public.inspections;
create trigger trg_guard_locked_inspections_write
before update or delete on public.inspections
for each row
execute function public.guard_locked_inspections_write();

do $$
declare
  v_table text;
  v_tables text[] := array[
    'inspection_conditions',
    'inspection_overview_selections',
    'inspection_documents',
    'inspection_disclosures',
    'inspection_exterior_observations',
    'inspection_interior_rooms',
    'inspection_control_items',
    'inspection_images',
    'inspection_addon_orders',
    'inspection_area_measurements',
    'inspection_area_measurement_rows',
    'ob_property_snapshot'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format(
        'drop trigger if exists trg_guard_locked_inspection_write on public.%I',
        v_table
      );
      execute format(
        'create trigger trg_guard_locked_inspection_write
          before insert or update or delete on public.%I
          for each row
          execute function public.guard_locked_inspection_child_write()',
        v_table
      );
    end if;
  end loop;
end
$$;
