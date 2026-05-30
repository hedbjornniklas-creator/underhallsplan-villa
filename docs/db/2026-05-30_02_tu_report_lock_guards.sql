-- Technical investigations report lock guards
-- Date: 2026-05-30
-- Scope:
-- 1) Ensure TU detail/image/document rows are protected by the inspection lock guard
-- 2) Keep TU reports immutable after "skicka och lås"

do $$
declare
  v_table text;
  v_tables text[] := array[
    'technical_investigation_details',
    'technical_investigation_images',
    'technical_investigation_documents'
  ];
begin
  if to_regprocedure('public.guard_locked_inspection_child_write()') is null then
    raise notice 'guard_locked_inspection_child_write() is missing; apply inspection lock migration first.';
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
