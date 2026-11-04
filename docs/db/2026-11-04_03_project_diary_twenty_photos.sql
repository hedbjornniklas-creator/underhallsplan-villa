-- Requires 2026-11-04_02_project_diary_people.sql.
-- Raise only the per-entry limit. Keep ownership, quotas, file sizes and originals unchanged.
begin;
do $migration$
declare
  definition text;
  original text:='jsonb_array_length(p_data->''photoIds'')>8';
  replacement text:='jsonb_array_length(p_data->''photoIds'')>20';
begin
  definition:=pg_get_functiondef('public.project_diary_people_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure);
  if position(original in definition)>0 then
    if cardinality(string_to_array(definition,original))<>2 or position(replacement in definition)>0 then
      raise exception 'PROJECT_DIARY_PHOTO_LIMIT_MIGRATION_SOURCE_MISMATCH';
    end if;
    execute replace(definition,original,replacement);
  elsif cardinality(string_to_array(definition,replacement))<>2 then
    raise exception 'PROJECT_DIARY_PHOTO_LIMIT_MIGRATION_SOURCE_MISMATCH';
  end if;
end $migration$;
notify pgrst,'reload schema';
commit;
