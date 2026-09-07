-- MANUAL FOLLOW-UP ONLY: deploy the classification-free application first.
-- Verify a restorable backup and inspect production dependencies before running.
-- Change BOTH confirmations below to true only after those checks.
-- Never use CASCADE here: unknown dependencies must stop the cleanup.
begin;

set local lock_timeout = '5s';

do $cleanup$
declare
  code_is_deployed boolean := false;
  backup_is_verified boolean := false;
begin
  if not code_is_deployed or not backup_is_verified then
    raise exception 'Deploy the classification-free code and verify a backup before confirming this cleanup.';
  end if;

  if exists (
    select 1 from pg_attribute
    where attrelid = to_regclass('public.renovation_case_checks')
      and attnum > 0 and not attisdropped
      and attname not in (
        'id', 'case_id', 'affects_structure', 'affects_plumbing',
        'affects_ventilation', 'affects_electrical', 'affects_wet_room',
        'affects_surface_only', 'created_at', 'updated_at'
      )
  ) then
    raise exception 'renovation_case_checks contains unexpected columns. Inspect them before cleanup.';
  end if;
end;
$cleanup$;

alter table if exists public.renovation_action_types
  drop column if exists implies_structure restrict,
  drop column if exists implies_plumbing restrict,
  drop column if exists implies_ventilation restrict,
  drop column if exists implies_electrical restrict,
  drop column if exists implies_wet_room restrict,
  drop column if exists implies_surface_only restrict;

drop table if exists public.renovation_case_checks restrict;

-- The shared renoapp_set_updated_at() function and all other tables stay intact.
commit;
