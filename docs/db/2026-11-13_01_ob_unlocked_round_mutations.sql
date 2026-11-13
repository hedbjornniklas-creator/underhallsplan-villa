-- OB: an explicitly unlocked inspection can still have status completed/klar/done.
-- Use the actual lock for both legacy and building-scoped round commands.
-- No inspection, note, report snapshot, PDF reference or customer link is changed.
begin;

do $migration$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
  v_old_guard constant text := $guard$if i.locked_at is not null or lower(coalesce(i.status, '')) in ('completed','klar','done') then raise exception 'OB_ROUND_LOCKED'; end if;$guard$;
  v_new_guard constant text := $guard$if i.locked_at is not null then raise exception 'OB_ROUND_LOCKED'; end if;$guard$;
  v_matches integer;
begin
  foreach v_signature in array array[
    'public.ob_round_mutate(uuid,uuid,uuid,text,jsonb,text[])',
    'public.ob_building_round_mutate(uuid,uuid,uuid,text,jsonb,uuid,text[])'
  ] loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'OB_UNLOCK_ROUND_FUNCTION_MISSING: %', v_signature;
    end if;
    v_definition := pg_get_functiondef(v_function);
    v_matches := (length(v_definition) - length(replace(v_definition, v_old_guard, ''))) / length(v_old_guard);
    if v_matches = 1 then
      -- Retain the installed body, owner, permissions, arguments and security settings.
      -- Abort rather than guessing if another version has a different lock guard.
      execute replace(v_definition, v_old_guard, v_new_guard);
    elsif v_matches <> 0 or strpos(v_definition, v_new_guard) = 0 then
      raise exception 'OB_UNLOCK_ROUND_GUARD_UNRECOGNIZED: %', v_signature;
    end if;
  end loop;
end
$migration$;

commit;
