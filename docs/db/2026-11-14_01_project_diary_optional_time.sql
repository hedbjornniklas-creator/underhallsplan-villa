-- Optional diary presence times. Existing originals, QR links and business data are unchanged.
-- Requires people, twenty-photo and revision diary migrations.
begin;
alter table public.action_case_diary_entries alter column minutes drop not null;
alter table public.action_case_diary_revisions alter column minutes drop not null;

create or replace function public.project_diary_optional_minutes(body jsonb)
returns integer language plpgsql immutable set search_path=pg_catalog as $$
declare minutes integer; pause integer;
begin
  if jsonb_typeof(body->'startTime') is distinct from 'string' or jsonb_typeof(body->'endTime') is distinct from 'string'
    or jsonb_typeof(body->'breakMinutes') is distinct from 'number'
    or (body->>'breakMinutes')::numeric<>trunc((body->>'breakMinutes')::numeric)
    or (body->>'breakMinutes')::numeric not between 0 and 1439 then raise exception 'PROJECT_DIARY_INVALID'; end if;
  pause:=(body->>'breakMinutes')::integer;
  if body->>'startTime'='' and body->>'endTime'='' then return null; end if;
  if body->>'startTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or body->>'endTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'PROJECT_DIARY_INVALID'; end if;
  minutes:=extract(epoch from ((body->>'endTime')::time-(body->>'startTime')::time))/60-pause;
  if minutes<=0 or minutes>=1440 then raise exception 'PROJECT_DIARY_INVALID'; end if;
  return minutes;
end $$;
revoke all on function public.project_diary_optional_minutes(jsonb) from public,anon,authenticated,service_role;

-- Patch only the known time guards and calculation, preserving the current
-- permissions, quotas, upload ownership, retry receipts and revision controls.
do $migration$
declare signature text; definition text; original text; replacement text; field text;
begin
  foreach signature in array array['public.project_diary_people_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','public.revise_project_diary_entry(uuid,uuid,uuid,jsonb)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    if position('public.project_diary_optional_minutes(body)' in definition)>0 then continue; end if;
    foreach field in array array['startTime','endTime'] loop
      original:='coalesce(body->>'''||field||''','''') !~ ''^([01][0-9]|2[0-3]):[0-5][0-9]$''';
      replacement:='jsonb_typeof(body->'''||field||''') is distinct from ''string''';
      if cardinality(string_to_array(definition,original))<>2 then raise exception 'PROJECT_DIARY_OPTIONAL_TIME_SOURCE_MISMATCH'; end if;
      definition:=replace(definition,original,replacement);
    end loop;
    original:='minutes:=extract(epoch from ((body->>''endTime'')::time-(body->>''startTime'')::time))/60-(body->>''breakMinutes'')::integer;';
    if cardinality(string_to_array(definition,original))<>2 then raise exception 'PROJECT_DIARY_OPTIONAL_TIME_SOURCE_MISMATCH'; end if;
    execute replace(definition,original,'minutes:=public.project_diary_optional_minutes(body);');
  end loop;
end $migration$;

-- A removed time in a newer version is genuinely absent, not the original's duration.
create or replace view public.action_case_diary_current with (security_invoker=true) as
select e.id,e.org_id,e.action_case_id,e.owner_key,e.request_hash,e.body,e.source_item_id,e.item_title,
  e.actor_profile_id,e.actor_name,e.author_email,e.actor_method,e.email_verified_at,e.minutes,e.work_date,e.received_at,e.person_id,
  coalesce(r.revision,0) revision, coalesce(r.body,e.body) current_body,
  coalesce(r.item_title,e.item_title) current_item_title, case when r.entry_id is null then e.minutes else r.minutes end current_minutes,
  case when r.entry_id is null then e.work_date else (r.body->>'workDate')::date end current_work_date,
  case when r.entry_id is null then e.source_item_id else (r.body->>'itemId')::uuid end current_source_item_id,
  coalesce(r.photo_ids,(select coalesce(array_agg(p.id order by p.position,p.id),'{}'::uuid[]) from public.action_case_diary_photos p where p.entry_id=e.id)) current_photo_ids,
  case when r.revision>0 then r.created_at end edited_at,
  case when r.revision>0 then r.actor_name end edited_by
from public.action_case_diary_entries e
left join lateral (select v.* from public.action_case_diary_revisions v where v.entry_id=e.id order by v.revision desc limit 1) r on true;
revoke all on public.action_case_diary_current from public,anon,authenticated;
grant select on public.action_case_diary_current to service_role;
notify pgrst,'reload schema';
commit;
