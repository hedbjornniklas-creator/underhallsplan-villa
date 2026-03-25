-- Attach lock write-guards for moisture control tables
-- Date: 2026-03-25
-- Prerequisite:
--  - 2026-03-24_03_inspection_lock_write_guards.sql

do $$
declare
  v_table text;
  v_tables text[] := array[
    'inspection_moisture_controls',
    'inspection_moisture_control_rows'
  ];
begin
  if to_regprocedure('public.guard_locked_inspection_child_write()') is null then
    raise notice 'guard_locked_inspection_child_write() saknas, hoppar över triggerkoppling.';
    return;
  end if;

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
