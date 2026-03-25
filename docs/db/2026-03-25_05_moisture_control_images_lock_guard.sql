-- Attach lock write-guard for moisture control images
-- Date: 2026-03-25
-- Prerequisite:
--  - 2026-03-24_03_inspection_lock_write_guards.sql

do $$
begin
  if to_regprocedure('public.guard_locked_inspection_child_write()') is null then
    raise notice 'guard_locked_inspection_child_write() saknas, hoppar over triggerkoppling.';
    return;
  end if;

  if to_regclass('public.inspection_moisture_control_images') is not null then
    execute 'drop trigger if exists trg_guard_locked_inspection_write on public.inspection_moisture_control_images';
    execute 'create trigger trg_guard_locked_inspection_write
      before insert or update or delete on public.inspection_moisture_control_images
      for each row
      execute function public.guard_locked_inspection_child_write()';
  end if;
end
$$;
